// test/CloudIdentity.test.js
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

// Dead address constant for vault initialisation
const DEAD = "0x000000000000000000000000000000000000dEaD";

// Deploy and wire up real contracts: CloudToken, CloudUtils, CloudStakeVault, CloudRewardPool, CloudStaking, then CloudIdentity
async function setupContracts() {
  const [owner, user, other] = await ethers.getSigners();

  // Deploy CloudToken (real)
  const CloudToken = await ethers.getContractFactory("CloudToken");
  const cloudToken = await CloudToken.deploy();
  await cloudToken.waitForDeployment();

  // Deploy CloudUtils (upgradeable)
  CloudUtils = await ethers.getContractFactory("CloudUtils");
  cloudUtils = await upgrades.deployProxy(CloudUtils, [await cloudToken.getAddress()], { initializer: "initialize" });

  // Deploy CloudStakeVault
  const CloudStakeVault = await ethers.getContractFactory("CloudStakeVault");
  const cloudStakeVault = await CloudStakeVault.deploy(
    await cloudToken.getAddress(),
    DEAD
  );
  await cloudStakeVault.waitForDeployment();

  // Deploy CloudRewardPool
  const CloudRewardPool = await ethers.getContractFactory("CloudRewardPool");
  const cloudRewardPool = await CloudRewardPool.deploy(
    await cloudToken.getAddress(),
    DEAD,
    await cloudStakeVault.getAddress(),
    10 // rugDetectionApr
  );
  await cloudRewardPool.waitForDeployment();

  // Deploy CloudStaking (upgradeable)
  const CloudStaking = await ethers.getContractFactory("CloudStaking");
  const cloudStaking = await upgrades.deployProxy(
    CloudStaking,
    [
      await cloudToken.getAddress(),
      await cloudStakeVault.getAddress(),
      await cloudRewardPool.getAddress(),
      await cloudUtils.getAddress()
    ],
    { initializer: "initialize" }
  );
  await cloudStaking.waitForDeployment();

  // Configure vault & pool with staking address
  await cloudStakeVault.setStakingContract(await cloudStaking.getAddress());
  await cloudRewardPool.setStakingContract(await cloudStaking.getAddress());

  // Deploy CloudIdentity (upgradeable)
  const CloudIdentity = await ethers.getContractFactory("CloudIdentity");
  const cloudIdentity = await upgrades.deployProxy(
    CloudIdentity,
    [await cloudToken.getAddress(), await cloudStaking.getAddress()],
    { initializer: "initialize" }
  );
  await cloudIdentity.waitForDeployment();

  return { owner, user, other, cloudToken, cloudStakeVault, cloudRewardPool, cloudUtils, cloudStaking, cloudIdentity };
}

// Helper: stake a user with a given amount
async function stakeForUser(cloudToken, cloudStakeVault, cloudStaking, user, amount) {
  // Transfer tokens from owner (deployer) to user
  await cloudToken.transfer(user.address, amount);
  // Approve vault
  await cloudToken.connect(user).approve(await cloudStakeVault.getAddress(), amount);
  // Stake via staking contract
  await cloudStaking.connect(user).stake(amount);
}

// Helper: fund user and approve CloudIdentity for mint price
async function fundAndApproveMint(cloudToken, cloudIdentity, user) {
  const mintPriceTokens = await cloudIdentity.mintPrice();       // whole tokens
  const priceWei = mintPriceTokens * 10n ** 18n; 

  // Seed tokens and approve
  await cloudToken.transfer(user.address, priceWei);
  await cloudToken.connect(user).approve(await cloudIdentity.getAddress(), priceWei);
}

describe("CloudIdentity", function () {
  let owner, user, other;
  let cloudToken, cloudStakeVault, cloudRewardPool, cloudUtils, cloudStaking, cloudIdentity;

  beforeEach(async () => {
    ({ owner, user, other, cloudToken, cloudStakeVault, cloudRewardPool, cloudUtils, cloudStaking, cloudIdentity } =
      await setupContracts());
  });

  describe("Initialization", () => {
    it("sets correct initial parameters", async () => {
      expect(await cloudIdentity.name()).to.equal("CloudAI Passport");
      expect(await cloudIdentity.symbol()).to.equal("CLOUDPASS");
      expect(await cloudIdentity.mintPrice()).to.equal(10000);
      expect(await cloudIdentity.minStakeRequired()).to.equal(100000);
      expect(await cloudIdentity.nextTokenId()).to.equal(1);
    });
  });

  describe("Minting", () => {
    it("allows mint with valid username and sufficient stake", async () => {
      const stakeAmt = ethers.parseUnits("100000", 18);
      await stakeForUser(cloudToken, cloudStakeVault, cloudStaking, user, stakeAmt);
      await fundAndApproveMint(cloudToken, cloudIdentity, user);

      await expect(
        cloudIdentity.connect(user).mint("ValidUser1", "uri://avatar")
      ).to.emit(cloudIdentity, "Minted").withArgs(user.address, 1, "ValidUser1");

      expect(await cloudIdentity.ownerOf(1)).to.equal(user.address);
      expect(await cloudIdentity.getUsername(1)).to.equal("ValidUser1");
      expect(await cloudIdentity.isValid(1)).to.equal(true);
    });

    it("rejects mint if already owns a passport", async () => {
      const stakeAmt = ethers.parseUnits("100000", 18);
      await stakeForUser(cloudToken, cloudStakeVault, cloudStaking, user, stakeAmt);
      await fundAndApproveMint(cloudToken, cloudIdentity, user);
      await cloudIdentity.connect(user).mint("SoloUser", "uri");

      await fundAndApproveMint(cloudToken, cloudIdentity, user);
      await expect(
        cloudIdentity.connect(user).mint("SoloUser2", "uri")
      ).to.be.revertedWith("You already own a CloudAI Passport");
    });

    it("rejects mint if stake too low", async () => {
      // stake low amount
      const lowStake = ethers.parseUnits("1000", 18);
      await stakeForUser(cloudToken, cloudStakeVault, cloudStaking, user, lowStake);
      await fundAndApproveMint(cloudToken, cloudIdentity, user);

      await expect(
        cloudIdentity.connect(user).mint("NoStakeUser", "uri")
      ).to.be.revertedWith("Insufficient stake");
    });

    it("rejects invalid usernames", async () => {
      const stakeAmt = ethers.parseUnits("100000", 18);
      await stakeForUser(cloudToken, cloudStakeVault, cloudStaking, user, stakeAmt);
      await fundAndApproveMint(cloudToken, cloudIdentity, user);

      await expect(
        cloudIdentity.connect(user).mint("ab", "uri")
      ).to.be.revertedWith("Username must be 3-20 chars");

      await expect(
        cloudIdentity.connect(user).mint("Bad*Name!", "uri")
      ).to.be.revertedWith("Invalid character in username");
    });

    it("rejects duplicate usernames (case-insensitive)", async () => {
      // user mints first
      const stakeAmt1 = ethers.parseUnits("100000", 18);
      await stakeForUser(cloudToken, cloudStakeVault, cloudStaking, user, stakeAmt1);
      await fundAndApproveMint(cloudToken, cloudIdentity, user);
      await cloudIdentity.connect(user).mint("UniqueName", "uri");

      // other stakes and tries same name
      const stakeAmt2 = ethers.parseUnits("100000", 18);
      await stakeForUser(cloudToken, cloudStakeVault, cloudStaking, other, stakeAmt2);
      await fundAndApproveMint(cloudToken, cloudIdentity, other);

      await expect(
        cloudIdentity.connect(other).mint("uniquename", "uri")
      ).to.be.revertedWith("Username already used");
    });
  });

  describe("Avatar updates", () => {
    beforeEach(async () => {
      // mint one first
      const stakeAmt = ethers.parseUnits("100000", 18);
      await stakeForUser(cloudToken, cloudStakeVault, cloudStaking, user, stakeAmt);
      await fundAndApproveMint(cloudToken, cloudIdentity, user);
      await cloudIdentity.connect(user).mint("AvatarUser", "oldURI");
    });

    it("allows owner to update avatar", async () => {
      await expect(
        cloudIdentity.connect(user).updateTokenURI(1, "newURI")
      ).to.emit(cloudIdentity, "TokenURIUpdated").withArgs(1, "newURI");
      expect(await cloudIdentity.tokenURI(1)).to.equal("newURI");
    });

    it("rejects non-owner or nonexistent token", async () => {
      await expect(
        cloudIdentity.connect(other).updateTokenURI(1, "x")
      ).to.be.revertedWith("Not the owner");
      await expect(
        cloudIdentity.connect(user).updateTokenURI(2, "x")
      ).to.be.reverted;
    });

    it("rejects too long URI", async () => {
      const longURI = "x".repeat(1000);
      await expect(
        cloudIdentity.connect(user).updateTokenURI(1, longURI)
      ).to.be.revertedWith("URI too long");
    });
  });

  describe("Ownership & upgrade", () => {
    it("only owner can upgrade contract", async () => {
      const NewImpl = await ethers.getContractFactory("CloudIdentity");
      await expect(
        upgrades.upgradeProxy(await cloudIdentity.getAddress(), NewImpl.connect(other))
      ).to.be.reverted;
    });
  });
});