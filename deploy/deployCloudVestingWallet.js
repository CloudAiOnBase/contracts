const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contract with account:", deployer.address);

    // Set vesting details
    const latestBlock = await hre.ethers.provider.getBlock("latest");
    const beneficiary = "0x0d237B1F097FD118652e84C51Cd5452086728d01";           //0x0d237B1F097FD118652e84C51Cd5452086728d01 (CloudAI wallet)
    const startTime   = latestBlock.timestamp + (0 * 24 * 60 * 60);             // 0-year cliff
    const duration    = 10 * 365 * 24 * 60 * 60;                                // 10-year vesting

    // Add a console log to display vesting details
    console.log(beneficiary, " - ", startTime.toString(), " - ", duration.toString());

    // Deploy CloudVestingWallet
    const VestingWallet = await hre.ethers.getContractFactory("CloudVestingWallet");
    const vestingWallet = await VestingWallet.deploy(beneficiary, startTime, duration);
    await vestingWallet.waitForDeployment();
    console.log("CloudVestingWallet deployed to:", await vestingWallet.getAddress());
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
