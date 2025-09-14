// scripts/deploy.cpeg.mainnet.js
require('dotenv').config();
const { ethers } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();

  const admin =
    process.env.ADMIN && process.env.ADMIN !== ''
      ? process.env.ADMIN
      : deployer.address;
  const initialHolder = process.env.FUNDS_WALLET;

  if (!initialHolder) throw new Error('FUNDS_WALLET is empty');

  console.log('Deployer :', deployer.address);
  console.log('Admin    :', admin);
  console.log('Holder   :', initialHolder);

  const Token = await ethers.getContractFactory('CopperPegCoin');
  const token = await Token.deploy(admin, initialHolder);
  await token.waitForDeployment();

  console.log('CPEG (mainnet) deployed at:', token.target);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
