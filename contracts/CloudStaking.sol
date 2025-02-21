// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";


interface ICloudStakeVault {
    function deposit            (address user, uint256 amount) external;
    function withdraw           (address user, uint256 amount) external;
}

interface ICloudRewardPool {
    function distributeRewards  (address user, uint256 amount) external;
    function getRewardBalance() external view returns (uint256);
}

interface ICloudUtils {
    function getCirculatingSupply() external view returns (uint256);
}


contract StakingContract is Initializable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    IERC20              public immutable cloudToken;
    ICloudStakeVault    public cloudStakeVault;
    ICloudRewardPool    public cloudRewardPool;
    ICloudUtils         public cloudUtils;

    bool public isPaused;
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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    /// @notice Initializes the contract replacing a constructor
    function initialize(address _cloudToken, address _cloudStakeVault, address _cloudRewardPool, address _cloudUtils) public initializer {
        require(_cloudToken         != address(0), "Invalid token address");
        require(_cloudStakeVault    != address(0), "Invalid stake vault address");
        require(_cloudRewardPool    != address(0), "Invalid reward pool address");
        require(_cloudUtils         != address(0), "Invalid utils contract address");

        __Ownable_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        cloudToken          = IERC20(_cloudToken);
        cloudStakeVault     = ICloudStakeVault(_cloudStakeVault);
        cloudRewardPool     = ICloudRewardPool(_cloudRewardPool);
        cloudUtils          = ICloudUtils(_cloudUtils);
    }

    modifier notPaused() {
        require(!isPaused, "Operation not allowed while contract is paused");
        _;
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
        maintenanceBatchSize,         // 8
    }


    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================


    function pauseContract()                                                            external onlyOwner {
        isPaused = true;
    }

    function unpauseContract()                                                          external onlyOwner {
        isPaused = false;
    }

    /**
     * @notice Updates one or more staking parameters based on the provided keys and values.
     * @param keys An array of keys representing the staking parameters to update.
     *             Each key is a uint8 corresponding to a value in the StakingParam enum.
     * @param values An array of new values for the corresponding parameters.
     * Requirements:
     * - `keys` and `values` arrays must have the same length.
     * - Only the contract owner can call this function.
     */
    function updateStakingParameters(uint8[] calldata keys, uint256[] calldata values)  external onlyOwner notPaused {
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
                require(values[i] <= 30,                        "Cooldown must be less than 30 days");

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
                require(values[i] > stakedCircSupplyMin,       "stakedCircSupplyMax must be > stakedCircSupplyMin");
                require(values[i] <= 100,                       "stakedCircSupplyMax must be <= 100");

                stakedCircSupplyMax = values[i];

            } else if (keys[i] == uint8(StakingParam.maintenanceBatchSize)) {

                maintenanceBatchSize = values[i];
             } else {
                revert("Invalid parameter key");
            }
        }
    }

    function stake(uint256 amount)                                                      external notPaused nonReentrant {
        Staker storage st = stakers[msg.sender];

        require(tx.origin == msg.sender,                                            "Smart contracts cannot stake");
        require(amount > 0,                                                         "Stake amount must be greater than zero");
        require(st.stakedAmount + st.unstakingAmount + amount >= minStakeAmount,    "Total stake below minimum required");
        require(cloudToken.allowance(msg.sender, address(this)) >= amount,          "Insufficient allowance");
        
        _reactivateStaker(msg.sender):

        _claimRewards    (msg.sender);               // Claim any pending rewards before modifying the stake balance.

        _cancelUnstaking (msg.sender);

        if (stakerIndex[msg.sender] == 0) {     // Create/update staker
            stakerList.push(msg.sender);
            stakerIndex[msg.sender] = stakerList.length; // store index+1
            st.lastRewardClaimTime  = block.timestamp;   // Initialize the lastRewardClaimTime for a new staker (better be completely safe)
        }

        if(st.stakedAmount < 1e18 && st.stakedAmount + amount >= 1e18) totalStakers++;
        totalStaked           += amount;
        totalStakedForTally   += amount;
        st.stakedAmount       += amount;
        st.lastRewardClaimTime = block.timestamp;   // they start accruing rewards from now rather than from an old timestamp (case: for old stakers that restake from 0)

        cloudStakeVault.deposit(msg.sender, amount);

        emit Staked     (msg.sender, amount);
        emit StakerData (msg.sender, st.stakedAmount);

        _updateLastActivity(msg.sender);

        handleInactivity(maintenanceBatchSize);
    }

    function claimRewards()                                                             external notPaused nonReentrant {
        _reactivateStaker(msg.sender);

        _claimRewards(msg.sender);

        _updateLastActivity(msg.sender);

        handleInactivity(maintenanceBatchSize); 
    }

    function initiateUnstake(uint256 amount)                                            external notPaused nonReentrant {
        _reactivateStaker(msg.sender); // Reactivate staker if previously inactive

        _initiateUnstake(msg.sender, amount);

        _updateLastActivity(msg.sender);
    }

    function cancelUnstaking()                                                          external notPaused nonReentrant {
        Staker storage st = stakers[msg.sender];

        require(st.unstakingAmount > 0,     "No unstaking in progress");

        _reactivateStaker(msg.sender); 

        _claimRewards(msg.sender);      // Claim any pending rewards before modifying the stake balance.

        _cancelUnstaking(msg.sender);

        _updateLastActivity(msg.sender);

        handleInactivity(maintenanceBatchSize);
    }

    function claimUnstakedTokens()                                                      external notPaused nonReentrant {
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

    function handleInactivity(uint256 batchSize)                                        external notPaused nonReentrant {

        if (batchSize == 0) return;

        uint256 processedCount      = 0;
        uint256 i                   = lastProcessedStaker;
        uint256 listLength          = stakerList.length;
        uint256 currentTimestamp    = block.timestamp;

        while (i < listLength && processedCount < batchSize) {

            address stakerAddr = stakerList[i];
            Staker storage st  = stakers[stakerAddr];

            // ignore in tally
            if(st.isActive && currentTimestamp >= st.lastActivityTime + governanceInactivityThreshold) {
                _deactivateStaker(stakerAddr);
            }

            // auto unstake
            if(st.stakedAmount > 0 && currentTimestamp >= st.lastActivityTime + autoUnstakePeriod) {
                _initiateUnstake(stakerAddr, st.stakedAmount);

                emit AutoUnstaked(stakerAddr, st.stakedAmount);
            }

            i++;
            processedCount++;
        }

        lastProcessedStaker = (i >= listLength) ? 0 : i;

        emit handleInactivityProcessed(lastProcessedStaker);
    }

    function rescueTokens(address token, uint256 amount)                                external onlyOwner {
       IERC20(token).safeTransfer(owner(), amount);
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    function _authorizeUpgrade(address newImplementation)           internal override onlyOwner {}

    function _initiateUnstake(address stakerAddr, uint256 amount)   internal {
        Staker storage st = stakers[stakerAddr];

        require(amount > 0,                 "Amount must be > 0");
        require(amount <= st.stakedAmount,  "Insufficient staked balance");

        _claimRewards(stakerAddr);  // Claim any pending rewards before modifying the stake balance.

        st.stakedAmount         -= amount;
        if(st.stakedAmount >= 1e18 && st.stakedAmount - amount < 1e18) totalStakers--;
        totalStaked             -= amount;
        if(st.isActive) {
            totalStakedForTally     -= amount;
        }
        st.unstakingAmount      += amount;
        st.unstakingStartTime   = block.timestamp; // resets cooldown

        emit Unstaking          (stakerAddr, amount);
        emit StakerData         (stakerAddr, st.stakedAmount);
    }

    function _cancelUnstaking(address stakerAddr)                   internal {
        Staker storage st = stakers[stakerAddr];

        if(st.unstakingAmount > 0) {
            uint256 cancelled       = st.unstakingAmount;

            st.stakedAmount        += cancelled;
            totalStaked            += cancelled;
            if(st.isActive) {
                totalStakedForTally     += cancelled;
            }
            st.unstakingAmount      = 0;
            st.unstakingStartTime   = 0;

            emit UnstakeCancelled (stakerAddr, cancelled);
        }    
    }

    function _claimRewards(address stakerAddr)                      internal {

        Staker storage st = stakers[stakerAddr];

        require(st.stakedAmount > 0,                        "Not an active staker");
        require(block.timestamp > st.lastRewardClaimTime,   "Already claimed recently");

        uint256 rewards = calculateRewards(stakerAddr);
        require(rewards > 0, "No rewards available");

        st.lastRewardClaimTime   = block.timestamp; // Update last reward claim time BEFORE external call, prevent double claiming before transfer
        st.totalEarnedRewards   += rewards;
        
        cloudRewardPool.distributeRewards(stakerAddr, rewards); // Transfer rewards from the reward pool

        emit RewardsClaimed(stakerAddr, rewards);
    }

    function _reactivateStaker(address stakerAddr)                  internal {
        Staker storage st = stakers[stakerAddr];

        if (!st.isActive) {
            st.isActive = true;
            totalStakedForTally += st.stakedAmount;

            emit StakerReactivated(stakerAddr, st.stakedAmount);
        }
    }

    function _deactivateStaker(address stakerAddr)                  internal {
        Staker storage st = stakers[stakerAddr];

        if (st.isActive) {
            st.isActive = false;
            totalStakedForTally -= st.stakedAmount;

            emit StakerDeactivated(stakerAddr, st.stakedAmount);
        }
    }

    function _updateLastActivity(address stakerAddr)                internal {
        Staker storage st = stakers[stakerAddr];

        st.lastActivityTime = block.timestamp;
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================


    function calculateRewards(address stakerAddr)              external view returns (uint256) {
        Staker memory st = stakers[stakerAddr];

        require(st.lastRewardClaimTime > 0,        "No rewards history");

        uint256 timeElapsed  = block.timestamp - st.lastRewardClaimTime;
        uint256 currentAprE2 = getAprE2();
        uint256 rewards      = (st.stakedAmount * currentAprE2 * timeElapsed) / (10000 * 365 days);

        rewards              = (rewards + 5e8) / 1e9;
        rewards              = rewards * 1e9;

        return rewards;
    }

    function getAprE2()                                        external view returns (uint256) {
        uint256 circulatingSupply       = cloudUtils.getCirculatingSupply();
        require(circulatingSupply > 0, "Circulating supply must be greater than zero");

        uint256 availableReward         = cloudRewardPool.getRewardBalance();
        uint256 stakedRatioE18          = (totalStaked * 1e18) / circulatingSupply;
        uint256 stakedCircSupplyMinE18  = stakedCircSupplyMin * 1e18;
        uint256 stakedCircSupplyMaxE18  = stakedCircSupplyMax * 1e18;
        uint256 aprMaxE18               = aprMax * 1e18;

        // Normal APR
        // Formula: APR = aprMax - max(0, min(1, (Staked Percentage - stakedCircSupplyMin) / (stakedCircSupplyMax - stakedCircSupplyMin)) × (aprMax-aprMin)

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
        // Formula: APR  = (availableReward / totalStaked) × 100
        if(totalStaked * aprE2 / 10000 > availableReward)
        {
            aprE18 = (totalStaked == 0) ? 0 : availableReward * 100 * 1e18 / totalStaked;
            aprE2  = aprE18 / 1e16;
        }

        if(aprE2 > 10000) aprE2 = 10000; // hard security in case a param is corrupted
 
        return aprE2;
    }

    function getStakerInfo(address stakerAddr)                 external view returns (
            uint256 stakedAmount,
            uint256 lastRewardClaimTime,
            uint256 unstakingAmount,
            uint256 unstakingStartTime,
            uint256 claimableTimestamp,
            uint256 totalEarnedRewards,
            uint256 lastActivityTime
        )
    {
        Staker storage st = stakers[stakerAddr];

        stakedAmount        = st.stakedAmount;
        lastRewardClaimTime = st.lastRewardClaimTime;
        unstakingAmount     = st.unstakingAmount;
        unstakingStartTime  = st.unstakingStartTime;
        claimableTimestamp  = st.unstakingStartTime + cooldown;
        totalEarnedRewards  = st.totalEarnedRewards;
        lastActivityTime    = st.lastActivityTime;
    }

    function getStakingParams()                                external view returns (
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
        _maintenanceBatchSize           = maintenanceBatchSize;
    }

    function getStakersData(address[] memory stakersAddresses) external view returns (uint256[] memory stakedAmounts, bool[] memory isActives)
    {
        uint256 length      = stakersAddresses.length;
        stakedAmounts       = new uint256[](length);
        isActives           = new bool[](length);

        for (uint256 i = 0; i < length; i++) {
            Staker storage st       = stakers[stakersAddresses[i]];
            stakedAmounts[i]        = st.stakedAmount;
            isActives[i]            = st.isActive;
        }
    }

    function getAllStakers(uint256 start, uint256 count)        external view returns (address[] memory stakersOut, uint256[] memory amounts)
    {
        uint256 listLength = stakerList.length;
        if (start >= listLength) {
            return (new addressw uint256 ); Return empty arrays if `start` is out of bounds
        }

        uint256 end = start + count;
        if (end > listLength) {
            end = listLength; // Prevent out-of-bounds access
        }

        uint256 actualCount = end - start;
        stakersOut          = new address[](actualCount);
        amounts             = new uint256[](actualCount);

        for (uint256 i = 0; i < actualCount; i++) {
            address stakerAddr  = stakerList[start + i];
            stakersOut[i]       = stakerAddr;
            amounts[i]          = stakers[stakerAddr].stakedAmount;
        }

        return (stakersOut, amounts);
    }


    // storage gap for upgrade safety, prevents storage conflicts in future versions
    uint256[50] private __gap;
}
