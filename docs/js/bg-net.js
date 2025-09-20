(() => {
  const host = document.getElementById('bg-net');
  if (!host) return;

  // キャンバス生成
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  host.appendChild(canvas);

  let dpr = Math.min(2, window.devicePixelRatio || 1);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // 点群を用意
  const N = 90; // 粒子数（多くすると賑やかに）
  const pts = Array.from({ length: N }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() * 2 - 1) * 0.25 * dpr,
    vy: (Math.random() * 2 - 1) * 0.25 * dpr,
    c:
      Math.random() < 0.5
        ? '#6ea8fe'
        : Math.random() < 0.5
        ? '#9b8cff'
        : '#64dfdf',
  }));
  const linkDist = 160 * dpr;

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 線
    ctx.lineWidth = 1 * dpr;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const d = Math.hypot(dx, dy);
        if (d < linkDist) {
          const a = 1 - d / linkDist; // 距離で透明度
          ctx.strokeStyle = 'rgba(42,51,85,' + (0.25 + 0.55 * a) + ')';
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }

    // 点
    for (const p of pts) {
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6 * dpr, 0, Math.PI * 2);
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
    }

    requestAnimationFrame(tick);
  }
  tick();
})();
