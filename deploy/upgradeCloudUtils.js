require("dotenv").config();
const { ethers, upgrades } = require("hardhat");

async function main() {
    // Get the current network from Hardhat
    const network = hre.network.name;
    console.log(`🚀 Upgrading CloudUtils on ${network.toUpperCase()}...`);

    // Determine proxy address based on the network
    const proxyAddress = network === "baseSepolia" 
        ? process.env.CLOUD_UTILS_PROXY_ADDRESS_TESTNET 
        : process.env.CLOUD_UTILS_PROXY_ADDRESS_MAINNET;

    if (!proxyAddress) {
        console.error(`❌ Error: Proxy address is not set for ${network.toUpperCase()} in .env`);
        process.exit(1);
    }

    const [deployer] = await ethers.getSigners();
    console.log(`👤 Deployer: ${deployer.address}`);

    // Get the CloudUtils contract factory (new implementation)
    const CloudUtils = await ethers.getContractFactory("CloudUtils");

    // Upgrade the proxy to the new implementation
    const upgradedCloudUtils = await upgrades.upgradeProxy(proxyAddress, CloudUtils);
    console.log(`✅ CloudUtils upgraded successfully at proxy address: ${await upgradedCloudUtils.getAddress()} on ${network.toUpperCase()}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

