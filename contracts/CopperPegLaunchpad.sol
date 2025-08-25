// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80);
}

/**
 * Launchpad for CPEG
 * - Default payment: USDC (6 decimals)
 * - Optional: ETH (via Chainlink ETH/USD)
 * - priceUSDC (6 decimals) per 1 token (18 decimals)
 *   example: $0.35 => 350_000
 */
contract CopperPegLaunchpad is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;

    IERC20  public immutable token;      // CPEG (18d)
    IERC20  public immutable usdc;       // USDC (6d)
    address public fundsWallet;

    uint256 public startTime;
    uint256 public endTime;
    bool    public paused;

    uint256 public priceUSDC = 350_000;  // $0.35

    uint256 public cap;   // 18d
    uint256 public sold;  // 18d

    AggregatorV3Interface public ethUsdFeed;
    bool public ethPurchaseEnabled;

    event BoughtWithUSDC(address indexed buyer, uint256 usdcPaid, uint256 tokensOut);
    event BoughtWithETH(address indexed buyer, uint256 ethPaid, uint256 tokensOut, uint256 usd6);
    event PriceUpdated(uint256 oldPriceUSDC, uint256 newPriceUSDC);

    constructor(
        address admin,
        address token_,
        address usdc_,
        address fundsWallet_,
        uint256 startTime_,
        uint256 endTime_,
        uint256 cap_
    ) {
        require(token_ != address(0) && usdc_ != address(0) && fundsWallet_ != address(0), "zero addr");
        require(endTime_ > startTime_, "bad window");
        _grantRole(ADMIN_ROLE, admin);

        token = IERC20(token_);
        usdc = IERC20(usdc_);
        fundsWallet = fundsWallet_;

        startTime = startTime_;
        endTime   = endTime_;
        cap       = cap_;
    }

    // Admin
    function setPaused(bool v) external onlyRole(ADMIN_ROLE) { paused = v; }
    function setFundsWallet(address w) external onlyRole(ADMIN_ROLE) { require(w != address(0)); fundsWallet = w; }
    function setWindow(uint256 start_, uint256 end_) external onlyRole(ADMIN_ROLE) { require(end_ > start_); startTime = start_; endTime = end_; }
    function setCap(uint256 cap_) external onlyRole(ADMIN_ROLE) { cap = cap_; }

    function setPriceUSDC(uint256 newPriceUSDC) external onlyRole(ADMIN_ROLE) {
        require(newPriceUSDC > 0, "price=0");
        emit PriceUpdated(priceUSDC, newPriceUSDC);
        priceUSDC = newPriceUSDC;
    }

    function setChainlinkFeed(address feed, bool enableETH) external onlyRole(ADMIN_ROLE) {
        ethUsdFeed = AggregatorV3Interface(feed);
        ethPurchaseEnabled = enableETH;
    }

    // Internals
    function _live() internal view {
        require(!paused, "paused");
        require(block.timestamp >= startTime && block.timestamp <= endTime, "not in window");
    }

    function _checkCap(uint256 amount) internal view {
        require(sold + amount <= cap, "sold out");
    }

    // USDC purchase
    function buyWithUSDC(uint256 amountUSDC) external nonReentrant {
        _live();
        require(amountUSDC > 0, "amount=0");
        uint256 tokensOut = (amountUSDC * 1e18) / priceUSDC; // USDC(6)→token(18)
        require(tokensOut > 0, "too small");
        _checkCap(tokensOut);

        usdc.safeTransferFrom(msg.sender, fundsWallet, amountUSDC);
        token.safeTransfer(msg.sender, tokensOut);

        sold += tokensOut;
        emit BoughtWithUSDC(msg.sender, amountUSDC, tokensOut);
    }

    // ETH purchase (optional)
    function buyWithETH() external payable nonReentrant {
        _live();
        require(ethPurchaseEnabled, "ETH disabled");
        require(msg.value > 0, "no ETH");

        (, int256 p,,,) = ethUsdFeed.latestRoundData(); // 1e8
        require(p > 0, "bad price");

        uint256 usd6 = (uint256(p) * msg.value) / 1e20; // wei→USD(6)
        require(usd6 > 0, "too small");

        uint256 tokensOut = (usd6 * 1e18) / priceUSDC;
        require(tokensOut > 0, "too small");

        _checkCap(tokensOut);

        (bool ok, ) = payable(fundsWallet).call{value: msg.value}("");
        require(ok, "eth xfer failed");

        token.safeTransfer(msg.sender, tokensOut);
        sold += tokensOut;
        emit BoughtWithETH(msg.sender, msg.value, tokensOut, usd6);
    }

    // Sweeps
    function sweepToken(address erc20, uint256 amount) external onlyRole(ADMIN_ROLE) {
        IERC20(erc20).transfer(fundsWallet, amount);
    }

    receive() external payable {}
    function sweepETH(uint256 amount) external onlyRole(ADMIN_ROLE) {
        (bool ok, ) = payable(fundsWallet).call{value: amount}("");
        require(ok, "sweep failed");
    }
}
