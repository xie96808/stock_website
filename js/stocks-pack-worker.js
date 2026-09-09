/* Parse stocks pack off the main thread; persist raw text to IndexedDB for repeat visits. */
var IDB_NAME = 'stockgame-pack';
var IDB_VER = 1;
var STORE = 'packs';

function openDb() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('idb open failed')); };
  });
}

function idbPut(record) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('idb put failed')); };
      tx.objectStore(STORE).put(record);
    });
  });
}

function parseText(text) {
  var trimmed = text.replace(/^\uFEFF/, '').trim();
  var pack;
  if (trimmed.charAt(0) === '[' || trimmed.charAt(0) === '{') {
    pack = JSON.parse(trimmed);
  } else {
    pack = new Function(trimmed + '\nreturn STOCKS_DATA;')();
  }
  if (!Array.isArray(pack) || pack.length === 0) {
    throw new Error('empty pack');
  }
  return pack;
}

self.onmessage = function (ev) {
  var payload = ev.data || {};
  var mode = payload.mode || 'parse';
  try {
    var text = payload.text;
    if (typeof text !== 'string' || !text.length) {
      throw new Error('empty pack text');
    }
    var pack = parseText(text);
    var cacheKey = payload.cacheKey || '';
    var meta = payload.meta || {};

    function done(cached, cacheError) {
      self.postMessage({
        ok: true,
        pack: pack,
        cached: !!cached,
        count: pack.length,
        cacheError: cacheError || undefined,
      });
    }

    if (cacheKey && typeof indexedDB !== 'undefined' && (mode === 'parseAndKeep' || mode === 'parse')) {
      idbPut({
        key: cacheKey,
        text: text,
        meta: meta,
        savedAt: Date.now(),
      }).then(function () {
        done(true);
      }).catch(function (err) {
        done(false, String((err && err.message) || err));
      });
      return;
    }

    done(false);
  } catch (err) {
    self.postMessage({
      ok: false,
      error: String((err && err.message) || err || 'pack parse failed'),
    });
  }
};
