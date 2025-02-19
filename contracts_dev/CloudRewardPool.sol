// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CloudRewardPool is Ownable {
    IERC20 public immutable cloudToken;  // Reward token
    address public stakingContract;      // Staking contract authorized to withdraw rewards

    event StakingContractUpdated(address newStakingContract);
    event RewardsWithdrawn(address indexed recipient, uint256 amount);
    event RewardsDeposited(address indexed depositor, uint256 amount);

    constructor(address _cloudToken) {
        require(_cloudToken != address(0), "Invalid token address");
        cloudToken = IERC20(_cloudToken);
    }

    // Sets the staking contract that can withdraw rewards.
    function setStakingContract(address _stakingContract) external onlyOwner {
        require(_stakingContract != address(0), "Invalid staking contract address");
        stakingContract = _stakingContract;
        emit StakingContractUpdated(_stakingContract);
    }

    // Allows the staking contract to withdraw rewards for users.
    function withdrawRewards(address recipient, uint256 amount) external {
        require(msg.sender == stakingContract, "Only staking contract can withdraw");
        require(amount > 0, "Amount must be greater than zero");
        require(cloudToken.balanceOf(address(this)) >= amount, "Insufficient rewards");

        cloudToken.transfer(recipient, amount);
        emit RewardsWithdrawn(recipient, amount);
    }

    // Allows anyone to deposit rewards into the pool.
    function depositRewards(uint256 amount) external {
        require(amount > 0, "Amount must be greater than zero");

        cloudToken.transferFrom(msg.sender, address(this), amount);
        emit RewardsDeposited(msg.sender, amount);
    }

    // Returns the balance of rewards in the pool.
    function getRewardBalance() external view returns (uint256) {
        return cloudToken.balanceOf(address(this));
    }

    // Returns unallocated rewards (i.e. tokens held in the contract not tied to staked funds) back to a community fund.
    function emptyRewardsPool       (address communityFund)                             external onlyOwner {
        uint256 contractBalance = cloudToken.balanceOf(address(this));
        uint256 totalStaked = getTotalStakedTokens();
        uint256 unallocated = contractBalance > totalStaked ? contractBalance - totalStaked : 0;
        require(unallocated > 0, "No unallocated rewards");

        cloudToken.safeTransfer(communityFund, unallocated);
    }
}
