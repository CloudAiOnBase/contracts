// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CloudUtils is Initializable, OwnableUpgradeable {
    IERC20 public cloudToken;
    address[] private excludedFromCirculatingSupply; // Stores excluded addresses

    // Staking parameters
    uint256 public minStakeAmount;
    uint256 public cooldown;
    uint256 public governanceInactivityThreshold;
    uint256 public autoUnstakePeriod;
    uint256 public aprMin;
    uint256 public aprMax;
    uint256 public stakedCircSupplyMin;
    uint256 public stakedCircSupplyMax;
    uint256 public cachingPeriod;

    event ExclusionUpdated(address wallet, bool isExcluded);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _cloudToken) public initializer {
        require(_cloudToken != address(0), "Invalid token address");
        __Ownable_init(msg.sender);
        cloudToken = IERC20(_cloudToken);
    }

    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================

    // Updates the exclusion status of a wallet from the circulating supply
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

    // Enum to represent each staking parameter.
    enum StakingParam {
        MinStakeAmount,               // 0
        Cooldown,                     // 1
        GovernanceInactivityThreshold,// 2
        AutoUnstakePeriod,            // 3
        AprMin,                       // 4
        AprMax,                       // 5
        StakedCircSupplyMin,          // 6
        StakedCircSupplyMax,          // 7
        CachingPeriod                 // 8
    }

    /**
     * @notice Updates one or more staking parameters based on the provided keys and values.
     * @param keys An array of keys representing the staking parameters to update.
     *             Each key is a uint8 corresponding to a value in the StakingParam enum.
     * @param values An array of new values for the corresponding parameters.
     * Requirements:
     * - `keys` and `values` arrays must have the same length.
     * - Only the contract owner can call this function.
     */
    function updateStakingParameters(uint8[] calldata keys, uint256[] calldata values) external onlyOwner {
        // IMPORTANT: When updating multiple parameters in a single call, the order matters.
        // For example, if both aprMin and aprMax are being updated, ensure that either aprMin is updated before aprMax,
        // or that the final values satisfy the condition (aprMax >= aprMin). Otherwise, the validation check for aprMax may fail.

        require(keys.length == values.length, "Array lengths mismatch");
        for (uint256 i = 0; i < keys.length; i++) {
            if (keys[i] == uint8(StakingParam.MinStakeAmount)) {
                // Validate that the new minStakeAmount is a positive integer (non-zero)
                require(values[i] > 0, "minStakeAmount must be a positive integer");
                minStakeAmount = values[i];

            } else if (keys[i] == uint8(StakingParam.Cooldown)) {
                // Validate that the cooldown is positive and in whole days (1 day = 86400 seconds)
                require(values[i] > 0, "Cooldown must be positive");
                require(values[i] % 1 days == 0, "Cooldown must be in whole days");
                cooldown = values[i];

            } else if (keys[i] == uint8(StakingParam.GovernanceInactivityThreshold)) {                
                // Validate that the governance inactivity threshold is positive and in whole days
                require(values[i] > 0, "GovernanceInactivityThreshold must be positive");
                require(values[i] % 1 days == 0, "GovernanceInactivityThreshold must be in whole days");
                governanceInactivityThreshold = values[i];

            } else if (keys[i] == uint8(StakingParam.AutoUnstakePeriod)) {
                // Validate that autoUnstakePeriod is positive and in whole days
                require(values[i] > 0, "AutoUnstakePeriod must be positive");
                require(values[i] % 1 days == 0, "AutoUnstakePeriod must be in whole days");
                autoUnstakePeriod = values[i];

            } else if (keys[i] == uint8(StakingParam.AprMin)) {
                // Allow aprMin to be 0 (which can disable rewards) or a positive value to enable rewards.
                aprMin = values[i];

            } else if (keys[i] == uint8(StakingParam.AprMax)) {
                // Allow aprMax to be 0 (which can disable rewards) or a positive value.
                // Ensure it is greater than or equal to aprMin.
                require(values[i] >= aprMin, "aprMax must be >= aprMin");
                aprMax = values[i];

            } else if (keys[i] == uint8(StakingParam.StakedCircSupplyMin)) {
                // stakedCircSupplyMin can be 0    
                stakedCircSupplyMin = values[i];

            } else if (keys[i] == uint8(StakingParam.StakedCircSupplyMax)) {
                // Validate that stakedCircSupplyMax is greater than or equal to stakedCircSupplyMin.
                require(values[i] >= stakedCircSupplyMin, "stakedCircSupplyMax must be >= stakedCircSupplyMin");
                stakedCircSupplyMax = values[i];

            } else if (keys[i] == uint8(StakingParam.CachingPeriod)) {
                // Validate that cachingPeriod is positive (non-zero)
                require(values[i] > 0, "CachingPeriod must be positive");
                cachingPeriod = values[i];

            } else {
                revert("Invalid parameter key");
            }
        }
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

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
    
    function getExcludedAddresses() external view returns (address[] memory) {
        return excludedFromCirculatingSupply;
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

    function getVersion() public pure returns (string memory) {
        return "CloudUtils v1.1";
    }

    // storage gap for upgrade safety, prevents storage conflicts in future versions
    uint256[41] private __gap;
}
