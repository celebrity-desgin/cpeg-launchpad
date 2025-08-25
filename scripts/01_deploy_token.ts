import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  const Token = await ethers.getContractFactory('CopperPegCoin');
  const token = await Token.deploy(deployer.address, deployer.address);
  await token.waitForDeployment();
  console.log('CPEG:', await token.getAddress());
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
