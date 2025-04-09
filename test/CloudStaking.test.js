const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("CloudStaking", function () {
  let CloudToken, cloudToken, CloudStakeVault, cloudStakeVault, CloudRewardPool, cloudRewardPool, CloudUtils, cloudUtils, CloudStaking, cloudStaking;
  let OtherToken, otherToken;
  let owner, nonOwner, commFund, devFund, user1, user2, user3;
  let stakingParams;
  let params;

  beforeEach(async function () {
    [owner, nonOwner, commFund, devFund, user1, user2, user3] = await ethers.getSigners();

    // Deploy CloudToken
    CloudToken = await ethers.getContractFactory("CloudToken");
    cloudToken = await CloudToken.deploy();
    await cloudToken.waitForDeployment();

    // Deploy CloudUtils
    CloudUtils = await ethers.getContractFactory("CloudUtils");
    cloudUtils = await upgrades.deployProxy(CloudUtils, [await cloudToken.getAddress()], { initializer: "initialize" });

    // Deploy CloudStakeVault
    CloudStakeVault = await ethers.getContractFactory("CloudStakeVault");
    cloudStakeVault = await CloudStakeVault.deploy(await cloudToken.getAddress(), "0x000000000000000000000000000000000000dEaD");
    await cloudStakeVault.waitForDeployment();
    
    // Deploy CloudRewardPool
    CloudRewardPool = await ethers.getContractFactory("CloudRewardPool");
    cloudRewardPool = await CloudRewardPool.deploy(
      await cloudToken.getAddress(),
      await "0x000000000000000000000000000000000000dEaD",
      await cloudStakeVault.getAddress(),
      10 // rugDetectionApr
    );

    // Deploy CloudStaking
    CloudStaking = await ethers.getContractFactory("CloudStaking");
    cloudStaking = await upgrades.deployProxy(
      CloudStaking,
      [
        await cloudToken.getAddress(),
        await cloudStakeVault.getAddress(),
        await cloudRewardPool.getAddress(),
        await cloudUtils.getAddress()
      ],
      { initializer: "initialize" }
    );

    // Deploy Governor
    CloudGovernor = await ethers.getContractFactory("CloudGovernor");
    cloudGovernor = await CloudGovernor.deploy(
      await cloudToken.getAddress(),
      await cloudStaking.getAddress()
    );
    await cloudGovernor.waitForDeployment();

    // Upgrade CloudStaking
    const CloudStakingV2 = await ethers.getContractFactory("CloudStaking");
    cloudStaking = await upgrades.upgradeProxy(await cloudStaking.getAddress(), CloudStakingV2);
    const tx = await cloudStaking.initializeV2(await cloudGovernor.getAddress());
    await tx.wait();

    // Set Staking Contract in other components
    await cloudStakeVault.setStakingContract(await cloudStaking.getAddress());
    await cloudRewardPool.setStakingContract(await cloudStaking.getAddress());

    // Deploy an additional token for mistaken recovery test
    OtherToken = await ethers.getContractFactory("CloudToken");
    otherToken = await OtherToken.deploy();
    await otherToken.waitForDeployment();

    // Set initial staking parameters for all tests
    params = {
      minStakeAmount: 100, // 100 CLOUD
      cooldown: 7, // 7 days 
      governanceInactivityThreshold: 365, // 1 year 
      autoUnstakePeriod: 3 * 365, // 3 years 
      aprMin: 4, // 3% APR
      aprMax: 10, // 10% APR
      stakedCircSupplyMin: 10, // 10% min staked supply
      stakedCircSupplyMax: 50, // 50% max staked supply
      maintenanceBatchSize: 2
    };

    await cloudStaking.updateStakingParameters(
      [0, 1, 2, 3, 5, 4, 7, 6, 8], // 5 before 4, 7 before 6
      [
        params.minStakeAmount,
        params.cooldown,
        params.governanceInactivityThreshold,
        params.autoUnstakePeriod,
        params.aprMax,
        params.aprMin,
        params.stakedCircSupplyMax,
        params.stakedCircSupplyMin,
        params.maintenanceBatchSize
      ]
    );
    stakingParams = await cloudStaking.getStakingParams();

    //top up reward pool
    cloudUtils.excludeFromCirculatingSupply(cloudRewardPool.getAddress(), true);
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("100000000"));

    //Set community and dev fund and exclude from CS
    cloudUtils.excludeFromCirculatingSupply(commFund.getAddress(), true);
    cloudUtils.excludeFromCirculatingSupply(devFund.getAddress(),  true);
    await cloudToken.transfer(await commFund.getAddress(),        ethers.parseEther("400000000"));
    await cloudToken.transfer(await devFund.getAddress(),         ethers.parseEther("400000000"));

    //
    expect(await cloudUtils.getCirculatingSupply()).to.equal(ethers.parseEther("100000000"));
    //console.log(await cloudUtils.getCirculatingSupply());

  });

  describe("Generic functions", function () {

    it("should initialize with correct parameters", async function () {
      expect(await cloudStaking.owner()).to.equal(owner.address);
    });

    it("should allow only the owner to upgrade the contract", async function () {
      const CloudStakingV2 = await ethers.getContractFactory("CloudStaking");
      await expect(
        upgrades.upgradeProxy(await cloudStaking.getAddress(), CloudStakingV2.connect(nonOwner))
      ).to.be.reverted;
    });

    it("should allow only the owner to pause and unpause the contract", async function () {
      await expect(cloudStaking.connect(nonOwner).pause()).to.be.reverted;

      await cloudStaking.pause();
      expect(await cloudStaking.paused()).to.equal(true);

      await expect(cloudStaking.connect(nonOwner).unpause()).to.be.reverted;

      await cloudStaking.unpause();
      expect(await cloudStaking.paused()).to.equal(false);
    });

    it("should allow only the owner to recover mistaken tokens", async function () {
      // Transfer some mistaken tokens to the staking contract
      await otherToken.transfer(cloudStaking.getAddress(), ethers.parseEther("100"));

      // Attempt recovery as non-owner
      await expect(
        cloudStaking.connect(nonOwner).recoverMistakenTokens(otherToken.getAddress(), nonOwner.address, ethers.parseEther("50"))
      ).to.be.reverted;

      // Recover as owner
      await cloudStaking.recoverMistakenTokens(otherToken.getAddress(), user1.address, ethers.parseEther("100"));

      // Ensure funds were recovered
      expect(await otherToken.balanceOf(user1.address)).to.equal(ethers.parseEther("100"));
    });

  });

  describe("General functions", function () {
    it("should initialize correctly", async function () {
      expect(await cloudStaking.totalStakers()).to.equal(0);
      expect(await cloudStaking.totalStaked()).to.equal(0);
    });

    it("should initialize with correct staking parameters", async function () {
      expect(stakingParams[0]).to.equal(params.minStakeAmount);
      expect(stakingParams[1]).to.equal(params.cooldown);
      expect(stakingParams[2]).to.equal(params.governanceInactivityThreshold);
      expect(stakingParams[3]).to.equal(params.autoUnstakePeriod);
      expect(stakingParams[5]).to.equal(params.aprMax);
      expect(stakingParams[4]).to.equal(params.aprMin);
      expect(stakingParams[6]).to.equal(params.stakedCircSupplyMin);
      expect(stakingParams[7]).to.equal(params.stakedCircSupplyMax);
      expect(stakingParams[8]).to.equal(params.maintenanceBatchSize);
    });

    it("should allow only the owner to update staking parameters", async function () {
      const minStakeAmount = 50;

      await expect(
        cloudStaking.connect(nonOwner).updateStakingParameters([0], [minStakeAmount])
      ).to.be.reverted;

      await cloudStaking.updateStakingParameters([0], [minStakeAmount]);
      expect(await cloudStaking.getStakingParams()).to.include(BigInt(minStakeAmount));
    });

    it("should allow the owner to set all staking parameters and retrieve them", async function () {
      const params = {
        minStakeAmount: 1000, // 1000 CLOUD 
        cooldown: 5 , // 5 days
        governanceInactivityThreshold: 30, // 30 days
        autoUnstakePeriod: 60, // 60 days
        aprMin: 3, // 3% APR
        aprMax: 11, // 10% APR
        stakedCircSupplyMin: 11, // 10% min staked supply
        stakedCircSupplyMax: 51, // 50% max staked supply
        maintenanceBatchSize: 10
      };

      // Owner updates all parameters
      await cloudStaking.updateStakingParameters(
        [0, 1, 2, 3, 5, 4, 7, 6, 8], // 5 before 4, 7 before 6
        [
          params.minStakeAmount,
          params.cooldown,
          params.governanceInactivityThreshold,
          params.autoUnstakePeriod,
          params.aprMax,
          params.aprMin,
          params.stakedCircSupplyMax,
          params.stakedCircSupplyMin,
          params.maintenanceBatchSize
        ]
      );

      // Retrieve and check that the parameters are updated correctly
      stakingParams = await cloudStaking.getStakingParams();

      expect(stakingParams[0]).to.equal(params.minStakeAmount);
      expect(stakingParams[1]).to.equal(params.cooldown);
      expect(stakingParams[2]).to.equal(params.governanceInactivityThreshold);
      expect(stakingParams[3]).to.equal(params.autoUnstakePeriod);
      expect(stakingParams[5]).to.equal(params.aprMax);
      expect(stakingParams[4]).to.equal(params.aprMin);
      expect(stakingParams[6]).to.equal(params.stakedCircSupplyMin);
      expect(stakingParams[7]).to.equal(params.stakedCircSupplyMax);
      expect(stakingParams[8]).to.equal(params.maintenanceBatchSize);
    });

    it("should allow users to stake tokens", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("1000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("1000"));
      await cloudStaking.connect(user1).stake(BigInt(params.minStakeAmount) * BigInt(1e18));

      expect(await cloudStaking.totalStakers()).to.equal(1);
      expect(await cloudStaking.totalStaked()).to.equal(BigInt(params.minStakeAmount) * BigInt(1e18));
      let staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(BigInt(params.minStakeAmount) * BigInt(1e18));
    });

    it("should calculate and claim rewards correctly", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("100000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("100000"));
      await cloudStaking.connect(user1).stake(ethers.parseEther("100000"));

      await ethers.provider.send("evm_increaseTime", [10 * 86400]);
      await ethers.provider.send("evm_mine");

      //let apr = await cloudStaking.getAprE2(); console.log(apr);
      let rewards = await cloudStaking.calculateRewards(user1.getAddress());
      expect(rewards).to.be.gt(0);
      //console.log(rewards);

      await cloudStaking.connect(user1).claimRewards();
      let updatedRewards = await cloudStaking.calculateRewards(user1.getAddress());
      expect(updatedRewards).to.equal(0);
    });

    it("should correctly calculate normal APR based on staked percentage", async function () {    
      // Fetch initial APR
      const initialApr = await cloudStaking.getAprE2();
      expect(initialApr).to.equal(params.aprMax * 100);
      //console.log("APR:", (Number(initialApr) / 100).toFixed(2) + "%");  

      // Transfer and approve tokens for staking
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("60000000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("60000000"));

      // User1 stakes 1000000 CLOUD
      await cloudStaking.connect(user1).stake(ethers.parseEther("1000000"));
      let aprAfterStake = await cloudStaking.getAprE2();
      expect(aprAfterStake).to.equal(1000);
      //console.log("----------------------------------------");
      //console.log("Total staked:", ethers.formatEther(await cloudStaking.totalStaked()));
      //console.log("Circ Supply:", ethers.formatEther(await cloudUtils.getCirculatingSupply()));
      //console.log("New APR:", (Number(aprAfterStake) / 100).toFixed(2) + "%");

      // User1 stakes 10000000 CLOUD
      await cloudStaking.connect(user1).stake(ethers.parseEther("9000000"));
      aprAfterStake = await cloudStaking.getAprE2();
      expect(aprAfterStake).to.equal(1000);
      //console.log("----------------------------------------");
      //console.log("Total staked:", ethers.formatEther(await cloudStaking.totalStaked()));
      //console.log("Circ Supply:", ethers.formatEther(await cloudUtils.getCirculatingSupply()));
      //console.log("New APR:", (Number(aprAfterStake) / 100).toFixed(2) + "%");

      // User1 stakes 10000000 CLOUD
      await cloudStaking.connect(user1).stake(ethers.parseEther("10000000"));
      aprAfterStake = await cloudStaking.getAprE2();
      expect(aprAfterStake).to.equal(850);
      //console.log("----------------------------------------");
      //console.log("Total staked:", ethers.formatEther(await cloudStaking.totalStaked()));
      //console.log("Circ Supply:", ethers.formatEther(await cloudUtils.getCirculatingSupply()));
      //console.log("New APR:", (Number(aprAfterStake) / 100).toFixed(2) + "%");

      await cloudStaking.connect(user1).stake(ethers.parseEther("10000000"));
      aprAfterStake = await cloudStaking.getAprE2();
      expect(aprAfterStake).to.equal(700);
      //console.log("----------------------------------------");
      //console.log("Total staked:", ethers.formatEther(await cloudStaking.totalStaked()));
      //console.log("Circ Supply:", ethers.formatEther(await cloudUtils.getCirculatingSupply()));
      //console.log("New APR:", (Number(aprAfterStake) / 100).toFixed(2) + "%");

      await cloudStaking.connect(user1).stake(ethers.parseEther("10000000"));
      aprAfterStake = await cloudStaking.getAprE2();
      expect(aprAfterStake).to.equal(550);
      //console.log("----------------------------------------");
      //console.log("Total staked:", ethers.formatEther(await cloudStaking.totalStaked()));
      //console.log("Circ Supply:", ethers.formatEther(await cloudUtils.getCirculatingSupply()));
      //console.log("New APR:", (Number(aprAfterStake) / 100).toFixed(2) + "%");

      await cloudStaking.connect(user1).stake(ethers.parseEther("10000000"));
      aprAfterStake = await cloudStaking.getAprE2();
      expect(aprAfterStake).to.equal(400);
      //console.log("----------------------------------------");
      //console.log("Total staked:", ethers.formatEther(await cloudStaking.totalStaked()));
      //console.log("Circ Supply:", ethers.formatEther(await cloudUtils.getCirculatingSupply()));
      //console.log("New APR:", (Number(aprAfterStake) / 100).toFixed(2) + "%");

      await cloudStaking.connect(user1).stake(ethers.parseEther("10000000"));
      aprAfterStake = await cloudStaking.getAprE2();
      expect(aprAfterStake).to.equal(400);
      //console.log("----------------------------------------");
      //console.log("Total staked:", ethers.formatEther(await cloudStaking.totalStaked()));
      //console.log("Circ Supply:", ethers.formatEther(await cloudUtils.getCirculatingSupply()));
      //console.log("New APR:", (Number(aprAfterStake) / 100).toFixed(2) + "%");
    });

    it("should correctly switch and calculate fallback APR", async function () {
      await cloudRewardPool.setRugDetectionApr(50);
      await cloudStaking.updateStakingParameters(
        [5, 4], // 5 before 4, 7 before 6
        [
          50,
          50,
        ]
      );

      // Fetch initial APR
      let Apr = await cloudStaking.getAprE2();
      expect(Apr).to.equal(50 * 100);
      //console.log("APR:", (Number(Apr) / 100).toFixed(2) + "%");  

      // Transfer and approve tokens for staking
      await cloudToken.connect(commFund).transfer(await owner.getAddress(), ethers.parseEther("300000000"));
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("400000000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("400000000"));
      await cloudStaking.connect(user1).stake(ethers.parseEther("201000000"));

      // Fetch initial APR
      Apr = await cloudStaking.getAprE2();
      expect(Apr).to.equal(4975);
      //console.log("APR:", (Number(Apr) / 100).toFixed(2) + "%");  
      await cloudStaking.connect(user1).stake(ethers.parseEther("199000000"));

      // Fetch initial APR
      Apr = await cloudStaking.getAprE2();
      expect(Apr).to.equal(2499);
      //console.log("APR:", (Number(Apr) / 100).toFixed(2) + "%");  
    });

    it("should correctly calculate and distribute rewards based on APR", async function () {

      // Transfer and approve tokens for staking
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("30000000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("30000000"));

      // User1 stakes 1000000 CLOUD
      //console.log("Circ Supply:", ethers.formatEther(await cloudUtils.getCirculatingSupply()));
      await cloudStaking.connect(user1).stake(ethers.parseEther("30000000"));
      let aprAfterStake = await cloudStaking.getAprE2();

      await ethers.provider.send("evm_increaseTime", [365 * 86400]);
      await ethers.provider.send("evm_mine");

      let expectedRewards = ethers.parseEther("30000000") * BigInt(aprAfterStake) / BigInt(10000);

      //console.log("----------------------------------------");
      //console.log("Total staked:", ethers.formatEther(await cloudStaking.totalStaked()));
      //console.log("Circ Supply:", ethers.formatEther(await cloudUtils.getCirculatingSupply()));
      //console.log("New APR:", (Number(aprAfterStake) / 100).toFixed(2) + "%");
      //console.log("Expected Rewards:", ethers.formatEther(expectedRewards));

      let rewards         = await cloudStaking.calculateRewards(user1.getAddress());
      expect(rewards).to.equal(expectedRewards);

      await cloudStaking.connect(user1).claimRewards();
      expect(
        await cloudToken.balanceOf(user1.getAddress())
      ).to.be.closeTo(
        expectedRewards,
        ethers.parseEther("0.1") // Allow small precision margin
      );
    });

    it("should allow users to initiate unstaking", async function () {

      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("6000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("6000"));      
      await cloudStaking.connect(user1).stake(BigInt(params.minStakeAmount) * BigInt(1e18));
      await cloudStaking.connect(user1).initiateUnstake(BigInt(params.minStakeAmount) * BigInt(1e18));

      let staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(0);
      expect(staker.unstakingAmount).to.equal(BigInt(params.minStakeAmount) * BigInt(1e18));
    });

    it("should allow users to cancel unstaking", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("6000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("6000"));      
      await cloudStaking.connect(user1).stake(BigInt(params.minStakeAmount) * BigInt(1e18));

      await ethers.provider.send("evm_increaseTime", [10 * 86400]);
      await ethers.provider.send("evm_mine");
      await cloudStaking.connect(user1).initiateUnstake(BigInt(params.minStakeAmount) * BigInt(1e18));


      await ethers.provider.send("evm_increaseTime", [2 * 86400]);
      await ethers.provider.send("evm_mine");
      await cloudStaking.connect(user1).cancelUnstaking();
      let staker = await cloudStaking.stakers(user1.getAddress());

      //console.log(staker);
      expect(staker.stakedAmount).to.equal(BigInt(params.minStakeAmount) * BigInt(1e18));
      expect(staker.unstakingAmount).to.equal(0);
    });

    it("should allow users to only claim unstaked tokens after cooldown", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("6000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("6000"));      
      await cloudStaking.connect(user1).stake(BigInt(params.minStakeAmount) * BigInt(1e18));

      await ethers.provider.send("evm_increaseTime", [10 * 86400]);
      await ethers.provider.send("evm_mine");
      await cloudStaking.connect(user1).initiateUnstake(BigInt(params.minStakeAmount) * BigInt(1e18) - ethers.parseEther("1"));

      await ethers.provider.send("evm_increaseTime", [1 * 86400]);
      await ethers.provider.send("evm_mine");
      await expect(
        cloudStaking.connect(user1).claimUnstakedTokens()
      ).to.be.revertedWith("Cooldown period not passed");

      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]); // Advance 7 days
      await ethers.provider.send("evm_mine");
      await cloudStaking.connect(user1).claimUnstakedTokens();
      let staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(ethers.parseEther("1"));
      expect(staker.unstakingAmount).to.equal(0);
    });


  });

  describe("Sync with vault", function () {
    it("should sync with vault when an emergency withdrawal in the vault (initiateUnstake / successful hook)", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("1000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("1000"));
      await cloudStaking.connect(user1).stake(ethers.parseEther("1000"));

      await ethers.provider.send("evm_increaseTime", [10 * 86400]);
      await ethers.provider.send("evm_mine");

      //staker = await cloudStaking.stakers(user1.getAddress());
      //console.log(staker);

      await cloudStakeVault.connect(user1).emergencyWithdraw();

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(0);
      expect(staker.unstakingAmount).to.equal(0);
      //console.log(staker);

      await expect(
        cloudStaking.connect(user1).initiateUnstake(ethers.parseEther("1"))
      ).to.be.revertedWith("Insufficient staked balance");

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(0);
      expect(staker.unstakingAmount).to.equal(0);
      //console.log(staker);
    });

    it("should sync with vault when an emergency withdrawal in the vault (initiateUnstake / failed hook)", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("1000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("1000"));
      await cloudStaking.connect(user1).stake(ethers.parseEther("1000"));

      await ethers.provider.send("evm_increaseTime", [10 * 86400]);
      await ethers.provider.send("evm_mine");

      //staker = await cloudStaking.stakers(user1.getAddress());
      //console.log(staker);

      await cloudStaking.setForceFailTest(1);

      await cloudStakeVault.connect(user1).emergencyWithdraw();

      await expect(
        cloudStaking.connect(user1).initiateUnstake(ethers.parseEther("1"))
      ).to.be.revertedWith("Insufficient staked balance");

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(ethers.parseEther("1000"));
    });

    it("should sync with vault when an emergency withdrawal in the vault (stake / successful hook)", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("1000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("1000"));
      await cloudStaking.connect(user1).stake(ethers.parseEther("500"));

      await ethers.provider.send("evm_increaseTime", [10 * 86400]);
      await ethers.provider.send("evm_mine");

      //staker = await cloudStaking.stakers(user1.getAddress());
      //console.log(staker);

      await cloudStakeVault.connect(user1).emergencyWithdraw();

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(0);
      expect(staker.unstakingAmount).to.equal(0);
      //console.log(staker);

      await expect(
        cloudStaking.connect(user1).stake(ethers.parseEther("500"))
      ).to.be.revertedWith("Cannot deposit during emergency withdrawal request");

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(0);
      expect(staker.unstakingAmount).to.equal(0);
      //console.log(staker);
    });

    it("should sync with vault when an emergency withdrawal in the vault (stake / failed hook)", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("1000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("1000"));
      await cloudStaking.connect(user1).stake(ethers.parseEther("500"));

      await ethers.provider.send("evm_increaseTime", [10 * 86400]);
      await ethers.provider.send("evm_mine");

      await cloudStaking.setForceFailTest(1);

      await cloudStakeVault.connect(user1).emergencyWithdraw();

      await expect(
        cloudStaking.connect(user1).stake(ethers.parseEther("500"))
      ).to.be.revertedWith("Cannot deposit during emergency withdrawal request");

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(ethers.parseEther("500"));
    });

    it("should sync with vault when an emergency withdrawal in the vault (claimUnstakedTokens / successful hook)", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("1000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("1000"));
      await cloudStaking.connect(user1).stake(ethers.parseEther("500"));

      await ethers.provider.send("evm_increaseTime", [10 * 86400]);
      await ethers.provider.send("evm_mine");

      await cloudStaking.connect(user1).initiateUnstake(ethers.parseEther("1"));

      await ethers.provider.send("evm_increaseTime", [1 * 86400]);
      await ethers.provider.send("evm_mine");

      await cloudStakeVault.connect(user1).emergencyWithdraw();

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(0);
      expect(staker.unstakingAmount).to.equal(0);
      //console.log(staker);

      await expect(
        cloudStaking.connect(user1).claimUnstakedTokens()
      ).to.be.revertedWith("No tokens in unstaking process");

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(0);
      expect(staker.unstakingAmount).to.equal(0);
      //console.log(staker);
    });

    it("should sync with vault when an emergency withdrawal in the vault (claimUnstakedTokens / failed hook)", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("1000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("1000"));
      await cloudStaking.connect(user1).stake(ethers.parseEther("500"));

      await ethers.provider.send("evm_increaseTime", [10 * 86400]);
      await ethers.provider.send("evm_mine");

      await cloudStaking.connect(user1).initiateUnstake(ethers.parseEther("1"));

      await ethers.provider.send("evm_increaseTime", [1 * 86400]);
      await ethers.provider.send("evm_mine");

      await cloudStaking.setForceFailTest(1);

      await cloudStakeVault.connect(user1).emergencyWithdraw();

      await expect(
        cloudStaking.connect(user1).claimUnstakedTokens()
      ).to.be.revertedWith("No tokens in unstaking process");

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(ethers.parseEther("499"));
      expect(staker.unstakingAmount).to.equal(ethers.parseEther("1"));
    });

    it("should sync with vault when an emergency withdrawal in the vault (claimRewards / successful hook)", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("1000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("1000"));
      await cloudStaking.connect(user1).stake(ethers.parseEther("500"));

      await ethers.provider.send("evm_increaseTime", [10 * 86400]);
      await ethers.provider.send("evm_mine");

      await cloudStakeVault.connect(user1).emergencyWithdraw();

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(0);
      expect(staker.unstakingAmount).to.equal(0);
      //console.log(staker);

      await expect(
        cloudStaking.connect(user1).claimRewards()
      ).to.be.revertedWith("No staked tokens");

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(0);
      expect(staker.unstakingAmount).to.equal(0);
      //console.log(staker);
    });

    it("should sync with vault when an emergency withdrawal in the vault (claimRewards / failed hook)", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("1000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("1000"));
      await cloudStaking.connect(user1).stake(ethers.parseEther("500"));

      await ethers.provider.send("evm_increaseTime", [10 * 86400]);
      await ethers.provider.send("evm_mine");

      await cloudStaking.setForceFailTest(1);

      await cloudStakeVault.connect(user1).emergencyWithdraw();

      await expect(
        cloudStaking.connect(user1).claimRewards()
      ).to.be.revertedWith("No staked tokens");

      staker = await cloudStaking.stakers(user1.getAddress());
      expect(staker.stakedAmount).to.equal(ethers.parseEther("500"));
      expect(staker.unstakingAmount).to.equal(ethers.parseEther("0"));
    });
  });

  describe("Inactivity", function () {

    it("should deactivate staker after inactivity", async function () {
      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("6000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("6000"));      
      await cloudStaking.connect(user1).stake(ethers.parseEther("6000"));

      let stakerInfo = await cloudStaking.stakers(user1.getAddress());
      expect(stakerInfo.isActive).to.be.true;

      await network.provider.send("evm_increaseTime", [60 * 60 * 24 * 365]); // 1 year
      await network.provider.send("evm_mine"); // Mine a new block

      await cloudStaking.handleInactivity(1);

      stakerInfo = await cloudStaking.stakers(user1.getAddress());
      expect(stakerInfo.isActive).to.be.false;

      expect(await cloudStaking.totalStaked()).to.equal(ethers.parseEther("6000"));
      expect(await cloudStaking.totalStakedForTally()).to.equal(0);
    });

    it("should reactivate staker on new stake", async function () {

      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("6000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("6000"));      
      await cloudStaking.connect(user1).stake(ethers.parseEther("100"));

      let stakerInfo = await cloudStaking.stakers(user1.getAddress());
      expect(stakerInfo.isActive).to.be.true;

      await network.provider.send("evm_increaseTime", [60 * 60 * 24 * 365]); // 1 year
      await network.provider.send("evm_mine"); // Mine a new block

      await cloudStaking.handleInactivity(1);
      stakerInfo = await cloudStaking.stakers(user1.getAddress());
      expect(stakerInfo.isActive).to.be.false;

      await cloudStaking.connect(user1).stake(ethers.parseEther("1"));
      stakerInfo = await cloudStaking.stakers(user1.getAddress());
      expect(stakerInfo.isActive).to.be.true;
    });

    it("should automatically unstake after prolonged inactivity", async function () {

      await cloudToken.transfer(user1.getAddress(), ethers.parseEther("6000"));
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("6000"));      
      await cloudStaking.connect(user1).stake(ethers.parseEther("6000"));

      let stakerInfo = await cloudStaking.stakers(user1.getAddress());
      expect(stakerInfo.isActive).to.be.true;

      await network.provider.send("evm_increaseTime", [60 * 60 * 24 * 365 * 3]); // 1 year
      await network.provider.send("evm_mine"); // Mine a new block

      await cloudStaking.handleInactivity(1);

      stakerInfo = await cloudStaking.stakers(user1.getAddress());
      expect(stakerInfo.stakedAmount).to.equal(0);
      expect(stakerInfo.isActive).to.be.false;
    });

    it("should update lastActivityTime from cloudGovernor before deactivating staker", async function () {
        await cloudToken.transfer(user1.getAddress(), ethers.parseEther("70000"));
        await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("60000")); 
        await cloudToken.connect(user1).approve(cloudGovernor.getAddress(), ethers.parseEther("10000"));      
        await cloudStaking.connect(user1).stake(ethers.parseEther("60000"));
        let stakerInfo = await cloudStaking.stakers(user1.getAddress());
        expect(stakerInfo.isActive).to.be.true;

        // Advance time beyond the governance inactivity threshold
        const blocks = (params.governanceInactivityThreshold * 24 * 3600 + 100) / 2;
        const hexBlocks = '0x' + Math.floor(blocks).toString(16);
        await ethers.provider.send("hardhat_mine", [hexBlocks]);

        const title       = "Proposal - Unauthorized Cancellation";
        const description = "This proposal ensures only authorized users can cancel.";
        const targets     = [await cloudGovernor.getAddress()];
        const values      = [0];
        const calldatas   = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];
        const tx          = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
        const receipt     = await tx.wait();
        const proposalId  = receipt.logs[1].args.proposalId;

        // Handle inactivity
        await cloudStaking.handleInactivityOne(user1.getAddress());

        // Fetch updated staker info
        stakerInfo = await cloudStaking.stakers(user1.getAddress());

        // Ensure lastActivityTime has been updated from cloudGovernor
        expect(stakerInfo.isActive).to.be.true; // Should remain active since activity was found in cloudGovernor
    });


  });

  describe("Snapshots", function () {
    it("should remove old checkpoints but keep recent ones", async function () {
        await cloudToken.transfer(user1.getAddress(), ethers.parseEther("6000"));
        await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), ethers.parseEther("6000"));      
        await cloudStaking.connect(user1).stake(ethers.parseEther("5000"));

        let blockNumber = await ethers.provider.getBlockNumber();

        // Simulate multiple checkpoints over time
        for (let i = 0; i < 5; i++) {
            await ethers.provider.send("hardhat_mine", ["0x13C680"]); // Mine ~30 days of blocks
            await cloudStaking.connect(user1).stake(ethers.parseEther("1"));
        }

        // Print checkpoints before cleanup
        let stakeCheckpoints = await cloudStaking.getStakedCheckpoints(user1.getAddress());
        //console.log("Checkpoints before cleanup:", stakeCheckpoints);

        // Trigger cleanup function
        await cloudStaking.handleInactivityOne(user1.getAddress());

        // Fetch checkpoints after cleanup
        stakeCheckpoints = await cloudStaking.getStakedCheckpoints(user1.getAddress());
        //console.log("Checkpoints after cleanup:", stakeCheckpoints);

        expect(stakeCheckpoints.length).to.be.lessThanOrEqual(2);
    });

  });

  describe("Views", function () {
    it("should return correct data from getStakersData()", async function () {
      // Step 1: Stake tokens for multiple users
      const stakeAmount1 = ethers.parseEther("100");
      const stakeAmount2 = ethers.parseEther("200");

      await cloudToken.transfer(user1.getAddress(), stakeAmount1);
      await cloudToken.transfer(user2.getAddress(), stakeAmount2);

      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), stakeAmount1);
      await cloudToken.connect(user2).approve(cloudStakeVault.getAddress(), stakeAmount2);

      await cloudStaking.connect(user1).stake(stakeAmount1);
      await cloudStaking.connect(user2).stake(stakeAmount2);

      // Step 2: Fetch stakers' data
      const addresses = [user1.getAddress(), user2.getAddress()];
      const [stakedAmounts, isActives] = await cloudStaking.getStakersData(addresses);

      // Step 3: Verify data
      expect(await cloudStaking.totalStakers()).to.equal(2);
      expect(await cloudStaking.totalStaked()).to.equal(ethers.parseEther("300"));
      expect(await cloudStaking.totalStakedForTally()).to.equal(ethers.parseEther("300"));

      expect(stakedAmounts[0]).to.equal(stakeAmount1);
      expect(stakedAmounts[1]).to.equal(stakeAmount2);
      expect(isActives[0]).to.be.true;
      expect(isActives[1]).to.be.true;
    });


    it("should return correct data from getAllStakers() with pagination", async function () {
      // Step 1: Stake tokens for multiple users
      const stakeAmount1 = ethers.parseEther("100");
      const stakeAmount2 = ethers.parseEther("150");
      const stakeAmount3 = ethers.parseEther("250");

      await cloudToken.transfer(user1.getAddress(), stakeAmount1);
      await cloudToken.transfer(user2.getAddress(), stakeAmount2);
      await cloudToken.transfer(user3.getAddress(), stakeAmount3);

      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), stakeAmount1);
      await cloudToken.connect(user2).approve(cloudStakeVault.getAddress(), stakeAmount2);
      await cloudToken.connect(user3).approve(cloudStakeVault.getAddress(), stakeAmount3);

      await cloudStaking.connect(user1).stake(stakeAmount1);
      await cloudStaking.connect(user2).stake(stakeAmount2);
      await cloudStaking.connect(user3).stake(stakeAmount3);

      // Step 2: Fetch all stakers (pagination test)
      const [stakers1, amounts1] = await cloudStaking.getAllStakers(0, 2); // Fetch first 2 stakers
      const [stakers2, amounts2] = await cloudStaking.getAllStakers(2, 2); // Fetch remaining stakers

      // Step 3: Verify first batch
      expect(stakers1[0]).to.equal(await user1.getAddress());
      expect(stakers1[1]).to.equal(await user2.getAddress());
      expect(amounts1[0]).to.equal(stakeAmount1);
      expect(amounts1[1]).to.equal(stakeAmount2);

      // Step 4: Verify second batch
      expect(stakers2[0]).to.equal(await user3.getAddress());
      expect(amounts2[0]).to.equal(stakeAmount3);
    });

  });
  

});


/*

TO DO:
test : 
  uint256 lastGovernorActivityTime = cloudGovernor.getLastActivityTime(stakerAddr); // Fetch last recorded activity from the governor
  _cleanStakedCheckpoints
  _updateStakedCheckpoint
  userStakedForTally
*/