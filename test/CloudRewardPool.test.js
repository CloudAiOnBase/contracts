const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CloudRewardPool", function () {
  let CloudToken, cloudToken, CloudStakeVault, cloudStakeVault, CloudRewardPool, cloudRewardPool, cloudStaking, OtherToken, otherToken;
  let owner, user1, user2;

  beforeEach(async function () {
    [owner, cloudStaking, user1, user2] = await ethers.getSigners();

    // CloudToken
    CloudToken = await ethers.getContractFactory("CloudToken");
    cloudToken = await CloudToken.deploy();
    await cloudToken.waitForDeployment();

    // CloudStakeVault
    CloudStakeVault = await ethers.getContractFactory("CloudStakeVault");
    cloudStakeVault = await CloudStakeVault.deploy(await cloudToken.getAddress(), await cloudStaking.getAddress());
    await cloudStakeVault.waitForDeployment();
    
    // CloudRewardPool
    CloudRewardPool = await ethers.getContractFactory("CloudRewardPool");
    cloudRewardPool = await CloudRewardPool.deploy(
      await cloudToken.getAddress(),
      await cloudStaking.getAddress(),
      await cloudStakeVault.getAddress(),
      10 // rugDetectionApr
    );

    // otherToken (for mistaken recovery test)
    OtherToken = await ethers.getContractFactory("CloudToken");
    otherToken = await OtherToken.deploy();
    await otherToken.waitForDeployment();
    
  });

  it("Should set correct initial values", async function () {
    expect(await cloudRewardPool.cloudToken()).to.equal(await cloudToken.getAddress());
    expect(await cloudRewardPool.cloudStaking()).to.equal(await cloudStaking.getAddress());
    expect(await cloudRewardPool.cloudStakeVault()).to.equal(await cloudStakeVault.getAddress());
    expect(await cloudRewardPool.rugDetectionApr()).to.equal(10);
  });

  it("Should allow owner to set a new staking contract", async function () {
    await cloudRewardPool.setStakingContract(await user1.getAddress());
    expect(await cloudRewardPool.cloudStaking()).to.equal(await user1.getAddress());
  });

  it("Should NOT allow non-owner to set a new staking contract", async function () {
      await expect(cloudRewardPool.connect(user1).setStakingContract(await user2.getAddress())).to.be.reverted;
  });

  it("Should allow owner to set a new stake vault contract", async function () {
    await cloudRewardPool.setCloudStakeVault(await user1.getAddress());
    expect(await cloudRewardPool.cloudStakeVault()).to.equal(await user1.getAddress());
  });

  it("Should NOT allow non-owner to set a new stake vault contract", async function () {
      await expect(cloudRewardPool.connect(user1).setCloudStakeVault(await user2.getAddress())).to.be.reverted;
  });

  it("Should allow owner to set a new rug detection APR", async function () {
    await cloudRewardPool.setRugDetectionApr(11);
    expect(await cloudRewardPool.rugDetectionApr()).to.equal(11);
  });

  it("Should NOT allow non-owner to set a new rug detection APR", async function () {
    await expect(cloudRewardPool.connect(user1).setRugDetectionApr(11)).to.be.reverted;
  });

  it("Should pause and unpause the contract", async function () {
    await cloudRewardPool.pause();
    await expect(cloudRewardPool.depositRewards(ethers.parseEther("10"))).to.be.reverted;
    
    await cloudRewardPool.unpause();
    await cloudToken.approve(await cloudRewardPool.getAddress(), ethers.parseEther("10"));
    await expect(cloudRewardPool.depositRewards(ethers.parseEther("10"))).to.not.be.reverted;
  });

  it("Should NOT allow non-owner to pause or unpause the contract", async function () {
      await expect(cloudRewardPool.connect(user1).pause()).to.be.reverted;

      await cloudRewardPool.pause();
      await expect(cloudRewardPool.connect(user1).unpause()).to.be.reverted;
  });

  it("Should allow owner to recover mistaken tokens", async function () {
    const depositAmount = ethers.parseEther("150");
    await otherToken.transfer(await cloudRewardPool.getAddress(), depositAmount);
    await expect( cloudRewardPool.connect(owner).recoverMistakenTokens( await otherToken.getAddress(), await user1.getAddress(), depositAmount)).to.not.be.reverted;
    expect(await otherToken.balanceOf(await user1.getAddress())).to.equal(depositAmount);
  });

  it("Should not allow to recover CLOUD token", async function () {
    const depositAmount = ethers.parseEther("150");
    await expect(
      cloudRewardPool.connect(owner).recoverMistakenTokens(await cloudToken.getAddress(), await owner.getAddress(), depositAmount)
    ).to.be.revertedWith("Cannot withdraw staking token");
  });

  it("Should not allow non-owner to recover tokens", async function () {
    const depositAmount = ethers.parseEther("150");
    await otherToken.transfer(await cloudRewardPool.getAddress(), depositAmount);
    await expect(
      cloudRewardPool.connect(user1).recoverMistakenTokens(
        await otherToken.getAddress(),
        await user1.getAddress(),
        depositAmount
      )
    ).to.be.reverted;
  });

  it("Should reject direct ETH transfers", async function () {
    await expect(
        user1.sendTransaction({ to: cloudRewardPool.getAddress(), value: ethers.parseUnits("1", "ether") })
    ).to.be.revertedWith("Direct ETH transfers not allowed");
});

  // ----- core functions

  it("Should allow topping up rewards and update balance", async function () {
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));
    await cloudToken.connect(user1).approve(await cloudRewardPool.getAddress(), ethers.parseEther("100"));
    await cloudRewardPool.connect(user1).depositRewards(ethers.parseEther("100"));

    expect(await cloudToken.balanceOf(await cloudRewardPool.getAddress())).to.equal(ethers.parseEther("100"));
  });

  it("Should not allow deposits when paused", async function () {
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));
    await cloudToken.connect(user1).approve(await cloudRewardPool.getAddress(), ethers.parseEther("100"));

    await cloudRewardPool.pause();
    await expect(
      cloudRewardPool.connect(user1).depositRewards(ethers.parseEther("10"))
    ).to.be.reverted;
});

  it("Should NOT allow non-staking contract to distribute reward", async function () {
    await expect(
      cloudRewardPool.connect(user1).distributeRewards(await user1.getAddress(), ethers.parseEther("10"))
    ).to.be.revertedWith("Only staking contract can distribute rewards");
  });

  it("Should distribute rewards correctly", async function () {
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("33"));
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));

    await cloudToken.connect(user1).approve(await cloudStakeVault.getAddress(), ethers.parseEther("100"));
    await cloudStakeVault.connect(cloudStaking).deposit(await user1.getAddress(), ethers.parseEther("50"));

    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(
            cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))
          ).to.emit(cloudRewardPool, "RewardsDistributed").withArgs(user1.getAddress(), ethers.parseEther("5"))
    expect(await cloudToken.balanceOf(await user1.getAddress())).to.equal(ethers.parseEther("55"));
  });

  it("Should not allow exceeding entitled rewards", async function () {
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("33"));
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));

    await cloudToken.connect(user1).approve(await cloudStakeVault.getAddress(), ethers.parseEther("100"));
    await cloudStakeVault.connect(cloudStaking).deposit(await user1.getAddress(), ethers.parseEther("50"));

    await expect(cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))).to.be.revertedWith("Requested amount exceeds entitled rewards");

    await ethers.provider.send("evm_increaseTime", [(365-1) * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))).to.be.revertedWith("Requested amount exceeds entitled rewards");
  });

  it("Should not allow non-staker rewards", async function () {
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("33"));

    await expect(cloudRewardPool.connect(cloudStaking).distributeRewards(await user2.getAddress(), ethers.parseEther("5"))).to.be.revertedWith("No tokens staked");
  });

  it("Should revert if contract balance is less than requested reward", async function () {
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("3"));
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));

    await cloudToken.connect(user1).approve(await cloudStakeVault.getAddress(), ethers.parseEther("100"));
    await cloudStakeVault.connect(cloudStaking).deposit(await user1.getAddress(), ethers.parseEther("50"));

    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(
            cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))
          ).to.be.revertedWith("Insufficient rewards");
  });

  it("Should revert if reward amount is zero", async function () {
      await expect(
          cloudRewardPool.connect(cloudStaking).distributeRewards(user1.address, 0)
      ).to.be.revertedWith("Amount must be greater than zero");
  });

  it("Should not allow distributing more than the entitled amount after deposit-withdraw-deposit", async function () {
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("33"));
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));
    await cloudToken.transfer(await user2.getAddress(), ethers.parseEther("100"));

    await cloudToken.connect(user1).approve(await cloudStakeVault.getAddress(), ethers.parseEther("100"));
    await cloudStakeVault.connect(cloudStaking).deposit(await user1.getAddress(), ethers.parseEther("50"));

    await cloudToken.connect(user2).approve(await cloudStakeVault.getAddress(), ethers.parseEther("100"));
    await cloudStakeVault.connect(cloudStaking).deposit(await user2.getAddress(), ethers.parseEther("50"));

    await ethers.provider.send("evm_increaseTime", [10 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await cloudStakeVault.connect(cloudStaking).withdraw(await user1.getAddress(), ethers.parseEther("50"));

    await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await cloudStakeVault.connect(cloudStaking).deposit(await user1.getAddress(), ethers.parseEther("50"));

    await ethers.provider.send("evm_increaseTime", [(365-1) * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))).to.be.revertedWith("Requested amount exceeds entitled rewards");
 
    await ethers.provider.send("evm_increaseTime", [1 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(
        cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))
      ).to.emit(cloudRewardPool, "RewardsDistributed").withArgs(user1.getAddress(), ethers.parseEther("5"))
    expect(await cloudToken.balanceOf(await user1.getAddress())).to.equal(ethers.parseEther("55"));

  });

});
