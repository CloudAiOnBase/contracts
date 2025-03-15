const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Upgrading CloudStaking with account:", deployer.address);

    // Load the previously deployed proxy address
    // Resolve path to deployments.json regardless of where the script is executed from
    const deploymentsPath = path.join(__dirname, "deployments.json");
    const deployedAddresses = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

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


    // Call initializeV2 to set the new state variable
    const XXcloudGovernorAddress = "0xYourCloudGovernorAddress"; // Replace with the actual address
    console.log("Initializing V2 with CloudGovernor address:", cloudGovernorAddress);
    const tx = await upgradedCloudStaking.initializeV2(cloudGovernorAddress);
    await tx.wait();
    console.log("initializeV2() executed successfully!");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});


/*

npx hardhat run deploy/upgradeCloudStaking.js --network baseSepolia

npx hardhat verify --network baseSepolia $(jq -r '.baseSepolia.CloudStaking' deployments.json)


*/
