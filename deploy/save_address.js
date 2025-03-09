const fs = require("fs");
const path = require("path");

const DEPLOY_FILE = path.join(__dirname, "deployments.json"); // Ensures correct path

function saveDeployedAddress(contractName, contractAddress, networkName) {
    let addresses = {};

    if (fs.existsSync(DEPLOY_FILE)) {
        addresses = JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf8"));
    }

    if (!addresses[networkName]) {
        addresses[networkName] = {};
    }

    addresses[networkName][contractName] = contractAddress;
    fs.writeFileSync(DEPLOY_FILE, JSON.stringify(addresses, null, 2));

    //console.log(`✅ Saved ${contractName} address for ${networkName}: ${contractAddress}`);
}

module.exports = { saveDeployedAddress };
