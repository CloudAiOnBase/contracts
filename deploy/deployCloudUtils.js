require("dotenv").config();
const { ethers, upgrades } = require("hardhat");

async function main() {
    // Get the current network from Hardhat
    const network = hre.network.name;
    console.log(`🚀 Deploying CloudUtils on ${network.toUpperCase()}...`);

    // Select the CloudToken address based on the detected network
    const cloudTokenAddress = network === "baseSepolia" 
        ? process.env.CLOUD_TOKEN_ADDRESS_TESTNET 
        : process.env.CLOUD_TOKEN_ADDRESS_MAINNET;

    if (!cloudTokenAddress) {
        console.error(`❌ Error: CLOUD_TOKEN_ADDRESS_${network.toUpperCase()} is not set in .env`);
        process.exit(1);
    }

    const [deployer] = await ethers.getSigners();
    console.log(`👤 Deployer: ${deployer.address}`);
    console.log(`🔗 Using CloudToken address: ${cloudTokenAddress}`);

    // Deploy CloudUtils as an upgradeable proxy
    const CloudUtils = await ethers.getContractFactory("CloudUtils");
    const cloudUtils = await upgrades.deployProxy(CloudUtils, [cloudTokenAddress], {
        initializer: "initialize",
    });

    await cloudUtils.waitForDeployment(); 

   console.log(`✅ CloudUtils deployed to: ${await cloudUtils.getAddress()} on ${network.toUpperCase()}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

