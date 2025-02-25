const fs = require("fs");

function saveDeployedAddress(contractName, address, networkName) {
    const filePath = "./deployed_addresses.json";

    let deployedContracts = {};
    
    // Check if the file exists and read it safely
    if (fs.existsSync(filePath)) {
        try {
            const data = fs.readFileSync(filePath, "utf8");
            deployedContracts = data ? JSON.parse(data) : {};
        } catch (error) {
            console.error("Error reading deployed_addresses.json. Resetting file.");
            deployedContracts = {};  // Reset to an empty object in case of corrupted JSON
        }
    }

    // Ensure network key exists
    if (!deployedContracts[networkName]) {
        deployedContracts[networkName] = {};
    }

    // Save the new contract address
    deployedContracts[networkName][contractName] = address;

    // Write updated data back to JSON file
    fs.writeFileSync(filePath, JSON.stringify(deployedContracts, null, 2));
    console.log(`${contractName} address saved in deployed_addresses.json:`, address);
}

module.exports = { saveDeployedAddress };

