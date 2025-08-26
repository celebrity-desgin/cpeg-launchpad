// app.js (drop-in with WalletConnect fallback + countdown + mobile Safari private handling)
(function () {
  // ====== 環境設定 ======
  const RAW = {
    LP: '0xd27131870F189249F9C7F57E985486a0568F64EF',
    USDC: '0x75DbbF6459Acf142f6b89f5456aB5f41dCeddBa8',
    CHAIN_HEX: '0xaa36a7', // Sepolia
    EXPLORER: 'https://sepolia.etherscan.io',
  };

  // ====== Countdown ======
  let cdTimer = null;
  const two = (n) => n.toString().padStart(2, '0');

  function startCountdown(st, et) {
    const stD = new Date(Number(st) * 1000);
    const etD = new Date(Number(et) * 1000);

    const cdStEl = document.getElementById('cdSt');
    if (cdStEl) cdStEl.textContent = stD.toLocaleString();
    const cdEtEl = document.getElementById('cdEt');
    if (cdEtEl) cdEtEl.textContent = etD.toLocaleString();

    if (cdTimer) {
      clearInterval(cdTimer);
      cdTimer = null;
    }

    const total = Math.max(0, Number(et) - Number(st));

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      let mode = 'ended',
        target = et;
      if (now < st) {
        mode = 'starts';
        target = st;
      } else if (now <= et) {
        mode = 'ends';
        target = et;
      }

      const left = Math.max(0, target - now);
      const d = Math.floor(left / 86400);
      const h = Math.floor((left % 86400) / 3600);
      const m = Math.floor((left % 3600) / 60);
      const s = left % 60;

      const head = document.getElementById('cdHeading');
      if (head)
        head.textContent =
          mode === 'starts'
            ? 'Sale starts in'
            : mode === 'ends'
            ? 'Sale ends in'
            : 'Sale ended';

      const setText = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
      };
      setText('cdDays', d);
      setText('cdHours', two(h));
      setText('cdMins', two(m));
      setText('cdSecs', two(s));

      const setP = (id, p) => {
        const el = document.getElementById(id);
        if (el) el.style.setProperty('--p', String(p));
      };
      setP('cdDaysRing', 100);
      setP('cdHoursRing', (h / 24) * 100);
      setP('cdMinsRing', (m / 60) * 100);
      setP('cdSecsRing', (s / 60) * 100);

      let prog = 0;
      if (mode === 'starts') prog = 0;
      else if (mode === 'ends') prog = total ? ((now - st) / total) * 100 : 0;
      else prog = 100;
      const bar = document.getElementById('cdProgBar');
      if (bar) bar.style.width = `${Math.min(100, Math.max(0, prog))}%`;
    };

    tick();
    cdTimer = setInterval(tick, 1000);
  }

  // === Buy-now（カウントダウンのCTA） ===
  function updateCtaState(phase) {
    const cdBtn = document.getElementById('cdAction');
    if (!cdBtn) return;
    let label = 'Buy now';
    let disabled = false;

    if (!me) label = 'Connect Wallet';
    if (phase === 'PRE') {
      label = 'Starts soon';
      disabled = true;
    }
    if (phase === 'ENDED') {
      label = 'Sale ended';
      disabled = true;
    }

    cdBtn.textContent = label;
    cdBtn.disabled = disabled;
  }

  // クリック挙動（※二重リスナーは付けない）
  document.getElementById('cdAction')?.addEventListener('click', () => {
    const connBtn = document.getElementById('connect');
    const inEl = document.getElementById('usdcIn');
    const buyEl = document.getElementById('buy');

    if (!me) {
      connBtn?.click();
      return;
    }

    const val = Number(inEl?.value || 0);
    if (!val) {
      inEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      inEl?.classList.add('glow');
      setTimeout(() => inEl?.classList.remove('glow'), 1200);
      inEl?.focus();
      return;
    }
    buyEl?.click();
  });

  // ====== WalletConnect ======
  const WC_PROJECT_ID = 'ec38e25956dbbbc960565c4daf1a0730';
  const SEPOLIA_ID = 11155111;

  // ====== 読み取りRPC ======
  const READ_RPCS = [
    'https://rpc.sepolia.org',
    'https://1rpc.io/sepolia',
    'https://endpoints.omniatech.io/v1/eth/sepolia/public',
  ];

  let rpcIndex = 0;
  let provider = new ethers.JsonRpcProvider(READ_RPCS[rpcIndex]); // 読み取り用
  let signer = null;
  let me = null;

  let reqProv = null; // 実コール用 EIP-1193
  let wcProvider = null; // WalletConnect provider

  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const rotateReader = () => {
    rpcIndex = (rpcIndex + 1) % READ_RPCS.length;
    provider = new ethers.JsonRpcProvider(READ_RPCS[rpcIndex]);
  };

  // 住所正規化
  const norm = (_label, a) => {
    const clean = (a ?? '').trim();
    try {
      return ethers.getAddress(clean.toLowerCase());
    } catch {
      return clean;
    }
  };

  const LP_ADDR = norm('LP', RAW.LP);
  const USDC_ADDR = norm('USDC', RAW.USDC);
  const CHAIN_HEX = RAW.CHAIN_HEX;
  const EXPLORER = RAW.EXPLORER;

  // ====== ABIs ======
  const LP_ABI = [
    'function priceUSDC() view returns (uint256)',
    'function startTime() view returns (uint256)',
    'function endTime() view returns (uint256)',
    'function cap() view returns (uint256)',
    'function token() view returns (address)',
    'function fundsWallet() view returns (address)',
    'function buyWithUSDC(uint256)',
  ];
  const ERC20_ABI = [
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
  ];

  // ====== util（表示） ======
  const $ = (id) => document.getElementById(id);

  function roundStrDecimal(s, dp) {
    const [iRaw, fRaw = ''] = s.split('.');
    if (dp <= 0) return iRaw;
    if (fRaw.length <= dp) {
      const f = fRaw.replace(/0+$/, '');
      return f ? `${iRaw}.${f}` : iRaw;
    }
    const cut = fRaw.slice(0, dp);
    const next = fRaw[dp];
    let carry = next >= '5' ? 1 : 0;
    let fracArr = cut
      .split('')
      .reverse()
      .map((d) => +d);
    for (let k = 0; k < fracArr.length && carry; k++) {
      const x = fracArr[k] + carry;
      if (x >= 10) {
        fracArr[k] = x - 10;
        carry = 1;
      } else {
        fracArr[k] = x;
        carry = 0;
      }
    }
    let i = iRaw;
    let f = fracArr.reverse().join('');
    if (carry) i = (BigInt(iRaw) + 1n).toString();
    f = f.replace(/0+$/, '');
    return f ? `${i}.${f}` : i;
  }
  const addThousands = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  function fmtAmount(v, decimals, dp) {
    const s = ethers.formatUnits(v, decimals);
    const rounded = roundStrDecimal(s, dp);
    const [i, f = ''] = rounded.split('.');
    const iw = addThousands(i);
    return f ? `${iw}.${f}` : iw;
  }

  const fmtUSDC = (v) => fmtAmount(v, 6, 2);
  const fmtPriceUSDC = (v) => fmtAmount(v, 6, 6);
  const fmtCPEG = (v) => {
    const n = Number(ethers.formatUnits(v, 18));
    const dp = !Number.isFinite(n) ? 6 : Math.abs(n) >= 1 ? 4 : 6;
    return fmtAmount(v, 18, dp);
  };
  const fmtQuoteCPEG = (v) => fmtAmount(v, 18, 4);

  // ====== 表示更新 ======
  async function refresh(readSigner = false) {
    try {
      const pvd = readSigner && signer ? signer : provider;
      const lp = new ethers.Contract(LP_ADDR, LP_ABI, pvd);
      const usdc = new ethers.Contract(USDC_ADDR, ERC20_ABI, pvd);

      const [price, st, et, tokAddr, fw] = await Promise.all([
        lp.priceUSDC(),
        lp.startTime(),
        lp.endTime(),
        lp.token(),
        lp.fundsWallet(),
      ]);

      // カウントダウンを起動/更新
      startCountdown(Number(st), Number(et));

      const nowTs = Math.floor(Date.now() / 1000);
      const phase = nowTs < st ? 'PRE' : nowTs <= et ? 'LIVE' : 'ENDED';

      const tokenRO = new ethers.Contract(
        tokAddr,
        ['function balanceOf(address) view returns (uint256)'],
        pvd
      );
      const [lpUsdc, lpTok] = await Promise.all([
        usdc.balanceOf(LP_ADDR),
        tokenRO.balanceOf(LP_ADDR),
      ]);

      $('phase').textContent = phase;
      $('now').textContent = new Date(nowTs * 1000).toLocaleString();
      $('price').textContent = fmtPriceUSDC(price);
      $('st').textContent = new Date(Number(st) * 1000).toLocaleString();
      $('et').textContent = new Date(Number(et) * 1000).toLocaleString();
      $('lpUsdc').textContent = fmtUSDC(lpUsdc);
      $('lpTok').textContent = fmtCPEG(lpTok);
      $('funds').textContent = fw;
      $('lpAddr').textContent = LP_ADDR;

      updateQuote(price);
      updateCtaState(phase); // ← ここでCTAを更新

      if (me) {
        const [myU, myT, alw] = await Promise.all([
          usdc.balanceOf(me),
          tokenRO.balanceOf(me),
          usdc.allowance(me, LP_ADDR),
        ]);
        $('myUsdc').textContent = fmtUSDC(myU);
        $('myCpeg').textContent = fmtCPEG(myT);
        $('allow').textContent = fmtUSDC(alw);
      }

      $('buy').disabled = phase !== 'LIVE' || !signer;
      $('msg').textContent = '';
    } catch (e) {
      console.error('[refresh] failed', e);
      $('msg').innerHTML = `<span class="danger">Refresh error:</span> ${
        e?.shortMessage || e?.message || e
      }`;
      if (String(e?.message || e).match(/fetch|network|timeout|429/i)) {
        rotateReader();
        setTimeout(() => refresh(readSigner).catch(() => {}), 900);
      }
    }
  }

  function updateQuote(priceUSDC) {
    try {
      const input = $('usdcIn').value || '0';
      const usdc = ethers.parseUnits(input, 6);
      if (usdc === 0n || priceUSDC === 0n) {
        $('quote').textContent = '-';
        return;
      }
      const out = (usdc * 10n ** 18n) / priceUSDC;
      $('quote').textContent = `≈ ${fmtQuoteCPEG(out)}`;
      $('quote').title = ethers.formatUnits(out, 18);
    } catch {
      $('quote').textContent = '-';
    }
  }

  $('usdcIn').addEventListener('input', async () => {
    try {
      const lp = new ethers.Contract(LP_ADDR, LP_ABI, provider);
      const price = await lp.priceUSDC();
      updateQuote(price);
    } catch {}
  });

  // UI切替
  function setConnUI(connected) {
    const connBtn = document.getElementById('connect');
    const discBtn = document.getElementById('disconnect');
    const discHdr = document.getElementById('disconnectHeader');
    if (connBtn) connBtn.hidden = connected;
    if (discBtn) discBtn.hidden = !connected;
    if (discHdr) discHdr.hidden = !connected;
  }

  // ====== Safariプライベート対策 & DeepLink ======
  function canUseLocalStorage() {
    try {
      localStorage.setItem('__wc_test__', '1');
      localStorage.removeItem('__wc_test__');
      return true;
    } catch {
      return false;
    }
  }
  const mmBtn = document.getElementById('openInMM');
  function showMMDeepLink(show) {
    if (!mmBtn) return;
    const dappPath = `${location.host}${location.pathname}${
      location.search || ''
    }`;
    mmBtn.href = `https://metamask.app.link/dapp/${dappPath}`;
    mmBtn.style.display = show ? 'inline-flex' : 'none';
  }
  showMMDeepLink(false);

  // ====== チェーン切替 ======
  async function ensureSepolia(prov) {
    const p = prov || reqProv || window.ethereum;
    if (!p) throw new Error('ウォレットが見つかりません');
    const chainId = await p.request({ method: 'eth_chainId' });
    if (chainId !== CHAIN_HEX) {
      try {
        await p.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: CHAIN_HEX }],
        });
      } catch (e) {
        if (e.code === 4902) {
          await p.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: CHAIN_HEX,
                chainName: 'Sepolia',
                nativeCurrency: {
                  name: 'SepoliaETH',
                  symbol: 'SEP',
                  decimals: 18,
                },
                rpcUrls: READ_RPCS,
                blockExplorerUrls: [EXPLORER],
              },
            ],
          });
        } else {
          throw e;
        }
      }
    }
  }

  // ====== Connect（拡張優先 → WalletConnect） ======
  $('connect').onclick = async () => {
    try {
      showMMDeepLink(false);

      if (window.ethereum) {
        reqProv = window.ethereum;
        await ensureSepolia(reqProv);
        provider = new ethers.BrowserProvider(reqProv, 'any');
        signer = await provider.getSigner();
        me = await signer.getAddress();
        $('addr').textContent = me;
        $('net').textContent = 'Sepolia';
        setConnUI(true);
        await refresh(true);
        return;
      }

      // PrivateモードなどでlocalStorage不可 → DeepLink案内
      if (!canUseLocalStorage()) {
        $(
          'msg'
        ).innerHTML = `<span class="danger">WalletConnect cannot start in Private mode.</span><br>通常タブで開くか、右上の「Open in MetaMask」をタップしてください。`;
        showMMDeepLink(true);
        return;
      }

      if (!window.EthereumProvider) {
        $(
          'msg'
        ).innerHTML = `<span class="danger">WalletConnect script not loaded.</span>`;
        showMMDeepLink(true);
        return;
      }

      try {
        await wcProvider?.disconnect?.();
      } catch {}

      wcProvider = await window.EthereumProvider.init({
        projectId: WC_PROJECT_ID,
        chains: [SEPOLIA_ID],
        showQrModal: true,
        rpcMap: { [SEPOLIA_ID]: READ_RPCS[0] },
        optionalMethods: [
          'eth_signTypedData',
          'personal_sign',
          'wallet_switchEthereumChain',
          'wallet_addEthereumChain',
        ],
        optionalEvents: ['accountsChanged', 'chainChanged', 'disconnect'],
        metadata: {
          name: 'CPEG Launchpad',
          description: 'Buy CPEG with USDC',
          url: location.origin,
          icons: [],
        },
      });

      await wcProvider.connect();
      reqProv = wcProvider;

      try {
        await ensureSepolia(reqProv);
      } catch (e) {
        console.warn(e);
      }

      provider = new ethers.BrowserProvider(wcProvider, 'any');
      signer = await provider.getSigner();
      me = await signer.getAddress();

      $('addr').textContent = me;
      $('net').textContent = 'Sepolia';
      setConnUI(true);
      await refresh(true);

      wcProvider.on('accountsChanged', async (a) => {
        me = (a && a[0]) || null;
        $('addr').textContent = me || '未接続';
        await refresh(!!me).catch(() => {});
      });
      wcProvider.on('chainChanged', () => location.reload());
      wcProvider.on('disconnect', () => cleanupConnection());
    } catch (e) {
      console.error('[connect] failed', e);
      $('msg').innerHTML = `<span class="danger">Connect error:</span> ${
        e?.shortMessage || e?.message || e
      }`;
      if (isMobile) showMMDeepLink(true);
    }
  };

  // ====== Buy ======
  $('buy').onclick = async () => {
    try {
      $('msg').textContent = '';
      if (!signer) throw new Error('先にウォレットを接続してください');
      await ensureSepolia(reqProv);

      const input = $('usdcIn').value || '0';
      const amount = ethers.parseUnits(input, 6);
      if (amount <= 0n) throw new Error('USDC 金額を入力してください');

      const lp = new ethers.Contract(LP_ADDR, LP_ABI, signer);
      const usdc = new ethers.Contract(USDC_ADDR, ERC20_ABI, signer);

      const cur = await usdc.allowance(me, LP_ADDR);
      if (cur < amount) {
        $('msg').textContent = 'Approving USDC...';
        const txA = await usdc.approve(LP_ADDR, amount);
        $(
          'msg'
        ).innerHTML = `Approve tx: <a href="${EXPLORER}/tx/${txA.hash}" target="_blank">${txA.hash}</a>`;
        await txA.wait();
      }

      $('msg').textContent = 'Buying CPEG...';
      const txB = await lp.buyWithUSDC(amount);
      $(
        'msg'
      ).innerHTML = `Buy tx: <a href="${EXPLORER}/tx/${txB.hash}" target="_blank">${txB.hash}</a>`;
      await txB.wait();

      $('msg').innerHTML += "<br><span class='ok'>✅ Completed</span>";
      await refresh(true);
    } catch (e) {
      console.error('[buy] failed', e);
      $('msg').innerHTML = `<span class="danger">Error:</span> ${
        e?.shortMessage || e?.message || e
      }`;
    }
  };

  // ====== Disconnect ======
  function cleanupConnection() {
    signer = null;
    me = null;
    try {
      reqProv = null;
    } catch {}
    try {
      wcProvider?.disconnect?.();
    } catch {}
    provider = new ethers.JsonRpcProvider(READ_RPCS[0]);
    $('addr').textContent = '未接続';
    $('net').textContent = 'Sepolia';
    setConnUI(false);
  }

  document.getElementById('disconnect')?.addEventListener('click', async () => {
    cleanupConnection();
    await refresh(false).catch(() => {});
  });
  document.getElementById('disconnectHeader')?.addEventListener('click', () => {
    document.getElementById('disconnect')?.click();
  });

  // ====== 初期化 ======
  $('year').textContent = new Date().getFullYear();
  setConnUI(false);
  refresh();
  setInterval(() => refresh(!!signer).catch(() => {}), 25000);

  if (window.ethereum) {
    ethereum.on?.('chainChanged', () => location.reload());
    ethereum.on?.('accountsChanged', async () => {
      try {
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner().catch(() => null);
        me = signer ? await signer.getAddress() : null;
        $('addr').textContent = me || '未接続';
        setConnUI(!!me);
        await refresh(!!me);
      } catch {}
    });
  }

  console.log(
    '[boot] ethers',
    ethers.version,
    'LP',
    LP_ADDR,
    'USDC',
    USDC_ADDR
  );
})();
