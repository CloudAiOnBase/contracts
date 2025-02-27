const express = require("express");
const { ethers } = require("ethers");
const app = express();

// Base Network RPC (Replace with your RPC provider URL)
const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");

// Your Utils Contract Address & ABI
const contractAddress = "0xE8cb9703Dbb199e68906bD90048DF30d9b85D470";
const abi = ["function getCirculatingSupply() external view returns (uint256)"];

const contract = new ethers.Contract(contractAddress, abi, provider);

app.get("/circulating-supply", async (req, res) => {
    try {
        const supply = await contract.getCirculatingSupply();
        res.json({ circulating_supply: supply.toString() });
    } catch (error) {
        console.error("Error fetching circulating supply:", error);
        res.status(500).json({ error: "Error fetching circulating supply" });
    }
});

app.listen(3000, () => console.log("API running on port 3000"));
