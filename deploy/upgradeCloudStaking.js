const hre = require("hardhat");
const fs = require("fs");
require("dotenv").config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Upgrading CloudStaking with account:", deployer.address);

    // Load the previously deployed proxy address
    const deployedAddresses = JSON.parse(fs.readFileSync("deployments.json", "utf8"));
    const cloudStakingProxyAddress = deployedAddresses[hre.network.name]?.CloudStaking;

    if (!cloudStakingProxyAddress) {
        throw new Error("CloudStaking proxy address not found. Ensure it's deployed and added to deployments.json");
    }

    console.log("Using CloudStaking proxy at:", cloudStakingProxyAddress);

    // Get the new implementation contract
    const CloudStakingV2 = await hre.ethers.getContractFactory("CloudStaking");
    
    // Upgrade the contract
    const upgradedCloudStaking = await hre.upgrades.upgradeProxy(cloudStakingProxyAddress, CloudStakingV2);

    await upgradedCloudStaking.waitForDeployment();
    console.log("CloudStaking upgraded successfully!");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});


/*

npx hardhat run deploy/upgradeCloudStaking.js --network baseSepolia

npx hardhat verify --network baseSepolia $(jq -r '.baseSepolia.CloudStaking' deployments.json)


*/
