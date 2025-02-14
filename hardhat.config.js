require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades"); 
require("dotenv").config();

module.exports = {
  networks: {
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      accounts: process.env.PRIVATE_KEY ? [`0x${process.env.PRIVATE_KEY}`] : [],
      chainId: 8453,
    },
    baseSepolia: {  // ✅ Replace Base Goerli with Base Sepolia
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
  solidity: "0.8.20",
};

