const hre = require("hardhat");
const { saveDeployedAddress } = require("./save_address");
const fs = require("fs");
require("dotenv").config();

async function main() {
    if (hre.network.name !== "localhost") {
        throw new Error("❌ This deployment script is for LOCAL ONLY. Use existing contracts on testnet/mainnet.");
    }

    const [deployer, commFund, devFund] = await hre.ethers.getSigners();
    const commFundAddress = await commFund.getAddress();
    const devFundAddress = await devFund.getAddress();
    console.log("🚀 Deploying contracts locally from:", deployer.address);

    // Deploy CloudToken
    const CloudToken = await hre.ethers.getContractFactory("CloudToken");
    const cloudToken = await CloudToken.deploy();
    await cloudToken.waitForDeployment();
    const cloudTokenAddress = await cloudToken.getAddress();
    console.log("✅ CloudToken deployed at:", cloudTokenAddress);
    saveDeployedAddress("CloudToken", cloudTokenAddress, hre.network.name);

    // Deploy CloudUtils (Proxy)
    const CloudUtils = await hre.ethers.getContractFactory("CloudUtils");
    const cloudUtils = await hre.upgrades.deployProxy(CloudUtils, [cloudTokenAddress], { initializer: "initialize" });
    const cloudUtilsAddress = await cloudUtils.getAddress();
    console.log("✅ CloudUtils deployed at:", cloudUtilsAddress);
    saveDeployedAddress("CloudUtils", cloudUtilsAddress, hre.network.name);

    // Deploy CloudStakeVault
    const CloudStakeVault = await hre.ethers.getContractFactory("CloudStakeVault");
    const cloudStakeVault = await CloudStakeVault.deploy(cloudTokenAddress, "0x000000000000000000000000000000000000dEaD");
    await cloudStakeVault.waitForDeployment();
    const cloudStakeVaultAddress = await cloudStakeVault.getAddress();
    console.log("✅ CloudStakeVault deployed at:", cloudStakeVaultAddress);
    saveDeployedAddress("CloudStakeVault", cloudStakeVaultAddress, hre.network.name);

    // Deploy CloudRewardPool
    const CloudRewardPool = await hre.ethers.getContractFactory("CloudRewardPool");
    const cloudRewardPool = await CloudRewardPool.deploy(
        cloudTokenAddress,
        "0x000000000000000000000000000000000000dEaD",
        cloudStakeVaultAddress,
        10 // rugDetectionApr
    );
    await cloudRewardPool.waitForDeployment();
    const cloudRewardPoolAddress = await cloudRewardPool.getAddress();
    console.log("✅ CloudRewardPool deployed at:", cloudRewardPoolAddress);
    saveDeployedAddress("CloudRewardPool", cloudRewardPoolAddress, hre.network.name);

    // Deploy CloudStaking (Proxy)
    const CloudStaking = await hre.ethers.getContractFactory("CloudStaking");
    const cloudStaking = await hre.upgrades.deployProxy(
        CloudStaking,
        [cloudTokenAddress, cloudStakeVaultAddress, cloudRewardPoolAddress, cloudUtilsAddress],
        { initializer: "initialize" }
    );
    const cloudStakingAddress = await cloudStaking.getAddress();
    console.log("✅ CloudStaking deployed at:", cloudStakingAddress);
    saveDeployedAddress("CloudStaking", cloudStakingAddress, hre.network.name);

    // Link Staking Contract to Vault & Reward Pool
    await cloudStakeVault.setStakingContract(cloudStakingAddress);
    console.log(`✅ CloudStakeVault linked to CloudStaking.`);
    await cloudRewardPool.setStakingContract(cloudStakingAddress);
    console.log(`✅ CloudRewardPool linked to CloudStaking.`);

    // Set initial staking parameters
    const params = {
        minStakeAmount: ethers.parseEther("100"),
        cooldown: 7 * 24 * 60 * 60, // 7 days
        governanceInactivityThreshold: 365 * 24 * 60 * 60, // 1 year
        autoUnstakePeriod: 3 * 365 * 24 * 60 * 60, // 3 years
        aprMin: 4,
        aprMax: 10,
        stakedCircSupplyMin: 10,
        stakedCircSupplyMax: 50,
        maintenanceBatchSize: 2
    };

    await cloudStaking.updateStakingParameters(
        [0, 1, 2, 3, 5, 4, 7, 6, 8], // Order of parameters
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
    console.log("✅ Staking parameters set.");

    // exclude from Circulating Supply
    await cloudUtils.excludeFromCirculatingSupply(cloudStakeVaultAddress, true);
    await cloudUtils.excludeFromCirculatingSupply(cloudRewardPoolAddress, true);
    await cloudUtils.excludeFromCirculatingSupply(commFundAddress, true);
    await cloudUtils.excludeFromCirculatingSupply(devFundAddress, true);
    console.log(`✅ Stake vault, Reward pool, Community fund and Dev fund excluded from circulating supply.`);

    // Top up reward pool
    await cloudToken.transfer(cloudRewardPoolAddress, ethers.parseEther("100000000"));
    console.log("✅ Reward pool topped up with 100M CLOUD tokens.");

    // Set community and dev fund
    await cloudToken.transfer(commFundAddress, ethers.parseEther("400000000"));
    await cloudToken.transfer(devFundAddress, ethers.parseEther("400000000"));
    console.log(`✅ Community fund (${commFundAddress}) and Dev fund (${devFundAddress}) received 400M CLOUD tokens each.`);

    console.log("✅ Local deployment completed successfully!");
}

// Run the script
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
