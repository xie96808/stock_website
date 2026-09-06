import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./lib/config.js";
import { migrate } from "./db/migrate.js";
import { ok, fail } from "./lib/http.js";
import {
  attachRequestId, loadSession, checkOrigin, requireCsrf,
} from "./middleware/request.js";
import authRoutes from "./routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const staticRoot = config.staticRoot || repoRoot;

migrate();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use(attachRequestId);
app.use(loadSession);
app.use(checkOrigin);

app.get("/api/v1/health/live", (req, res) => ok(res, { status: "live" }));
app.get("/api/v1/health/ready", (req, res) => ok(res, { status: "ready" }));
app.get("/api/v1/config", (req, res) =>
  ok(res, {
    ruleVersion: "sim30-mtm-v1",
    fillModes: ["next_open", "same_close"],
    avatarCount: 12,
    passwordMinLength: 4,
    features: { cloudGames: false, leaderboard: false, adminPublic: false },
  })
);

app.use("/api/v1", (req, res, next) => {
  // CSRF for authenticated mutating requests; login/register/recover also protected by Origin
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && req.sessionToken) {
    return requireCsrf(req, res, next);
  }
  next();
}, authRoutes);

// unknown API -> JSON 404
app.use("/api", (req, res) => fail(res, 404, "NOT_FOUND", "接口不存在"));

app.use(express.static(staticRoot, { index: "index.html", fallthrough: true }));
app.get(/^(?!\/api).*/, (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(staticRoot, "index.html"), (err) => (err ? next(err) : undefined));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  fail(res, 500, "INTERNAL", "服务器错误");
});

app.listen(config.port, () => {
  console.log(`stockgame server on http://127.0.0.1:${config.port}`);
  console.log(`static root: ${staticRoot}`);
});
