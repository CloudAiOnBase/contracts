
contract CloudStaking is Ownable {

   
    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================

     // Stake tokens. Also cancels any pending unstake.



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
    function claimUnstakedTokens    ()                                                  external notInEmergency {
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


    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================


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

    // Returns all staking parameters (needed by the CloudStaking contract).
    function getStakingParams() external view returns (
        uint256 _minStakeAmount,
        uint256 _cooldown,
        uint256 _governanceInactivityThreshold,
        uint256 _autoUnstakePeriod,
        uint256 _aprMin,
        uint256 _aprMax,
        uint256 _stakedCircSupplyMin,
        uint256 _stakedCircSupplyMax,
        uint256 _cachingPeriod
    ) {
        _minStakeAmount                 = minStakeAmount;
        _cooldown                       = cooldown;
        _governanceInactivityThreshold  = governanceInactivityThreshold;
        _autoUnstakePeriod              = autoUnstakePeriod;
        _aprMin                         = aprMin;
        _aprMax                         = aprMax;
        _stakedCircSupplyMin            = stakedCircSupplyMin;
        _stakedCircSupplyMax            = stakedCircSupplyMax;
        _cachingPeriod                  = cachingPeriod;
    }


    // storage gap for upgrade safety, prevents storage conflicts in future versions
    uint256[50] private __gap;
}