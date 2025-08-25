import 'dotenv/config';
import { ethers } from 'hardhat';

async function main() {
  const { getAddress, isAddress, parseUnits } = ethers;

  const token = getAddress((process.env.CPEG ?? '').trim());
  const usdc = getAddress((process.env.USDC ?? '').trim());
  const funds = getAddress((process.env.FUNDS_WALLET ?? '').trim());

  // ここから下はそのままでOK
  const [deployer] = await ethers.getSigners();

  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 60;
  const endTime = startTime + 7 * 24 * 60 * 60;
  const cap = parseUnits('1000000', 18);

  const Launchpad = await ethers.getContractFactory('CopperPegLaunchpad');
  const lp = await Launchpad.deploy(
    deployer.address, // admin
    token, // CPEG
    usdc, // USDC
    funds, // 受取アドレス
    startTime,
    endTime,
    cap
  );
  await lp.waitForDeployment();
  console.log('LAUNCHPAD:', await lp.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
