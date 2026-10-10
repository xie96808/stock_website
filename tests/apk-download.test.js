import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APK_DOWNLOAD_HREF,
  hasStockGameAppBridge,
  isAppleTouchDevice,
  apkDownloadMode,
  applyApkDownloadEntry,
} from '../js/apk-download.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

test('APK href is the stable /download/stockgame.apk path', () => {
  assert.equal(APK_DOWNLOAD_HREF, '/download/stockgame.apk');
});

test('hasStockGameAppBridge detects window.StockGameApp', () => {
  assert.equal(hasStockGameAppBridge({}), false);
  assert.equal(hasStockGameAppBridge({ StockGameApp: { setTheme() {} } }), true);
  assert.equal(hasStockGameAppBridge(undefined), false);
});

test('isAppleTouchDevice covers iPhone/iPad and iPadOS desktop UA', () => {
  assert.equal(isAppleTouchDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5), true);
  assert.equal(isAppleTouchDevice('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', 5), true);
  assert.equal(
    isAppleTouchDevice(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      5,
    ),
    true,
  );
  assert.equal(
    isAppleTouchDevice(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      0,
    ),
    false,
  );
  assert.equal(
    isAppleTouchDevice(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile',
      5,
    ),
    false,
  );
  assert.equal(
    isAppleTouchDevice(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      0,
    ),
    false,
  );
});

test('apkDownloadMode: app hidden, iOS hint, else download', () => {
  assert.equal(
    apkDownloadMode({ hasAppBridge: true, userAgent: 'iPhone', maxTouchPoints: 5 }),
    'hidden',
  );
  assert.equal(
    apkDownloadMode({
      hasAppBridge: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    }),
    'ios-hint',
  );
  assert.equal(
    apkDownloadMode({
      hasAppBridge: false,
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile',
      maxTouchPoints: 5,
    }),
    'download',
  );
  assert.equal(
    apkDownloadMode({
      hasAppBridge: false,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      maxTouchPoints: 0,
    }),
    'download',
  );
});

test('applyApkDownloadEntry toggles nodes by mode', () => {
  const nodes = {
    apkDownloadEntry: { hidden: true },
    apkDownloadLink: { hidden: false },
    apkDownloadTip: { hidden: false },
    apkIosHint: { hidden: true },
  };
  const doc = {
    getElementById(id) {
      return nodes[id] || null;
    },
  };

  assert.equal(
    applyApkDownloadEntry(doc, { hasAppBridge: true, userAgent: 'Android', maxTouchPoints: 5 }),
    'hidden',
  );
  assert.equal(nodes.apkDownloadEntry.hidden, true);

  assert.equal(
    applyApkDownloadEntry(doc, {
      hasAppBridge: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    }),
    'ios-hint',
  );
  assert.equal(nodes.apkDownloadEntry.hidden, false);
  assert.equal(nodes.apkDownloadLink.hidden, true);
  assert.equal(nodes.apkDownloadTip.hidden, true);
  assert.equal(nodes.apkIosHint.hidden, false);

  assert.equal(
    applyApkDownloadEntry(doc, {
      hasAppBridge: false,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      maxTouchPoints: 0,
    }),
    'download',
  );
  assert.equal(nodes.apkDownloadEntry.hidden, false);
  assert.equal(nodes.apkDownloadLink.hidden, false);
  assert.equal(nodes.apkDownloadTip.hidden, false);
  assert.equal(nodes.apkIosHint.hidden, true);
});

test('index.html wires download link + applyApkDownloadEntry', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="apkDownloadEntry"/);
  assert.match(html, /href="\/download\/stockgame\.apk"[^>]*download/);
  assert.match(html, /下载安卓 App/);
  assert.match(html, /应用到主屏幕|添加到主屏幕/);
  assert.match(html, /from '\.\/js\/apk-download\.js'/);
  assert.match(html, /applyApkDownloadEntry\(\)/);
});

test('nginx conf has /download/ alias before version.json', () => {
  const conf = fs.readFileSync(
    path.join(ROOT, 'deploy/nginx-stockgame.xieyw.top.conf'),
    'utf8',
  );
  const dl = conf.indexOf('location ^~ /download/');
  const ver = conf.indexOf('location = /version.json');
  assert.ok(dl > 0, 'missing /download/ location');
  assert.ok(ver > dl, '/download/ must precede version.json');
  assert.match(conf, /alias \/srv\/stock-website\/downloads\/;/);
});
