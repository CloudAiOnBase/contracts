const hre = require("hardhat");
const { saveDeployedAddress } = require("./save_address");
require("dotenv").config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying CloudStakeVault with account:", deployer.address);

    const cloudTokenAddress = hre.network.name === "baseSepolia"
        ? process.env.CLOUD_TOKEN_ADDRESS_TESTNET
        : process.env.CLOUD_TOKEN_ADDRESS_MAINNET;

    if (!cloudTokenAddress) {
        throw new Error("Cloud Token address is missing from environment variables.");
    }

    const deadAddress = "0x000000000000000000000000000000000000dEaD";

    const CloudStakeVault = await hre.ethers.getContractFactory("CloudStakeVault");
    const cloudStakeVault = await CloudStakeVault.deploy(cloudTokenAddress, deadAddress);

    await cloudStakeVault.waitForDeployment();
    const cloudStakeVaultAddress = await cloudStakeVault.getAddress();

    console.log("CloudStakeVault deployed to:", cloudStakeVaultAddress);
    saveDeployedAddress("CloudStakeVault", cloudStakeVaultAddress, hre.network.name);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});


/*

npx hardhat run scripts/deployCloudStakeVault.js --network baseSepolia

npx hardhat verify --network baseSepolia $(jq -r '.baseSepolia.CloudStakeVault' deployed_addresses.json) \
$(jq -r '.baseSepolia.CloudToken' deployed_addresses.json) \
0x000000000000000000000000000000000000dEaD



npx hardhat console --network baseSepolia
const CloudStakeVault = await ethers.getContractFactory("CloudStakeVault");
const cloudStakeVault = await CloudStakeVault.attach("0x67DBB32dFf2Ea28B5cBc26B51bB1A9FcdD2ebD0D");
const tx = await cloudStakeVault.setStakingContract("0xB78c584ed07B1b0Bf8Bc6bdD48d32f31f599434d");
await tx.wait();

*/