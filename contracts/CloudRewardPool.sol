// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Author: CloudAI Core Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; 
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface ICloudStakeVault {
    function getDepositedBalance(address _user)     external view returns (uint256);
    function getLastDepositTime(address _user)      external view returns (uint256);
}

contract CloudRewardPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable cloudToken;
    ICloudStakeVault public stakeVault;
    address public stakingContract;
    uint256 public rugDetectionApr;
    mapping(address => uint256) public lastRewardClaimTime;

    event StakingContractUpdated    (address newStakingContract);
    event RewardsDistributed        (address indexed recipient, uint256 amount);
    event RewardsDeposited          (address indexed depositor, uint256 amount);
    event rugDetectionAprUpdated    (uint256 newRugDetectionApr);

    constructor(address _cloudToken, address _stakingContract, address _stakingVault, uint256 _rugDetectionApr) {
        require(_cloudToken      != address(0), "Invalid token address");
        require(_stakingContract != address(0), "Invalid staking contract address");
        require(_stakingVault    != address(0), "Invalid staking vault address");
        require(_rugDetectionApr <= 100,        "APR limit must be smaller than 100");

        cloudToken      = IERC20(_cloudToken);
        stakingVault    = ICloudStakeVault(_stakingVault);
        stakingContract = _stakingContract;
        rugDetectionApr = _rugDetectionApr;
    }


    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================


    function setStakingContract         (address _stakingContract)                              external onlyOwner {
        require(_stakingContract != address(0),     "Invalid staking contract address");

        stakingContract = _stakingContract;
        
        emit StakingContractUpdated(_stakingContract);
    }

    function setRugDetectionApr         (uint256 _newRugDetectionApr)                           external onlyOwner {
        require(_newRugDetectionApr <= 100,      "APR limit must be smaller than 100");

        rugDetectionApr = _newRugDetectionApr;

        emit rugDetectionAprUpdated(_newRugDetectionApr);
    }

    function depositRewards             (uint256 _amount)                                       external {
        require(_amount > 0,           "Amount must be greater than zero");

        cloudToken.safeTransferFrom(msg.sender, address(this), _amount);

        emit RewardsDeposited(msg.sender, _amount);
    }

    function distributeRewards          (address _recipient, uint256 _rewardAmount)             external nonReentrant {
        require(_recipient != address(0),                                   "Invalid recipient address");
        require(_rewardAmount > 0,                                          "Amount must be greater than zero");
        require(stakingContract != address(0),                              "Staking contract not set");
        require(msg.sender == stakingContract,                              "Only staking contract can withdraw");
        require(cloudToken.balanceOf(address(this)) >= _rewardAmount,       "Insufficient rewards");

        uint256 totalStaked    = stakingVault.getDepositedBalance(_recipient);
        require(totalStaked > 0,                    "No tokens staked");

        uint256 lastDepositTime = stakingVault.getLastDepositTime(_recipient);
        uint256 lastClaimTime   = lastRewardClaimTime[_recipient];
        uint256 lastActionTime  = lastDepositTime > lastClaimTime ? lastDepositTime : lastClaimTime;  // Determine the last action time (either the last deposit or the last reward claim)
        require(lastActionTime > 0,                 "No action time");

        uint256 elapsedTime     = block.timestamp - lastActionTime;
        uint256 entitledRewards = (totalStaked * elapsedTime * rugDetectionApr) / (365 days * 100);
        require(_rewardAmount <= entitledRewards,   "Requested amount exceeds entitled rewards"); // Ensure the requested reward amount does not exceed the rugDetectionApr

        lastRewardClaimTime[_recipient] = block.timestamp;

        cloudToken.safeTransfer(_recipient, _rewardAmount);

        emit RewardsDistributed(_recipient, _rewardAmount);
    }

    function recoverMistakenTokens      (address _token, address _recipient, uint256 _amount)   external onlyOwner {
        require(_token != address(cloudToken), "Cannot withdraw staking token");

        IERC20(_token).safeTransfer(_recipient, _amount);
    }

    receive()                                                                                   external payable {
        revert("Direct transfers not allowed");
    }


    // ============================================
    // VIEW FUNCTIONS
    // ============================================


    function getRewardBalance()                                                         external view returns (uint256) {
        return cloudToken.balanceOf(address(this));
    }

}

