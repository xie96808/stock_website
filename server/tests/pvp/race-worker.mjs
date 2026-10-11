import { parentPort, workerData } from "node:worker_threads";

const { openDb } = await import("../../src/db/connection.js");
const { forfeitMatch, resolveIfDue } = await import("../../src/lib/pvp/match.js");

try {
  const db = openDb();
  const result = workerData.op === "forfeit"
    ? forfeitMatch(db, workerData.args)
    : resolveIfDue(db, workerData.args);
  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({ ok: false, message: String(err && err.message ? err.message : err) });
}
