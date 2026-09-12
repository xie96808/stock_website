#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const runs = [
  ["node", ["--test", "tests/engine/engine.test.js", "tests/engine/equity-curve.test.js", "tests/engine/puzzle-engine.test.js", "tests/cloud-draft.test.js", "tests/screen-router.test.js", "tests/analysis-pure.test.js", "tests/kline-option.test.js", "tests/game-session.test.js", "tests/pack-url.test.js", "tests/time.test.js", "tests/puzzle-chapter-ui.test.js"]],
  // Separate processes so in-memory rate-limit / config mutations do not leak across suites.
  ["node", ["--test", "server/tests/auth.integration.test.js"]],
  ["node", ["--test", "server/tests/games.integration.test.js"]],
  ["node", ["--test", "server/tests/leaderboard.integration.test.js"]],
  ["node", ["--test", "server/tests/admin.integration.test.js"]],
  ["node", ["--test", "server/tests/announcements.integration.test.js"]],
  ["node", ["--test", "server/tests/jiu-coin.integration.test.js"]],
  ["node", ["--test", "server/tests/reward-claims.integration.test.js"]],
  ["node", ["--test", "server/tests/quiz-rewards.integration.test.js"]],
  ["node", ["--test", "server/tests/daily-challenge.integration.test.js"]],
  ["node", ["--test", "server/tests/event-protocol-off.integration.test.js"]],
  ["node", ["--test", "server/tests/event-protocol.integration.test.js"]],
  ["node", ["--test", "server/tests/game-rewind.integration.test.js"]],
  ["node", ["--test", "server/tests/game-rewind-off.integration.test.js"]],
  ["node", ["--test", "server/tests/puzzle-chapter.integration.test.js"]],
  ["node", ["--test", "server/tests/puzzle-chapter-off.integration.test.js"]],
  ["node", ["--test", "server/tests/backup.integration.test.js"]],
  ["node", ["--test", "server/tests/ops-flags.integration.test.js"]],
  ["node", ["--test", "server/tests/phase0.integration.test.js"]],
];
for (const [cmd, args] of runs) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status) process.exit(r.status ?? 1);
}
console.log("all suites green");
