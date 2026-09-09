#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const runs = [
  ["node", ["--test", "tests/engine/engine.test.js", "tests/cloud-draft.test.js"]],
  // Separate processes so in-memory rate-limit / config mutations do not leak across suites.
  ["node", ["--test", "server/tests/auth.integration.test.js"]],
  ["node", ["--test", "server/tests/games.integration.test.js"]],
  ["node", ["--test", "server/tests/leaderboard.integration.test.js"]],
  ["node", ["--test", "server/tests/admin.integration.test.js"]],
  ["node", ["--test", "server/tests/backup.integration.test.js"]],
  ["node", ["--test", "server/tests/ops-flags.integration.test.js"]],
  ["node", ["--test", "server/tests/phase0.integration.test.js"]],
];
for (const [cmd, args] of runs) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status) process.exit(r.status ?? 1);
}
console.log("all suites green");
