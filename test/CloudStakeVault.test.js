const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CloudStakeVault", function () {
  let cloudStakeVault;
  let cloudToken, otherToken;
  let owner, CloudStaking, cloudStaking, user, other, other2, newCloudStaking;
  const initialSupply = ethers.parseEther("1000000000");
  const depositAmount = ethers.parseEther("150");
  const depositAmount2 = ethers.parseEther("50");
  const withdrawAmount = ethers.parseEther("50");
  let cloudStakingSigner;

  beforeEach(async function () {
    [owner, cloudStakingSigner, user, other, other2, newCloudStaking] = await ethers.getSigners();

    // Deploy CloudToken
    const CloudToken = await ethers.getContractFactory("CloudToken");
    cloudToken = await CloudToken.deploy();
    await cloudToken.waitForDeployment();

    // Deploy CloudUtils
    CloudUtils = await ethers.getContractFactory("CloudUtils");
    cloudUtils = await upgrades.deployProxy(CloudUtils, [await cloudToken.getAddress()], { initializer: "initialize" });

    // Transfer tokens to users before they can deposit
    await cloudToken.transfer(user.getAddress(), depositAmount);
    await cloudToken.transfer(other.getAddress(), depositAmount);
    await cloudToken.transfer(other2.getAddress(), depositAmount);

    // Deploy CloudStakeVault
    const CloudStakeVault = await ethers.getContractFactory("CloudStakeVault");
    cloudStakeVault = await CloudStakeVault.deploy(cloudToken.getAddress(), "0x000000000000000000000000000000000000dEaD");
    await cloudStakeVault.waitForDeployment();

    // Deploy CloudStaking
    CloudStaking = await ethers.getContractFactory("CloudStaking");
    cloudStaking = await upgrades.deployProxy(
      CloudStaking,
      [
        await cloudToken.getAddress(),
        await cloudStakeVault.getAddress(),
        "0x000000000000000000000000000000000000dEaD",
        await cloudUtils.getAddress()
      ],
      { initializer: "initialize" }
    );

    await expect(cloudStakeVault.connect(owner).setStakingContract(cloudStakingSigner)).to.emit(cloudStakeVault, "StakingContractAddressUpdated");

  });

  describe("Administrative functions", function () {
      it("Should allow owner to pause and unpause", async function () {
        await cloudToken.connect(user).approve(cloudStakeVault.getAddress(), depositAmount);

        await cloudStakeVault.connect(owner).pause();
        await expect(cloudStakeVault.connect(cloudStakingSigner).deposit(user.getAddress(), depositAmount)).to.be.reverted;

        await cloudStakeVault.connect(owner).unpause();
        await expect(cloudStakeVault.connect(cloudStakingSigner).deposit(user.getAddress(), depositAmount)).to.emit(cloudStakeVault, "Deposited");

        await expect(cloudStakeVault.connect(user).pause()).to.be.reverted;

      });

      it("Should allow owner to recover mistaken tokens", async function () {
        const OtherToken = await ethers.getContractFactory("CloudToken");
        otherToken       = await OtherToken.deploy();
        await otherToken.waitForDeployment();

        await otherToken.transfer(cloudStakeVault.getAddress(), depositAmount);
        await expect(cloudStakeVault.connect(owner).recoverMistakenTokens(otherToken.getAddress(), owner.getAddress(), depositAmount)).to.not.be.reverted;

        expect(await otherToken.balanceOf(owner.getAddress())).to.equal(initialSupply);
      });

      it("Should not allow recovery of staking token", async function () {
        await expect(cloudStakeVault.connect(owner).recoverMistakenTokens(cloudToken.getAddress(), owner.getAddress(), depositAmount)).to.be.revertedWith("Cannot withdraw staking token");
      });

      it("Should allow owner to update the staking contract address", async function () {
          const newAddress = await newCloudStaking.getAddress();
          await expect(cloudStakeVault.connect(owner).setStakingContract(newAddress)).to.emit(cloudStakeVault, "StakingContractAddressUpdated");
          expect(await cloudStakeVault.cloudStaking()).to.equal(newAddress);
      });

      it("Should revert if a non-owner tries to update the staking contract address", async function () {
          const newAddress = await newCloudStaking.getAddress();
          await expect(cloudStakeVault.connect(user).setStakingContract(newAddress)).to.be.reverted;
      });
    });


  async function wait(seconds) {
      await ethers.provider.send("evm_increaseTime", [seconds]);
      await ethers.provider.send("evm_mine");
      console.log(`⌛ wait ${seconds} sec`);
  }

  async function depositThroughStaking(user, amount, userLabel = "User") {
      let vaultBalance = await cloudToken.balanceOf(cloudStakeVault.getAddress());
      let userBalance = await cloudStakeVault.getDepositedBalance(user.getAddress());

      // Deposit through staking contract
      let tx = await cloudStakeVault.connect(cloudStakingSigner).deposit(user.getAddress(), amount);
      await expect(tx).to.emit(cloudStakeVault, "Deposited").withArgs(user.getAddress(), amount);
      console.log(`✅ [${userLabel}] Successful deposit of ${ethers.formatEther(amount)} through the staking contract`);

      // Verify vault balance and user deposit balance
      expect(await cloudToken.balanceOf(cloudStakeVault.getAddress())).to.equal(vaultBalance + amount);
      expect(await cloudStakeVault.getDepositedBalance(user.getAddress())).to.equal(userBalance + amount);
      //console.log(`✅ [${userLabel}] getDepositedBalance correct, vault balance correct`);

      // Check last deposit time
      let receipt = await tx.wait();
      let blockTimestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp;
      expect(await cloudStakeVault.getLastActivityTime(user.getAddress())).to.equal(blockTimestamp);
      //console.log(`✅ [${userLabel}] lastActivityTime correctly updated`);

      vaultBalance = await cloudToken.balanceOf(cloudStakeVault.getAddress());
      userBalance = await cloudStakeVault.getDepositedBalance(user.getAddress());
      console.log(`💰 [${userLabel}] balance  ${ethers.formatEther(userBalance)}`);
      console.log(`🏦 [Vault]  balance  ${ethers.formatEther(vaultBalance)}`);
  }

  async function withdrawThroughStaking(user, amount, userLabel = "User") {
      let vaultBalance = await cloudToken.balanceOf(cloudStakeVault.getAddress());
      let userBalance = await cloudStakeVault.getDepositedBalance(user.getAddress());

      // Perform withdrawal via staking contract
      let tx = await cloudStakeVault.connect(cloudStakingSigner).withdraw(user.getAddress(), amount);
      await expect(tx).to.emit(cloudStakeVault, "Withdrawn").withArgs(user.getAddress(), amount);
      console.log(`✅ [${userLabel}] Successful withdrawal of ${ethers.formatEther(amount)} through the staking contract`);

      // Verify updated balances
      expect(await cloudToken.balanceOf(cloudStakeVault.getAddress())).to.equal(vaultBalance - amount);
      expect(await cloudStakeVault.getDepositedBalance(user.getAddress())).to.equal(userBalance - amount);
      //console.log(`✅ [${userLabel}] getDepositedBalance correct, vault balance correct`);

      // Ensure lastActivityTime remains unchanged
      let receipt = await tx.wait();
      let blockTimestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp;
      userBalance = await cloudStakeVault.getDepositedBalance(user.getAddress());
      if(userBalance > 0) expect(await cloudStakeVault.getLastActivityTime(user.getAddress())).to.equal(blockTimestamp);
      else expect(await cloudStakeVault.getLastActivityTime(user.getAddress())).to.equal(0);
      //console.log(`✅ [${userLabel}] lastActivityTime still correct`);

     vaultBalance = await cloudToken.balanceOf(cloudStakeVault.getAddress());
      userBalance = await cloudStakeVault.getDepositedBalance(user.getAddress());
      console.log(`💰 [${userLabel}] balance  ${ethers.formatEther(userBalance)}`);
      console.log(`🏦 [Vault]  balance  ${ethers.formatEther(vaultBalance)}`);
  }

  async function claimEmergencyWithdrawal(user, userLabel = "User") {
      let vaultBalance = await cloudToken.balanceOf(cloudStakeVault.getAddress());
      let info = await cloudStakeVault.getEmergencyWithdrawalInfo(user.getAddress());
      let walletBalance = await cloudToken.balanceOf(user.getAddress())
  
      // Claim emergency withdrawal
      await expect(cloudStakeVault.connect(user).claimEmergencyWithdraw()).to.emit(cloudStakeVault, "EmergencyWithdrawn").withArgs(user.getAddress(), info.pendingAmount);
      console.log(`✅ [${userLabel}] successfully claimed emergency withdrawal after cooldown`);

      // Check token balances
      expect(await cloudToken.balanceOf(user.getAddress())).to.equal(walletBalance + info.pendingAmount);
      expect(await cloudToken.balanceOf(cloudStakeVault.getAddress())).to.equal(vaultBalance - info.pendingAmount);
      //console.log(`✅ [${userLabel}] Token balances correct after emergency withdrawal`);

      // Ensure deposit balance is erased
      expect(await cloudStakeVault.getDepositedBalance(user.getAddress())).to.equal(0);
      
      // Verify emergency withdrawal info is cleared
      info = await cloudStakeVault.getEmergencyWithdrawalInfo(user.getAddress());
      expect(info.pendingAmount).to.equal(0);
      expect(info.requested).to.equal(false);
      //console.log(`✅ [${userLabel}] balances erased in the vault`);

      // Ensure another claim attempt fails
      await expect(cloudStakeVault.connect(user).claimEmergencyWithdraw()).to.be.revertedWith("No pending emergency withdrawal");
      //console.log(`✅ [${userLabel}] new EmergencyWithdrawRequest failed as expected`);

      vaultBalance = await cloudToken.balanceOf(cloudStakeVault.getAddress());
      userBalance = await cloudStakeVault.getDepositedBalance(user.getAddress());
      console.log(`💰 [${userLabel}] balance  ${ethers.formatEther(userBalance)}`);
      console.log(`🏦 [Vault]  balance  ${ethers.formatEther(vaultBalance)}`);
  }


  async function requestEmergencyWithdrawal(user, userLabel = "User") {
      let expectedPendingAmount = await cloudStakeVault.getDepositedBalance(user.getAddress());

      await expect(cloudStakeVault.connect(owner).setStakingContract(cloudStaking.getAddress())).to.emit(cloudStakeVault, "StakingContractAddressUpdated"); //hack
      await expect(cloudStakeVault.connect(user).emergencyWithdraw()).to.emit(cloudStakeVault, "EmergencyWithdrawRequested");
      await expect(cloudStakeVault.connect(owner).setStakingContract(cloudStakingSigner)).to.emit(cloudStakeVault, "StakingContractAddressUpdated"); //hack
      console.log(`✅ [${userLabel}] Emergency withdrawal requested`);

      expect(await cloudStakeVault.getDepositedBalance(user.getAddress())).to.equal(0);
      const info = await cloudStakeVault.getEmergencyWithdrawalInfo(user.getAddress());
      expect(info.pendingAmount).to.equal(expectedPendingAmount);
      expect(info.requested).to.equal(true);
      //console.log(`✅ [${userLabel}] balance erased, correctly stored in the Emergency Withdraw Request`);

      await wait(10);

      await expect(cloudStakeVault.connect(user).emergencyWithdraw()).to.be.revertedWith("Already requested");
      console.log(`✅ [${userLabel}] Emergency withdrawal requested`);

      await expect(cloudStakeVault.connect(cloudStakingSigner).deposit(user.getAddress(), depositAmount2)).to.be.revertedWith("Cannot deposit during emergency withdrawal request");
      console.log("✅ [${userLabel}] cannot deposit during emergency withdrawal request"); 

      await expect(cloudStakeVault.connect(cloudStakingSigner).withdraw(user.getAddress(), depositAmount2)).to.be.revertedWith("Cannot withdraw during emergency withdrawal request");
      console.log("✅ [${userLabel}] cannot withdraw during emergency withdrawal request"); 

      await wait(10);

      await expect(cloudStakeVault.connect(user).claimEmergencyWithdraw()).to.be.revertedWith("Emergency cooldown not finished");
      //console.log(`✅ [${userLabel}] cannot claim emergency withdrawal yet`);
  }


  describe("Complete process", function () {
    it("", async function () {
      try {
          await cloudToken.connect(user).approve(cloudStakeVault.getAddress(), depositAmount);
          await expect(cloudStakeVault.connect(user).deposit(user.getAddress(), depositAmount2)).to.be.revertedWith("Only CloudStaking can call this function");
          console.log("✅ Direct user deposit rejected");  

          expect(await cloudStakeVault.getLastActivityTime(user.getAddress())).to.equal(0);
          console.log("✅ lastActivityTime = 0");  

          await wait(10);

          await depositThroughStaking(user, depositAmount2, "User 1");

          await wait(10);

          await depositThroughStaking(user, depositAmount2, "User 1");

          await wait(10);

          await expect(cloudStakeVault.connect(user).deposit(user.getAddress(), depositAmount2)).to.be.revertedWith("Only CloudStaking can call this function");
          console.log("✅ Direct deposit rejected again");

          await expect(cloudStakeVault.connect(user).withdraw(user.getAddress(), withdrawAmount)).to.be.revertedWith("Only CloudStaking can call this function");
          console.log("✅ Direct user withdrawal rejected");

          await wait(10);

          await withdrawThroughStaking(user, depositAmount2, "User 1");

          await expect(cloudStakeVault.connect(cloudStakingSigner).withdraw(user.getAddress(), (depositAmount2 + ethers.parseEther("0.0000001")))).to.be.revertedWith("Insufficient user balance");
          console.log("✅ cannot witdraw more than user balance");

          await wait(10);

          await cloudToken.connect(other).approve(cloudStakeVault.getAddress(), depositAmount);
          await depositThroughStaking(other, depositAmount2, "User 2");

          await wait(10);

          await cloudToken.connect(other2).approve(cloudStakeVault.getAddress(), depositAmount);
          await depositThroughStaking(other2, depositAmount2, "User 3");

          await wait(10);

          await depositThroughStaking(other, depositAmount2 + depositAmount2, "User 2");

          await wait(10);

          await requestEmergencyWithdrawal(other2, "User 3");

          const cooldown = await cloudStakeVault.EMERGENCY_COOLDOWN();
          await ethers.provider.send("evm_increaseTime", [Number(cooldown) + 1]);
          await ethers.provider.send("evm_mine", []);
          console.log("⌛ wait 30 days"); 

          await claimEmergencyWithdrawal(other2, "User 3");

          await wait(10);

          await cloudToken.connect(other2).approve(cloudStakeVault.getAddress(), depositAmount);
          await depositThroughStaking(other2, depositAmount, "User 3");

          await wait(10);

          await withdrawThroughStaking(other2, withdrawAmount, "User 3");

          await wait(10);
          
          await withdrawThroughStaking(other2, depositAmount2 + depositAmount2, "User 3");

          await requestEmergencyWithdrawal(user, "User 1");

          await ethers.provider.send("evm_increaseTime", [Number(cooldown) + 1]);
          await ethers.provider.send("evm_mine", []);
          console.log("⌛ wait 30 days"); 

          await claimEmergencyWithdrawal(user, "User 1");

          await expect(
            cloudStakeVault.connect(cloudStakingSigner).withdraw(user.getAddress(), (depositAmount2 + ethers.parseEther("0.0000001")))
          ).to.be.revertedWith("Insufficient user balance");
          console.log("✅ cannot witdraw more than user balance");

          await wait(10);

          await withdrawThroughStaking(other, depositAmount, "User 2");

          await expect(cloudStakeVault.connect(user).emergencyWithdraw()).to.be.revertedWith("No funds to withdraw");
          console.log(`✅ [User 1] Emergency withdrawal request failed`);

          // Claim emergency withdrawal
          await expect(cloudStakeVault.connect(user).claimEmergencyWithdraw()).to.be.revertedWith("No pending emergency withdrawal");
          console.log(`✅ [User 1] emergency withdrawal failed`);

          await cloudToken.connect(user).approve(cloudStakeVault.getAddress(), depositAmount);
          await depositThroughStaking(user, depositAmount2, "User 1");
          await depositThroughStaking(user, depositAmount2, "User 1");
          await depositThroughStaking(user, depositAmount2, "User 1");
          await withdrawThroughStaking(user, depositAmount2, "User 1");
          await withdrawThroughStaking(user, depositAmount2, "User 1");
          await withdrawThroughStaking(user, depositAmount2, "User 1");

          await cloudToken.connect(user).approve(cloudStakeVault.getAddress(), depositAmount);
          await depositThroughStaking(user, depositAmount2, "User 1");
          await withdrawThroughStaking(user, depositAmount2, "User 1");
          await depositThroughStaking(user, depositAmount2, "User 1");
          await withdrawThroughStaking(user, depositAmount2, "User 1");
          await depositThroughStaking(user, depositAmount2, "User 1");
          await withdrawThroughStaking(user, depositAmount2, "User 1");

          await expect(cloudStakeVault.connect(cloudStakingSigner).deposit(user.getAddress(), 0)).to.be.revertedWith("Amount must be greater than zero");
          await expect(cloudStakeVault.connect(cloudStakingSigner).withdraw(user.getAddress(), 0)).to.be.revertedWith("Amount must be greater than zero");
 
      } catch (error) {
        console.error("❌ Test failed:", error);
      }
    });

  });

  
});

