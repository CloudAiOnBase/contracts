// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Import OpenZeppelin libraries for ERC20 and Ownable functionality.
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CloudAIStaking is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable cloudToken;

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
    bool public emergencyMode;  
    
    struct Staker {
        uint256 stakedAmount;
        uint256 unstakingAmount;
        uint256 unstakingStartTime; // when the unstaking (cooldown) began
        uint256 totalEarnedRewards;
        uint256 lastActivityTime;   // last time the staker interacted (stake/unstake/claim)
    }

    mapping(address => Staker) public stakers;
    address[] public stakerList;
    mapping(address => uint256) private stakerIndex; // index+1 in stakerList

    // --- Events ---
    event getStakersData            (address indexed staker, uint256 amount);
    event UnstakeInitiated          (address indexed staker, uint256 amount);
    event UnstakeCancelled          (address indexed staker, uint256 amount);
    event UnstakeCancelled          (address indexed staker, uint256 amount);
    event RewardsClaimed            (address indexed staker, uint256 rewards);
    event EmergencyModeActivated    ();
    event EmergencyWithdrawn        (address indexed staker, uint256 amount, uint256 rewards);
    event getStakersData            (address indexed staker, uint256 stakedAmount);

    // Constructor initializes the token address and initial parameters.
    constructor(IERC20 _cloudToken, uint256 _minStakeAmount) {
        cloudToken                      = _cloudToken;
        minStakeAmount                  = _minStakeAmount;    // minStakeAmount The minimum amount required to stake (e.g. 100 * 1e18 for 18 decimals).
        cooldown                        = 10 days;
        governanceInactivityThreshold   = 365 days;
        autoUnstakePeriod               = 3 * 365 days;
        aprMin                          = 4; // 4%
        aprMax                          = 10; // 10%
        stakedCircSupplyMin             = 10; // 10%
        stakedCircSupplyMax             = 50; // 50%

        lastParamsUpdate = block.timestamp;
    }

    // Modifier to disallow actions during emergency mode.
    modifier notInEmergency() {
        require(!emergencyMode, "Operation not allowed in emergency mode");
        _;
    }

    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================

    // Stake tokens. Also cancels any pending unstake.
    function stake(uint256 amount) external notInEmergency {
        require(amount >= minStakeAmount, "Amount below minimum stake");

        // Update rewards and last activity before modifying state.
        _updateRewards(msg.sender);
        _updateActivity(msg.sender);

        Staker storage st = stakers[msg.sender];

        // If the staker had initiated an unstake, cancel it.
        if (st.unstakingAmount > 0) {
            uint256 cancelled = st.unstakingAmount;
            st.stakedAmount += cancelled;
            st.unstakingAmount = 0;
            st.unstakingStartTime = 0;
            emit UnstakeCancelled(msg.sender, cancelled);
        }

        // Transfer tokens from the staker.
        cloudToken.safeTransferFrom(msg.sender, address(this), amount);

        // Add new staker if needed.
        if (st.lastActivityTime == 0 && st.stakedAmount == 0) {
            _addStaker(msg.sender);
        }

        st.stakedAmount += amount;
        st.lastActivityTime = block.timestamp;
        emit Staked(msg.sender, amount);
        emit StakerData(msg.sender, st.stakedAmount);
    }

    // Claim accrued staking rewards
    function claimRewards() external notInEmergency {
        _updateRewards(msg.sender);
        _updateActivity(msg.sender);

        Staker storage st = stakers[msg.sender];
        uint256 rewards = st.unclaimedRewards;
        require(rewards > 0, "No rewards available");

        st.unclaimedRewards = 0;
        cloudToken.safeTransfer(msg.sender, rewards);
        emit RewardsClaimed(msg.sender, rewards);
    }

    // Initiate unstaking for a specified amount.
    function initiateUnstake(uint256 amount) external notInEmergency {
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

    // After the cooldown period, claim the unstaked tokens.
    function claimUnstakedTokens() external notInEmergency {
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

    // Trigger emergency mode, unstake all the funds immediately and disable .
    function emergencyWithdraw() external {
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

    // Returns unallocated rewards (i.e. tokens held in the contract not tied to staked funds) back to a community fund.
    function emptyRewardsPool(address communityFund) {
        uint256 contractBalance = cloudToken.balanceOf(address(this));
        uint256 totalStaked = getTotalStakedTokens();
        uint256 unallocated = contractBalance > totalStaked ? contractBalance - totalStaked : 0;
        require(unallocated > 0, "No unallocated rewards");

        cloudToken.safeTransfer(communityFund, unallocated);
    }

    // Empty APR function; to be implemented with APR logic later.
    function getAPR() public view returns (uint256) {
        return 0;
    }

    // recaching/updating of parameters
    function updateStakingParams() external onlyOwner {
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

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    // Automatically update staking parameters if the caching period has passed.
    function _tryUpdateStakingParams() internal {
        if (block.timestamp >= lastParamsUpdate + cachingPeriod) {
             updateStakingParams();
        }
    }

    // Placeholder for rewards update logic.
    function _updateRewards(address stakerAddr) internal {
        // Future implementation: update staker’s unclaimedRewards based on APR, staking time, etc.
    }

    // Updates the staker’s last activity timestamp and checks for auto-unstake due to inactivity.
    function _updateActivity(address stakerAddr) internal {
        Staker storage st = stakers[stakerAddr];
        if (st.lastActivityTime != 0 && block.timestamp >= st.lastActivityTime + autoUnstakePeriod) {
            _autoUnstake(stakerAddr);
        } else {
            st.lastActivityTime = block.timestamp;
        }
    }

    // Automatically unstakes a staker who has been inactive for 3 years.
    function _autoUnstake(address stakerAddr) internal {
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

    // Adds a new staker to the tracking list if not already present.
    function _addStaker(address stakerAddr) internal {
        if (stakerIndex[stakerAddr] == 0) {
            stakerList.push(stakerAddr);
            stakerIndex[stakerAddr] = stakerList.length; // store index+1
        }
    }

    // Removes a staker from the tracking list.
    function _removeStaker(address stakerAddr) internal {
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

    /// @notice Returns detailed staking info for a given staker.
    function getStakerInfo(address stakerAddr)
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
    function getTotalStakers() public view returns (uint256) {
        return stakerList.length;
    }

    /// @notice Returns the sum of active staked tokens across all stakers.
    function getTotalStakedTokens() public view returns (uint256 total) {
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
    function getAllStakers(uint256 start, uint256 count) external view returns (address[] memory, uint256[] memory) {
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
    function getStakersData(address[] memory stakersAddresses) external view returns (uint256[] memory) {
        uint256[] memory amounts = new uint256[](stakersAddresses.length);
        for (uint256 i = 0; i < stakersAddresses.length; i++) {
            amounts[i] = stakers[stakersAddresses[i]].stakedAmount;
        }
        return amounts;
    }

    /// @notice Returns all staking-related parameters.
    function getStakingParams()
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
}
