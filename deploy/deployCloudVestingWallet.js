const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contract with account:", deployer.address);

    // Set vesting details
    const beneficiary = "0xeA63c473D43990e1b9f1bB4d6B22f375CF414fE6";                   //0xeA63c473D43990e1b9f1bB4d6B22f375CF414fE6
    const startTime   = Math.floor(Date.now() / 1000) + ((365 - 12) * 24 * 60 * 60);    // 1-year cliff - 12 days (project launch date)
    const duration    = 4 * 365 * 24 * 60 * 60;                                         // 4-year vesting

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
