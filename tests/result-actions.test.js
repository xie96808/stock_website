import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const resultJs = readFileSync(new URL('../js/result.js', import.meta.url), 'utf8');
const shareJs = readFileSync(new URL('../js/result-share.js', import.meta.url), 'utf8');

const block = html.slice(html.indexOf('class="result-actions"'), html.indexOf('result-share-hint'));

test('result actions keep every original handler/id and gain an icon + label span', () => {
    for (const needle of [
        'onclick="playAgain()"',
        'id="resultShareImageBtn"', 'onclick="saveResultShareImage()"',
        'id="resultLeaderboardBtn"', 'onclick="openResultLeaderboard()"',
    ]) assert.ok(block.includes(needle), `missing ${needle}`);
    const buttons = block.match(/<button[\s\S]*?<\/button>/g) || [];
    assert.equal(buttons.length, 3, '返回首页 moved to the fixed top bar (返回主页)');
    assert.ok(!block.includes('onclick="resetGame()"'));
    assert.ok(!block.includes('resultShareCopyBtn'), '复制文案 removed');
    for (const b of buttons) {
        assert.ok(b.includes('<svg class="result-act__icon"'), 'icon');
        assert.ok(b.includes('<span class="ctl-label">'), 'label span');
    }
});

test('playAgain stays the first .play-again-btn (result.js picks it via querySelector)', () => {
    assert.ok(block.indexOf('playAgain()') < block.indexOf('saveResultShareImage()'));
    assert.equal((block.match(/class="play-again-btn/g) || []).length, 3);
    assert.ok(block.indexOf('class="play-again-btn result-act result-act--primary') < block.indexOf('result-act ctl ctl-secondary'));
});

test('result.js relabels via the label span, never wiping icons with textContent on the button', () => {
    assert.ok(!/(playBtn|lbBtn)\.textContent\s*=/.test(resultJs));
    assert.ok(resultJs.includes('setBtnLabel('));
});

test('保存图片 no longer depends on a CDN script and has a hard timeout', () => {
    assert.ok(!/cdn\.jsdelivr\.net/.test(shareJs));
    assert.ok(shareJs.includes("import('./vendor/html2canvas.esm.js')"));
    assert.ok(shareJs.includes('withTimeout('));
    assert.ok(!/\balert\(/.test(shareJs));
});
