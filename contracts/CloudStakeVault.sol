// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract CloudStakeVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable cloudToken;
    address public cloudStaking;
    uint256 public constant EMERGENCY_COOLDOWN = 30 days;

    mapping(address => uint256) private userDeposits;
    mapping(address => uint256) private lastActivityTimes;
    mapping(address => uint256) private emergencyWithdrawRequests;
    mapping(address => uint256) private emergencyWithdrawAmounts;

    event StakingContractAddressUpdated     (address oldCloudStaking, address newCloudStaking);
    event Deposited                         (address indexed user, uint256 amount);
    event Withdrawn                         (address indexed user, uint256 amount);
    event EmergencyWithdrawRequested        (address indexed user, uint256 timestamp);
    event EmergencyWithdrawn                (address indexed user, uint256 amount);

    constructor(address _cloudToken, address _cloudStaking) Ownable(msg.sender) {
        require(_cloudToken   != address(0),    "Invalid token address");
        require(_cloudStaking != address(0),    "Invalid staking address");

        cloudToken             = IERC20(_cloudToken);
        cloudStaking           = _cloudStaking;
    }

    modifier onlyStakingContract() {
        require(msg.sender == cloudStaking, "Only CloudStaking can call this function");
        _;
    }


    // ============================================
    // VIEW FUNCTIONS
    // ============================================


    function getDepositedBalance(address user)                                          external view returns (uint256) {
        return userDeposits[user];
    }

    function getLastActivityTime(address user)                                           external view returns (uint256) {
        return lastActivityTimes[user];
    }

    function getEmergencyWithdrawalInfo(address user)
        external
        view
        returns (
            bool requested,
            uint256 requestTime,
            uint256 pendingAmount,
            bool claimable
        )
    {
        requestTime   = emergencyWithdrawRequests[user];
        pendingAmount = emergencyWithdrawAmounts[user];
        requested     = requestTime > 0;
        claimable     = requested && (block.timestamp >= requestTime + EMERGENCY_COOLDOWN);
    }


    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================

    function setStakingContractAddress(address _newCloudStaking)                        external onlyOwner {
        require(_newCloudStaking != address(0),               "Invalid address");
        require(_newCloudStaking != cloudStaking,             "Same address already set");

        address oldCloudStaking         = cloudStaking;
        cloudStaking                    = _newCloudStaking;

        emit StakingContractAddressUpdated(oldCloudStaking, cloudStaking);
    }

    function deposit(address user, uint256 amount)                                      external onlyStakingContract whenNotPaused nonReentrant {
        require(user != address(0),                     "Invalid user address");
        require(emergencyWithdrawRequests[user] == 0,   "Cannot deposit during emergency withdrawal request");
        require(amount > 0,                             "Amount must be greater than zero");

        cloudToken.safeTransferFrom(user, address(this), amount);

        userDeposits[user]        += amount;
        lastActivityTimes[user]     = block.timestamp;

        emit Deposited(user, amount);
    }

    function withdraw(address user, uint256 amount)                                     external onlyStakingContract whenNotPaused nonReentrant {
        require(user != address(0),                     "Invalid user address");
        require(emergencyWithdrawRequests[user] == 0,   "Cannot withdraw during emergency withdrawal request");
        require(amount > 0,                             "Amount must be greater than zero");
        require(userDeposits[user] >= amount,           "Insufficient user balance");

        userDeposits[user]        -= amount;
        lastActivityTimes[user]     = block.timestamp;
        if(userDeposits[user] == 0) {
            delete userDeposits[user];
            delete lastActivityTimes[user];
        }

        cloudToken.safeTransfer(user, amount);

        emit Withdrawn(user, amount);
    }

    function emergencyWithdraw()                                                        external {
        require(emergencyWithdrawRequests[msg.sender] == 0,     "Already requested");
        require(userDeposits[msg.sender] > 0,                   "No funds to withdraw");

        emergencyWithdrawAmounts[msg.sender]  = userDeposits[msg.sender];
        userDeposits[msg.sender]              = 0;
        emergencyWithdrawRequests[msg.sender] = block.timestamp;

        emit EmergencyWithdrawRequested(msg.sender, block.timestamp);
    }

    function claimEmergencyWithdraw()                                                   external nonReentrant {
        require(emergencyWithdrawRequests[msg.sender] > 0,                                      "No pending emergency withdrawal");
        require(block.timestamp >= emergencyWithdrawRequests[msg.sender] + EMERGENCY_COOLDOWN,  "Emergency cooldown not finished");

        uint256 amount = emergencyWithdrawAmounts[msg.sender];
        require(amount > 0, "No fund to withdraw");

        delete emergencyWithdrawAmounts[msg.sender];
        delete emergencyWithdrawRequests[msg.sender];
        delete userDeposits[msg.sender];
        delete lastActivityTimes[msg.sender];

        cloudToken.safeTransfer(msg.sender, amount);

        emit EmergencyWithdrawn(msg.sender, amount);
    }

    function pause()                                                                    external onlyOwner {
        _pause();
    }

    function unpause()                                                                  external onlyOwner {
        _unpause();
    }

    function recoverMistakenTokens(address _token, address _recipient, uint256 _amount) external onlyOwner {
        require(_token != address(cloudToken),  "Cannot withdraw staking token");
        require(_recipient != address(0),       "Invalid recipient address");

        IERC20(_token).safeTransfer(_recipient, _amount);
    }
    
    receive()                                                                           external payable {
        revert("Direct ETH transfers not allowed");
    }

    fallback()                                                                          external payable {
        revert("ETH deposits not allowed");
    }
}