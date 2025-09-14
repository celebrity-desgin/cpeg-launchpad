// scripts/verify.args.launchpad.mainnet.js
require('dotenv').config();
const { ethers } = require('ethers');

function norm(a) {
  return ethers.getAddress(String(a).trim());
}

const admin =
  process.env.ADMIN && process.env.ADMIN !== ''
    ? norm(process.env.ADMIN)
    : norm(process.env.FUNDS_WALLET);
const token = norm(process.env.CPEG);
const usdc = norm(process.env.USDC);
const funds = norm(process.env.FUNDS_WALLET);
const startTs = BigInt(process.env.START_TS);
const endTs = BigInt(process.env.END_TS);
const cap = BigInt(process.env.CAP_USDC || '0');

module.exports = [admin, token, usdc, funds, startTs, endTs, cap];
