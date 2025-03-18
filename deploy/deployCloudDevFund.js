const hre = require("hardhat");
const { saveDeployedAddress } = require("./save_address");
require("dotenv").config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying CloudDevFund with account:", deployer.address);

    const cloudTokenAddress = hre.network.name === "baseSepolia"
        ? process.env.CLOUD_TOKEN_ADDRESS_TESTNET
        : process.env.CLOUD_TOKEN_ADDRESS_MAINNET;

    if (!cloudTokenAddress) {
        throw new Error("Cloud Token address is missing from environment variables.");
    }

    const CloudDevFund = await hre.ethers.getContractFactory("CloudDevFund");
    const cloudDevFund = await hre.upgrades.deployProxy(CloudDevFund, [cloudTokenAddress], { initializer: "initialize" });

    await cloudDevFund.waitForDeployment();
    const cloudDevFundAddress = await cloudDevFund.getAddress();

    console.log("CloudDevFund deployed to:", cloudDevFundAddress);
    saveDeployedAddress("CloudDevFund", cloudDevFundAddress, hre.network.name);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

/*

npx hardhat run deploy/deployCloudDevFund.js --network baseSepolia

npx hardhat verify --network baseSepolia $(jq -r '.baseSepolia.CloudDevFund' deploy/deployments.json)

*/