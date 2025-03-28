const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers, upgrades } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Upgrading CloudStaking with account:", deployer.address);

  const deploymentsPath = path.join(__dirname, "deployments.json");
  const deployedAddresses = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const cloudStakingProxyAddress = deployedAddresses[hre.network.name]?.CloudStaking;

  if (!cloudStakingProxyAddress) {
    throw new Error("CloudStaking proxy address not found. Ensure it's deployed and added to deployments.json");
  }

  console.log("Using CloudStaking proxy at:", cloudStakingProxyAddress);

  const CloudStaking = await ethers.getContractFactory("CloudStaking");

  // Optional: Force import if you're unsure if the proxy is recognized
  //await upgrades.forceImport(cloudStakingProxyAddress, CloudStaking);

  // Upgrade the contract
  const upgradedCloudStaking = await upgrades.upgradeProxy(cloudStakingProxyAddress, CloudStaking);
  await upgradedCloudStaking.waitForDeployment();

  console.log("✅ CloudStaking upgraded successfully!");

  // 🔍 Confirm the implementation address changed
  const implAddress = await upgrades.erc1967.getImplementationAddress(cloudStakingProxyAddress);
  console.log("🔍 New implementation address:", implAddress);

  // Optional: if initializer
  /*
  const cloudGovernorAddress = deployedAddresses[hre.network.name]?.CloudGovernor;
  if (cloudGovernorAddress) {
    console.log("Initializing V2 with CloudGovernor:", cloudGovernorAddress);
    const tx = await upgradedCloudStaking.initializeV2(cloudGovernorAddress);
    await tx.wait();
    console.log("✅ initializeV2 executed successfully!");
  }
  */
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


/*

npx hardhat run deploy/upgradeCloudStaking.js --network baseSepolia

npx hardhat verify --network baseSepolia $(jq -r '.baseSepolia.CloudStaking' deploy/deployments.json)


*/
