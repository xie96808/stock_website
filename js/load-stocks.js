export function attachDeferredStart(startGame, gameState) {
  let packPromise = null;
  let locked = false;

  function readPack() {
    try {
      if (typeof STOCKS_DATA !== 'undefined') return STOCKS_DATA;
    } catch (err) {}
    return window.STOCKS_DATA;
  }

  function ready() {
    const pack = readPack();
    return Array.isArray(pack) && pack.length > 0;
  }

  function apply() {
    const pack = readPack();
    gameState.stocksData = pack;
    window.STOCKS_DATA = pack;
    console.log('Loaded ' + gameState.stocksData.length + ' stocks');
  }

  function loadPack() {
    if (ready()) {
      apply();
      return Promise.resolve();
    }
    if (packPromise) return packPromise;
    const tag = 'scr' + 'ipt';
    packPromise = new Promise(function (resolve, reject) {
      const el = document.createElement(tag);
      el.src = 'data/stocks_data.js';
      el.async = true;
      el.onload = function () {
        if (ready()) {
          apply();
          resolve();
        } else {
          reject(new Error('empty pack'));
        }
      };
      el.onerror = function () {
        reject(new Error('network'));
      };
      document.head.appendChild(el);
    });
    return packPromise;
  }

  window.startGame = function () {
    if (locked) return;
    if (ready()) {
      apply();
      startGame();
      return;
    }
    locked = true;
    const btn = document.querySelector('.arena-btn');
    if (btn) btn.disabled = true;
    loadPack()
      .then(function () {
        locked = false;
        if (btn) btn.disabled = false;
        startGame();
      })
      .catch(function (err) {
        locked = false;
        if (btn) btn.disabled = false;
        console.error(err);
        window.alert('\u80a1\u7968\u6570\u636e\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5');
      });
  };

  loadPack().catch(function (err) {
    console.error(err);
  });
}
