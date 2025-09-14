// scripts/deploy.launchpad.mainnet.js
require('dotenv').config();
const { ethers } = require('hardhat');

function norm(a) {
  return ethers.getAddress(String(a).trim());
}

async function main() {
  const admin =
    process.env.ADMIN && process.env.ADMIN !== ''
      ? norm(process.env.ADMIN)
      : (await ethers.getSigners())[0].address;
  const token = norm(process.env.CPEG);
  const usdc = norm(process.env.USDC);
  const funds = norm(process.env.FUNDS_WALLET);
  const startTs = BigInt(process.env.START_TS);
  const endTs = BigInt(process.env.END_TS);
  const cap = BigInt(process.env.CAP_USDC || '0');

  console.log('=== Launchpad deploy params ===');
  console.log({
    admin,
    token,
    usdc,
    funds,
    startTs: String(startTs),
    endTs: String(endTs),
    cap: String(cap),
  });

  const F = await ethers.getContractFactory('CopperPegLaunchpad');
  const launchpad = await F.deploy(
    admin,
    token,
    usdc,
    funds,
    startTs,
    endTs,
    cap
  );
  await launchpad.waitForDeployment();

  console.log('Launchpad (mainnet) deployed at:', launchpad.target);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
