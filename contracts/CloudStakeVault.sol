// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CloudStakeVault is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable cloudToken;
    address public cloudStaking;
    uint256 public constant EMERGENCY_COOLDOWN = 30 days;

    mapping(address => uint256) private userDeposits;
    mapping(address => uint256) private emergencyWithdrawRequests;

    event StakingContractAddressUpdated     (address oldCloudStaking, address newCloudStaking);
    event Deposited                         (address indexed user, uint256 amount);
    event Withdrawn                         (address indexed user, uint256 amount);
    event EmergencyWithdrawRequested        (address indexed user, uint256 timestamp);
    event EmergencyWithdrawn                (address indexed user, uint256 amount);

    constructor(address _cloudToken, address _cloudStaking) {
        require(_cloudToken   != address(0),    "Invalid token address");
        require(_cloudStaking != address(0),    "Invalid staking address");

        cloudToken   = IERC20(_cloudToken);
        cloudStaking = _cloudStaking;
    }

    modifier onlyStakingContract() {
        require(msg.sender == cloudStaking, "Only CloudStaking can call this function");
        _;
    }

    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================

    function setStakingContractAddress(address _newCloudStaking)    external onlyOwner {
        require(_newCloudStaking != address(0),      "Invalid address");
        require(_newCloudStaking != cloudStaking,    "Same address already set");

        address oldCloudStaking = cloudStaking;
        cloudStaking            = _newCloudStaking;

        emit StakingContractAddressUpdated(oldCloudStaking, cloudStaking);
    }

    function deposit(address user, uint256 amount)                  external onlyStakingContract {
        require(user != address(0), "Invalid user address");
        require(amount > 0,         "Amount must be greater than zero");

        cloudToken.safeTransferFrom(user, address(this), amount);

        userDeposits[user]             += amount;
        emergencyWithdrawRequests[user] = 0;

        emit Deposited(user, amount);
    }

    function withdraw(address user, uint256 amount)                 external onlyStakingContract {
        require(user != address(0),             "Invalid user address");
        require(userDeposits[user] >= amount,   "Insufficient user balance");

        userDeposits[user]             -= amount;
        emergencyWithdrawRequests[user] = 0;

        cloudToken.safeTransfer(user, amount);

        emit Withdrawn(user, amount);
    }

    function emergencyWithdraw()                                    external {
        require(userDeposits[msg.sender] > 0,                   "No funds to withdraw");
        require(emergencyWithdrawRequests[msg.sender] == 0,     "Already requested");

        emergencyWithdrawRequests[msg.sender] = block.timestamp;

        emit EmergencyWithdrawRequested(msg.sender, block.timestamp);
    }

    function claimEmergencyWithdraw()                               external {
        require(emergencyWithdrawRequests[msg.sender] > 0,                                      "No pending emergency withdrawal");
        require(block.timestamp >= emergencyWithdrawRequests[msg.sender] + EMERGENCY_COOLDOWN,  "Emergency cooldown not finished");

        uint256 amount = userDeposits[msg.sender];
        require(amount > 0, "No fund to withdraw");

        userDeposits[msg.sender]                = 0;
        emergencyWithdrawRequests[msg.sender]   = 0;

        cloudToken.safeTransfer(msg.sender, amount);

        emit EmergencyWithdrawn(msg.sender, amount);
    }

    function recoverMistakenTokens(address _token, address _recipient, uint256 _amount) external onlyOwner {
        require(_token != address(cloudToken), "Cannot withdraw staking token");

        IERC20(_token).safeTransfer(_recipient, _amount);
    }

    receive()                                                       external payable {
        revert("Direct transfers not allowed");
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================


    function getDepositedBalance(address user)                      external view returns (uint256) {
        return userDeposits[user];
    }

    function getStakingContractAddress()                            external view returns (address) {
        return cloudStaking;
    }
}