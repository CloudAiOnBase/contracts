// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Import OpenZeppelin libraries for ERC20 and Ownable functionality.
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface ICloudUtils {
    function getStakingParams() external view returns (
        uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256
    );
}

interface ICloudRewardPool {
    function withdrawRewards(address recipient, uint256 amount) external;
}

contract CloudStaking is Ownable {
    using SafeERC20 for IERC20;

    IERC20              public immutable cloudToken;
    ICloudUtils         public cloudUtils;
    ICloudRewardPool    public cloudRewardPool;

    uint256 private minStakeAmount;                  // e.g. 100 CLOUD (in token smallest units)
    uint256 private cooldown;                        // 10 days cooldown for unstaking
    uint256 private governanceInactivityThreshold;   // 1 year inactivity threshold (for governance tally)
    uint256 private autoUnstakePeriod;               // 3 years auto-unstake for inactive stakers
    uint256 private aprMin;                          // APR range minimum (4%)
    uint256 private aprMax;                          // APR range maximum (10%)
    uint256 private stakedCircSupplyMin;             // 10%
    uint256 private stakedCircSupplyMax;             // 50%
    uint256 private cachingPeriod;                   // 24 hours
    uint256 private lastParamsUpdate;                // Caching period for external parameters
    uint256 private lastProcessedStaker;
    bool public emergencyMode;  
    
    struct Staker {
        uint256 stakedAmount;
        uint256 lastRewardClaimTime;
        uint256 unstakingAmount;
        uint256 unstakingStartTime; // when the unstaking (cooldown) began
        uint256 totalEarnedRewards;
        uint256 lastActivityTime;   // last time the staker interacted (stake/unstake/claim)
    }

    mapping(address => Staker) public stakers;
    address[] public stakerList;
    mapping(address => uint256) private stakerIndex; // index+1 in stakerList

    // --- Events ---
    event CloudUtilsUpdated       (address oldCloudUtils, address newCloudUtils);
    event Staked                  (address indexed staker, uint256 stakedAmount);
    event RewardsClaimed          (address indexed staker, uint256 rewards);
    event Unstaking               (address indexed staker, uint256 amount);
    event Unstaked                (address indexed staker, uint256 amount);
    event UnstakeCancelled        (address indexed staker, uint256 amount);
    event StakerData              (address indexed staker, uint256 totalStakedAmount);
   

    // Constructor initializes the token, utility contract, and reward pool.
    constructor(address _cloudToken, address _cloudUtils, address _cloudRewardPool) {
        require(_cloudToken         != address(0), "Invalid token address");
        require(_cloudUtils         != address(0), "Invalid utils contract address");
        require(_cloudRewardPool    != address(0), "Invalid reward pool address");

        cloudToken          = IERC20(_cloudToken);        
        cloudUtils          = ICloudUtils(_cloudUtils);
        cloudRewardPool     = ICloudRewardPool(_cloudRewardPool);
    }

    modifier autoUpdateStakingParams() {
        _tryUpdateStakingParams();
        _;
    }

    // Modifier to disallow actions during emergency mode.
    modifier notInEmergency() {
        require(!emergencyMode, "Operation not allowed in emergency mode");
        _;
    }

    // TODO
    // disable direct transfers to this contract

    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================

    // Updates the CloudUtils contract address in case of migration
    function setCloudUtils          (address _newCloudUtils)                            external onlyOwner {
        require(_newCloudUtils != address(0),           "Invalid address");
        require(_newCloudUtils != address(cloudUtils),  "Same address already set");

        address oldCloudUtils = address(cloudUtils);
        cloudUtils = ICloudUtils(_newCloudUtils);

        emit CloudUtilsUpdated(oldCloudUtils, _newCloudUtils);
    }

    // recaching/updating of parameters
    function updateStakingParams    ()                                                  external onlyOwner notInEmergency {
        _updateStakingParams();
    }

    // Stake tokens. Also cancels any pending unstake.
    function stake                  (uint256 amount)                                    external notInEmergency autoUpdateStakingParams {
        require(amount > 0,       "Stake amount must be greater than zero");

        Staker storage st = stakers[msg.sender];

        require(st.stakedAmount + st.unstakingAmount + amount >= minStakeAmount,    "Total stake below minimum required");
        require(cloudToken.allowance(msg.sender, address(this)) >= amount,          "Insufficient allowance");

        // Claim any pending rewards before modifying the stake balance.
        claimRewards();

        // If the staker had initiated an unstake, cancel it.
        if (st.unstakingAmount > 0) {
            uint256 cancelled       = st.unstakingAmount;
            st.stakedAmount        += cancelled;
            st.unstakingAmount      = 0;
            st.unstakingStartTime   = 0;
            emit UnstakeCancelled (msg.sender, cancelled);
        }

        // Create/update staker
        if (st.lastActivityTime == 0) {
            _addStaker(msg.sender);
        }
        st.stakedAmount     += amount;
        st.lastActivityTime  = block.timestamp;

        // Transfer tokens from the staker.
        cloudToken.safeTransferFrom(msg.sender, address(this), amount);        

        //event
        emit Staked     (msg.sender, amount);
        emit StakerData (msg.sender, st.stakedAmount);
    }

    // Claim accrued staking rewards
    function claimRewards()                                                             external notInEmergency autoUpdateStakingParams {
        Staker storage st = stakers[msg.sender];

        require(st.stakedAmount > 0,                        "Not an active staker");
        require(block.timestamp > st.lastRewardClaimTime,   "Already claimed recently");

        // Calculate pending rewards dynamically
        uint256 timeElapsed = block.timestamp - st.lastRewardClaimTime;
        uint256 rewards = (st.stakedAmount * rewardRate * timeElapsed) / rewardTimeUnit; // Example formula

        require(rewards > 0, "No rewards available");

        st.lastRewardClaimTime  = block.timestamp; // Update last reward claim time BEFORE external call, prevent double claiming before transfer
        st.lastActivityTime     = block.timestamp;

        // Transfer rewards from the reward pool
        cloudRewardPool.withdrawRewards(msg.sender, rewards);

        // Emit event
        emit RewardsClaimed(msg.sender, rewards);
    }

    // Initiate unstaking for a specified amount.
    function initiateUnstake        (uint256 amount)                                    external notInEmergency {
        Staker storage st = stakers[msg.sender];
        require(amount > 0, "Amount must be > 0");
        require(amount <= st.stakedAmount, "Insufficient staked balance");

        _updateRewards(msg.sender);
        _updateActivity(msg.sender);

        st.stakedAmount -= amount;
        st.unstakingAmount += amount;
        st.unstakingStartTime = block.timestamp; // resets cooldown
        emit UnstakeInitiated(msg.sender, amount);
        emit StakerData(msg.sender, st.stakedAmount);
    }

    // Allows users to cancel their unstaking before claiming and restake their tokens.
    function cancelUnstaking        ()                                                  external notInEmergency {
        Staker storage st = stakers[msg.sender];

        require(st.stakedAmount == 0, "You are already staked");
        require(st.unstakedTimestamp > 0, "No unstaking in progress");

        // Restore stake (before claiming)
        st.stakedAmount = getPendingUnstakedAmount(msg.sender);
        st.unstakedTimestamp = 0; // Reset unstake timestamp

        emit UnstakingCancelled(msg.sender, st.stakedAmount);
    }

    // After the cooldown period, claim the unstaked tokens.
    function claimUnstakedTokens    ()                                                  external notInEmergency autoUpdateStakingParams {
        Staker storage st = stakers[msg.sender];
        require(st.unstakingAmount > 0, "No tokens in unstaking process");
        require(block.timestamp >= st.unstakingStartTime + cooldown, "Cooldown period not passed");

        _updateRewards(msg.sender);
        _updateActivity(msg.sender);

        uint256 amountToClaim = st.unstakingAmount;
        st.unstakingAmount = 0;
        st.unstakingStartTime = 0;

        cloudToken.safeTransfer(msg.sender, amountToClaim);
        emit Unstaked(msg.sender, amountToClaim);
        emit StakerData(msg.sender, st.stakedAmount);
    }

    // Processes automatic unstaking for inactive users in batches.
    function processAutoUnstake     (uint256 batchSize, bool resetLastProcessedStaker)  external onlyOwner {
        if (resetLastProcessedStaker) {
            lastProcessedStaker = 0;
        }

        uint256 processedCount = 0;
        uint256 i              = lastProcessedStaker;
        uint256 listLength     = stakerList.length;

        while (i < listLength && processedCount < batchSize) {
            address stakerAddr = stakerList[i];
            Staker storage st  = stakers[stakerAddr];

            if (st.stakedAmount > 0 && block.timestamp >= st.lastActivityTime + autoUnstakePeriod) {
                _autoUnstake(stakerAddr);
            }

            i++;
            processedCount++;
        }

        lastProcessedStaker = (i >= listLength) ? 0 : i;
    }

    // Trigger emergency mode, unstake all the funds immediately and disable .
    function emergencyWithdraw      ()                                                  external onlyOwner notInEmergency {
        require(emergencyMode, "Not in emergency mode");

        emergencyMode = true;

        Staker storage st = stakers[msg.sender];
        uint256 totalAmount = st.stakedAmount + st.unstakingAmount + st.unclaimedRewards;
        require(totalAmount > 0, "Nothing to withdraw");

        // Reset staker data.
        st.stakedAmount = 0;
        st.unstakingAmount = 0;
        st.unclaimedRewards = 0;
        st.unstakingStartTime = 0;
        st.totalEarnedRewards = 0;
        st.lastActivityTime = block.timestamp;

        _removeStaker(msg.sender);

        cloudToken.safeTransfer(msg.sender, totalAmount);
        emit EmergencyWithdrawn(msg.sender, totalAmount, 0);
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    // Recaching/updating of parameters
    function _updateStakingParams       () internal {

        require(address(cloudUtils) != address(0), "CloudUtils not set");
        (
            uint256 _minStakeAmount,
            uint256 _cooldown,
            uint256 _governanceInactivityThreshold,
            uint256 _autoUnstakePeriod,
            uint256 _aprMin,
            uint256 _aprMax,
            uint256 _stakedCircSupplyMin,
            uint256 _stakedCircSupplyMax,
            uint256 _cachingPeriod
        ) = cloudUtils.getStakingParams();

        minStakeAmount                  = _minStakeAmount;
        cooldown                        = _cooldown;
        autoUnstakePeriod               = _autoUnstakePeriod;
        governanceInactivityThreshold   = _governanceInactivityThreshold;
        aprMin                          = _aprMin;
        aprMax                          = _aprMax;
        stakedCircSupplyMin             = _stakedCircSupplyMin;
        stakedCircSupplyMax             = _stakedCircSupplyMax;
        cachingPeriod                   = _cachingPeriod;

        lastParamsUpdate = block.timestamp;
    }

    // Automatically update staking parameters if the caching period has passed.
    function _tryUpdateStakingParams    () internal {
        if (block.timestamp >= lastParamsUpdate + cachingPeriod) {
             _updateStakingParams();
        }
    }

    // Adds a new staker to the tracking list if not already present.
    function _addStaker                 (address stakerAddr) internal {
        if (stakerIndex[stakerAddr] == 0) {
            stakerList.push(stakerAddr);
            stakerIndex[stakerAddr] = stakerList.length; // store index+1
        }
    }

    // Placeholder for rewards update logic.
    function _updateRewards             (address stakerAddr) internal {
        // Future implementation: update staker’s unclaimedRewards based on APR, staking time, etc.
    }

    // Automatically unstakes a staker who has been inactive for 3 years.
    function _autoUnstake               (address stakerAddr) internal {
        Staker storage st = stakers[stakerAddr];
        uint256 totalToReturn = st.stakedAmount + st.unclaimedRewards;
        // Reset staker data.
        st.stakedAmount = 0;
        st.unstakingAmount = 0;
        st.unclaimedRewards = 0;
        st.unstakingStartTime = 0;
        st.totalEarnedRewards = 0;
        st.lastActivityTime = block.timestamp;
        // Remove staker from the active list.
        _removeStaker(stakerAddr);
        // Transfer funds back to the staker.
        if (totalToReturn > 0) {
            cloudToken.safeTransfer(stakerAddr, totalToReturn);
        }
        emit Unstaked(stakerAddr, totalToReturn);
    }

    // Removes a staker from the tracking list.
    function _removeStaker              (address stakerAddr) internal {
        uint256 index = stakerIndex[stakerAddr];
        if (index > 0) {
            uint256 actualIndex = index - 1;
            uint256 lastIndex = stakerList.length - 1;
            if (actualIndex != lastIndex) {
                address lastStaker = stakerList[lastIndex];
                stakerList[actualIndex] = lastStaker;
                stakerIndex[lastStaker] = index;
            }
            stakerList.pop();
            stakerIndex[stakerAddr] = 0;
        }
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    // Returns whether all stakers have been processed and, if not, the last processed staker index.
    function getAutoUnstakeProgress() external view returns (bool reachedEnd, uint256 lastIndex) {
        return (lastProcessedStaker == 0, lastProcessedStaker);
    }

    /// @notice Returns detailed staking info for a given staker.
    function getStakerInfo          (address stakerAddr)
        external
        view
        returns (
            uint256 stakedAmount,
            uint256 unstakingAmount,
            uint256 unclaimedRewards,
            uint256 unstakingStartTime,
            uint256 claimableTimestamp,
            uint256 totalEarnedRewards
        )
    {
        Staker storage st = stakers[stakerAddr];
        stakedAmount = st.stakedAmount;
        unstakingAmount = st.unstakingAmount;
        unclaimedRewards = st.unclaimedRewards;
        unstakingStartTime = st.unstakingStartTime;
        claimableTimestamp = st.unstakingStartTime + cooldown;
        totalEarnedRewards = st.totalEarnedRewards;
    }

    /// @notice Returns the total number of stakers.
    function getTotalStakers        () public view returns (uint256) {
        return stakerList.length;
    }

    /// @notice Returns the sum of active staked tokens across all stakers.
    function getTotalStakedTokens   () public view returns (uint256 total) {
        for (uint256 i = 0; i < stakerList.length; i++) {
            total += stakers[stakerList[i]].stakedAmount;
        }
    }

    /// @notice Returns the total staked tokens for tallying governance votes,
    /// excluding stakers inactive for more than the governance threshold.
    function getTotalStakedTokensForTally() public view returns (uint256 total) {
        for (uint256 i = 0; i < stakerList.length; i++) {
            Staker storage st = stakers[stakerList[i]];
            if (block.timestamp < st.lastActivityTime + governanceInactivityThreshold) {
                total += st.stakedAmount;
            }
        }
    }

    /// @notice Provides paginated access to stakers and their staked amounts.
    /// @param start The starting index.
    /// @param count The number of stakers to retrieve.
    function getAllStakers          (uint256 start, uint256 count) external view returns (address[] memory, uint256[] memory) {
        uint256 end = start + count;
        if (end > stakerList.length) {
            end = stakerList.length;
        }
        uint256 actualCount = end - start;
        address[] memory stakersOut = new address[](actualCount);
        uint256[] memory amounts = new uint256[](actualCount);
        for (uint256 i = 0; i < actualCount; i++) {
            address stakerAddr = stakerList[start + i];
            stakersOut[i] = stakerAddr;
            amounts[i] = stakers[stakerAddr].stakedAmount;
        }
        return (stakersOut, amounts);
    }

    /// @notice Fetches staked amounts for a list of stakers.
    /// @param stakersAddresses The addresses of stakers.
    function getStakersData         (address[] memory stakersAddresses) external view returns (uint256[] memory) {
        uint256[] memory amounts = new uint256[](stakersAddresses.length);
        for (uint256 i = 0; i < stakersAddresses.length; i++) {
            amounts[i] = stakers[stakersAddresses[i]].stakedAmount;
        }
        return amounts;
    }

    /// @notice Returns all staking-related parameters.
    function getStakingParams       ()
        external
        view
        returns (
            uint256 _minStakeAmount,
            uint256 _cooldown,
            uint256 _autoUnstakePeriod,
            uint256 _governanceInactivityThreshold,
            uint256 _aprMin,
            uint256 _aprMax,
            uint256 _stakedCircSupplyMin,
            uint256 _stakedCircSupplyMax
        )
    {
        _minStakeAmount = minStakeAmount;
        _cooldown = cooldown;
        _autoUnstakePeriod = autoUnstakePeriod;
        _governanceInactivityThreshold = governanceInactivityThreshold;
        _aprMin = aprMin;
        _aprMax = aprMax;
        _stakedCircSupplyMin = stakedCircSupplyMin;
        _stakedCircSupplyMax = stakedCircSupplyMax;
    }

    // Empty APR function; to be implemented with APR logic later.
    function getAPR                 () public view returns (uint256) {
        return 0;
    }
}
