const hre = require("hardhat");
const { saveDeployedAddress } = require("./save_address");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying CloudIdentity with account:", deployer.address);

    const cloudTokenAddress = hre.network.name === "baseSepolia"
        ? process.env.CLOUD_TOKEN_ADDRESS_TESTNET
        : process.env.CLOUD_TOKEN_ADDRESS_MAINNET;

    if (!cloudTokenAddress) {
        throw new Error("Cloud Token address is missing from environment variables.");
    }

  const deploymentsPath = path.join(__dirname, "deployments.json");
  const deployedAddresses = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const cloudStakingProxyAddress = deployedAddresses[hre.network.name]?.CloudStaking;

  if (!cloudStakingProxyAddress) {
    throw new Error("CloudStaking proxy address not found. Ensure it's deployed and added to deployments.json");
  }

    const CloudIdentity = await hre.ethers.getContractFactory("CloudIdentity");
    const cloudIdentity = await hre.upgrades.deployProxy(CloudIdentity, [cloudTokenAddress, cloudStakingProxyAddress], { initializer: "initialize" });

    await cloudIdentity.waitForDeployment();
    const cloudIdentityAddress = await cloudIdentity.getAddress();

    console.log("CloudIdentity deployed to:", cloudIdentityAddress);
    saveDeployedAddress("CloudIdentity", cloudIdentityAddress, hre.network.name);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

/*

npx hardhat run deploy/deployCloudIdentity.js --network baseSepolia

npx hardhat verify --network baseSepolia $(jq -r '.baseSepolia.CloudIdentity' deploy/deployments.json)

*/