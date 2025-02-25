const hre = require("hardhat");
const { saveDeployedAddress } = require("./save_address");
require("dotenv").config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying CloudUtils with account:", deployer.address);

    const cloudTokenAddress = hre.network.name === "baseSepolia"
        ? process.env.CLOUD_TOKEN_ADDRESS_TESTNET
        : process.env.CLOUD_TOKEN_ADDRESS_MAINNET;

    if (!cloudTokenAddress) {
        throw new Error("Cloud Token address is missing from environment variables.");
    }

    const CloudUtils = await hre.ethers.getContractFactory("CloudUtils");
    const cloudUtils = await hre.upgrades.deployProxy(CloudUtils, [cloudTokenAddress], { initializer: "initialize" });

    await cloudUtils.waitForDeployment();
    const cloudUtilsAddress = await cloudUtils.getAddress();

    console.log("CloudUtils deployed to:", cloudUtilsAddress);
    saveDeployedAddress("CloudUtils", cloudUtilsAddress, hre.network.name);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
