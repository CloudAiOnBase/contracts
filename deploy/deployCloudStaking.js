const hre = require("hardhat");
const { saveDeployedAddress } = require("./save_address");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying CloudStaking with account:", deployer.address);

    const cloudTokenAddress = hre.network.name === "baseSepolia"
        ? process.env.CLOUD_TOKEN_ADDRESS_TESTNET
        : process.env.CLOUD_TOKEN_ADDRESS_MAINNET;

    if (!cloudTokenAddress) {
        throw new Error("Cloud Token address is missing from environment variables.");
    }


    // Resolve path to deployments.json regardless of where the script is executed from
    const deploymentsPath = path.resolve(__dirname, "../deployments.json");
    const deployedAddresses = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

    const cloudStakeVaultAddress = deployedAddresses[hre.network.name]?.CloudStakeVault;
    const cloudRewardPoolAddress = deployedAddresses[hre.network.name]?.CloudRewardPool;
    const cloudUtilsAddress      = deployedAddresses[hre.network.name]?.CloudUtils;

    if (!cloudStakeVaultAddress || !cloudRewardPoolAddress || !cloudUtilsAddress) {
        throw new Error("Missing dependencies. Deploy CloudUtils, CloudStakeVault, and CloudRewardPool first.");
    }

    const CloudStaking = await hre.ethers.getContractFactory("CloudStaking");
    const cloudStaking = await hre.upgrades.deployProxy(
        CloudStaking,
        [cloudTokenAddress, cloudStakeVaultAddress, cloudRewardPoolAddress, cloudUtilsAddress],
        { initializer: "initialize" }
    );

    await cloudStaking.waitForDeployment();
    const cloudStakingAddress = await cloudStaking.getAddress();

    console.log("CloudStaking deployed to:", cloudStakingAddress);
    saveDeployedAddress("CloudStaking", cloudStakingAddress, hre.network.name);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

/*

npx hardhat run scripts/deployCloudStakeVault.js --network baseSepolia

npx hardhat verify --network baseSepolia $(jq -r '.baseSepolia.CloudStaking' deployed_addresses.json)




const tx3 = await cloudStaking.updateStakingParameters(
  [0, 1, 2, 3, 5, 4, 7, 6, 8], // Parameter keys
  [
    ethers.parseEther("100"),    // Minimum stake amount 
    7 * 24 * 60 * 60,            // cooldown
    365 * 24 * 60 * 60,          
    3 * 365 * 24 * 60 * 60,      
    10,                          
    4,                           
    50,                          
    10,                          
    2                           
  ]
);
await tx.wait();


let trx = await cloudStaking.updateStakingParameters([1], [20]); 
await trx.wait();

console.log("✅ Staking parameters updated successfully!");



*/
