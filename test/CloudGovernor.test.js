const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("CloudGovernor", function () {
  let CloudToken, cloudToken, CloudStakeVault, cloudStakeVault, CloudRewardPool, cloudRewardPool, CloudUtils, cloudUtils, CloudStaking, cloudStaking;
  let CloudGovernor, cloudGovernor, CloudGovernorNew, cloudGovernorNew, commFundVestingWallet;
  let owner, nonOwner, commFund, devFund, user1, user2, user3;
  let stakingParams;
  let params;
  let stakeAmount1, stakeAmount2, stakeAmount3;
  

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
    stakeAmount1 = ethers.parseEther("10000000");
    stakeAmount2 = ethers.parseEther("15000000");
    stakeAmount3 = ethers.parseEther("500000");

    await cloudToken.transfer(user1.getAddress(), stakeAmount1);
    await cloudToken.transfer(user2.getAddress(), stakeAmount2);
    await cloudToken.transfer(user3.getAddress(), stakeAmount3);

    await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), stakeAmount1);
    await cloudToken.connect(user2).approve(cloudStakeVault.getAddress(), stakeAmount2);
    await cloudToken.connect(user3).approve(cloudStakeVault.getAddress(), stakeAmount3);

    await cloudStaking.connect(user1).stake(stakeAmount1);
    await cloudStaking.connect(user2).stake(stakeAmount2);
    await cloudStaking.connect(user3).stake(stakeAmount3);

    // Transfer ownership of Vesting wallet to CloudGovernor
    const currentOwner = await commFundVestingWallet.owner();
    await commFundVestingWallet.transferOwnership(await cloudGovernor.getAddress());
    const newOwner = await commFundVestingWallet.owner();
    //console.log("Current Owner of CloudVestingWallet:", currentOwner);
    //console.log("New Owner of CloudVestingWallet:", newOwner);
    expect(newOwner).to.equal(await cloudGovernor.getAddress());

    // Transfer ownership of Staking contract to CloudGovernor
    await cloudStaking.transferOwnership(await cloudGovernor.getAddress());
    const newOwner2 = await cloudStaking.owner();
    expect(newOwner2).to.equal(await cloudGovernor.getAddress());

  });

  describe("Initialization", function () {
    it("should initialize correctly", async function () {
      expect(await cloudGovernor.cloudToken()).to.equal(await cloudToken.getAddress());
      expect(await cloudGovernor.cloudStaking()).to.equal(await cloudStaking.getAddress());
    });
  });

  describe("Governance Functions", function () {
    it("should allow a proposal to be created, voted on, and executed (to release token from the vesting contract)", async function () {

      //  Simulate time passage so that tokens are vested.
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine 327,680 blocks (~7 days)
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
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create the proposal
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;
      //console.log("Proposal Created. ID:", proposalId);

      // Wait for voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

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

    it("should allow a proposal to be created, voted on, and executed (release token from the vesting contract and send to user2)", async function () {

      //  Simulate time passage so that tokens are vested.
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine 327,680 blocks (~7 days)
      await ethers.provider.send("evm_mine");

      // Proposal data
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
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create the proposal
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;
      //console.log("Proposal Created. ID:", proposalId);

      // Wait for voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

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
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create the proposal
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;
      //console.log("Proposal Created. ID:", proposalId);

      // Wait for voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

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


      // Step 1: Deploy a new CloudGovernor
      const CloudGovernorNew = await ethers.getContractFactory("CloudGovernor");
      const cloudGovernorNew = await CloudGovernorNew.deploy(
        await cloudToken.getAddress(),
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
      const title2 = description;
      const descriptionHash2 = ethers.keccak256(ethers.toUtf8Bytes(description2));

      // Step 3: Create the proposal
      const tx2 = await cloudGovernor.connect(user1).proposeWithMetadata(targets2, values2, calldatas2, title2, description2);
      const receipt2 = await tx2.wait();
      const proposalId2 = receipt2.logs[0].args.proposalId;

      //console.log("Proposal Created. ID:", proposalId2);

      // Step 4: Mine 1 block to process the proposal
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Step 5: Cast votes (user1, user2 vote FOR)
      await cloudGovernor.connect(user1).castVote(proposalId2, 1); // Vote FOR
      await cloudGovernor.connect(user2).castVote(proposalId2, 1); // Vote FOR

      // Step 6: Mine blocks for 7-day voting period
      await ethers.provider.send("hardhat_mine", ["0x50000"]);

      // Step 9: Execute the proposal
      await cloudGovernor.execute(targets2, values2, calldatas2, descriptionHash2);

      // Step 10: Verify the ownership transfer
      const newOwner = await commFundVestingWallet.owner();
      //console.log("New Owner of Vesting Wallet:", newOwner);
      expect(newOwner).to.equal(await cloudGovernorNew.getAddress());

      // Step 11: Verify fund transfer
      const newGovernorBalance = await cloudToken.balanceOf(await cloudGovernorNew.getAddress());
      //console.log("New CloudGovernor Balance:", ethers.formatEther(newGovernorBalance));
      expect(newGovernorBalance).to.equal(cloudGovernorBalance);
    });

    it("should allow governance to change governance voting parameters (e.g., quorum, proposal threshold)", async function () {
      // Fetch current parameters
      const oldQuorum = (await cloudGovernor.getGovernanceParams())[2]; // Quorum value
      const oldProposalThreshold = await cloudGovernor.proposalThreshold();
      const oldVotingPeriod = await cloudGovernor.votingPeriod();

      // New values to be proposed
      const newQuorum = 15; // Change quorum from 10% to 15%
      const newProposalThreshold = 20000; // 20,000 CLOUD
      const newVotingPeriod = 5; // Change voting period to 5 days

      // Encode function call for updating governance parameters
      const targets = [await cloudGovernor.getAddress()];
      const values = [0];
      const calldatas = [
        cloudGovernor.interface.encodeFunctionData("updateGovernanceParameters", [
          [0, 1, 2], // Keys: VotingPeriodValue, ProposalThresholdValue, QuorumValue
          [newVotingPeriod, newProposalThreshold, newQuorum], // New values
        ])
      ];
      const description = "Update governance parameters (Voting period, Proposal Threshold, Quorum)";
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Propose the update
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Cast votes (user1 and user2 vote FOR)
      await cloudGovernor.connect(user1).castVote(proposalId, 1);
      await cloudGovernor.connect(user2).castVote(proposalId, 1);

      // Simulate time passage for the voting period (7 days)
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine ~327,680 blocks (~7 days)

      // Execute the proposal
      await cloudGovernor.execute(targets, values, calldatas, descriptionHash);

      // Verify the new governance parameters
      let [updatedVotingPeriod, updatedProposalThreshold, updatedQuorum] = await cloudGovernor.getGovernanceParams();

      expect(updatedQuorum).to.equal(newQuorum);
      expect(updatedProposalThreshold).to.equal(newProposalThreshold);
      expect(updatedVotingPeriod).to.equal(newVotingPeriod); // Convert days to blocks
    });

    it("should allow governance to change APR settings in the Staking contract", async function () {
      // Fetch current APR parameters
      let [
        , , , , // Skip first 4 values
        oldAprMin,
        oldAprMax,
        oldStakedCircSupplyMin,
        oldStakedCircSupplyMax
      ] = await cloudStaking.getStakingParams();

      oldAprMin = Number(oldAprMin);
      oldAprMax = Number(oldAprMax);
      oldStakedCircSupplyMin = Number(oldStakedCircSupplyMin);
      oldStakedCircSupplyMax = Number(oldStakedCircSupplyMax);

      // New values to be proposed
      const newAprMin = 5; // Increase min APR to 5%
      const newAprMax = 12; // Increase max APR to 12%
      const newStakedCircSupplyMin = 15; // Increase min staked supply to 15%
      const newStakedCircSupplyMax = 60; // Increase max staked supply to 60%

      // Encode function call for updating staking parameters
      const targets = [await cloudStaking.getAddress()];
      const values = [0];
      const calldatas = [
        cloudStaking.interface.encodeFunctionData("updateStakingParameters", [
          [4, 5, 6, 7], // Keys: aprMin, aprMax, stakedCircSupplyMin, stakedCircSupplyMax
          [newAprMin, newAprMax, newStakedCircSupplyMin, newStakedCircSupplyMax], // New values
        ])
      ];
      const description = "Update APR settings in CloudStaking";
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Propose the update
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Cast votes (user1 and user2 vote FOR)
      await cloudGovernor.connect(user1).castVote(proposalId, 1);
      await cloudGovernor.connect(user2).castVote(proposalId, 1);

      // Simulate time passage for the voting period (7 days)
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine ~327,680 blocks (~7 days)

      // Execute the proposal
      await cloudGovernor.execute(targets, values, calldatas, descriptionHash);

      // Fetch updated APR parameters
      let [
        , , , , // Skip first 4 values
        updatedAprMin,
        updatedAprMax,
        updatedStakedCircSupplyMin,
        updatedStakedCircSupplyMax
      ] = await cloudStaking.getStakingParams();

      updatedAprMin = Number(updatedAprMin);
      updatedAprMax = Number(updatedAprMax);
      updatedStakedCircSupplyMin = Number(updatedStakedCircSupplyMin);
      updatedStakedCircSupplyMax = Number(updatedStakedCircSupplyMax);

      // Verify the updated APR settings
      expect(updatedAprMin).to.equal(newAprMin);
      expect(updatedAprMax).to.equal(newAprMax);
      expect(updatedStakedCircSupplyMin).to.equal(newStakedCircSupplyMin);
      expect(updatedStakedCircSupplyMax).to.equal(newStakedCircSupplyMax);
    });

    it("Should revert when calling propose() directly", async function () {
      const targets = [await cloudGovernor.getAddress()];
      const values = [0];
      const calldatas = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];
      const description = "This proposal should fail because propose() is disabled";

      // Try calling propose() directly (should revert)
      await expect(
        cloudGovernor.connect(user1).propose(targets, values, calldatas, description)
      ).to.be.revertedWith("Use proposeWithMetadata() instead");
    });

    it("Should revert if title exceeds 100 characters", async function () {
      const longTitle = "A".repeat(101); // 101 characters
      const description = "Valid description";

      await expect(
        cloudGovernor.connect(user1).proposeWithMetadata([], [], [], longTitle, description)
      ).to.be.revertedWith("Title is too long (max 100 characters)");
    });

    it("Should revert if description exceeds 2000 characters", async function () {
      const title = "Valid Title";
      const longDescription = "A".repeat(2001); // 2001 characters

      await expect(
        cloudGovernor.connect(user1).proposeWithMetadata([], [], [], title, longDescription)
      ).to.be.revertedWith("Description is too long (max 2000 characters)");
    });

  });

  describe("Voting Mechanics", function () {

    it("Users stake tokens and gain voting power", async function () {
      // Fetch initial voting power for user1
      const blockNumberBefore = await ethers.provider.getBlockNumber();
      const initialVotingPower = await cloudGovernor.getVotes(user1.address, blockNumberBefore);

      // Amount to stake
      const stakeAmount = ethers.parseEther("1000000"); // 1,000,000 CLOUD

      // Transfer tokens to user1 and approve staking
      await cloudToken.transfer(user1.address, stakeAmount);
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), stakeAmount);

      // User1 stakes tokens
      await cloudStaking.connect(user1).stake(stakeAmount);

      // Mine a block to reflect the state change
      await ethers.provider.send("evm_mine");

      // Fetch updated voting power for user1
      const blockNumberAfter = await ethers.provider.getBlockNumber();
      const updatedVotingPower = await cloudGovernor.getVotes(user1.address, blockNumberAfter);

      // Verify voting power increased
      expect(updatedVotingPower).to.equal(stakeAmount + initialVotingPower);
    });

    it("Users unstake tokens and lose voting power.", async function () {
      // Fetch voting power after staking
      const blockNumberAfterStake = await ethers.provider.getBlockNumber();
      const votingPowerAfterStake = await cloudGovernor.getVotes(user1.address, blockNumberAfterStake);
      expect(votingPowerAfterStake).to.equal(stakeAmount1); // Voting power should match stake amount

      // User1 unstakes tokens
      await cloudStaking.connect(user1).initiateUnstake(stakeAmount1);

      // Mine a block to reflect the state change
      await ethers.provider.send("evm_mine");

      // Fetch voting power after unstaking
      const blockNumberAfterUnstake = await ethers.provider.getBlockNumber();
      const votingPowerAfterUnstake = await cloudGovernor.getVotes(user1.address, blockNumberAfterUnstake);

      // Verify that voting power is now 0
      expect(votingPowerAfterUnstake).to.equal(0);
    });

    it("Users stake more tokens and increase voting power", async function () {
      // Initial stake amount
      const initialStake = stakeAmount1;
      const additionalStake = ethers.parseEther("500000"); // 500,000 CLOUD


      // Transfer tokens to user1 and approve staking
      await cloudToken.transfer(user1.address, additionalStake);
      await cloudToken.connect(user1).approve(cloudStakeVault.getAddress(), additionalStake);

      await ethers.provider.send("evm_mine");

      // Fetch voting power after initial stake
      const blockNumberAfterFirstStake = await ethers.provider.getBlockNumber();
      const votingPowerAfterFirstStake = await cloudGovernor.getVotes(user1.address, blockNumberAfterFirstStake);
      expect(votingPowerAfterFirstStake).to.equal(initialStake); // Voting power should match stake amount

      // User1 stakes additional tokens
      await cloudStaking.connect(user1).stake(additionalStake);

      // Mine a block to reflect the state change
      await ethers.provider.send("evm_mine");

      // Fetch voting power after additional stake
      const blockNumberAfterAdditionalStake = await ethers.provider.getBlockNumber();
      const votingPowerAfterAdditionalStake = await cloudGovernor.getVotes(user1.address, blockNumberAfterAdditionalStake);

      // Verify that voting power increased accordingly
      expect(votingPowerAfterAdditionalStake).to.equal(initialStake+ additionalStake);
    });

  });    

  describe("Proposal Execution Scenarios", function () {
    it("A proposal should fail if quorum is not met", async function () {
      // Fetch the required quorum percentage
      const [, , quorumPercentage] = await cloudGovernor.getGovernanceParams();
      
      // Fetch the total voting power in the system
      const totalVotes = await cloudStaking.totalStakedForTally();

      // Calculate the required quorum in absolute votes
      const requiredQuorum = totalVotes * BigInt(quorumPercentage) / BigInt(100);
      const totalVotesCast = await cloudStaking.userStakedForTally(user3.address, await ethers.provider.getBlockNumber());
      expect(totalVotesCast).to.be.lessThan(requiredQuorum);

      // Ensure the proposal gets less than the required quorum (only 1 user voting)
      const targets         = [await cloudGovernor.getAddress()];
      const values          = [0];
      const calldatas       = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];
      const description     = "Test proposal that should fail due to low quorum";
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create a proposal
      const tx              = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt         = await tx.wait();
      const proposalId      = receipt.logs[0].args.proposalId;

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Only user1 votes (less than the required quorum)
      await cloudGovernor.connect(user3).castVote(proposalId, 1); // Vote FOR

      // Simulate the end of the voting period
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine ~327,680 blocks (7 days)

      // Verify that the proposal status is 'Defeated' due to low quorum
      const proposalState = await cloudGovernor.state(proposalId);
      expect(proposalState).to.equal(3); // 3 = Defeated

      // Attempt to execute the proposal (should fail)
      await expect(cloudGovernor.execute(targets, values, calldatas, descriptionHash)).to.be.reverted;
    });

    it("A proposal fails if votes are insufficient", async function () {
      // Fetch quorum requirement
      const [, , quorumPercentage] = await cloudGovernor.getGovernanceParams();
      const totalVotes = await cloudStaking.totalStakedForTally();
      const requiredQuorum = totalVotes * BigInt(quorumPercentage) / BigInt(100);

      const targets         = [await cloudGovernor.getAddress()];
      const values          = [0];
      const calldatas       = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];
      const description     = "Test proposal that should fail due to insufficient votes in favor";
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create a proposal
      const tx              = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt         = await tx.wait();
      const proposalId      = receipt.logs[0].args.proposalId;

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Vote with sufficient participation, but more AGAINST votes
      await cloudGovernor.connect(user1).castVote(proposalId, 0); // Vote AGAINST
      await cloudGovernor.connect(user2).castVote(proposalId, 0); // Vote AGAINST
      await cloudGovernor.connect(user3).castVote(proposalId, 2); // Abstain

      // Simulate the end of the voting period
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine ~327,680 blocks (7 days)

      // Verify that the proposal status is 'Defeated' due to insufficient votes in favor
      const proposalState = await cloudGovernor.state(proposalId);
      expect(proposalState).to.equal(3); // 3 = Defeated

      // Attempt to execute the proposal (should fail)
      await expect(cloudGovernor.execute(targets, values, calldatas, descriptionHash)).to.be.reverted;
    });

    it("Governor can upgrade the CloudStaking contract", async function () {
      // Deploy the new version of CloudStaking (CloudStakingV3)
      const CloudStakingV3 = await ethers.getContractFactory("CloudStaking");
      const newImplementation = await CloudStakingV3.deploy();
      await newImplementation.waitForDeployment();

      // Get the current implementation address before the upgrade
      const currentImplementation = await upgrades.erc1967.getImplementationAddress(await cloudStaking.getAddress());

      // Encode the upgrade call for Governor to execute upgradeTo()
      const targets = [await cloudStaking.getAddress()];
      const values = [0];
      const calldatas = [
        cloudStaking.interface.encodeFunctionData("upgradeToAndCall", [await newImplementation.getAddress(), "0x"])
      ];
      const description = "Upgrade CloudStaking contract to CloudStakingV3";
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Propose the upgrade
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Vote for the upgrade
      await cloudGovernor.connect(user1).castVote(proposalId, 1);
      await cloudGovernor.connect(user2).castVote(proposalId, 1);

      // Simulate the end of the voting period
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine ~327,680 blocks (7 days)

      // Execute the proposal
      await cloudGovernor.execute(targets, values, calldatas, descriptionHash);

      // Verify that the implementation has been updated
      const updatedImplementation = await upgrades.erc1967.getImplementationAddress(await cloudStaking.getAddress());
      expect(updatedImplementation).to.not.equal(currentImplementation);
      expect(updatedImplementation).to.equal(await newImplementation.getAddress());
    });
  });  

  describe("Security", function () {
    it("Only governance can update staking parameters", async function () {
      // Define new staking parameters
      const newAprMin = 5; // Change min APR to 5%
      const newAprMax = 12; // Change max APR to 12%

      //  Attempt to update staking parameters directly as user1 (should fail)
      await expect(
        cloudStaking.connect(user1).updateStakingParameters([5, 4], [newAprMin, newAprMax])
      ).to.be.reverted;
    });

    it("Governance cannot execute an invalid proposal", async function () {
      // Define a fake proposal ID that doesn't exist
      const invalidProposalId = 999999; // A high number that no proposal has
      
      const targets         = [await cloudGovernor.getAddress()];
      const values          = [0];
      const calldatas       = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];
      const description     = "Invalid Proposal";
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Attempt to execute a non-existent proposal (should fail)
      await expect(
        cloudGovernor.execute(targets, values, calldatas, descriptionHash)
      ).to.be.reverted;

      // Create a proposal but make it fail by NOT voting on it
      const tx          = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt     = await tx.wait();
      const proposalId  = receipt.logs[0].args.proposalId;

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Simulate the end of the voting period
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine ~327,680 blocks (7 days)

      // Verify that the proposal status is 'Defeated'
      const proposalState = await cloudGovernor.state(proposalId);
      expect(proposalState).to.equal(3); // 3 = Defeated

      // Attempt to execute a defeated proposal (should fail)
      await expect(
        cloudGovernor.execute(targets, values, calldatas, descriptionHash)
      ).to.be.reverted;
    });
  });  

  describe("Views & Utility Functions", function () {

    it("Fetch **COUNTING_MODE()** to verify vote counting rules", async function () {
      // Get the counting mode from the contract
      const countingMode = await cloudGovernor.COUNTING_MODE();

      // Log the counting mode for debugging
      console.log("COUNTING_MODE:", countingMode);

      // ✅ Verify that it follows the expected format
      expect(countingMode).to.be.a("string");
      expect(countingMode).to.include("support=bravo"); // Ensures Governor Bravo-style voting
      expect(countingMode).to.include("quorum=for,abstain"); // Ensures quorum includes For votes
    });

    it("Fetch Proposal details", async function () {
      // Define a test proposal
      const targets         = [await cloudGovernor.getAddress()];
      const values          = [0];
      const calldatas       = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];
      const description     = "Test Proposal: Fetch details";
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create the proposal
      const tx              = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt         = await tx.wait();
      const proposalId      = receipt.logs[0].args.proposalId;
      
      // Fetch proposal details using OpenZeppelin Governor functions
      const startBlock = await cloudGovernor.proposalSnapshot(proposalId);
      const endBlock = await cloudGovernor.proposalDeadline(proposalId);
      const state = await cloudGovernor.state(proposalId);

      // Log proposal details for debugging
      console.log("Proposal ID:", proposalId.toString());
      console.log("Proposal Start Block:", startBlock.toString());
      console.log("Proposal End Block:", endBlock.toString());
      console.log("Proposal State:", state.toString()); // 0 = Pending

      // ✅ Verify the proposal details
      expect(startBlock).to.be.gt(0);
      expect(endBlock).to.be.gt(startBlock);
      expect(state).to.equal(0); // 0 = Pending (first state)
    });

    it("Fetch total staked & voting power of users", async function () {
      // Get total staked amount in the system
      const totalStaked = await cloudStaking.totalStakedForTally();

      // Get voting power of each user (at the latest block)
      const latestBlock = await ethers.provider.getBlockNumber();
      const user1VotingPower = await cloudStaking.userStakedForTally(user1.address, latestBlock);
      const user2VotingPower = await cloudStaking.userStakedForTally(user2.address, latestBlock);
      const user3VotingPower = await cloudStaking.userStakedForTally(user3.address, latestBlock);

      // Log the values for debugging
      console.log("Total Staked in System:", ethers.formatEther(totalStaked));
      console.log("User1 Voting Power:", ethers.formatEther(user1VotingPower));
      console.log("User2 Voting Power:", ethers.formatEther(user2VotingPower));
      console.log("User3 Voting Power:", ethers.formatEther(user3VotingPower));

      // Ensure total staked is greater than zero
      expect(totalStaked).to.be.gt(0);

      // Ensure each user has some voting power
      expect(user1VotingPower).to.be.gt(0);
      expect(user2VotingPower).to.be.gt(0);
      expect(user3VotingPower).to.be.gt(0);

      // Ensure total voting power accounts for all users' stakes
      const totalUserVotingPower = user1VotingPower + user2VotingPower + user3VotingPower;
      expect(totalUserVotingPower).to.be.lte(totalStaked); // Should not exceed total staked
    });

    it("Fetch proposal wallet counts (against, for, abstain)", async function () {
      // Define a test proposal
      const targets = [await cloudGovernor.getAddress()];
      const values = [0];
      const calldatas = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];
      const description = "Test Proposal: Fetch wallet vote counts";
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create the proposal
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Users cast votes with different choices
      await cloudGovernor.connect(user1).castVote(proposalId, 1); // Vote FOR
      await cloudGovernor.connect(user2).castVote(proposalId, 0); // Vote AGAINST
      await cloudGovernor.connect(user3).castVote(proposalId, 2); // Abstain

      // Simulate the end of the voting period
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine ~327,680 blocks (7 days)

      // Fetch wallet vote counts from `proposalWalletCounts`
      const proposalVoteCounts = await cloudGovernor.proposalWalletCounts(proposalId);
      const againstWallets = proposalVoteCounts[0];
      const forWallets = proposalVoteCounts[1];
      const abstainWallets = proposalVoteCounts[2];

      // Log the vote results
      console.log("Proposal ID:", proposalId.toString());
      console.log("Against Votes (wallets):", againstWallets.toString());
      console.log("For Votes (wallets):", forWallets.toString());
      console.log("Abstain Votes (wallets):", abstainWallets.toString());

      // Verify vote counts match the expected wallets that voted
      expect(againstWallets).to.equal(1); // Only user2 voted against
      expect(forWallets).to.equal(1); // Only user1 voted for
      expect(abstainWallets).to.equal(1); // Only user3 abstained
    });

    it("Fetch all proposals with pagination", async function () {
      // Define multiple test proposals
      const targets = [await cloudGovernor.getAddress()];
      const values = [0];
      const calldatas = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];

      let proposalIds = [];

      // Create 5 proposals
      for (let i = 0; i < 5; i++) {
        const description = `Test Proposal ${i + 1}`;
        const title = description;
        const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
        const receipt = await tx.wait();
        const proposalId = receipt.logs[0].args.proposalId;
        proposalIds.push(proposalId);
      }

      // Fetch proposals using pagination
      const pageSize = 2; // Fetch 2 proposals at a time
      let fetchedProposals = [];

      for (let i = 0; i < proposalIds.length; i += pageSize) {
        const paginatedResults = await cloudGovernor.getProposalsPaginated(i, pageSize);
        fetchedProposals = [...fetchedProposals, ...paginatedResults];
      }

      // Log fetched proposals for debugging
      console.log("Fetched Proposals:", fetchedProposals.map(p => p.toString()));

      // Ensure we fetched all proposals
      expect(fetchedProposals.length).to.equal(proposalIds.length);

      // Ensure the proposals match the ones we created
      for (let i = 0; i < proposalIds.length; i++) {
        expect(fetchedProposals[i]).to.equal(proposalIds[i]);
      }
    });

    it("Fetch proposal's vote count and weight", async function () {
      // Define a test proposal
      const targets = [await cloudGovernor.getAddress()];
      const values = [0];
      const calldatas = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];
      const description = "Test Proposal: Fetch vote count and weight";
      const title = description;
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create the proposal
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Fetch user voting power at the current block
      const latestBlock = await ethers.provider.getBlockNumber();
      const user1VotingPower = await cloudStaking.userStakedForTally(user1.address, latestBlock);
      const user2VotingPower = await cloudStaking.userStakedForTally(user2.address, latestBlock);
      const user3VotingPower = await cloudStaking.userStakedForTally(user3.address, latestBlock);

      // Users cast votes with different choices
      await cloudGovernor.connect(user1).castVote(proposalId, 1); // Vote FOR
      await cloudGovernor.connect(user2).castVote(proposalId, 0); // Vote AGAINST
      await cloudGovernor.connect(user3).castVote(proposalId, 2); // Abstain

      // Simulate the end of the voting period
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine ~327,680 blocks (7 days)

      // Fetch the final vote counts
      const proposalVoteCounts = await cloudGovernor.proposalWalletCounts(proposalId);
      const forVotes = await cloudGovernor.hasVoted(proposalId, user1.address);
      const againstVotes = await cloudGovernor.hasVoted(proposalId, user2.address);
      const abstainVotes = await cloudGovernor.hasVoted(proposalId, user3.address);

      // Log the vote results
      console.log("Proposal ID:", proposalId.toString());
      console.log("For Votes:", proposalVoteCounts.forWallets.toString(), "Voting Power:", ethers.formatEther(user1VotingPower));
      console.log("Against Votes:", proposalVoteCounts.againstWallets.toString(), "Voting Power:", ethers.formatEther(user2VotingPower));
      console.log("Abstain Votes:", proposalVoteCounts.abstainWallets.toString(), "Voting Power:", ethers.formatEther(user3VotingPower));

      // Verify vote counts match the expected voters
      expect(proposalVoteCounts.forWallets).to.equal(1);
      expect(proposalVoteCounts.againstWallets).to.equal(1);
      expect(proposalVoteCounts.abstainWallets).to.equal(1);

      // Ensure the voting weights are counted correctly
      expect(forVotes).to.equal(true);
      expect(againstVotes).to.equal(true);
      expect(abstainVotes).to.equal(true);
    });

    it("Stores and fetches proposal title & description on-chain", async function () {
      const title = "Upgrade Staking Contract";
      const description = "This proposal upgrades the staking contract to v2.";

      const targets = [await cloudGovernor.getAddress()];
      const values = [0];
      const calldatas = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];

      // Create the proposal with title & description
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;

      // Fetch metadata from the contract
      const storedMetadata = await cloudGovernor.getProposalMetadata(proposalId);

      // Log results
      console.log("Stored Title:", storedMetadata[0]);
      console.log("Stored Description:", storedMetadata[1]);

      // ✅ Ensure the title & description match
      expect(storedMetadata[0]).to.equal(title);
      expect(storedMetadata[1]).to.equal(description);
    });
  });  

  describe("Edge Cases", function () {
    it("Proposal is canceled before execution", async function () {
      const title           = "Test Proposal Cancellation";
      const description     = "This proposal should be canceled before execution.";
      const targets         = [await cloudGovernor.getAddress()];
      const values          = [0];
      const calldatas       = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Create proposal
      const tx          = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt     = await tx.wait();
      const proposalId  = receipt.logs[0].args.proposalId;

      // Ensure proposal is in the Pending state
      let state = await cloudGovernor.state(proposalId);
      expect(state).to.equal(0); // 0 = Pending

      await ethers.provider.send("evm_mine");

      // Cancel the proposal
      await cloudGovernor.connect(user1).cancel(targets, values, calldatas, descriptionHash);

      // Check if the proposal is now canceled
      state = await cloudGovernor.state(proposalId);
      expect(state).to.equal(2); // 2 = Canceled

      // Attempt to execute (should fail)

      await expect(
        cloudGovernor.execute(targets, values, calldatas, descriptionHash)
      ).to.be.reverted;
    });

    it("User votes but later unstakes, reducing vote count", async function () {
      const title       = "Test Proposal - Vote Before Unstaking";
      const description = "This proposal tests vote count reduction after unstaking.";
      const targets     = [await cloudGovernor.getAddress()];
      const values      = [0];
      const calldatas   = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];

      // Create proposal
      const tx          = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt     = await tx.wait();
      const proposalId  = receipt.logs[0].args.proposalId;

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Check user1's initial voting power
      let votingPowerBefore = await cloudGovernor.getVotes(user1.address, await ethers.provider.getBlockNumber() - 1);
      console.log("Voting Power Before Unstaking:", votingPowerBefore.toString());

      // User1 votes
      await cloudGovernor.connect(user1).castVote(proposalId, 1); // 1 = FOR

      // Unstake all tokens
      await cloudStaking.connect(user1).initiateUnstake(stakeAmount1); // Assuming unstakeAll() exists in your staking contract

      // Check user1's voting power after unstaking
      let votingPowerAfter = await cloudGovernor.getVotes(user1.address, await ethers.provider.getBlockNumber());
      console.log("Voting Power After Unstaking:", votingPowerAfter.toString());

      // Ensure voting power is now 0
      expect(votingPowerAfter).to.equal(0);

      // Check that the vote still counts in the proposal
      const proposalVotes = await cloudGovernor.proposalVotes(proposalId);
      console.log("Proposal Votes:", proposalVotes.toString());

      // Ensure the proposal still registers the original vote
      expect(proposalVotes.forVotes).to.be.gt(0); // The vote should still be counted
    });

    it("Multiple proposals run simultaneously", async function () {
      const title1 = "Proposal 1 - Increase Staking Rewards";
      const description1 = "This proposal increases staking rewards by 2%.";

      const title2 = "Proposal 2 - Reduce Voting Period";
      const description2 = "This proposal reduces the voting period from 7 days to 5 days.";

      const targets = [await cloudGovernor.getAddress()];
      const values = [0];
      const calldatas = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];

      // Create two proposals
      const tx1 = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title1, description1);
      const receipt1 = await tx1.wait();
      const proposalId1 = receipt1.logs[0].args.proposalId;

      const tx2 = await cloudGovernor.connect(user2).proposeWithMetadata(targets, values, calldatas, title2, description2);
      const receipt2 = await tx2.wait();
      const proposalId2 = receipt2.logs[0].args.proposalId;

      // Ensure both proposals exist and are in Pending state
      let state1 = await cloudGovernor.state(proposalId1);
      let state2 = await cloudGovernor.state(proposalId2);
      expect(state1).to.equal(0); // 0 = Pending
      expect(state2).to.equal(0); // 0 = Pending

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Users vote on different proposals
      await cloudGovernor.connect(user1).castVote(proposalId1, 1); // Vote FOR proposal 1
      await cloudGovernor.connect(user2).castVote(proposalId2, 1); // Vote FOR proposal 2

      // Simulate end of voting period
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine ~7 days of blocks

      // Execute both proposals independently
      const descriptionHash1 = ethers.keccak256(ethers.toUtf8Bytes(description1));
      const descriptionHash2 = ethers.keccak256(ethers.toUtf8Bytes(description2));

      await cloudGovernor.execute(targets, values, calldatas, descriptionHash1);
      await cloudGovernor.execute(targets, values, calldatas, descriptionHash2);

      // Ensure both proposals were executed successfully
      state1 = await cloudGovernor.state(proposalId1);
      state2 = await cloudGovernor.state(proposalId2);
      expect(state1).to.equal(7); // 7 = Executed
      expect(state2).to.equal(7); // 7 = Executed
    });

    it("Prevents double voting on the same proposal", async function () {
      const title = "Proposal - Prevent Double Voting";
      const description = "This proposal ensures users cannot vote twice.";

      const targets = [await cloudGovernor.getAddress()];
      const values = [0];
      const calldatas = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];

      // Create proposal
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // User votes once
      await cloudGovernor.connect(user1).castVote(proposalId, 1); // 1 = FOR

      // Attempt to vote again (should fail)
      await expect(
        cloudGovernor.connect(user1).castVote(proposalId, 1)
      ).to.be.reverted;
    });

    it("Prevents executing a proposal more than once", async function () {
      const title = "Proposal - Prevent Double Execution";
      const description = "This proposal ensures a proposal cannot be executed twice.";

      const targets = [await cloudGovernor.getAddress()];
      const values = [0];
      const calldatas = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];

      // Create proposal
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;

      // Mine a block for the voting delay
      await ethers.provider.send("hardhat_mine", ["0x708"]); // 0x708 in hex = 1800 blocks

      // Vote and execute proposal
      await cloudGovernor.connect(user1).castVote(proposalId, 1);
      await cloudGovernor.connect(user2).castVote(proposalId, 1);

      // Simulate end of voting period
      await ethers.provider.send("hardhat_mine", ["0x50000"]); // Mine ~7 days of blocks

      // Execute the proposal
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await cloudGovernor.execute(targets, values, calldatas, descriptionHash);

      // Ensure the proposal was executed
      let state = await cloudGovernor.state(proposalId);
      expect(state).to.equal(7); // 7 = Executed

      // Attempt to execute again (should fail)
      await expect(
        cloudGovernor.execute(targets, values, calldatas, descriptionHash)
      ).to.be.reverted;
    });

    it("Prevents unauthorized users from canceling a proposal", async function () {
      const title = "Proposal - Unauthorized Cancellation";
      const description = "This proposal ensures only authorized users can cancel.";

      const targets = [await cloudGovernor.getAddress()];
      const values = [0];
      const calldatas = [cloudGovernor.interface.encodeFunctionData("votingPeriod")];

      // Create proposal
      const tx = await cloudGovernor.connect(user1).proposeWithMetadata(targets, values, calldatas, title, description);
      const receipt = await tx.wait();
      const proposalId = receipt.logs[0].args.proposalId;

      // Mine a block for voting
        await ethers.provider.send("evm_mine");

      // Ensure proposal is in Pending state
      let state = await cloudGovernor.state(proposalId);
      expect(state).to.equal(0); // 0 = Pending

      // Unauthorized user (user3) tries to cancel (should fail)
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await expect(
        cloudGovernor.connect(user3).cancel(targets, values, calldatas, descriptionHash)
      ).to.be.reverted;

      // Now proposer cancels (should succeed)
      await cloudGovernor.connect(user1).cancel(targets, values, calldatas, descriptionHash);

      // Check if the proposal is now canceled
      state = await cloudGovernor.state(proposalId);
      expect(state).to.equal(2); // 2 = Canceled
    });

  });  

});