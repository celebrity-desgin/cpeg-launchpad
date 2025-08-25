import { ethers } from 'hardhat';

async function main() {
  const [owner] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory('MockUSDC6');
  const usdc = await Mock.deploy(owner.address);
  await usdc.waitForDeployment();
  console.log('MockUSDC6:', await usdc.getAddress());
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
