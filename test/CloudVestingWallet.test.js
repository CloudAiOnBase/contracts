const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("CloudVestingWallet", function () {
    let vestingWallet, cloudToken, owner, beneficiary;
    const startTime = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60); // 1-year cliff
    const duration = 4 * 365 * 24 * 60 * 60; // 4-year duration

    beforeEach(async function () {
        [owner, beneficiary] = await ethers.getSigners();

        // Deploy CloudToken
        const CloudToken = await ethers.getContractFactory("CloudToken");
        cloudToken = await CloudToken.deploy();
        await cloudToken.waitForDeployment(); // Ensure deployment completes

        // Deploy CloudVestingWallet
        const VestingWallet = await ethers.getContractFactory("CloudVestingWallet");
        vestingWallet = await VestingWallet.deploy(beneficiary.address, startTime, duration);
        await vestingWallet.waitForDeployment(); // Ensure deployment completes

        // Transfer Cloud tokens to the vesting contract
        await cloudToken.transfer(await vestingWallet.getAddress(), ethers.parseEther("1000000"));
    });

    it("Should not allow withdrawal before the cliff", async function () {
        await vestingWallet["release(address)"](cloudToken.getAddress());
        
        // Check that no tokens have been released
        let released = await vestingWallet["released(address)"](cloudToken.getAddress());
        expect(released).to.be.equal(0);
    });

    it("Should not allow withdrawal until the end of the cliff", async function () {
        // Fast-forward 1 year to reach the cliff
        await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 - 12]); 
        await network.provider.send("evm_mine");

        // Check releasable amount (Explicit function signature)
        let releasable = await vestingWallet["releasable(address)"](cloudToken.getAddress());
        expect(releasable).to.be.equal(0); // Should be 0, cliff just ended

     });   

    it("Should allow withdrawal after cliff and vesting over time", async function () {
        // Fast-forward another 0.5 years (0.5 years after cliff)
        await network.provider.send("evm_increaseTime", [0.5 * 365 * 24 * 60 * 60]);
        await network.provider.send("evm_mine");

        // Now some tokens should be available
        releasable = await vestingWallet["releasable(address)"](cloudToken.getAddress());
        expect(releasable).to.be.gt(0);

        // Release tokens (Explicit function signature)
        await vestingWallet["release(address)"](cloudToken.getAddress());
        let released = await vestingWallet["released(address)"](cloudToken.getAddress());
        expect(released).to.be.gt(0);

        // Check that the beneficiary received the tokens
        const beneficiaryBalance = await cloudToken.balanceOf(beneficiary.address);
        expect(beneficiaryBalance).to.be.equal(released);
        //console.log(parseInt(ethers.formatUnits(released, 18),10));
    });

    it("Should release all tokens at the end of vesting period", async function () {
        // Fast-forward 5 years (cliff + 4 years vesting)
        await network.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60]); 
        await network.provider.send("evm_mine");

        // Check releasable amount
        let releasable = await vestingWallet["releasable(address)"](cloudToken.getAddress());
        expect(releasable).to.be.equal(await cloudToken.balanceOf(await vestingWallet.getAddress()));

        // Release all tokens
        await vestingWallet["release(address)"](cloudToken.getAddress());

        // Check that the beneficiary received the tokens
        let released = await vestingWallet["released(address)"](cloudToken.getAddress());
        const beneficiaryBalance = await cloudToken.balanceOf(beneficiary.address);
        expect(beneficiaryBalance).to.be.equal(released);
        //console.log(parseInt(ethers.formatUnits(released, 18),10));

        // Now the contract should have 0 balance
        expect(await cloudToken.balanceOf(await vestingWallet.getAddress())).to.be.equal(0);
    });

});
