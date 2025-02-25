const hre = require("hardhat");
const { saveDeployedAddress } = require("./save_address");
const fs = require("fs");
require("dotenv").config();

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying CloudStaking with account:", deployer.address);

    const cloudTokenAddress = hre.network.name === "baseSepolia"
        ? process.env.CLOUD_TOKEN_ADDRESS_TESTNET
        : process.env.CLOUD_TOKEN_ADDRESS_MAINNET;

    if (!cloudTokenAddress) {
        throw new Error("Cloud Token address is missing from environment variables.");
    }

    const deployedAddresses = JSON.parse(fs.readFileSync("./deployed_addresses.json", "utf8"));
    const cloudStakeVaultAddress = deployedAddresses[hre.network.name]?.CloudStakeVault;
    const cloudRewardPoolAddress = deployedAddresses[hre.network.name]?.CloudRewardPool;
    const cloudUtilsAddress      = deployedAddresses[hre.network.name]?.CloudUtils;

    if (!cloudStakeVaultAddress || !cloudRewardPoolAddress || !cloudUtilsAddress) {
        throw new Error("Missing dependencies. Deploy CloudUtils, CloudStakeVault, and CloudRewardPool first.");
    }

    const CloudStaking = await hre.ethers.getContractFactory("CloudStaking");
    const cloudStaking = await hre.upgrades.deployProxy(
        CloudStaking,
        [cloudTokenAddress, cloudStakeVaultAddress, cloudRewardPoolAddress, cloudUtilsAddress],
        { initializer: "initialize" }
    );

    await cloudStaking.waitForDeployment();
    const cloudStakingAddress = await cloudStaking.getAddress();

    console.log("CloudStaking deployed to:", cloudStakingAddress);
    saveDeployedAddress("CloudStaking", cloudStakingAddress, hre.network.name);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
