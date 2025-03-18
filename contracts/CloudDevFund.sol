// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CloudDevFund is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    IERC20 public cloudToken;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _cloudToken) public initializer {
        require(_cloudToken != address(0), "Invalid token address");
        
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        cloudToken = IERC20(_cloudToken);
    }


    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    function getVersion() public pure returns (string memory) {
        return "CloudDevFund v1";
    }


    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================


    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}


    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================

    // @notice Allows the contract to receive ETH
    receive() external payable {}

    /// @notice Fallback function for handling unexpected calls
    fallback() external payable {}
    
    
    // storage gap for upgrade safety, prevents storage conflicts in future versions
    uint256[50] private __gap;
}
