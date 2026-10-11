// Read-only baseline experiment. Extracts three files from the reviewed Git SHA
// into an isolated temporary directory. It does not change application sources.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const revision = 'fb13936984ae9166d58fa2bdc72423aee445933e';
const dir = mkdtempSync(join(tmpdir(), 'pvp-engine-probe-'));
try {
  mkdirSync(join(dir, 'shared'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  for (const f of ['rules.js', 'engine.js', 'equityCurve.js']) {
    writeFileSync(join(dir, 'shared', f), execFileSync('git', ['show', `${revision}:shared/${f}`], {cwd: repo}));
  }
  const { replayGame, settleGame, roundHalfUp } = await import(pathToFileURL(join(dir, 'shared/engine.js')));
  const { buildEquityCurveCash } = await import(pathToFileURL(join(dir, 'shared/equityCurve.js')));
  const bars = Array.from({length:30}, () => ({open:10, high:10, low:10, close:10}));
  bars[1] = {open:20, high:22, low:20, close:22};
  const before = replayGame({fillMode:'next_open', bars, actions:['buy'], finish:false});
  const curve = buildEquityCurveCash({fillMode:'next_open', bars, actions:['buy'], finish:false});
  const after = roundHalfUp((curve.at(-1) / 100000 - 1) * 1e6);
  assert.equal(before.returnPpm, -500000);
  assert.equal(after, 100000);
  console.log(`PASS MTM_ADAPTER baseline=${before.returnPpm} proposed=${after}`);
  assert.equal(replayGame({fillMode:'next_open', bars, actions:['buy','sell']}).ok, true);
  console.log('PASS T_PLUS_ONE next_open buy(d1)->sell(d2) is legal');
  const actions = ['buy', ...Array(28).fill('hold')];
  const settled = settleGame({fillMode:'next_open', bars, actions});
  const finalCurve = buildEquityCurveCash({fillMode:'next_open',bars,actions,finish:true});
  assert.equal(settled.returnPpm, roundHalfUp((finalCurve.at(-1)/100000-1)*1e6));
  console.log('PASS FINAL_CURVE_EQUALS_SETTLEMENT');
  const old = Math.floor((1000-700)/100);
  const proposed = Math.floor((1000-700)/100)+1;
  assert.equal(old, 3); assert.equal(proposed, 4);
  assert.equal(Math.floor((1132-700)/100)+1, 5);
  console.log(`PASS RATING_BOUNDARY baseline_level=${old} proposed_level=${proposed} level_at_1132=5`);
  console.log('NOTE: proposed adapter/formula tested as isolated expressions, not implemented PvP.');
} finally {
  rmSync(dir, {recursive:true, force:true});
}
