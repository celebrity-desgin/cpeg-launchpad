import { ethers } from 'hardhat';

async function main() {
  const tokenAddr = process.env.CPEG!;
  const lpAddr = process.env.LAUNCHPAD!;
  const amount = '500000000'; // 5億枚

  const token = await ethers.getContractAt('CopperPegCoin', tokenAddr);
  const tx = await token.transfer(lpAddr, ethers.parseEther(amount));
  await tx.wait();
  console.log('Seeded', amount, 'CPEG ->', lpAddr);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
