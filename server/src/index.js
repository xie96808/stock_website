import http from "node:http";
import { config } from "./lib/config.js";
import { createApp } from "./app.js";
import { openDb } from "./db/connection.js";
import { scanDueMatches } from "./lib/pvp/match.js";
import { attachPvpRealtime, noteMatchChanged } from "./lib/pvp/realtime.js";

const app = createApp({ skipStatic: config.skipStatic });
const server = http.createServer(app);
attachPvpRealtime(server);

const scanTimer = setInterval(() => {
  try {
    const rows = scanDueMatches(openDb(), Date.now());
    for (const row of rows) {
      if (row.advanced || row.finished) noteMatchChanged(row.matchId);
    }
  } catch (err) {
    console.error("pvp scan failed:", err && err.message ? err.message : err);
  }
}, 1000);
scanTimer.unref();

server.listen(config.port, "127.0.0.1", () => {
  console.log(`stockgame server on http://127.0.0.1:${config.port}`);
  console.log(`static root: ${config.skipStatic ? "(disabled)" : (config.staticRoot || "(repo root)")}`);
});
