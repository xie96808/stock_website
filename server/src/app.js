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
import gamesRoutes, { gamesConfigPayload, warmDataset } from "./routes/games.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

export function createApp({ skipMigrate = false, skipStatic = false } = {}) {
  if (!skipMigrate) migrate();
  warmDataset();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use(attachRequestId);
  app.use(loadSession);
  app.use(checkOrigin);

  app.get("/api/v1/health/live", (req, res) => ok(res, { status: "live" }));
  app.get("/api/v1/health/ready", (req, res) => {
    try {
      const cfg = gamesConfigPayload();
      if (!cfg.datasetVersion) return fail(res, 503, "NOT_READY", "行情数据不可用");
      return ok(res, { status: "ready", datasetVersion: cfg.datasetVersion });
    } catch (e) {
      return fail(res, 503, "NOT_READY", String(e.message || e));
    }
  });
  app.get("/api/v1/config", (req, res) => ok(res, gamesConfigPayload()));

  app.use("/api/v1", (req, res, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && req.sessionToken) {
      return requireCsrf(req, res, next);
    }
    next();
  }, authRoutes, gamesRoutes);

  app.use("/api", (req, res) => fail(res, 404, "NOT_FOUND", "接口不存在"));

  if (!skipStatic) {
    const staticRoot = config.staticRoot || repoRoot;
    app.use(express.static(staticRoot, { index: "index.html", fallthrough: true }));
    app.get(/^(?!\/api).*/, (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(staticRoot, "index.html"), (err) => (err ? next(err) : undefined));
    });
  }

  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    fail(res, 500, "INTERNAL", "服务器错误");
  });

  return app;
}
