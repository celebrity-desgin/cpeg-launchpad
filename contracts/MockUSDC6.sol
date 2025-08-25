// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * Mock USDC (6 decimals) for testnet
 * - owner can mint for testing
 */
contract MockUSDC6 is ERC20, Ownable {
    constructor(address owner_) ERC20("Mock USDC", "USDC") Ownable(owner_) {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external onlyOwner { _mint(to, amount); }
}
