require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades"); 
require("hardhat-contract-sizer");
require("dotenv").config();

module.exports = {
  networks: {
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      accounts: process.env.PRIVATE_KEY ? [`0x${process.env.PRIVATE_KEY}`] : [],
      chainId: 8453,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY ? [`0x${process.env.PRIVATE_KEY}`] : [],
      chainId: 84532,
    },
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY || "",
      baseSepolia: process.env.BASESCAN_API_KEY || "", 
    },
  },
  solidity: {
    version: "0.8.22",  //  Ensure latest Solidity version
    settings: {
      optimizer: {
        enabled: true,  
        runs: 200,      // Adjust runs (lower values reduce size)
      },
    },
  },
  contractSizer: {
    runOnCompile: false,  //  Automatically checks size when compiling
    only: ["CloudStaking", "CloudVestingWallet", "CloudRewardPool", "CloudStakeVault", "CloudUtils"],  //  Change this to your contract name
  },
};
