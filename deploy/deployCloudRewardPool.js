const hre = require("hardhat");
const { saveDeployedAddress } = require("./save_address");
const fs = require("fs");
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

    const deployedAddresses = JSON.parse(fs.readFileSync("./deployed_addresses.json", "utf8"));
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
