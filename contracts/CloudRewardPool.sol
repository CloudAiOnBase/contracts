// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; 
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

interface ICloudStakeVault {
    function getDepositedBalance(address _user)     external view returns (uint256);
    function getLastDepositTime(address _user)      external view returns (uint256);
}

contract CloudRewardPool is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable cloudToken;
    ICloudStakeVault public cloudStakeVault;
    address public cloudStaking;
    uint256 public rugDetectionApr;
    mapping(address => uint256) public lastRewardClaimTimes;

    event StakingContractUpdated    (address newStakingContract);
    event StakeVaultContractUpdated (address newCloudStakeVault);
    event RewardsDistributed        (address indexed recipient, uint256 amount);
    event RewardsDeposited          (address indexed depositor, uint256 amount);
    event rugDetectionAprUpdated    (uint256 newRugDetectionApr);

    constructor(address _cloudToken, address _cloudStaking, address _cloudStakeVault, uint256 _rugDetectionApr) Ownable(msg.sender) {
        require(_cloudToken != address(0),          "Invalid token address");
        require(_cloudStaking != address(0),        "Invalid staking contract address");
        require(_cloudStakeVault != address(0),     "Invalid stake vault address");
        require(_rugDetectionApr <= 50,             "APR limit must be smaller than 50");

        cloudToken      = IERC20(_cloudToken);
        cloudStakeVault = ICloudStakeVault(_cloudStakeVault);
        cloudStaking    = _cloudStaking;
        rugDetectionApr = _rugDetectionApr;
    }


    // ============================================
    // VIEW FUNCTIONS
    // ============================================


    function getRewardBalance()                                                                 external view returns (uint256) {
        return cloudToken.balanceOf(address(this));
    }


    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================


    function _secureRewardThreshold     (address _recipient)                                    internal view returns (uint256) {
        uint256 totalStaked = cloudStakeVault.getDepositedBalance(_recipient);
        require(totalStaked > 0, "No tokens staked");

        uint256 lastDepositTime = cloudStakeVault.getLastDepositTime(_recipient);
        uint256 lastClaimTime   = lastRewardClaimTimes[_recipient];
        uint256 lastActionTime  = lastDepositTime > lastClaimTime ? lastDepositTime : lastClaimTime; // Determine the last action time (either the last deposit or the last reward claim)
        require(lastActionTime > 0, "No action time");

        uint256 elapsedTime = block.timestamp - lastActionTime;
        return (totalStaked * elapsedTime * rugDetectionApr) / (365 days * 100);
    }


    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================


    function setStakingContract         (address _newCloudStaking)                             external onlyOwner {
        require(_newCloudStaking != address(0),     "Invalid staking contract address");

        cloudStaking = _newCloudStaking;
        
        emit StakingContractUpdated(_newCloudStaking);
    }

    function setCloudStakeVault         (address _newCloudStakeVault)                           external onlyOwner {
        require(_newCloudStakeVault != address(0), "Invalid stake vault address");

        cloudStakeVault = ICloudStakeVault(_newCloudStakeVault);

        emit StakeVaultContractUpdated(_newCloudStakeVault);
    }

    function setRugDetectionApr         (uint256 _newRugDetectionApr)                           external onlyOwner {
        require(_newRugDetectionApr <= 100,      "APR must not exceed 100");

        rugDetectionApr = _newRugDetectionApr;

        emit rugDetectionAprUpdated(_newRugDetectionApr);
    }

    function depositRewards             (uint256 _amount)                                       external whenNotPaused {
        require(_amount > 0,           "Amount must be greater than zero");

        cloudToken.safeTransferFrom(msg.sender, address(this), _amount);

        emit RewardsDeposited(msg.sender, _amount);
    }

    function distributeRewards          (address _recipient, uint256 _rewardAmount)             external nonReentrant whenNotPaused{
        require(msg.sender == cloudStaking,                             "Only staking contract can distribute rewards");
        require(_recipient != address(0),                               "Invalid recipient address");
        require(_rewardAmount > 0,                                      "Amount must be greater than zero");
        require(cloudToken.balanceOf(address(this)) >= _rewardAmount,   "Insufficient rewards");

        uint256 entitledRewards = _secureRewardThreshold(_recipient);
        require(_rewardAmount <= entitledRewards, "Requested amount exceeds entitled rewards"); // Ensure the requested reward amount does not exceed the rugDetectionApr

        lastRewardClaimTimes[_recipient] = block.timestamp;

        cloudToken.safeTransfer(_recipient, _rewardAmount);

        emit RewardsDistributed(_recipient, _rewardAmount);
    }

    function recoverMistakenTokens      (address _token, address _recipient, uint256 _amount)   external onlyOwner {
        require(_token != address(cloudToken),  "Cannot withdraw staking token");
        require(_recipient != address(0),       "Invalid recipient address");


        IERC20(_token).safeTransfer(_recipient, _amount);
    }

    function pause                      ()                                                      external onlyOwner {
        _pause();
    }

    function unpause                    ()                                                      external onlyOwner {
        _unpause();
    }

    receive()                                                                                   external payable {
        revert("Direct ETH transfers not allowed");
    }

    fallback()                                                                                  external payable {
        revert("ETH deposits not allowed");
    }
}