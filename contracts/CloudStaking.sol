// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

/*
 * Developer Note - Potential Improvement:
 *
 * Currently, rewards are computed only at the moment of claim, using the instantaneous APR.
 * An alternative approach would be to periodically update and account for rewards locally.
 *
 * By doing so, the contract could track the accrued rewards over time, effectively averaging the APR
 * rather than applying a single rate at claim time. This might provide a fairer reward calculation,
 * especially in scenarios where the APR fluctuates.
 *
 */

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

interface ICloudStakeVault {
    function deposit             (address user, uint256 amount)  external;
    function withdraw            (address user, uint256 amount)  external;
    function getDepositedBalance (address user)                  external view returns (uint256);
}

interface ICloudRewardPool {
    function distributeRewards   (address user, uint256 amount)  external;
    function getRewardBalance    ()                              external view returns (uint256);
}

interface ICloudUtils {
    function getCirculatingSupply()                              external view returns (uint256);
}

interface ICloudGovernor {
    function getLastActivityTime  (address user)                 external view returns (uint256);
}

contract CloudStaking is Initializable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;

    IERC20              public cloudToken;
    ICloudStakeVault    public cloudStakeVault;
    ICloudRewardPool    public cloudRewardPool;
    ICloudUtils         public cloudUtils;

    uint256 public totalStakers;
    uint256 public totalStaked;
    uint256 public totalStakedForTally;
    uint256 private minStakeAmount;
    uint256 private cooldown;
    uint256 private governanceInactivityThreshold;
    uint256 private autoUnstakePeriod;
    uint256 private aprMin;
    uint256 private aprMax;
    uint256 private stakedCircSupplyMin;
    uint256 private stakedCircSupplyMax;
    uint256 private maintenanceBatchSize;
    uint256 public lastProcessedStaker;
    uint256 public forceFailTest; // Control success/failure

    struct Staker {
        uint256 stakedAmount;
        uint256 lastRewardClaimTime;
        uint256 unstakingAmount;
        uint256 unstakingStartTime;
        uint256 totalEarnedRewards;
        uint256 lastActivityTime;
        bool    isActive;
    }
    mapping(address => Staker) public stakers;
    address[] public stakerList;
    mapping(address => uint256) private stakerIndex;

    struct StakeCheckpoint {
        uint256 blockNumber;
        uint256 amount;
    }
    mapping(address => StakeCheckpoint[]) private stakedCheckpoints;

    ICloudGovernor      public cloudGovernor;

    event Staked                    (address indexed staker, uint256 stakedAmount);
    event RewardsClaimed            (address indexed staker, uint256 rewards);
    event Unstaking                 (address indexed staker, uint256 amount);
    event Unstaked                  (address indexed staker, uint256 amount);
    event UnstakeCancelled          (address indexed staker, uint256 amount);
    event StakerData                (address indexed staker, uint256 totalStakedAmount);
    event StakerDeactivated         (address indexed staker, uint256 stakedAmount);
    event StakerReactivated         (address indexed staker, uint256 stakedAmount);
    event AutoUnstaked              (address indexed staker, uint256 amount);
    event handleInactivityProcessed (uint256 lastProcessedStaker);
    event handleInactivityCompleted ();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the contract replacing a constructor
    function initialize(address _cloudToken, address _cloudStakeVault, address _cloudRewardPool, address _cloudUtils) public initializer {
        require(_cloudToken         != address(0), "Invalid token address");
        require(_cloudStakeVault    != address(0), "Invalid stake vault address");
        require(_cloudRewardPool    != address(0), "Invalid reward pool address");
        require(_cloudUtils         != address(0), "Invalid utils contract address");

        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        cloudToken          = IERC20(_cloudToken);
        cloudStakeVault     = ICloudStakeVault(_cloudStakeVault);
        cloudRewardPool     = ICloudRewardPool(_cloudRewardPool);
        cloudUtils          = ICloudUtils(_cloudUtils);
    }

    /// @notice New initializer for the upgraded version that includes the cloudGovernor.
    function initializeV2(address _cloudGovernor) public reinitializer(2) {
        require(_cloudGovernor      != address(0), "Invalid governor address");

        cloudGovernor = ICloudGovernor(_cloudGovernor);
    }

    // Enum to represent each staking parameter.
    enum StakingParam {
        MinStakeAmount,               // 0
        Cooldown,                     // 1
        GovernanceInactivityThreshold,// 2
        AutoUnstakePeriod,            // 3
        AprMin,                       // 4
        AprMax,                       // 5
        StakedCircSupplyMin,          // 6
        StakedCircSupplyMax,          // 7
        maintenanceBatchSize          // 8
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    function getVersion()                                           public pure returns (string memory) {
        return "CloudStaking v1.1";
    }

    function getAprE2()                                             public view returns (uint256) {
        // Normal APR
        uint256 stakedCircSupplyMinE18  = stakedCircSupplyMin * 1e18 / 100;
        uint256 stakedCircSupplyMaxE18  = stakedCircSupplyMax * 1e18 / 100;
        uint256 aprMaxE18               = aprMax * 1e18;

        // -- Formula: APR = aprMax - max(0, min(1, (Staked Percentage - stakedCircSupplyMin) / (stakedCircSupplyMax - stakedCircSupplyMin)) × (aprMax-aprMin)
        uint256 circulatingSupplyE18    = cloudUtils.getCirculatingSupply();
        require(circulatingSupplyE18 > 0,     "Circulating supply must be greater than zero");
        uint256 stakedRatioE18   = (totalStaked * 1e18) / circulatingSupplyE18;

        uint256 factorE18;
        if        (stakedRatioE18 <= stakedCircSupplyMinE18) {
            factorE18 = 0;
        } else if (stakedRatioE18 >= stakedCircSupplyMaxE18) {
            factorE18 = 1e18;
        } else {
            factorE18 = (stakedRatioE18 - stakedCircSupplyMinE18) * 1e18 / (stakedCircSupplyMaxE18 - stakedCircSupplyMinE18);
        }
        uint256 aprE18 = aprMaxE18 - (factorE18 * (aprMax - aprMin));
        uint256 aprE2  = aprE18 / 1e16; // converting from 1e18 to 1e2 format

        // Fallback APR
        uint256 availableReward         = cloudRewardPool.getRewardBalance();

        // -- Formula: APR  = (availableReward / totalStaked) × 100
        if(totalStaked * aprE2 / 10000 > availableReward)
        {
            aprE18 = (totalStaked == 0) ? 0 : availableReward * 100 * 1e18 / totalStaked;
            aprE2  = aprE18 / 1e16;
        }

        if(aprE2 > 5000) aprE2 = 5000; // hard security in case a param is corrupted
 
        return aprE2;
    }

    function calculateRewards(address stakerAddr)                   public view returns (uint256) {
        Staker memory st = stakers[stakerAddr];

        require(st.lastRewardClaimTime > 0,        "No rewards history"); // important safety

        uint256 timeElapsed  = block.timestamp - st.lastRewardClaimTime;
        uint256 currentAprE2 = getAprE2();
        uint256 rewards      = (st.stakedAmount * currentAprE2 * timeElapsed) / (10000 * 365 days);

        rewards              = (rewards + 5e8) / 1e9;
        rewards              = rewards * 1e9;

        return rewards;
    }

    function getStakingParams()                                     external view returns (
        uint256 _minStakeAmount,
        uint256 _cooldown,
        uint256 _governanceInactivityThreshold,
        uint256 _autoUnstakePeriod,
        uint256 _aprMin,
        uint256 _aprMax,
        uint256 _stakedCircSupplyMin,
        uint256 _stakedCircSupplyMax,
        uint256 _maintenanceBatchSize
    ) {
        _minStakeAmount                 = minStakeAmount;
        _cooldown                       = cooldown;
        _governanceInactivityThreshold  = governanceInactivityThreshold;
        _autoUnstakePeriod              = autoUnstakePeriod;
        _aprMin                         = aprMin;
        _aprMax                         = aprMax;
        _stakedCircSupplyMin            = stakedCircSupplyMin;
        _stakedCircSupplyMax            = stakedCircSupplyMax;
        _maintenanceBatchSize           = maintenanceBatchSize;
    }

    function getStakersData(address[] memory stakerAddresses)       external view returns (uint256[] memory stakedAmounts, bool[] memory isActives) {
        uint256 length      = stakerAddresses.length;
        stakedAmounts       = new uint256[](length);
        isActives           = new bool[](length);

        for (uint256 i = 0; i < length; i++) {
            Staker storage st       = stakers[stakerAddresses[i]];
            stakedAmounts[i]        = st.stakedAmount;
            isActives[i]            = st.isActive;
        }
    }

    function getAllStakers(uint256 start, uint256 count)            external view returns (address[] memory stakerOuts, uint256[] memory amounts) {
        uint256 listLength = stakerList.length;
        if (start >= listLength) {
            return (new address[](0), new uint256[](0)); //Return empty arrays if `start` is out of bound
        }

        uint256 end = start + count;
        if (end > listLength) {
            end = listLength; // Prevent out-of-bound access
        }

        uint256 actualCount = end - start;
        stakerOuts          = new address[](actualCount);
        amounts             = new uint256[](actualCount);

        for (uint256 i = 0; i < actualCount; i++) {
            address stakerAddr  = stakerList[start + i];
            stakerOuts[i]       = stakerAddr;
            amounts[i]          = stakers[stakerAddr].stakedAmount;
        }

        return (stakerOuts, amounts);
    }

    function userStakedForTally(address stakerAddr, uint256 blockNumber)  external view returns (uint256) {

        StakeCheckpoint[] storage checkpoints = stakedCheckpoints[stakerAddr];

        uint256 length = checkpoints.length;
        if (length == 0) {
            return 0;
        }
        // Iterate backwards: the most recent checkpoint comes last
        for (uint256 i = length; i > 0; i--) {
            if (checkpoints[i - 1].blockNumber <= blockNumber) {
                return checkpoints[i - 1].amount;
            }
        }
        return 0; // If no checkpoint exists for a block <= blockNumber
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================


    function _authorizeUpgrade(address newImplementation)           internal override onlyOwner {}

    function _syncStakerWithVault(address stakerAddr)               internal {
        uint256 depositedBalance = cloudStakeVault.getDepositedBalance(stakerAddr);

        Staker storage st = stakers[stakerAddr];

        if (depositedBalance == 0 && st.stakedAmount > 0) { // i.e., an emergency withdrawal has been initiated or completed in the stake vault
            uint256 amountWithdrawn = st.stakedAmount;

            if (amountWithdrawn >= 1e18) {
                totalStakers--;
            }
            totalStaked -= amountWithdrawn;
            if (st.isActive) {
                totalStakedForTally -= amountWithdrawn;
                _updateStakedCheckpoint(stakerAddr, 0);
            }

            st.stakedAmount = 0;
            st.unstakingAmount = 0;
            st.unstakingStartTime = 0;
        }
    }

    function _initiateUnstake(address stakerAddr, uint256 amount)   internal {
        Staker storage st = stakers[stakerAddr];

        require(amount > 0,                 "Amount must be > 0");
        require(amount <= st.stakedAmount,  "Insufficient staked balance");

        _claimRewards(stakerAddr);  // Claim any pending rewards before modifying the stake balance.

        uint256 previousStake = st.stakedAmount;

        if(previousStake >= 1e18 && previousStake - amount < 1e18) totalStakers--;
        totalStaked             -= amount;
        st.stakedAmount         -= amount;
        st.unstakingAmount      += amount;
        st.unstakingStartTime   = block.timestamp; // resets cooldown
        if(st.isActive) {
            totalStakedForTally     -= amount;
            _updateStakedCheckpoint(stakerAddr, st.stakedAmount);
        }

        emit Unstaking          (stakerAddr, amount);
        emit StakerData         (stakerAddr, st.stakedAmount);
    }

    function _cancelUnstaking(address stakerAddr)                   internal {
        Staker storage st = stakers[stakerAddr];

        if(st.unstakingAmount > 0) {
            uint256 previousStake = st.stakedAmount;
            uint256 amount       = st.unstakingAmount;

            if(previousStake < 1e18 && previousStake + amount >= 1e18) totalStakers++;
            totalStaked            += amount;
            st.stakedAmount        += amount;
            st.unstakingAmount      = 0;
            st.unstakingStartTime   = 0;
            if(st.isActive) {
                totalStakedForTally     += amount;
                _updateStakedCheckpoint(stakerAddr, st.stakedAmount);
            }

            emit UnstakeCancelled (stakerAddr, amount);
        }    
    }

    function _claimRewards(address stakerAddr)                      internal  {

        Staker storage st = stakers[stakerAddr];

        if (st.stakedAmount == 0) {
            return; 
        }

        require(block.timestamp > st.lastRewardClaimTime,   "Already claimed recently");

        uint256 rewards = calculateRewards(stakerAddr);
        require(rewards > 0, "No rewards available");

        st.lastRewardClaimTime   = block.timestamp; // Update last reward claim time BEFORE external call, prevent double claiming before transfer
        st.totalEarnedRewards   += rewards;
        
        cloudRewardPool.distributeRewards(stakerAddr, rewards);

        emit RewardsClaimed(stakerAddr, rewards);
    }

    function _reactivateStaker(address stakerAddr)                  internal {
        Staker storage st = stakers[stakerAddr];

        if (!st.isActive) {
            st.isActive = true;
            totalStakedForTally += st.stakedAmount;
            _updateStakedCheckpoint(stakerAddr, st.stakedAmount);

            emit StakerReactivated(stakerAddr, st.stakedAmount);
        }
    }

    function _deactivateStaker(address stakerAddr)                  internal {
        Staker storage st = stakers[stakerAddr];

        if (st.isActive) {
            st.isActive = false;
            totalStakedForTally -= st.stakedAmount;
            _updateStakedCheckpoint(stakerAddr, 0);

            emit StakerDeactivated(stakerAddr, st.stakedAmount);
        }
    }

    function _updateLastActivity(address stakerAddr)                internal {
        Staker storage st = stakers[stakerAddr];

        st.lastActivityTime = block.timestamp;
    }

    function _handleInactivity(uint256 batchSize)                   internal {

        if (batchSize == 0) return;

        uint256 processedCount      = 0;
        uint256 i                   = lastProcessedStaker;
        uint256 listLength          = stakerList.length;
        

        while (i < listLength && processedCount < batchSize) {

            address stakerAddr = stakerList[i];

            _handleInactivityOne(stakerAddr);
            
            i++;
            processedCount++;
        }

        emit handleInactivityProcessed((i > 0) ? i - 1 : 0);

        lastProcessedStaker = (i >= listLength) ? 0 : i;

        if (lastProcessedStaker == 0) {
            emit handleInactivityCompleted();
        }
    }

    function _handleInactivityOne(address stakerAddr)               internal {

        Staker storage st  = stakers[stakerAddr];        
        uint256 currentTimestamp    = block.timestamp;

        // sync with vault in case of a direct emergency withdraw in the vault
         _syncStakerWithVault(stakerAddr);

        if(st.stakedAmount > 0)
        {
            // ignore in tally
            if(st.isActive) {
                if(currentTimestamp >= st.lastActivityTime + governanceInactivityThreshold) {

                    uint256 lastGovernorActivityTime = cloudGovernor.getLastActivityTime(stakerAddr); // Fetch last recorded activity from the governor

                    if (lastGovernorActivityTime > st.lastActivityTime) { // Update last activity time if governance shows a more recent activity
                        st.lastActivityTime = lastGovernorActivityTime;
                    }

                    if(currentTimestamp >= st.lastActivityTime + governanceInactivityThreshold) {  // If still inactive after checking governance, deactivate the staker
                        _deactivateStaker(stakerAddr);
                    }
                }
            }

            // auto unstake
            if(currentTimestamp >= st.lastActivityTime + autoUnstakePeriod) {
                _initiateUnstake(stakerAddr, st.stakedAmount);

                emit AutoUnstaked(stakerAddr, st.stakedAmount);
            }
        }

        //clean stake check points 
        _cleanStakedCheckpoints(stakerAddr);
    }

    function _updateStakedCheckpoint(address stakerAddr, uint256 newAmount) internal {
        StakeCheckpoint[] storage checkpoints = stakedCheckpoints[stakerAddr];
        uint256 len = checkpoints.length;
        
        if (len > 0 && checkpoints[len - 1].blockNumber == block.number) {
            // Update the existing checkpoint in the current block.
            checkpoints[len - 1].amount = newAmount;
        } else {
            // Create a new checkpoint for the current block.
            checkpoints.push(StakeCheckpoint({
                blockNumber: block.number,
                amount: newAmount
            }));
        }
    }

    function _cleanStakedCheckpoints(address stakerAddr)            internal {
        StakeCheckpoint[] storage checkpoints = stakedCheckpoints[stakerAddr];
        uint256 len = checkpoints.length;
        if (len == 0) return;
        
        uint256 thresholdBlocks = (30 * 24 * 3600) / 2; // 2 sec block time
        
        // Find the first checkpoint that is recent (within 30 days).
        uint256 firstRecent = len;
        for (uint256 i = 0; i < len; i++) {
            if (block.number - checkpoints[i].blockNumber <= thresholdBlocks) {
                firstRecent = i;
                break;
            }
        }
        
        uint256 startIndex;
        if (firstRecent == 0) {
            // All checkpoints are recent – nothing to clean.
            return;
        } else if (firstRecent == len) {
            // All are older than 30 days, so keep only the last one.
            startIndex = len - 1;
        } else {
            // Otherwise, keep the last checkpoint that is older than 30 days.
            startIndex = firstRecent - 1;
        }
        
        // Calculate the new length (checkpoints to keep).
        uint256 newLength = len - startIndex;
        
        // Shift the checkpoints we want to keep to the beginning.
        for (uint256 j = 0; j < newLength; j++) {
            checkpoints[j] = checkpoints[startIndex + j];
        }
        // Remove the excess entries from the end.
        for (uint256 j = 0; j < (len - newLength); j++) {
            checkpoints.pop();
        }
    }

    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================


    /**
     * @notice Updates one or more staking parameters based on the provided keys and values.
     * @param keys An array of keys representing the staking parameters to update.
     *             Each key is a uint8 corresponding to a value in the StakingParam enum.
     * @param values An array of new values for the corresponding parameters.
     */
    function updateStakingParameters(uint8[] calldata keys, uint256[] calldata values)  external onlyOwner whenNotPaused {
        // IMPORTANT: When updating multiple parameters in a single call, the order matters.
        // For example, if both aprMin and aprMax are being updated, ensure that either aprMin is updated before aprMax,
        // or that the final values satisfy the condition (aprMax >= aprMin). Otherwise, the validation check for aprMax may fail.

        require(keys.length == values.length, "Array lengths mismatch");
        for (uint256 i = 0; i < keys.length; i++) {
            if (keys[i] == uint8(StakingParam.MinStakeAmount)) {
                require(values[i] > 0,                          "minStakeAmount must be a positive integer");

                minStakeAmount = values[i];

            } else if (keys[i] == uint8(StakingParam.Cooldown)) {
                require(values[i] > 0,                          "Cooldown must be positive");
                require(values[i] % 1 days == 0,                "Cooldown must be in whole days");
                require(values[i] <= 30 days,                   "Cooldown must be less than 30 days");

                cooldown = values[i];

            } else if (keys[i] == uint8(StakingParam.GovernanceInactivityThreshold)) {
                require(values[i] > 0,                          "GovernanceInactivityThreshold must be positive");
                require(values[i] % 1 days == 0,                "GovernanceInactivityThreshold must be in whole days");

                governanceInactivityThreshold = values[i];

            } else if (keys[i] == uint8(StakingParam.AutoUnstakePeriod)) {
                require(values[i] > 0,                          "AutoUnstakePeriod must be positive");
                require(values[i] % 1 days == 0,                "AutoUnstakePeriod must be in whole days");

                autoUnstakePeriod = values[i];

            } else if (keys[i] == uint8(StakingParam.AprMin)) {
                require(values[i] <= aprMax,                    "aprMin must be <= aprMax");
                require(values[i] <= 100,                       "aprMin must be <= 100");

                aprMin = values[i];

            } else if (keys[i] == uint8(StakingParam.AprMax)) {
                require(values[i] >= aprMin,                    "aprMax must be >= aprMin");
                require(values[i] <= 100,                       "aprMax must be <= 100");

                aprMax = values[i];

            } else if (keys[i] == uint8(StakingParam.StakedCircSupplyMin)) {
                require(values[i] <= stakedCircSupplyMax,       "stakedCircSupplyMin must be <= stakedCircSupplyMax");
                require(values[i] <= 100,                       "stakedCircSupplyMin must be <= 100");

                stakedCircSupplyMin = values[i];

            } else if (keys[i] == uint8(StakingParam.StakedCircSupplyMax)) {
                require(values[i] >  0,                         "stakedCircSupplyMax must be > 0");
                require(values[i] > stakedCircSupplyMin,        "stakedCircSupplyMax must be > stakedCircSupplyMin");
                require(values[i] <= 100,                       "stakedCircSupplyMax must be <= 100");

                stakedCircSupplyMax = values[i];

            } else if (keys[i] == uint8(StakingParam.maintenanceBatchSize)) {
                require(values[i] <= 100,                       "maintenanceBatchSize must be <= 100");

                maintenanceBatchSize = values[i];

             } else {
                revert("Invalid parameter key");
            }
        }
    }

    function handleInactivity(uint256 batchSize)                                        public whenNotPaused nonReentrant {

        _handleInactivity(batchSize);
    }

    function handleInactivityOne(address stakerAddr)                                    public whenNotPaused nonReentrant {

        if (forceFailTest == 1) {
            return;
        } else if (forceFailTest == 2) {
            revert("ForceFailTest: Intentional failure");
        }

        _handleInactivityOne(stakerAddr);
    }

    function stake(uint256 amount)                                                      external whenNotPaused nonReentrant {

        require(tx.origin == msg.sender,                                            "Smart contracts cannot stake");
        require(amount > 0,                                                         "Stake amount must be greater than zero");

        _syncStakerWithVault(msg.sender);

        Staker storage st = stakers[msg.sender];

        require(st.stakedAmount + st.unstakingAmount + amount >= minStakeAmount,        "Total stake below minimum required");
        require(cloudToken.allowance(msg.sender, address(cloudStakeVault)) >= amount,   "Insufficient allowance");

        _reactivateStaker   (msg.sender);

        _claimRewards       (msg.sender);               // Claim any pending rewards before modifying the stake balance.

        _cancelUnstaking    (msg.sender);

        if (stakerIndex[msg.sender] == 0) {     // Create/update staker
            stakerList.push(msg.sender);
            stakerIndex[msg.sender] = stakerList.length; // store index+1
            st.lastRewardClaimTime  = block.timestamp;   // Initialize reward claim time (extra safety)
        }

        uint256 previousStake = st.stakedAmount;

        if(previousStake < 1e18 && previousStake + amount >= 1e18) totalStakers++;
        totalStaked           += amount;
        totalStakedForTally   += amount;
        st.stakedAmount       += amount;
        st.lastRewardClaimTime = block.timestamp;   // Start accruing rewards from now (edge case: old staker that restakes from 0)
        _updateStakedCheckpoint(msg.sender, st.stakedAmount);

        cloudStakeVault.deposit(msg.sender, amount);


        emit Staked     (msg.sender, amount);
        emit StakerData (msg.sender, st.stakedAmount);

        _updateLastActivity(msg.sender);
    }

    function claimRewards()                                                             external whenNotPaused nonReentrant {
        _syncStakerWithVault(msg.sender);

        Staker storage st = stakers[msg.sender];

        require(st.stakedAmount > 0,   "No staked tokens");

        _reactivateStaker   (msg.sender);

        _claimRewards       (msg.sender);

        _updateLastActivity (msg.sender);

        _handleInactivity(maintenanceBatchSize); 
    }

    function initiateUnstake(uint256 amount)                                            external whenNotPaused nonReentrant {
        _syncStakerWithVault(msg.sender);

        _reactivateStaker   (msg.sender); // Reactivate staker if previously inactive

        _initiateUnstake    (msg.sender, amount);

        _updateLastActivity (msg.sender);

        _handleInactivity(maintenanceBatchSize); 
    }

    function cancelUnstaking()                                                          external whenNotPaused nonReentrant {
        _syncStakerWithVault(msg.sender);

        Staker storage st = stakers[msg.sender];

        require(st.unstakingAmount > 0,     "No unstaking in progress");

        _reactivateStaker   (msg.sender); 

        _claimRewards       (msg.sender);      // Claim any pending rewards before modifying the stake balance.

        _cancelUnstaking    (msg.sender);

        _updateLastActivity (msg.sender);

        _handleInactivity    (maintenanceBatchSize);
    }

    function claimUnstakedTokens()                                                      external whenNotPaused nonReentrant {
        _syncStakerWithVault(msg.sender);

        Staker storage st = stakers[msg.sender];

        require(st.unstakingAmount > 0,                                 "No tokens in unstaking process");
        require(block.timestamp >= st.unstakingStartTime + cooldown,    "Cooldown period not passed");

        _reactivateStaker(msg.sender);

        uint256 amountToClaim = st.unstakingAmount;

        st.unstakingAmount      = 0;
        st.unstakingStartTime   = 0;

        cloudStakeVault.withdraw(msg.sender, amountToClaim);

        emit Unstaked   (msg.sender, amountToClaim);
        emit StakerData (msg.sender, st.stakedAmount);

        _updateLastActivity(msg.sender);
    }

    function recoverMistakenTokens(address _token, address _recipient, uint256 _amount) external onlyOwner {
        require(_recipient != address(0),       "Invalid recipient address");

        IERC20(_token).safeTransfer(_recipient, _amount);
    }

    function pause()                                                                    external onlyOwner {
        _pause();
    }

    function unpause()                                                                  external onlyOwner {
        _unpause();
    }

    function setForceFailTest(uint256 _fail)                                            external onlyOwner{
        forceFailTest = _fail;
    }

    // storage gap for upgrade safety, prevents storage conflicts in future versions
    uint256[48] private __gap;
}