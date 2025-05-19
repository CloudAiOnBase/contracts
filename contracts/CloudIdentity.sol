// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";


interface ICloudStaking {
    function stakers(address user) external view returns (
        uint256 stakedAmount,
        uint256 lastRewardClaimTime,
        uint256 unstakingAmount,
        uint256 unstakingStartTime,
        uint256 totalEarnedRewards,
        uint256 lastActivityTime,
        bool    isActive
    );
}

interface IBurnableERC20 is IERC20 {
    function burn(uint256 amount) external;
}

contract CloudIdentity is Initializable, ERC721URIStorageUpgradeable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    IBurnableERC20 public cloudToken;
    ICloudStaking  public cloudStaking;

    uint256        public mintPrice;
    uint256        public minStakeRequired;
    uint256        public nextTokenId;

    mapping(address => uint256) public tokenIdByOwner;
    mapping(uint256 => uint256) public tokenBirth;
    mapping(string => uint256)  public tokenIdByUsernameLower;
    mapping(uint256 => string)  public usernameLowerByTokenId;
    mapping(string => string)   public usernameByUsernameLower;
    mapping(uint256 => string)  public profileData; // maps tokenId > encoded JSON profile data

    event MintPriceUpdated                  (uint256 oldPrice, uint256 newPrice);
    event MinStakeRequiredUpdated           (uint256 oldStakeTokens, uint256 newStakeTokens);
    event StakingContractAddressUpdated     (address oldCloudStaking, address newCloudStaking);
    event Minted                            (address indexed user, uint256 indexed tokenId, string username);
    event TokenURIUpdated                   (uint256 indexed tokenId, string newURI);


    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _cloudToken,
        address _cloudStaking
    ) public initializer {
        __ERC721_init("CloudAI Passport", "CLOUDPASS");
        __ERC721URIStorage_init();
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        cloudToken          = IBurnableERC20(_cloudToken);
        cloudStaking        = ICloudStaking(_cloudStaking);

        mintPrice           = 10_000;
        minStakeRequired    = 50_000;
        nextTokenId         = 1;
    }


    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    function getUsername                  (uint256 tokenId)                                   external view returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");

        string memory lower = usernameLowerByTokenId[tokenId];

        return usernameByUsernameLower[lower];
    }

    function isValid                    (uint256 tokenId)                                   external view returns (bool) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");

        address owner = ownerOf(tokenId);

        return _getStakedAmount(owner) >= minStakeRequired  * 1e18;
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    function _authorizeUpgrade          (address newImplementation)                         internal override onlyOwner {}

    function _validateUsername            (string memory _username)                             internal pure {
        bytes memory b = bytes(_username);
        require(b.length >= 3 && b.length <= 20, "Username must be 3-20 chars");

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 char = b[i];

            bool valid = (
                (char >= 0x30 && char <= 0x39) || // 0-9
                (char >= 0x41 && char <= 0x5A) || // A-Z
                (char >= 0x61 && char <= 0x7A) || // a-z
                (char == 0x5F) ||                 // _
                (char == 0x2D)                    // -
            );

            require(valid, "Invalid character in username");
        }
    }

    function _getStakedAmount           (address user)                                      internal view returns (uint256) {
        (uint256 stakedAmount, , , , , , ) = cloudStaking.stakers(user);
        return stakedAmount;
    }

    function _toLower                   (string memory str)                                 internal pure returns (string memory) {
        bytes memory bStr   = bytes(str);
        bytes memory bLower = new bytes(bStr.length);
        for (uint i = 0; i < bStr.length; i++) {
            // Uppercase character
            if ((uint8(bStr[i]) >= 65) && (uint8(bStr[i]) <= 90)) {
                bLower[i] = bytes1(uint8(bStr[i]) + 32);
            } else {
                bLower[i] = bStr[i];
            }
        }
        return string(bLower);
    }

    /// @dev Enforce “one CloudPass per wallet” on every transfer.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
      if (to != address(0)) {
        require(balanceOf(to) == 0, "Recipient already owns a CloudPass");
      }

      from = super._update(to, tokenId, auth);

      if (to != address(0)) {
        tokenIdByOwner[to] = tokenId;
      }
      if (from != address(0)) {
        delete tokenIdByOwner[from];
      }

      return from;
    }

    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================

    /// @dev Value in whole tokens (e.g., 10 for 10 CLOUD).
    function setMintPrice               (uint256 newPrice)                                  external onlyOwner {
        require(newPrice > 0, "Must be > 0");

        emit MintPriceUpdated(mintPrice, newPrice);

        mintPrice = newPrice;
    }

    /// @dev Value in whole tokens (e.g., 5000 for 500 CLOUD).
    function setMinStakeRequired        (uint256 newStake)                                  external onlyOwner {
        require(newStake > 0, "Must be > 0");

        emit MinStakeRequiredUpdated(minStakeRequired, newStake);

        minStakeRequired = newStake;
    }

    function setStakingContract         (address _newCloudStaking)                          external onlyOwner {
        require(_newCloudStaking != address(0),               "Invalid address");
        require(_newCloudStaking != address(cloudStaking),    "Same address already set");
        require(_newCloudStaking.code.length > 0,             "Not a contract");

        address oldCloudStaking     = address(cloudStaking);
        cloudStaking                = ICloudStaking(_newCloudStaking);

        emit StakingContractAddressUpdated(oldCloudStaking, _newCloudStaking);
    }

    function pause                      ()                                                  external onlyOwner {
        _pause();
    }

    function unpause                    ()                                                  external onlyOwner {
        _unpause();
    }

    function mint                       (string memory _username, string memory _tokenURI)    external whenNotPaused nonReentrant {
        uint256 priceWei    = mintPrice * 1e18;
        string memory lower = _toLower(_username);
        uint256 userStake   = _getStakedAmount(msg.sender);

        require(balanceOf(msg.sender) == 0,                                                   "You already own a CloudAI Passport");
        require(userStake >= minStakeRequired * 1e18,                                         "Insufficient stake");
        require(cloudToken.allowance(msg.sender, address(this)) >= priceWei,                  "Approve CLOUD first" );
        require(tokenIdByUsernameLower[lower] == 0,                                             "Username already used");

        _validateUsername(_username);

        // 
        SafeERC20.safeTransferFrom(IERC20(address(cloudToken)), msg.sender, address(this), priceWei);
        cloudToken.burn(priceWei);
        uint256 tokenId = nextTokenId++;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, _tokenURI);

        tokenIdByOwner[msg.sender]      = tokenId;
        tokenBirth[tokenId]             = block.timestamp;
        tokenIdByUsernameLower[lower]   = tokenId;
        usernameByUsernameLower[lower]  = _username;
        usernameLowerByTokenId[tokenId] = lower;
        profileData[tokenId]            = "";

        emit Minted(msg.sender, tokenId, _username);
    }

    function updateTokenURI(uint256 tokenId, string memory newTokenURI) external whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "Not the owner");
        require(bytes(newTokenURI).length < 1000, "URI too long");

        _setTokenURI(tokenId, newTokenURI);
        emit TokenURIUpdated(tokenId, newTokenURI);
    }


    // Storage gap for future upgrades (50 slots)
    uint256[50] private __gap;
}
