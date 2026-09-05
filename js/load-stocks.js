export function attachDeferredStart(startGame, gameState) {
  let locked = false;

  function modalEl() {
    return document.getElementById('fillModeModal');
  }

  function choosePane() {
    return document.getElementById('fillModeChoosePane');
  }

  function loadingPane() {
    return document.getElementById('fillModeLoadingPane');
  }

  function titleEl() {
    return document.getElementById('fillModeDialogTitle');
  }

  function setProgress(pct, tip) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    const fill = document.getElementById('fillLoadFill');
    const bar = document.getElementById('fillLoadBar');
    const pctEl = document.getElementById('fillLoadPct');
    const tipEl = document.getElementById('fillLoadTip');
    if (fill) fill.style.width = p + '%';
    if (bar) bar.setAttribute('aria-valuenow', String(p));
    if (pctEl) pctEl.textContent = p + '%';
    if (tipEl && tip) tipEl.textContent = tip;
  }

  function showChooseView() {
    const choose = choosePane();
    const loading = loadingPane();
    const title = titleEl();
    if (choose) choose.hidden = false;
    if (loading) loading.hidden = true;
    if (title) title.textContent = '选择成交方式';
    setProgress(0, '股票资源加载中…');
    const modal = modalEl();
    if (modal) modal.classList.remove('is-loading');
  }

  function showLoadingView() {
    const choose = choosePane();
    const loading = loadingPane();
    const title = titleEl();
    if (choose) choose.hidden = true;
    if (loading) loading.hidden = false;
    if (title) title.textContent = '正在开局';
    const modal = modalEl();
    if (modal) modal.classList.add('is-loading');
    setProgress(4, '股票资源加载中…');
  }

  function openModal() {
    const modal = modalEl();
    if (!modal) return;
    showChooseView();
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    // Warm pack while user picks a mode (no progress UI yet).
    ensureStocksLoaded(gameState).catch(function (err) {
      console.error(err);
    });
    const first = modal.querySelector('input[name="fillMode"]:checked');
    if (first) first.focus();
  }

  function closeModal() {
    const modal = modalEl();
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    showChooseView();
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function animateTo(targetPct, tip, ms) {
    return new Promise(function (resolve) {
      const fill = document.getElementById('fillLoadFill');
      const startPct = fill ? (parseFloat(fill.style.width) || 0) : 0;
      const from = Number.isFinite(startPct) ? startPct : 0;
      const to = Math.max(from, targetPct);
      const t0 = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - t0) / Math.max(1, ms));
        const eased = 1 - Math.pow(1 - t, 2);
        setProgress(from + (to - from) * eased, tip);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  window.startGame = function () {
    if (locked) return;
    openModal();
  };

  window.cancelFillModeModal = function () {
    if (locked) return;
    closeModal();
  };

  window.confirmFillModeAndStart = function () {
    if (locked) return;
    locked = true;
    showLoadingView();

    const run = async function () {
      setProgress(6, '股票资源加载中…');
      if (ready()) {
        await animateTo(62, '股票资源加载中…', 480);
      } else {
        await ensureStocksLoaded(gameState, function (ratio) {
          setProgress(6 + Math.max(0, Math.min(1, ratio)) * 56, '股票资源加载中…');
        });
        await animateTo(66, '股票资源加载中…', 160);
      }

      await animateTo(80, '标的筛选中…', 560);
      await animateTo(88, '标的筛选中…', 240);

      await animateTo(94, '初始化模拟盘…', 280);
      await startGame();

      const game = document.getElementById('gameScreen');
      if (!(game && game.classList.contains('active'))) {
        throw new Error('game screen inactive');
      }
      setProgress(100, '即将进入…');
      await delay(220);
      closeModal();
    };

    run()
      .catch(function (err) {
        console.error(err);
        showChooseView();
        window.alert('股票数据加载失败，请刷新后重试');
      })
      .finally(function () {
        locked = false;
      });
  };

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const modal = modalEl();
    if (modal && !modal.hidden) window.cancelFillModeModal();
  });

  // Prefetch pack on page load so confirm rarely waits on network.
  ensureStocksLoaded(gameState).catch(function (err) {
    console.error(err);
  });
}

let packPromise = null;

function ready() {
  return Array.isArray(window.STOCKS_DATA) && window.STOCKS_DATA.length > 0;
}

function apply(gameState) {
  if (!gameState) return;
  gameState.stocksData = window.STOCKS_DATA;
}

function decodeChunks(chunks) {
  let total = 0;
  for (let i = 0; i < chunks.length; i++) total += chunks[i].length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    merged.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return new TextDecoder('utf-8').decode(merged);
}

function loadPack(onProgress) {
  if (ready()) {
    if (onProgress) onProgress(1);
    return Promise.resolve();
  }
  if (packPromise) {
    // Another caller already fetching — still emit progress when done.
    return packPromise.then(function () {
      if (onProgress) onProgress(1);
    });
  }

  packPromise = fetch('data/stocks_data.js')
    .then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      const total = Number(res.headers.get('content-length')) || 0;
      if (!res.body || !total || !res.body.getReader) {
        return res.text().then(function (text) {
          if (onProgress) onProgress(1);
          return text;
        });
      }
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            if (onProgress) onProgress(1);
            return decodeChunks(chunks);
          }
          chunks.push(result.value);
          received += result.value.length;
          if (onProgress) onProgress(Math.min(0.98, received / total));
          return pump();
        });
      }
      return pump();
    })
    .then(function (text) {
      const pack = new Function(text + '\nreturn STOCKS_DATA;')();
      if (!Array.isArray(pack) || pack.length === 0) {
        throw new Error('empty pack');
      }
      window.STOCKS_DATA = pack;
      return pack;
    })
    .catch(function (err) {
      packPromise = null;
      throw err;
    });

  return packPromise;
}

export function ensureStocksLoaded(gameState, onProgress) {
  return loadPack(onProgress).then(function () {
    apply(gameState);
    if (gameState && Array.isArray(gameState.stocksData)) {
      console.log('Loaded ' + gameState.stocksData.length + ' stocks');
    }
    if (onProgress) onProgress(1);
  });
}
