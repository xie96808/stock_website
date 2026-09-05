export function attachDeferredStart(startGame, gameState) {
  let locked = false;

  function modalEl() {
    return document.getElementById('fillModeModal');
  }

  function statusEl() {
    return document.getElementById('fillModeStatus');
  }

  function setStatus(text) {
    const el = statusEl();
    if (el) el.textContent = text || '';
  }

  function openModal() {
    const modal = modalEl();
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    setStatus(ready() ? '数据已就绪' : '正在准备行情数据…');
    // Keep warming the pack while the user picks a mode.
    ensureStocksLoaded(gameState)
      .then(function () { setStatus('数据已就绪'); })
      .catch(function (err) {
        console.error(err);
        setStatus('数据加载失败，仍可重试开始');
      });
    const first = modal.querySelector('input[name="fillMode"]:checked');
    if (first) first.focus();
  }

  function closeModal() {
    const modal = modalEl();
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    setStatus('');
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
    const confirmBtn = document.getElementById('fillModeConfirmBtn');
    const prevLabel = confirmBtn ? confirmBtn.textContent : '';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '准备中…';
    }
    setStatus(ready() ? '正在开局…' : '正在加载行情数据…');

    Promise.resolve()
      .then(function () { return ensureStocksLoaded(gameState); })
      .then(function () { return startGame(); })
      .then(function () {
        const game = document.getElementById('gameScreen');
        if (game && game.classList.contains('active')) {
          closeModal();
        } else {
          setStatus('开局未完成，请重试');
        }
      })
      .catch(function (err) {
        console.error(err);
        setStatus('开局失败，请重试或刷新页面');
        window.alert('\u80a1\u7968\u6570\u636e\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5');
      })
      .finally(function () {
        locked = false;
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = prevLabel || '\u5f00\u59cb\u6a21\u62df';
        }
      });
  };

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const modal = modalEl();
    if (modal && !modal.hidden) window.cancelFillModeModal();
  });

  // Prefetch pack on page load so the modal rarely waits.
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

function loadPack() {
  if (ready()) return Promise.resolve();
  if (packPromise) return packPromise;
  packPromise = fetch('data/stocks_data.js')
    .then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.text();
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

export function ensureStocksLoaded(gameState) {
  return loadPack().then(function () {
    apply(gameState);
    if (gameState && Array.isArray(gameState.stocksData)) {
      console.log('Loaded ' + gameState.stocksData.length + ' stocks');
    }
  });
}
