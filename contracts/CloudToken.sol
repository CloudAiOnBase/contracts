// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CloudToken is ERC20, Ownable {
	uint256 private immutable _cap = 1_000_000_000 * 10 ** 18; // 1 Billion CLOUD (Fixed Supply)

	constructor() ERC20("CloudAI", "CLOUD") Ownable(msg.sender) {
		_mint(msg.sender, _cap);
	}

	// ✅ Public Burn Function (Users can burn their tokens)
	function burn(uint256 amount) public {
		_burn(msg.sender, amount);
	}

	// 🚫 Block ETH from being sent to the contract
	receive() external payable {
		revert("CLOUD does not accept ETH");
	}

	fallback() external payable {
		revert("CLOUD does not accept ETH");
	}

	// 🚀 Final Step: Renounce Ownership (Fully Decentralized)
	function renounceOwnership() public override onlyOwner {
		_transferOwnership(address(0)); // Makes contract ownerless
	}
}

