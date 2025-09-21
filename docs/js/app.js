// app.js — CPEG Launchpad (MetaMask + Mobile Deep Link + WalletConnect Fallback)
// ethers v6

(() => {
  // ====== Config ======
  const RAW = {
    LP: '0xBdF1AeF237CdefdBd406831d408aE33ACD9E7fC0', // Launchpad contract
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT (ETH mainnet, 6 decimals)
    CHAIN_HEX: '0x1', // Ethereum
    EXPLORER: 'https://etherscan.io',
    MIN_BUY_USDT: 10n * 10n ** 6n,
  };

  // 読み取り用 RPC（不調時にローテーション）
  const READ_RPCS = [
    'https://ethereum.publicnode.com',
    'https://rpc.ankr.com/eth',
    'https://1rpc.io/eth',
    'https://cloudflare-eth.com',
  ];

  // ====== Mobile / WalletConnect Fallbacks ======
  const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  // metamask.app.link の dapp ディープリンク（プロトコル無しのホスト+パス）
  const DAPP_PATH = `${location.host}${location.pathname}`.replace(/\/+$/, '');
  const METAMASK_DEEPLINK = `https://metamask.app.link/dapp/${DAPP_PATH}`;
  const WC_PROJECT_ID = 'ec38e25956dbbbc960565c4daf1a0730';

  // ====== DOM helpers / formatting ======
  const $ = (id) => document.getElementById(id);
  const getInEl = () =>
    document.getElementById('usdtIn') || document.getElementById('usdcIn');
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

  const addThousands = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const roundStrDecimal = (s, dp) => {
    const [iRaw, fRaw = ''] = s.split('.');
    if (dp <= 0) return iRaw;
    if (fRaw.length <= dp) {
      const f = fRaw.replace(/0+$/, '');
      return f ? `${iRaw}.${f}` : iRaw;
    }
    const cut = fRaw.slice(0, dp),
      next = fRaw[dp];
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
  const dtUTC = (sec) => {
    const d = new Date(Number(sec) * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm} UTC`;
  };

  // ====== Providers / state ======
  let rpcIndex = 0;
  let provider = new ethers.JsonRpcProvider(READ_RPCS[rpcIndex]); // 読み取り
  let reqProv = null; // EIP-1193 (MetaMask など)
  let wcProvider = null; // WalletConnect
  let signer = null; // 書き込み用
  let me = null; // 自分のアドレス
  let priceCache = 0n; // CPEG 1枚の価格(USDT 6桁) 例: 0.35 USDT/CPEG → 350000
  let myUsdtBal = null; // BigInt or null
  let sale = { st: 0n, et: 0n, live: false };
  let cdTimer = null;

  function rotateReader() {
    rpcIndex = (rpcIndex + 1) % READ_RPCS.length;
    provider = new ethers.JsonRpcProvider(READ_RPCS[rpcIndex]);
  }

  // ====== ABIs ======
  const LP_ABI = [
    'function priceUSDT() view returns (uint256)',
    'function priceUSDC() view returns (uint256)',
    'function price() view returns (uint256)',
    'function window() view returns (uint64,uint64)',
    'function startTime() view returns (uint64)',
    'function endTime() view returns (uint64)',
    'function buyWithUSDT(uint256) returns (bool)',
    'function buyWithUSDC(uint256) returns (bool)',
    'function token() view returns (address)',
  ];
  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
  ];

  // ====== Topbar UI helpers ======
  function showConnectedUI(addr, usdtBal) {
    const tb = $('tb');
    const connectBtn = $('connect');
    if (tb) {
      tb.hidden = false;
      tb.style.display = 'flex';
    }
    if (connectBtn) {
      connectBtn.hidden = true;
      connectBtn.style.display = 'none';
    }

    if (addr) {
      const short = addr.slice(0, 6) + '…' + addr.slice(-4);
      setTxt('tbAddr', short);
    }
    if (typeof usdtBal !== 'undefined' && usdtBal !== null) {
      setTxt('tbUsdt', `${fmt.usdt(usdtBal)} USDT`);
    }
    const dis = $('disconnectHeader');
    if (dis) dis.hidden = false;
  }

  function showDisconnectedUI() {
    const tb = $('tb');
    const connectBtn = $('connect');
    if (tb) {
      tb.hidden = true;
      tb.style.display = 'none';
    }
    if (connectBtn) {
      connectBtn.hidden = false;
      connectBtn.style.display = 'inline-flex';
    }
    const dis = $('disconnectHeader');
    if (dis) dis.hidden = true;
  }

  async function refreshWalletBar() {
    try {
      const eth = window.ethereum;
      if (!eth) {
        showDisconnectedUI();
        return;
      }
      const accs = await eth.request({ method: 'eth_accounts' });
      if (!accs || !accs.length) {
        showDisconnectedUI();
        return;
      }
      me = ethers.getAddress(accs[0]);
      const usdtRO = new ethers.Contract(USDT_ADDR, ERC20_ABI, provider);
      myUsdtBal = await usdtRO.balanceOf(me);
      showConnectedUI(me, myUsdtBal);
      updateBuyButtonByInput();
    } catch {
      showDisconnectedUI();
    }
  }

  // ====== Countdown & price ======
  function setSaleWindow(st, et) {
    sale.st = BigInt(st || 0);
    sale.et = BigInt(et || 0);
    setTxt('cdSt', sale.st ? dtUTC(sale.st) : '--');
    setTxt('cdEt', sale.et ? dtUTC(sale.et) : '--');

    if (cdTimer) {
      clearInterval(cdTimer);
      cdTimer = null;
    }
    const two = (n) => n.toString().padStart(2, '0');

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      sale.live =
        sale.st && sale.et
          ? now >= Number(sale.st) && now <= Number(sale.et)
          : false;
      const target = now < Number(sale.st) ? Number(sale.st) : Number(sale.et);
      const left = Math.max(0, target - now);

      const d = Math.floor(left / 86400);
      const h = Math.floor((left % 86400) / 3600);
      const m = Math.floor((left % 3600) / 60);
      const s = left % 60;

      setTxt('cdDays', d);
      setTxt('cdHours', two(h));
      setTxt('cdMins', two(m));
      setTxt('cdSecs', two(s));

      updateBuyButtonByInput();
    };
    tick();
    cdTimer = setInterval(tick, 1000);
  }

  async function readPrice(lp) {
    try {
      return await lp.priceUSDT();
    } catch {}
    try {
      return await lp.priceUSDC();
    } catch {}
    try {
      return await lp.price();
    } catch {}
    return 0n;
  }

  function updateQuote() {
    const qEl = $('quote');
    try {
      const raw = (getInEl()?.value || '0').trim();
      if (!raw) {
        if (qEl) qEl.textContent = '-';
        return;
      }
      const usdt = ethers.parseUnits(raw, 6);
      if (usdt <= 0n || priceCache <= 0n) {
        if (qEl) qEl.textContent = '-';
        return;
      }
      const out = (usdt * 10n ** 18n) / priceCache;
      if (qEl) {
        qEl.textContent = fmt.cpeg(out);
        qEl.title = ethers.formatUnits(out, 18);
      }
    } catch {
      if (qEl) qEl.textContent = '-';
    }
  }

  function updateBuyButtonByInput() {
    const btn = $('buy');
    if (!btn) return;
    try {
      if (!signer || !sale.live || priceCache <= 0n) {
        btn.disabled = true;
        return;
      }
      const raw = (getInEl()?.value || '0').trim();
      if (!raw) {
        btn.disabled = true;
        return;
      }
      const usdt = ethers.parseUnits(raw, 6);
      if (usdt <= 0n) {
        btn.disabled = true;
        return;
      }
      if (RAW.MIN_BUY_USDT && usdt < RAW.MIN_BUY_USDT) {
        btn.disabled = true;
        return;
      }
      if (myUsdtBal != null && usdt > myUsdtBal) {
        btn.disabled = true;
        return;
      }
      btn.disabled = false;
    } catch {
      btn.disabled = true;
    }
  }

  // ====== Network guard ======
  async function ensureMainnet(prov) {
    const p = prov || reqProv || window.ethereum;
    if (!p) throw new Error('Wallet not found. Please enable MetaMask.');
    const chainId = await p.request({ method: 'eth_chainId' });
    if (chainId === RAW.CHAIN_HEX) return;
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

  // ユーザーに分かりやすい接続メッセージ
  async function requestAccountsWithHints() {
    const eth = window.ethereum;
    if (!eth)
      throw new Error('MetaMask not found. Please enable the 🦊 extension.');
    try {
      const accs = await eth.request({ method: 'eth_requestAccounts' });
      if (!accs || !accs.length)
        throw new Error(
          'No account returned. Open MetaMask, choose an account, then try again.'
        );
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

  // ====== Refresh (read chain state) ======
  async function refresh(readSigner = false) {
    try {
      const p = readSigner && signer ? signer : provider;
      const lp = new ethers.Contract(LP_ADDR, LP_ABI, p);

      priceCache = await readPrice(lp);

      let st = 0n,
        et = 0n;
      try {
        const w = await lp.window();
        st = BigInt(w[0]);
        et = BigInt(w[1]);
      } catch {
        try {
          st = BigInt(await lp.startTime());
          et = BigInt(await lp.endTime());
        } catch {}
      }
      if (st && et) setSaleWindow(st, et);

      updateQuote();
      updateBuyButtonByInput();
      setTxt('msg', '');

      if (me) {
        const usdtRO = new ethers.Contract(USDT_ADDR, ERC20_ABI, provider);
        myUsdtBal = await usdtRO.balanceOf(me);
        showConnectedUI(me, myUsdtBal);
      }
    } catch (e) {
      console.error('[refresh]', e);
      $('msg') &&
        ($('msg').innerHTML = `<span class="danger">Refresh error:</span> ${
          e?.shortMessage || e?.message || e
        }`);
      if (String(e?.message || e).match(/fetch|network|timeout|429|coalesce/i))
        rotateReader();
    }
  }

  // ====== Connect / Disconnect ======
  $('connect')?.addEventListener('click', connectWallet);

  async function connectWallet() {
    const msgEl = $('msg');
    if (msgEl) msgEl.textContent = '';
    try {
      // 1) 拡張があるならそれを使用
      if (window.ethereum) {
        reqProv = window.ethereum;
        await ensureMainnet(reqProv);
        const first = await requestAccountsWithHints();
        if (!first) throw new Error('No account selected.');

        const br = new ethers.BrowserProvider(reqProv, 'any');
        provider = br;
        signer = await br.getSigner();
        me = ethers.getAddress(first);

        showConnectedUI(me);
        await refresh(true);

        reqProv.on?.('accountsChanged', onAccountsChanged);
        reqProv.on?.('chainChanged', () => location.reload());
        reqProv.on?.('disconnect', () => {
          cleanupConnection();
          refresh(false).catch(() => {});
        });
        return;
      }

      // 2) モバイルなら MetaMask アプリへ遷移（内蔵ブラウザで ethereum が注入される）
      if (IS_MOBILE) {
        location.href = METAMASK_DEEPLINK;
        return;
      }

      // 3) PCで拡張が無い → WalletConnect を使う（任意）
      if (
        WC_PROJECT_ID &&
        !WC_PROJECT_ID.startsWith('YOUR_') &&
        window.EthereumProvider
      ) {
        wcProvider = await EthereumProvider.init({
          projectId: WC_PROJECT_ID,
          chains: [1],
          showQrModal: true,
          methods: [
            'eth_sendTransaction',
            'personal_sign',
            'eth_signTypedData',
            'eth_signTypedData_v4',
          ],
          optionalMethods: ['eth_accounts', 'eth_requestAccounts'],
        });
        await wcProvider.enable();

        provider = new ethers.BrowserProvider(wcProvider, 'any');
        signer = await provider.getSigner();
        const accs = await provider.send('eth_accounts', []);
        me = ethers.getAddress(accs[0]);

        showConnectedUI(me);
        await refresh(true);

        wcProvider.on('accountsChanged', onAccountsChanged);
        wcProvider.on('chainChanged', () => location.reload());
        wcProvider.on('disconnect', () => {
          cleanupConnection();
          refresh(false).catch(() => {});
        });
        return;
      }

      // 4) フォールバック不可
      throw new Error(
        'No wallet detected. Install MetaMask or set WC_PROJECT_ID to use WalletConnect.'
      );
    } catch (e) {
      console.error('connect error', e);
      $('msg') &&
        ($('msg').innerHTML = `<span class="danger">Connect error:</span> ${
          e?.shortMessage || e?.message || e
        }`);
      showDisconnectedUI();
    }
  }

  async function onAccountsChanged(a) {
    me = a && a[0] ? ethers.getAddress(a[0]) : null;
    if (!me) cleanupConnection();
    await refresh(!!me).catch(() => {});
  }

  function cleanupConnection() {
    signer = null;
    me = null;
    reqProv = null;
    try {
      if (wcProvider?.disconnect) wcProvider.disconnect();
    } catch {}
    wcProvider = null;
    provider = new ethers.JsonRpcProvider(READ_RPCS[0]);
    showDisconnectedUI();
  }

  $('disconnectHeader')?.addEventListener('click', async () => {
    try {
      if (wcProvider?.disconnect) await wcProvider.disconnect();
    } catch {}
    cleanupConnection();
    await refresh(false).catch(() => {});
  });

  // ====== Buy flow ======
  $('buy')?.addEventListener('click', async () => {
    const msgEl = $('msg');
    if (msgEl) msgEl.textContent = '';
    try {
      if (!signer || !me) throw new Error('Please connect your wallet first.');
      await ensureMainnet(reqProv || wcProvider);

      if (!sale.live) throw new Error('The sale is not live.');
      if (priceCache <= 0n)
        throw new Error('Price not available. Please try again.');

      const inp = getInEl();
      if (!inp) throw new Error('Input box not found.');
      const amountStr = (inp.value || '0').trim();
      const amount = ethers.parseUnits(amountStr, 6);

      if (amount <= 0n) throw new Error('Enter a valid USDT amount.');
      if (RAW.MIN_BUY_USDT && amount < RAW.MIN_BUY_USDT) {
        throw new Error(
          `Minimum purchase is ${fmt.usdt(RAW.MIN_BUY_USDT)} USDT.`
        );
      }
      if (myUsdtBal != null && amount > myUsdtBal) {
        throw new Error('You do not have enough USDT for this purchase.');
      }

      const lp = new ethers.Contract(LP_ADDR, LP_ABI, signer);
      const usdt = new ethers.Contract(USDT_ADDR, ERC20_ABI, signer);

      // allowance
      const cur = await usdt.allowance(me, LP_ADDR);
      if (cur < amount) {
        setTxt('msg', 'Approving USDT…');
        const txA = await usdt.approve(LP_ADDR, amount);
        msgEl.innerHTML = `Approve: <a target="_blank" href="${RAW.EXPLORER}/tx/${txA.hash}">${txA.hash}</a>`;
        await txA.wait();
      }

      // buy
      setTxt('msg', 'Buying CPEG…');
      let txB;
      try {
        txB = await lp.buyWithUSDT(amount);
      } catch {
        txB = await lp.buyWithUSDC(amount);
      }
      msgEl.innerHTML = `Buy: <a target="_blank" href="${RAW.EXPLORER}/tx/${txB.hash}">${txB.hash}</a>`;
      await txB.wait();
      msgEl.innerHTML += "<br><span class='ok'>✅ Completed</span>";

      // update balances
      try {
        const usdtRO = new ethers.Contract(USDT_ADDR, ERC20_ABI, provider);
        myUsdtBal = await usdtRO.balanceOf(me);
        showConnectedUI(me, myUsdtBal);
      } catch {}
      await refresh(true);
    } catch (e) {
      $('msg') &&
        ($('msg').innerHTML = `<span class="danger">Error:</span> ${
          e?.shortMessage || e?.message || e
        }`);
    }
  });

  // 入力のたびに見積り＆ボタン状態を更新
  (function bindInputListener() {
    const inEl = getInEl();
    inEl?.addEventListener('input', () => {
      updateQuote();
      updateBuyButtonByInput();
    });
  })();

  // ====== MetaMask events (既に注入されている場合) ======
  if (window.ethereum) {
    window.ethereum.on?.('accountsChanged', onAccountsChanged);
    window.ethereum.on?.('chainChanged', () => {
      setTimeout(() => location.reload(), 200);
    });
  }

  // ====== Boot ======
  (function boot() {
    $('year') && ($('year').textContent = new Date().getFullYear());
    showDisconnectedUI();
    refreshWalletBar(); // 既に接続済みなら上部バーに反映
    refresh(false); // 読み取りデータ（価格/期間）
    setInterval(() => refresh(false).catch(() => {}), 25000);

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
