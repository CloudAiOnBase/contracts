// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CloudUtils is Initializable, OwnableUpgradeable {
    IERC20 public cloudToken;
    address[] public excludedFromCirculatingSupply; // Stores excluded addresses

    event ExclusionUpdated(address wallet, bool isExcluded);

    /// @dev Prevents the implementation contract from being initialized separately
    constructor() {
        _disableInitializers();
    }

    function initialize(address _cloudToken) public initializer {
        require(_cloudToken != address(0), "Invalid token address");
        __Ownable_init();
        cloudToken = IERC20(_cloudToken);
    }

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

    function circulatingSupply() public view returns (uint256) {
        uint256 totalSupply = cloudToken.totalSupply();
        uint256 excludedBalance = 0;

        for (uint256 i = 0; i < excludedFromCirculatingSupply.length; i++) {
            excludedBalance += cloudToken.balanceOf(excludedFromCirculatingSupply[i]);
        }

        // Prevent underflow: Ensure excluded balance does not exceed total supply
        require(excludedBalance <= totalSupply, "Inconsistent state: excluded balance exceeds total supply");

        return totalSupply - excludedBalance;
    }

    /// @dev Storage gap for upgrade safety, prevents storage conflicts in future versions
    uint256[50] private __gap;
}
