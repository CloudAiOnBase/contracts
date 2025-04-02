const hre = require("hardhat");
const { saveDeployedAddress } = require("./save_address");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying CloudGovernor with account:", deployer.address);

    const cloudTokenAddress = hre.network.name === "baseSepolia"
        ? process.env.CLOUD_TOKEN_ADDRESS_TESTNET
        : process.env.CLOUD_TOKEN_ADDRESS_MAINNET;

    if (!cloudTokenAddress) {
        throw new Error("Cloud Token address is missing from environment variables.");
    }

    // Resolve path to deployments.json regardless of where the script is executed from
    const deploymentsPath = path.join(__dirname, "deployments.json");
    const deployedAddresses = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

    const cloudStakingAddress = deployedAddresses[hre.network.name]?.CloudStaking;

    if (!cloudStakingAddress) {
        throw new Error("cloudStaking address is missing. Deploy cloudStakingAddress first.");
    }

    const CloudGovernor = await hre.ethers.getContractFactory("CloudGovernor");
    const cloudGovernor = await CloudGovernor.deploy(cloudTokenAddress, cloudStakingAddress);

    await cloudGovernor.waitForDeployment();
    const cloudGovernorAddress = await cloudGovernor.getAddress();

    console.log("CloudGovernor deployed to:", cloudGovernorAddress);
    saveDeployedAddress("CloudGovernor", cloudGovernorAddress, hre.network.name);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});


/*

npx hardhat run deploy/deployCloudGovernor.js --network baseSepolia

npx hardhat verify --network baseSepolia $(jq -r '.baseSepolia.CloudGovernor' deploy/deployments.json) \
$(jq -r '.baseSepolia.CloudToken' deploy/deployments.json) \
$(jq -r '.baseSepolia.CloudStaking' deploy/deployments.json)

*/

