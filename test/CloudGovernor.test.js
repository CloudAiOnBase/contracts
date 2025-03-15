const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("CloudGovernor", function () {
  let CloudToken, cloudToken, CloudStakeVault, cloudStakeVault, CloudRewardPool, cloudRewardPool, CloudUtils, cloudUtils, CloudStaking, cloudStaking;
  let CloudGovernor, cloudGovernor, CloudGovernorNew, cloudGovernorNew;
  let owner, nonOwner, commFund, devFund, user1, user2, user3;
  let stakingParams;
  let params;
  let commFundVestingWallet;
  

  beforeEach(async function () {
    [owner, nonOwner, commFund, devFund, user1, user2, user3] = await ethers.getSigners();

    // Deploy CloudToken
    CloudToken = await ethers.getContractFactory("CloudToken");
    cloudToken = await CloudToken.deploy();
    await cloudToken.waitForDeployment();

    // Deploy CloudVestingWallet
    const startTime = Math.floor(Date.now() / 1000); // 1-year cliff
    const duration = 4 * 365 * 24 * 60 * 60; // 4-year duration
    const CommFundVestingWallet = await ethers.getContractFactory("CloudVestingWallet");
    commFundVestingWallet = await CommFundVestingWallet.deploy(owner.address, startTime, duration);
    await commFundVestingWallet.waitForDeployment(); // Ensure deployment completes

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
      await cloudStakeVault.getAddress(),
      await cloudStaking.getAddress()
    );
    await cloudGovernor.waitForDeployment();

    // Transfer ownership of Vesting wallet to CloudGovernor
    const currentOwner = await commFundVestingWallet.owner();
    await commFundVestingWallet.transferOwnership(await cloudGovernor.getAddress());
    const newOwner = await commFundVestingWallet.owner();
    //console.log("Current Owner of CloudVestingWallet:", currentOwner);
    //console.log("New Owner of CloudVestingWallet:", newOwner);
    expect(newOwner).to.equal(await cloudGovernor.getAddress());

    // Set Staking Contract in other components
    await cloudStakeVault.setStakingContract(await cloudStaking.getAddress());
    await cloudRewardPool.setStakingContract(await cloudStaking.getAddress());

    // Set initial staking parameters for all tests
    params = {
      minStakeAmount: ethers.parseEther("100"),
      cooldown: 7 * 24 * 60 * 60, // 7 days in seconds
      governanceInactivityThreshold: 365 * 24 * 60 * 60, // 1 year in seconds
      autoUnstakePeriod: 3 * 365 * 24 * 60 * 60, // 3 years in seconds
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

    //exclude from CS
    cloudUtils.excludeFromCirculatingSupply(await cloudRewardPool.getAddress(), true);
    cloudUtils.excludeFromCirculatingSupply(await commFundVestingWallet.getAddress(), true);
    cloudUtils.excludeFromCirculatingSupply(devFund.getAddress(),  true);
    cloudUtils.excludeFromCirculatingSupply(await commFundVestingWallet.getAddress(), true);
    cloudUtils.excludeFromCirculatingSupply(await cloudGovernor.getAddress(), true);

    //send funds
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("100000000"));
    await cloudToken.transfer(await commFundVestingWallet.getAddress(),   ethers.parseEther("400000000"));
    await cloudToken.transfer(await devFund.getAddress(),         ethers.parseEther("400000000"));

    //
    expect(await cloudUtils.getCirculatingSupply()).to.equal(ethers.parseEther("100000000"));
    const circulatingSupply = await cloudUtils.getCirculatingSupply();
    //console.log(Number(circulatingSupply) / 10 ** 18);

    //create 3 stakers for voting power
    const stakeAmount1 = ethers.parseEther("10000000");
    const stakeAmount2 = ethers.parseEther("15000000");
    const stakeAmount3 = ethers.parseEther("5000000");

    await cloudToken.transfer(user1.getAddress(), stakeAmount1);
    await cloudToken.transfer(user2.getAddress(), stakeAmount2);
    await cloudToken.transfer(user3.getAddress(), stakeAmount3);

    await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), stakeAmount1);
    await cloudToken.connect(user2).approve(cloudStakeVault.getAddress(), stakeAmount2);
    await cloudToken.connect(user3).approve(cloudStakeVault.getAddress(), stakeAmount3);

    await cloudStaking.connect(user1).stake(stakeAmount1);
    await cloudStaking.connect(user2).stake(stakeAmount2);
    await cloudStaking.connect(user3).stake(stakeAmount3);
  });

  describe("Initialization", function () {
    it("should initialize correctly", async function () {
      expect(await cloudGovernor.cloudToken()).to.equal(await cloudToken.getAddress());
      expect(await cloudGovernor.cloudStakeVault()).to.equal(await cloudStakeVault.getAddress());
      expect(await cloudGovernor.cloudStaking()).to.equal(await cloudStaking.getAddress());
    });
  });

  describe("Governance Functions", function () {
    it("should allow a proposal to be created to release token from the vesting contract, voted on, and executed", async function () {

      //  Simulate time passage so that tokens are vested.
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine 327,680 blocks (~7 days)
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      //Encode the function call to release funds from VestingWallet
      const targets = [await commFundVestingWallet.getAddress()];
      const values = [0]; // No ETH transfer, only token
      const calldatas = [
        commFundVestingWallet.interface.encodeFunctionData("release(address)", [
          await cloudToken.getAddress()
        ])
      ];
      const description = "Release from the commFundVestingWallet";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create the proposal
      const tx = await cloudGovernor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;
      //console.log("Proposal Created. ID:", proposalId);

      // Wait for voting delay
      await ethers.provider.send("evm_mine");

      // Cast votes (user1, user2, user3)
      await cloudGovernor.connect(user1).castVote(proposalId, 1); // Vote FOR
      await cloudGovernor.connect(user2).castVote(proposalId, 1); // Vote FOR

      // Increase time to simulate 7 days
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine 327,680 blocks (~7 days)
      await ethers.provider.send("evm_mine"); // Mine 1 block

      // Execute the proposal
      await cloudGovernor.execute(targets, values, calldatas, descriptionHash);

      // Verify the funds were released 
      const cloudGovernorBalance = await cloudToken.balanceOf(await cloudGovernor.getAddress());
      //expect(cloudGovernorBalance).to.be.gte(ethers.BigNumber.from(0));
      expect(cloudGovernorBalance).to.be.gt(0);
      //console.log("Governor Balance After Execution:", ethers.formatEther(cloudGovernorBalance));
    });

    it("should allow a proposal to be created to release token from the vesting contract and send to user2, voted on, and executed", async function () {

      //  Simulate time passage so that tokens are vested.
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine 327,680 blocks (~7 days)
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      // Each call is sent to the appropriate contract:
      const targets = [
        await commFundVestingWallet.getAddress(),             // 1. Call release on the vesting wallet.
        await cloudToken.getAddress(),                        // 2. Call approve on the token contract.
        await cloudToken.getAddress()                         // 3. Call transferFrom on the token contract.
      ];

      const values = [0, 0, 0]; // No ETH is transferred in any of these calls

      const calldatas = [
        // 1. Release vested tokens from the vesting wallet (which sends tokens to its beneficiary, e.g. the governor)
        commFundVestingWallet.interface.encodeFunctionData("release(address)", [
          await cloudToken.getAddress()
        ]),

        // 2. Approve to spend 100 CLOUD tokens from the governor's balance
        cloudToken.interface.encodeFunctionData("approve", [
          await cloudGovernor.getAddress(),
          ethers.parseEther("100")
        ]),

        // 3. Transfer 100 CLOUD tokens from the governor's balance to user2
        cloudToken.interface.encodeFunctionData("transferFrom", [
          await cloudGovernor.getAddress(), // From the governor (who received the released tokens)
          user2.address,         // To user2
          ethers.parseEther("100")
        ])
      ];

      const description = "Release from the commFundVestingWallet and send 100 CLOUD to user2";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create the proposal
      const tx = await cloudGovernor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;
      //console.log("Proposal Created. ID:", proposalId);

      // Wait for voting delay
      await ethers.provider.send("evm_mine");

      // Cast votes (user1, user2, user3)
      await cloudGovernor.connect(user1).castVote(proposalId, 1); // Vote FOR
      await cloudGovernor.connect(user2).castVote(proposalId, 1); // Vote FOR

      // Increase time to simulate 7 days
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine 327,680 blocks (~7 days)
      await ethers.provider.send("evm_mine"); // Mine 1 block

      // Execute the proposal
      await cloudGovernor.execute(targets, values, calldatas, descriptionHash);

      // Verify the funds were released 
      const user2Balance = await cloudToken.balanceOf(user2.address);
      expect(user2Balance).to.equal(ethers.parseEther("100"));
      //console.log("User2 Balance After Execution:", ethers.formatEther(user2Balance));
    });

    it("should allow governance to transfer ownership of commFundVestingWallet to a new governor and send funds from the old governor to the new one", async function () {

      //  Simulate time passage so that tokens are vested.
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine 327,680 blocks (~7 days)
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      //Encode the function call to release funds from VestingWallet
      const targets = [await commFundVestingWallet.getAddress()];
      const values = [0]; // No ETH transfer, only token
      const calldatas = [
        commFundVestingWallet.interface.encodeFunctionData("release(address)", [
          await cloudToken.getAddress()
        ])
      ];
      const description = "Release from the commFundVestingWallet";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create the proposal
      const tx = await cloudGovernor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;
      //console.log("Proposal Created. ID:", proposalId);

      // Wait for voting delay
      await ethers.provider.send("evm_mine");

      // Cast votes (user1, user2, user3)
      await cloudGovernor.connect(user1).castVote(proposalId, 1); // Vote FOR
      await cloudGovernor.connect(user2).castVote(proposalId, 1); // Vote FOR

      // Increase time to simulate 7 days
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine 327,680 blocks (~7 days)
      await ethers.provider.send("evm_mine"); // Mine 1 block

      // Execute the proposal
      await cloudGovernor.execute(targets, values, calldatas, descriptionHash);

      // Verify the funds were released 
      const cloudGovernorBalance = await cloudToken.balanceOf(await cloudGovernor.getAddress());
      //expect(cloudGovernorBalance).to.be.gte(ethers.BigNumber.from(0));
      expect(cloudGovernorBalance).to.be.gt(0);
      //console.log("Governor Balance After Execution:", ethers.formatEther(cloudGovernorBalance));


      // ✅ Step 1: Deploy a new CloudGovernor
      const CloudGovernorNew = await ethers.getContractFactory("CloudGovernor");
      const cloudGovernorNew = await CloudGovernorNew.deploy(
        await cloudToken.getAddress(),
        await cloudStakeVault.getAddress(),
        await cloudStaking.getAddress()
      );
      await cloudGovernorNew.waitForDeployment();
      //console.log("New CloudGovernor deployed at:", await cloudGovernorNew.getAddress());


      // Step 2: Encode function calls
      const targets2 = [
        await commFundVestingWallet.getAddress(), // Transfer ownership of vesting wallet
        await cloudToken.getAddress()            // Transfer funds from old governor to new governor
      ];
      const values2 = [0, 0];

      const calldatas2 = [
        // Transfer ownership of commFundVestingWallet to new Governor
        commFundVestingWallet.interface.encodeFunctionData("transferOwnership", [
          await cloudGovernorNew.getAddress()
        ]),

        // Transfer CLOUD from old governor to new governor
        cloudToken.interface.encodeFunctionData("transfer", [
          await cloudGovernorNew.getAddress(),
          cloudGovernorBalance
        ])
      ];

      const description2 = "Transfer ownership of commFundVestingWallet and send funds to new CloudGovernor";
      const descriptionHash2 = ethers.keccak256(ethers.toUtf8Bytes(description2));

      // ✅ Step 3: Create the proposal
      const tx2 = await cloudGovernor.connect(user1).propose(targets2, values2, calldatas2, description2);
      const receipt2 = await tx2.wait();
      const proposalId2 = receipt2.logs[0].args.proposalId;

      //console.log("Proposal Created. ID:", proposalId2);

      // ✅ Step 4: Mine 1 block to process the proposal
      await ethers.provider.send("evm_mine");

      // ✅ Step 5: Cast votes (user1, user2 vote FOR)
      await cloudGovernor.connect(user1).castVote(proposalId2, 1); // Vote FOR
      await cloudGovernor.connect(user2).castVote(proposalId2, 1); // Vote FOR

      // ✅ Step 6: Mine blocks for 7-day voting period
      await ethers.provider.send("hardhat_mine", ["0x50000"]);

      // ✅ Step 9: Execute the proposal
      await cloudGovernor.execute(targets2, values2, calldatas2, descriptionHash2);

      // ✅ Step 10: Verify the ownership transfer
      const newOwner = await commFundVestingWallet.owner();
      //console.log("New Owner of Vesting Wallet:", newOwner);
      expect(newOwner).to.equal(await cloudGovernorNew.getAddress());

      // ✅ Step 11: Verify fund transfer
      const newGovernorBalance = await cloudToken.balanceOf(await cloudGovernorNew.getAddress());
      //console.log("New CloudGovernor Balance:", ethers.formatEther(newGovernorBalance));
      expect(newGovernorBalance).to.equal(cloudGovernorBalance);
    });
  });

  describe("Security", function () {
    // update params only through governance
    // fail prop doesn't get executed
    // ...
  });    

  describe("Views", function () {
    // update params only through governance
    // fail prop doesn't get executed
    // ...
  });  

});


/*

# ** Current Test Map (subject to change)**
### **1️⃣ Initialization**
- ✅ **Test 1:** Contract initialization with correct addresses.

---

### **2️⃣ Governance Functions**
- ✅ **Test 2:** Proposal to **release tokens** from `commFundVestingWallet`, vote, and execute.
- ✅ **Test 3:** Proposal to **release tokens** and send them to `user2`, vote, and execute.
- ✅ **Test 4:** Proposal to **transfer ownership of `commFundVestingWallet`** to a **new Governor** and **send funds**.
- 🆕 **Test 5:** Proposal to **change governance voting parameters** (e.g., quorum, proposal threshold).
- 🆕 **Test 6:** Proposal to **change APR settings** for staking via governance.

---

### **3️⃣ Staking & Voting Mechanics**
- ✅ **Test 7:** Users **stake tokens** and **gain voting power**.
- 🆕 **Test 8:** Users **unstake tokens** and **lose voting power**.
- 🆕 **Test 9:** Users **stake more tokens** and **increase voting power**.
- 🆕 **Test 10:** **Inactive stakers lose their voting rights** (governance inactivity threshold).

---

### **4️⃣ Proposal Execution Scenarios**
- 🆕 **Test 11:** A proposal **fails if quorum is not met**.
- 🆕 **Test 12:** A proposal **fails if votes are insufficient**.
- 🆕 **Test 13:** A proposal **is executed successfully after voting period**.
- 🆕 **Test 14:** A **malicious proposal fails** (e.g., an unauthorized token transfer).

---

### **5️⃣ Security**
- ✅ **Test 15:** **Only governance can update staking parameters**.
- 🆕 **Test 16:** **Only governance can update treasury spending rules**.
- 🆕 **Test 17:** **Governance cannot execute an invalid proposal**.
- 🆕 **Test 18:** **Governance cannot reassign ownership of an already owned contract**.

---

### **6️⃣ Views & Utility Functions**
- 🆕 **Test 19:** Fetch **Proposal details**.
- 🆕 **Test 20:** Fetch **total staked & voting power of users**.
- 🆕 **Test 21:** Fetch **proposal states correctly** (`Pending`, `Active`, `Succeeded`, etc.).
- 🆕 **Test 22:** Fetch **all proposals with pagination**.
- 🆕 **Test 23:** Fetch **proposal's vote count and weight**.

---

### **7️⃣ Edge Cases**
- 🆕 **Test 24:** Proposal is **canceled before execution**.
- 🆕 **Test 25:** User **votes but later unstakes, reducing vote count**.
- 🆕 **Test 26:** Governance **proposes a self-destructive function** (should fail).
- 🆕 **Test 27:** Multiple proposals **run simultaneously**.


*/