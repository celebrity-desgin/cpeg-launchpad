// app.js — CPEG Launchpad (MetaMask + Countdown + USDT only, robust)
// ethers v6

(function () {
  // ====== Config ======
  const RAW = {
    // Launchpad コントラクト
    LP: '0xBdF1AeF237CdefdBd406831d408aE33ACD9E7fC0',
    // USDT (Ethereum Mainnet)
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    CHAIN_HEX: '0x1',
    EXPLORER: 'https://etherscan.io',

    // ★テスト用（本番は 1000n * 10n ** 6n に戻す）
    MIN_BUY_USDT: 10n * 10n ** 6n, // 10 USDT
  };

  // 読み取り用 RPC（不調時にローテーション）
  const READ_RPCS = [
    'https://ethereum.publicnode.com',
    'https://rpc.ankr.com/eth',
    'https://1rpc.io/eth',
    'https://cloudflare-eth.com',
  ];

  // ====== Helpers ======
  const $ = (id) => document.getElementById(id);
  const byId = (id) => document.getElementById(id);
  const getInEl = () => byId('usdtIn') || byId('usdcIn'); // 互換
  const setTxt = (id, v) => {
    const el = $(id);
    if (el) el.textContent = v;
  };

  const norm = (a) => {
    try {
      return ethers.getAddress((a || '').toLowerCase());
    } catch {
      return a;
    }
  };
  const LP_ADDR = norm(RAW.LP);
  const USDT_ADDR = norm(RAW.USDT);

  // 表示フォーマッタ
  const addThousands = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const roundStrDecimal = (s, dp) => {
    const [iRaw, fRaw = ''] = s.split('.');
    if (dp <= 0) return iRaw;
    if (fRaw.length <= dp) {
      const f = fRaw.replace(/0+$/, '');
      return f ? `${iRaw}.${f}` : iRaw;
    }
    const cut = fRaw.slice(0, dp);
    const next = fRaw[dp];
    let carry = next >= '5' ? 1 : 0;
    let frac = [...cut].reverse().map((d) => +d);
    for (let k = 0; k < frac.length && carry; k++) {
      const x = frac[k] + carry;
      if (x >= 10) {
        frac[k] = x - 10;
        carry = 1;
      } else {
        frac[k] = x;
        carry = 0;
      }
    }
    let i = iRaw,
      f = frac.reverse().join('');
    if (carry) i = (BigInt(iRaw) + 1n).toString();
    f = f.replace(/0+$/, '');
    return f ? `${i}.${f}` : i;
  };
  const fmt = {
    usdt: (v) => addThousands(roundStrDecimal(ethers.formatUnits(v, 6), 2)),
    cpeg: (v) => {
      const n = Number(ethers.formatUnits(v, 18));
      const dp = !Number.isFinite(n) ? 6 : Math.abs(n) >= 1 ? 4 : 6;
      return addThousands(roundStrDecimal(ethers.formatUnits(v, 18), dp));
    },
  };

  // ====== Ethers setup ======
  let rpcIndex = 0;
  let provider = new ethers.JsonRpcProvider(READ_RPCS[rpcIndex]); // 読み取り
  let reqProv = null; // EIP-1193（MetaMask）
  let signer = null; // 書き込み
  let me = null; // 自分のアドレス
  let myUsdtBal = null; // BigInt（不明なら null）
  let priceCache = 0n; // 現在価格（18桁基準への換算用は不要、価格自体は6桁想定）

  const rotateReader = () => {
    rpcIndex = (rpcIndex + 1) % READ_RPCS.length;
    provider = new ethers.JsonRpcProvider(READ_RPCS[rpcIndex]);
  };

  // ====== ABI（揺れに強く） ======
  const LP_ABI = [
    // 価格はどれかが存在すればOK
    'function priceUSDT() view returns (uint256)',
    'function priceUSDC() view returns (uint256)',
    'function price() view returns (uint256)',

    'function token() view returns (address)',

    // 販売期間（uint64/uint256 どちらでも拾えるように）
    'function window() view returns (uint256 start, uint256 end)',
    'function startTime() view returns (uint256)',
    'function endTime() view returns (uint256)',

    // 購入関数（どちらかが存在）
    'function buyWithUSDT(uint256)',
    'function buyWithUSDC(uint256)',
  ];
  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
  ];

  // ====== Countdown ======
  let cdTimer = null;
  const two = (n) => n.toString().padStart(2, '0');

  function startCountdown(st, et) {
    const stD = new Date(Number(st) * 1000);
    const etD = new Date(Number(et) * 1000);
    setTxt('cdSt', stD.toLocaleString());
    setTxt('cdEt', etD.toLocaleString());

    if (cdTimer) {
      clearInterval(cdTimer);
      cdTimer = null;
    }

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const target = now < st ? st : et;
      const left = Math.max(0, target - now);

      const d = Math.floor(left / 86400);
      const h = Math.floor((left % 86400) / 3600);
      const m = Math.floor((left % 3600) / 60);
      const s = left % 60;

      setTxt('cdDays', d);
      setTxt('cdHours', two(h));
      setTxt('cdMins', two(m));
      setTxt('cdSecs', two(s));
    };
    tick();
    cdTimer = setInterval(tick, 1000);
  }

  // ====== 価格/期間の堅牢取得 ======
  async function readPrice(lp) {
    let p = 0n;
    try {
      p = await lp.priceUSDT();
    } catch {}
    if (p === 0n) {
      try {
        p = await lp.priceUSDC();
      } catch {}
    }
    if (p === 0n) {
      try {
        p = await lp.price();
      } catch {}
    }
    return p;
  }

  async function readSaleWindow(lp) {
    try {
      const w = await lp.window();
      const st = BigInt(w.start ?? w[0] ?? 0);
      const et = BigInt(w.end ?? w[1] ?? 0);
      if (st && et) return [st, et];
    } catch {}
    try {
      const st = BigInt(await lp.startTime());
      const et = BigInt(await lp.endTime());
      if (st && et) return [st, et];
    } catch {}
    return [0n, 0n];
  }

  // ====== 見積 & BUY ボタン活性判定 ======
  function updateQuote(price6) {
    const inp = getInEl();
    if (!inp) return;
    try {
      const input = (inp.value || '0').trim();
      const usdt = ethers.parseUnits(input, 6);
      if (usdt <= 0n || !price6 || price6 === 0n) {
        setTxt('quote', '-');
        return;
      }
      // CPEG out = USDT(6) * 1e18 / price(6)
      const out = (usdt * 10n ** 18n) / price6;
      setTxt('quote', fmt.cpeg(out));
      const el = $('quote');
      if (el) el.title = ethers.formatUnits(out, 18);
    } catch {
      setTxt('quote', '-');
    }
  }

  function parseAmount() {
    const inp = getInEl();
    if (!inp) return 0n;
    try {
      return ethers.parseUnits((inp.value || '0').trim(), 6);
    } catch {
      return 0n;
    }
  }

  function updateBuyButton(live) {
    const btn = $('buy');
    if (!btn) return;
    try {
      if (!signer || !live || priceCache <= 0n) {
        btn.disabled = true;
        return;
      }
      const amt = parseAmount();
      if (amt < RAW.MIN_BUY_USDT) {
        btn.disabled = true;
        return;
      }
      if (myUsdtBal != null && amt > myUsdtBal) {
        btn.disabled = true;
        return;
      }
      btn.disabled = false;
    } catch {
      btn.disabled = true;
    }
  }

  // ====== UI Toggle ======
  function showConnectedUI(addr, usdtBal) {
    const tb = $('tb');
    const connectBtn = $('connect');
    if (tb) tb.style.display = 'flex';
    if (connectBtn) connectBtn.style.display = 'none';

    if (addr) {
      const short = addr.slice(0, 6) + '…' + addr.slice(-4);
      setTxt('tbAddr', short);
    }
    if (typeof usdtBal !== 'undefined') {
      setTxt('tbUsdt', `${fmt.usdt(usdtBal)} USDT`);
    }
    const dis = $('disconnectHeader');
    if (dis) dis.hidden = false;
  }

  function showDisconnectedUI() {
    const tb = $('tb');
    const connectBtn = $('connect');
    if (tb) tb.style.display = 'none';
    if (connectBtn) connectBtn.style.display = 'inline-flex';
    const dis = $('disconnectHeader');
    if (dis) dis.hidden = true;
  }

  // ====== Refresh（チェーン状態を読む） ======
  async function refresh(readSigner = false) {
    try {
      const pvd = readSigner && signer ? signer : provider;

      const lp = new ethers.Contract(LP_ADDR, LP_ABI, pvd);
      const usdt = new ethers.Contract(USDT_ADDR, ERC20_ABI, pvd);

      // 価格
      priceCache = await readPrice(lp);
      updateQuote(priceCache);

      // 期間
      const [st, et] = await readSaleWindow(lp);
      if (st && et) startCountdown(Number(st), Number(et));

      // ライブ判定
      const now = Math.floor(Date.now() / 1000);
      const live = st && et ? now >= Number(st) && now <= Number(et) : false;

      // 接続済みなら残高を更新
      if (me) {
        try {
          myUsdtBal = await usdt.balanceOf(me);
        } catch {
          myUsdtBal = null;
        }
        showConnectedUI(me, myUsdtBal ?? 0n);
      }

      updateBuyButton(live);
      setTxt('msg', '');
    } catch (e) {
      console.error('[refresh] failed', e);
      const el = $('msg');
      if (el)
        el.innerHTML = `<span class="danger">Refresh error:</span> ${
          e?.shortMessage || e?.message || e
        }`;
      if (
        String(e?.message || e).match(/fetch|network|timeout|429|coalesce/i)
      ) {
        rotateReader();
        setTimeout(() => refresh(readSigner).catch(() => {}), 800);
      }
    }
  }

  // ====== Chain helpers ======
  async function ensureMainnet(prov) {
    const p = prov || reqProv || window.ethereum;
    if (!p) throw new Error('Wallet not found. Please enable MetaMask.');
    const chainId = await p.request({ method: 'eth_chainId' });
    if (chainId !== RAW.CHAIN_HEX) {
      try {
        await p.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: RAW.CHAIN_HEX }],
        });
      } catch (e) {
        if (e && e.code === 4902) {
          await p.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: RAW.CHAIN_HEX,
                chainName: 'Ethereum',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: READ_RPCS,
                blockExplorerUrls: [RAW.EXPLORER],
              },
            ],
          });
        } else {
          throw e;
        }
      }
    }
  }

  // MetaMask に確実につなぐ（英語メッセージ）
  async function requestAccountsWithHints() {
    const eth = window.ethereum;
    if (!eth)
      throw new Error('MetaMask not found. Please enable the 🦊 extension.');

    try {
      const accs = await eth.request({ method: 'eth_requestAccounts' });
      if (!accs || accs.length === 0) {
        throw new Error(
          'No account returned. Open MetaMask, choose an account, then try again.'
        );
      }
      return accs[0];
    } catch (e) {
      const code = e && e.code;
      const msg = String(e?.message || e || '');
      if (code === -32002)
        throw new Error(
          'A connection request is already pending. Click the 🦊 icon and approve it.'
        );
      if (code === 4001)
        throw new Error(
          'Connection was rejected. Please click “Connect Wallet” again.'
        );
      if (/locked|unlock/i.test(msg))
        throw new Error(
          'Please open MetaMask and unlock it (enter your password), then try again.'
        );
      throw new Error(msg);
    }
  }

  // ====== Connect / Disconnect ======
  $('connect')?.addEventListener('click', async () => {
    const msgEl = $('msg');
    if (msgEl) msgEl.textContent = '';
    try {
      if (!window.ethereum)
        throw new Error('MetaMask not found. Please install/enable it.');

      reqProv = window.ethereum;

      const first = await requestAccountsWithHints();
      if (!first) throw new Error('No account selected.');

      await ensureMainnet(reqProv);

      const br = new ethers.BrowserProvider(reqProv, 'any');
      provider = br;
      signer = await br.getSigner();
      me = await signer.getAddress();

      showConnectedUI(me); // 先に UI を切り替える
      await refresh(true);

      // イベント
      reqProv.on?.('accountsChanged', async (a) => {
        me = a && a[0] ? ethers.getAddress(a[0]) : null;
        if (!me) {
          cleanupConnection();
        }
        await refresh(!!me).catch(() => {});
      });
      reqProv.on?.('chainChanged', () => location.reload());
      reqProv.on?.('disconnect', () => {
        cleanupConnection();
        refresh(false).catch(() => {});
      });
    } catch (e) {
      console.error('connect error', e);
      const el = $('msg');
      if (el)
        el.innerHTML = `<span class="danger">Connect error:</span> ${
          e?.shortMessage || e?.message || e
        }`;
      showDisconnectedUI();
    }
  });

  function cleanupConnection() {
    signer = null;
    me = null;
    reqProv = null;
    myUsdtBal = null;
    provider = new ethers.JsonRpcProvider(READ_RPCS[0]);
    showDisconnectedUI();
  }

  $('disconnectHeader')?.addEventListener('click', async () => {
    cleanupConnection();
    await refresh(false).catch(() => {});
  });

  // ====== Buy flow ======
  $('buy')?.addEventListener('click', async () => {
    const msgEl = $('msg');
    if (msgEl) msgEl.textContent = '';
    try {
      if (!signer) throw new Error('Please connect your wallet first.');
      await ensureMainnet(reqProv);

      const amount = parseAmount();
      if (amount < RAW.MIN_BUY_USDT) {
        throw new Error(
          `Minimum purchase is ${fmt.usdt(RAW.MIN_BUY_USDT)} USDT.`
        );
      }
      if (myUsdtBal != null && amount > myUsdtBal) {
        throw new Error('You do not have enough USDT for this purchase.');
      }
      if (priceCache <= 0n)
        throw new Error('Price not available. Please try again.');

      const lp = new ethers.Contract(LP_ADDR, LP_ABI, signer);
      const usdt = new ethers.Contract(USDT_ADDR, ERC20_ABI, signer);

      // allowance
      const cur = await usdt.allowance(me, LP_ADDR);
      if (cur < amount) {
        setTxt('msg', 'Approving USDT...');
        const txA = await usdt.approve(LP_ADDR, amount);
        msgEl.innerHTML = `Approve: <a target="_blank" href="${RAW.EXPLORER}/tx/${txA.hash}">${txA.hash}</a>`;
        await txA.wait();
      }

      // buy（関数名の揺れに対応）
      setTxt('msg', 'Buying CPEG...');
      let txB;
      try {
        txB = await lp.buyWithUSDT(amount);
      } catch {
        txB = await lp.buyWithUSDC(amount);
      }
      msgEl.innerHTML = `Buy: <a target="_blank" href="${RAW.EXPLORER}/tx/${txB.hash}">${txB.hash}</a>`;
      await txB.wait();
      msgEl.innerHTML += "<br><span class='ok'>✅ Completed</span>";

      // 残高/UI更新
      try {
        const roUsdt = new ethers.Contract(USDT_ADDR, ERC20_ABI, provider);
        myUsdtBal = await roUsdt.balanceOf(me);
        showConnectedUI(me, myUsdtBal);
      } catch {}
      await refresh(true);
    } catch (e) {
      const el = $('msg');
      if (el)
        el.innerHTML = `<span class="danger">Error:</span> ${
          e?.shortMessage || e?.message || e
        }`;
    }
  });

  // 入力変更 → 見積＆ボタン状態更新
  getInEl()?.addEventListener('input', async () => {
    try {
      const lp = new ethers.Contract(LP_ADDR, LP_ABI, provider);
      priceCache = await readPrice(lp);
      updateQuote(priceCache);

      // ライブ判定で活性を更新
      const [st, et] = await readSaleWindow(lp);
      const now = Math.floor(Date.now() / 1000);
      const live = st && et ? now >= Number(st) && now <= Number(et) : false;
      updateBuyButton(live);
    } catch {
      /* noop */
    }
  });

  // ====== Boot ======
  (function boot() {
    const y = $('year');
    if (y) y.textContent = new Date().getFullYear();
    showDisconnectedUI(); // 初期は未接続表示
    refresh(false);
    setInterval(() => refresh(!!signer).catch(() => {}), 25000);

    if (window.ethereum) {
      // 既に MetaMask があれば監視だけ先に張っておく
      window.ethereum.on?.('chainChanged', () => location.reload());
      window.ethereum.on?.('accountsChanged', async (a) => {
        me = a && a[0] ? ethers.getAddress(a[0]) : null;
        if (!me) cleanupConnection();
        await refresh(!!me).catch(() => {});
      });
    }

    console.log(
      '[boot] ethers',
      ethers.version,
      '| LP',
      LP_ADDR,
      '| USDT',
      USDT_ADDR
    );
  })();
})();
