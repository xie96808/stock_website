import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../js/pvp/room.js', import.meta.url), 'utf8');
function composer() {
  const nodes = Object.fromEntries(['pvpMsgInput', 'pvpMsgSend', 'pvpMsgCount', 'pvpMsgStatus', 'pvpMsgPicker'].map(id => [id, {
    value: '', hidden: false, textContent: '', attrs: {}, focus() { this.focused = true; },
    setAttribute(k, v) { this.attrs[k] = v; },
  }]));
  let resolve;
  const context = vm.createContext({
    document: { getElementById: id => nodes[id], querySelectorAll: () => [] },
    view: { status: 'playing' }, matchId: 'room-a',
    window: { clearTimeout() {}, setTimeout() {} },
    pvpFetch: () => new Promise(r => { resolve = r; }),
    setText: (id, text) => { if (nodes[id]) nodes[id].textContent = text; },
  });
  vm.runInContext(source.slice(source.indexOf('const PRESET_TAUNT_MS'), source.indexOf('function wireRoom()')), context);
  return { nodes, run: code => vm.runInContext(code, context), finish: () => resolve({}) };
}

test('composer counts Unicode codepoints and disables overlong / blank messages', () => {
  const c = composer();
  c.nodes.pvpMsgInput.value = '🙂'.repeat(32);
  c.run('updateCustomTauntControls()');
  assert.equal(c.nodes.pvpMsgCount.textContent, '32/32');
  assert.equal(c.nodes.pvpMsgSend.disabled, false);
  c.nodes.pvpMsgInput.value += '字';
  c.run('updateCustomTauntControls()');
  assert.equal(c.nodes.pvpMsgSend.disabled, true);
  assert.equal(c.nodes.pvpMsgInput.attrs['aria-invalid'], 'true');
  c.nodes.pvpMsgInput.value = '   ';
  c.run('updateCustomTauntControls()');
  assert.equal(c.nodes.pvpMsgSend.disabled, true);
});

test('successful send keeps composer open and clears only the submitted draft', async () => {
  const c = composer();
  c.nodes.pvpMsgInput.value = '你好';
  const pending = c.run('sendCustomTaunt()');
  assert.equal(c.nodes.pvpMsgSend.disabled, true);
  c.finish(); await pending;
  assert.equal(c.nodes.pvpMsgInput.value, '');
  assert.equal(c.nodes.pvpMsgPicker.hidden, false);
  assert.equal(c.nodes.pvpMsgInput.focused, true);
  assert.equal(c.nodes.pvpMsgStatus.textContent, '已发送');
});

test('new draft typed while sending survives the response', async () => {
  const c = composer();
  c.nodes.pvpMsgInput.value = '第一条';
  const pending = c.run('sendCustomTaunt()');
  c.nodes.pvpMsgInput.value = '接着聊';
  c.finish(); await pending;
  assert.equal(c.nodes.pvpMsgInput.value, '接着聊');
  assert.equal(c.nodes.pvpMsgSend.disabled, false);
});

test('old room response never clears the new room draft', async () => {
  const c = composer();
  c.nodes.pvpMsgInput.value = '第一条';
  const pending = c.run('sendCustomTaunt()');
  c.run('matchId = "room-b"; customTauntSending = true');
  c.nodes.pvpMsgInput.value = '新对局';
  c.finish(); await pending;
  assert.equal(c.nodes.pvpMsgInput.value, '新对局');
  assert.equal(c.run('customTauntSending'), true);
});

test('message panel retains original art controls and ordering with four presets', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const panel = html.split('id="pvpMsgPicker"')[1].split('id="pvpTauntPicker"')[0];
  assert.equal((panel.match(/class="pvp-msg-line(?: [^"]*)?"/g) || []).length, 4);
  assert.doesNotMatch(panel, /进厂打螺丝|啥都拿不住/);
  assert.ok(panel.indexOf('class="pvp-msg-line') < panel.indexOf('id="pvpMsgInput"'));
  assert.doesNotMatch(panel, /pvp-msg-heading|pvp-msg-presets/);
  assert.match(panel, /pvp-msg-send ctl ctl-secondary/);
  assert.match(panel, /pvp-msg-input ctl-input/);
  assert.match(panel, /pvp-msg-shortcuts/);
  const css = readFileSync(new URL('../../css/pvp.css', import.meta.url), 'utf8');
  assert.match(css, /#pvpMsgPicker \.pvp-msg-send\.ctl\s*\{[^}]*width: 72px/);

});

test('quick preset leaves a typed custom draft intact', async () => {
  const c = composer();
  c.nodes.pvpMsgInput.value = '还在编辑';
  const pending = c.run('sendCustomTaunt("买买买")');
  c.finish(); await pending;
  assert.equal(c.nodes.pvpMsgInput.value, '还在编辑');
});
