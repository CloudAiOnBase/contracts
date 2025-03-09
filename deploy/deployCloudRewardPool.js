const hre = require("hardhat");
const { saveDeployedAddress } = require("./save_address");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying CloudRewardPool with account:", deployer.address);

    const cloudTokenAddress = hre.network.name === "baseSepolia"
        ? process.env.CLOUD_TOKEN_ADDRESS_TESTNET
        : process.env.CLOUD_TOKEN_ADDRESS_MAINNET;

    if (!cloudTokenAddress) {
        throw new Error("Cloud Token address is missing from environment variables.");
    }

    // Resolve path to deployments.json regardless of where the script is executed from
    const deploymentsPath = path.join(__dirname, "deployments.json");
    const deployedAddresses = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

    const cloudStakeVaultAddress = deployedAddresses[hre.network.name]?.CloudStakeVault;

    if (!cloudStakeVaultAddress) {
        throw new Error("CloudStakeVault address is missing. Deploy CloudStakeVault first.");
    }

    const deadAddress = "0x000000000000000000000000000000000000dEaD";
    const rugDetectionApr = 10;

    const CloudRewardPool = await hre.ethers.getContractFactory("CloudRewardPool");
    const cloudRewardPool = await CloudRewardPool.deploy(cloudTokenAddress, deadAddress, cloudStakeVaultAddress, rugDetectionApr);

    await cloudRewardPool.waitForDeployment();
    const cloudRewardPoolAddress = await cloudRewardPool.getAddress();

    console.log("CloudRewardPool deployed to:", cloudRewardPoolAddress);
    saveDeployedAddress("CloudRewardPool", cloudRewardPoolAddress, hre.network.name);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});


/*

npx hardhat run scripts/deployCloudStakeVault.js --network baseSepolia

npx hardhat verify --network baseSepolia $(jq -r '.baseSepolia.CloudRewardPool' deployed_addresses.json) \
$(jq -r '.baseSepolia.CloudToken' deployed_addresses.json) \
0x000000000000000000000000000000000000dEaD \
$(jq -r '.baseSepolia.CloudStakeVault' deployed_addresses.json) \
10


npx hardhat console --network baseSepolia
const CloudRewardPool = await ethers.getContractFactory("CloudRewardPool");
const cloudRewardPool = await CloudRewardPool.attach("0xD4f13100463eCcFC5a40b83Cc9b28D02Feea624F");
const tx = await cloudRewardPool.setStakingContract("0xB78c584ed07B1b0Bf8Bc6bdD48d32f31f599434d");
await tx.wait();


*/

