// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts/finance/VestingWallet.sol";

contract CloudVestingWallet is VestingWallet {
    constructor(
        address beneficiaryAddress, 
        uint64 startTimestamp, 
        uint64 durationSeconds
    ) VestingWallet(beneficiaryAddress, startTimestamp, durationSeconds) {}
}
