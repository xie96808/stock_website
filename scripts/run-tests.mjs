#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const runs = [
  ["node", ["--test", "tests/engine/engine.test.js"]],
  ["node", ["--test", "server/tests/games.integration.test.js", "server/tests/auth.integration.test.js"]],
];
for (const [cmd, args] of runs) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status) process.exit(r.status ?? 1);
}
console.log("all suites green");
