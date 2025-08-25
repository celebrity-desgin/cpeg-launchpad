// tasks/launchpad.ts
import { task, types } from 'hardhat/config';
import type { HardhatRuntimeEnvironment as HRE } from 'hardhat/types';
import '@nomicfoundation/hardhat-ethers';
import { ethers } from 'ethers';

// ---- 環境変数を読むヘルパ -----------------
function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`.env に ${name} がありません`);
  return v.trim();
}

async function addr(hre: HRE, v: string) {
  return await hre.ethers.getAddress(v.trim());
}

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function mint(address,uint256)',
];

// ---- コントラクト取得 ----------------------
async function getLP(hre: HRE) {
  const a = await addr(hre, must('LAUNCHPAD'));
  return hre.ethers.getContractAt('CopperPegLaunchpad', a);
}

async function getERC20(hre: HRE, a: string) {
  return new hre.ethers.Contract(
    a,
    ERC20_ABI,
    (await hre.ethers.getSigners())[0]
  );
}

async function nowTs(hre: HRE) {
  const blk = await hre.ethers.provider.getBlock('latest');
  if (!blk) throw new Error('failed to fetch latest block');
  return blk.timestamp;
}

const fmt6 = (v: any) => ethers.formatUnits(v, 6);
const fmt18 = (v: any) => ethers.formatUnits(v, 18);

// =====================================================
//  lp:status — 状態一覧
// =====================================================
task('lp:status', 'Launchpad の現在状態を表示').setAction(async (_, hre) => {
  const lp = await getLP(hre);
  const USDC_ADDR = await addr(hre, must('USDC'));
  const usdc = await getERC20(hre, USDC_ADDR);
  const tokenAddr: string = await lp.token();
  const token = await getERC20(hre, tokenAddr);

  const [price, cap, st, et] = await Promise.all([
    lp.priceUSDC(),
    lp.cap(),
    lp.startTime(),
    lp.endTime(),
  ]);
  const now = await nowTs(hre);
  const phase = now < Number(st) ? 'PRE' : now <= Number(et) ? 'LIVE' : 'ENDED';

  const lpAddr = await lp.getAddress();
  const [lpUsdc, lpTok, fw] = await Promise.all([
    usdc.balanceOf(lpAddr),
    token.balanceOf(lpAddr),
    lp.fundsWallet(),
  ]);

  console.log('=== Launchpad STATUS ===');
  console.log('Phase     :', phase, '(now:', now, ')');
  console.log('Start/End :', Number(st), '/', Number(et));
  console.log('Price     : USDC', fmt6(price));
  console.log('Cap       :', fmt18(cap), 'CPEG(18)');
  console.log('LP USDC   :', fmt6(lpUsdc));
  console.log('LP Token  :', fmt18(lpTok));
  console.log('FundsWallet:', fw);
  console.log('TokenAddr :', tokenAddr);
});

// =====================================================
//  lp:sweep — 売上/残トークン回収
//    USDC/CPEG/任意ERC20/ETH を回収
// =====================================================
task('lp:sweep', 'LP から資金を回収')
  .addOptionalParam('token', 'USDC | CPEG | ETH | <address>', 'USDC')
  .addOptionalParam('to', '送金先 (省略で FUNDS_WALLET)', '')
  .addFlag('force', 'endTime 前でも実行（危険）')
  .setAction(async (args, hre) => {
    const lp = await getLP(hre);
    const to = args.to
      ? await addr(hre, args.to)
      : await addr(hre, must('FUNDS_WALLET'));
    const now = await nowTs(hre);
    const end = Number(await lp.endTime());
    if (now <= end && !args.force) {
      throw new Error(
        'まだ endTime を過ぎていません。--force で強制実行できます。'
      );
    }

    if ((args.token || 'USDC').toUpperCase() === 'ETH') {
      const tx = await lp.sweepETH(to);
      console.log('sweepETH tx:', tx.hash);
      await tx.wait();
      return;
    }

    // ERC20 アドレス解決
    let tokenAddr: string;
    if (args.token.toUpperCase() === 'USDC')
      tokenAddr = await addr(hre, must('USDC'));
    else if (args.token.toUpperCase() === 'CPEG') tokenAddr = await lp.token();
    else tokenAddr = await addr(hre, args.token);

    const tx = await lp.sweepToken(tokenAddr, to);
    console.log('sweepToken tx:', tx.hash);
    await tx.wait();
  });

// =====================================================
//  lp:set-price — 価格更新（USDC, 6桁小数）
// =====================================================
task('lp:set-price', 'USDC 価格を更新（6桁小数）')
  .addParam('usdc', '例: 0.35')
  .setAction(async ({ usdc }, hre) => {
    const lp = await getLP(hre);
    const v = ethers.parseUnits(usdc, 6);
    const tx = await lp.setPriceUSDC(v);
    console.log('setPriceUSDC tx:', tx.hash);
    await tx.wait();
  });

// =====================================================
//  lp:set-funds — 売上の送金先を変更
// =====================================================
task('lp:set-funds', 'FUNDS_WALLET を変更')
  .addParam('to', '新しい送金先アドレス')
  .setAction(async ({ to }, hre) => {
    const lp = await getLP(hre);
    const tx = await lp.setFundsWallet(await addr(hre, to));
    console.log('setFundsWallet tx:', tx.hash);
    await tx.wait();
  });

// =====================================================
//  lp:grant-admin / lp:revoke-admin — 権限移譲
// =====================================================
task('lp:grant-admin', 'DEFAULT_ADMIN_ROLE を付与')
  .addParam('to', '付与先アドレス')
  .setAction(async ({ to }, hre) => {
    const lp = await getLP(hre);
    const role = await lp.DEFAULT_ADMIN_ROLE();
    const tx = await lp.grantRole(role, await addr(hre, to));
    console.log('grantRole tx:', tx.hash);
    await tx.wait();
  });

task('lp:revoke-admin', 'DEFAULT_ADMIN_ROLE を剥奪')
  .addParam('from', '剥奪対象アドレス')
  .setAction(async ({ from }, hre) => {
    const lp = await getLP(hre);
    const role = await lp.DEFAULT_ADMIN_ROLE();
    const tx = await lp.revokeRole(role, await addr(hre, from));
    console.log('revokeRole tx:', tx.hash);
    await tx.wait();
  });

// =====================================================
//  lp:seed — CPEG を LP へ補充（18桁）
// =====================================================
task('lp:seed', 'LP に CPEG を補充（18桁小数）')
  .addParam('amount', '例: 1000000  ( = 1,000,000 CPEG )')
  .setAction(async ({ amount }, hre) => {
    const lp = await getLP(hre);
    const to = await (await getLP(hre)).getAddress();
    const tokenAddr: string = await lp.token();
    const token = await getERC20(hre, tokenAddr);

    const val = ethers.parseUnits(amount, 18);
    const tx = await (token as any).transfer(to, val);
    console.log('seed CPEG tx:', tx.hash);
    await tx.wait();
  });

// =====================================================
//  lp:env — .env の基本チェック
// =====================================================
task('lp:env', '.env のアドレス確認').setAction(async (_, hre) => {
  const keys = ['USDC', 'CPEG', 'FUNDS_WALLET', 'LAUNCHPAD'];
  for (const k of keys) {
    const v = must(k);
    console.log(k, '=>', await addr(hre, v));
  }
});

task('lp:preview', 'USDC で買うと何 CPEG か見積もり表示')
  .addParam('usdc', '例: 50', undefined, types.string)
  .setAction(async ({ usdc }, hre) => {
    const lp = await getLP(hre);
    const usdcAmt = ethers.parseUnits(usdc, 6);

    // 1) 関数があれば使う
    let out: bigint | undefined;
    if ('quote' in lp && typeof (lp as any).quote === 'function') {
      out = await (lp as any).quote(usdcAmt);
    } else if ('preview' in lp && typeof (lp as any).preview === 'function') {
      out = await (lp as any).preview(usdcAmt);
    }

    // 2) 無ければ priceUSDC から計算
    if (out === undefined) {
      const price = await lp.priceUSDC(); // 6桁小数
      // CPEG = usdcAmt(6) * 10^18 / price(6)
      out = (usdcAmt * 10n ** 18n) / price;
    }

    console.log('USDC', usdc, '=> CPEG', fmt18(out));
  });

task('lp:buy', 'USDC で実際に購入（テスト用）')
  .addParam('usdc', '例: 50', undefined, types.string)
  .setAction(async ({ usdc }, hre) => {
    const lp = await getLP(hre);
    const usdcAddr = await addr(hre, must('USDC'));
    const usdcC = await getERC20(hre, usdcAddr);
    const amt = ethers.parseUnits(usdc, 6);

    // 承認 → 購入
    console.log('approve...');
    await (await usdcC.approve(await lp.getAddress(), amt)).wait();
    console.log('buy...');
    await (await lp.buyWithUSDC(amt)).wait();
    console.log('done!');
  });
