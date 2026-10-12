import http from "node:http";
import { config } from "./lib/config.js";
import { createApp } from "./app.js";
import { openDb } from "./db/connection.js";
import { expireDueReady, expirePendingChallenges } from "./lib/pvp/challenges.js";
import { tickBots } from "./lib/pvp/bots.js";
import { pruneHeartbeats, scanDueMatches } from "./lib/pvp/match.js";
import { prunePresence } from "./lib/pvp/presence.js";
import { attachPvpRealtime, noteLobbyChanged, noteMatchChanged, sweepPvpTickets } from "./lib/pvp/realtime.js";

const app = createApp({ skipStatic: config.skipStatic });
const server = http.createServer(app);
attachPvpRealtime(server);

const scanTimer = setInterval(() => {
  try {
    const db = openDb();
    const now = Date.now();
    const expiredChallenges = expirePendingChallenges(db, now);
    const readyRows = expireDueReady(db, now);
    for (const row of readyRows) {
      if (row.matchId) noteMatchChanged(row.matchId);
    }
    if (expiredChallenges || readyRows.length) noteLobbyChanged();
    const botRows = tickBots(db, now);
    for (const row of botRows) {
      if (row.matchId && row.ok) noteMatchChanged(row.matchId);
    }
    const rows = scanDueMatches(db, now);
    for (const row of rows) {
      if (row.advanced || row.finished) noteMatchChanged(row.matchId);
    }
    sweepPvpTickets(now);
    prunePresence(now);
    pruneHeartbeats(now);
  } catch (err) {
    console.error("pvp scan failed:", err && err.message ? err.message : err);
  }
}, 1000);
scanTimer.unref();

server.listen(config.port, "127.0.0.1", () => {
  console.log(`stockgame server on http://127.0.0.1:${config.port}`);
  console.log(`static root: ${config.skipStatic ? "(disabled)" : (config.staticRoot || "(repo root)")}`);
});
