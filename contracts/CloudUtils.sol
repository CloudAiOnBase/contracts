// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CloudUtils is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    IERC20 public cloudToken;
    address[] private excludedFromCirculatingSupply;

    event ExclusionUpdated(address wallet, bool isExcluded);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    function initialize(address _cloudToken) public initializer {
        require(_cloudToken != address(0), "Invalid token address");
        
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        cloudToken = IERC20(_cloudToken);
    }


    // ============================================
    // VIEW FUNCTIONS
    // ============================================


    function getCirculatingSupply() public view returns (uint256) {
        uint256 totalSupply = cloudToken.totalSupply();
        uint256 excludedBalance = 0;

        for (uint256 i = 0; i < excludedFromCirculatingSupply.length; i++) {
            excludedBalance += cloudToken.balanceOf(excludedFromCirculatingSupply[i]);
        }

        // Prevent underflow: Ensure excluded balance does not exceed total supply
        require(excludedBalance <= totalSupply, "Inconsistent state: excluded balance exceeds total supply");

        return totalSupply - excludedBalance;
    }
    
    function getExcludedAddresses() external view returns (address[] memory) {
        return excludedFromCirculatingSupply;
    }

    function getVersion() public pure returns (string memory) {
        return "CloudUtils v1.1";
    }


    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================


    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}


    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================


    function excludeFromCirculatingSupply(address _wallet, bool _status) external onlyOwner {
        require(_wallet != address(0), "Invalid address");

        if (_status) {
            // Only add if not already excluded
            for (uint256 i = 0; i < excludedFromCirculatingSupply.length; i++) {
                if (excludedFromCirculatingSupply[i] == _wallet) {
                    return; // Already excluded, do nothing
                }
            }
            excludedFromCirculatingSupply.push(_wallet); // Add to list
            emit ExclusionUpdated(_wallet, _status);
        } else {
            // Remove from the list
            for (uint256 i = 0; i < excludedFromCirculatingSupply.length; i++) {
                if (excludedFromCirculatingSupply[i] == _wallet) {
                    excludedFromCirculatingSupply[i] = excludedFromCirculatingSupply[excludedFromCirculatingSupply.length - 1]; // Replace with last element
                    excludedFromCirculatingSupply.pop(); // Remove last element
                    emit ExclusionUpdated(_wallet, _status);
                    return;
                }
            }
        }
    }
    

    // storage gap for upgrade safety, prevents storage conflicts in future versions
    uint256[50] private __gap;
}
