// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * Copper Peg Coin (CPEG)
 * - Name: Copper Peg Coin
 * - Symbol: CPEG
 * - Decimals: 18
 * - Total supply: 4.3B * 1e18
 * - Roles: ADMIN, PAUSER, BLACKLISTER, MINTER
 * - Features: pause, burn, blacklist
 */
contract CopperPegCoin is ERC20, ERC20Burnable, ERC20Pausable, AccessControl {
    bytes32 public constant PAUSER_ROLE       = keccak256("PAUSER_ROLE");
    bytes32 public constant BLACKLISTER_ROLE  = keccak256("BLACKLISTER_ROLE");
    bytes32 public constant MINTER_ROLE       = keccak256("MINTER_ROLE");

    mapping(address => bool) private _blacklisted;
    event Blacklisted(address indexed account, bool blacklisted);

    constructor(address admin, address initialHolder) ERC20("Copper Peg Coin", "CPEG") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(BLACKLISTER_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);

        uint256 supply = 4_300_000_000 ether;
        _mint(initialHolder, supply);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function setBlacklisted(address account, bool value) external onlyRole(BLACKLISTER_ROLE) {
        _blacklisted[account] = value;
        emit Blacklisted(account, value);
    }

    function isBlacklisted(address account) external view returns (bool) {
        return _blacklisted[account];
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        if (from != address(0)) require(!_blacklisted[from], "Sender blacklisted");
        if (to != address(0))   require(!_blacklisted[to], "Recipient blacklisted");
        super._update(from, to, value);
    }
}
