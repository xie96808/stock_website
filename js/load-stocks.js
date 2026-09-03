export function attachDeferredStart(startGame, gameState) {
  let packPromise = null;
  let locked = false;

  function ready() {
    return Array.isArray(window.STOCKS_DATA) && window.STOCKS_DATA.length > 0;
  }

  function apply() {
    gameState.stocksData = window.STOCKS_DATA;
    console.log('Loaded ' + gameState.stocksData.length + ' stocks');
  }

  function loadPack() {
    if (ready()) {
      apply();
      return Promise.resolve();
    }
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
        apply();
      })
      .catch(function (err) {
        packPromise = null;
        throw err;
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
