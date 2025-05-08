const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying from:", deployer.address);

    const Token = await ethers.getContractFactory("CloudToken");
    const token = await Token.deploy();

    await token.waitForDeployment(); 

    console.log("CLOUD Token deployed at:", await token.getAddress());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


/*

npx hardhat run deploy/deployCloudToken.js --network baseSepolia

npx hardhat verify --network baseSepolia $(jq -r '.baseSepolia.CloudToken' deploy/deployments.json)

*/