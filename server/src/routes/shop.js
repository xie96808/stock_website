import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import { titleShopEnabled, buyTitle, equipTitle, getTitleState } from "../lib/titles.js";
import { renameCardEnabled, buyRenameCard, getRenameState } from "../lib/renameCards.js";
import { findUserById, publicUser } from "../lib/users.js";

const router = Router();

/** 称号 state. enabled:false (not 404) when the flag is off, so the client just hides the tab. */
router.get("/me/titles", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!titleShopEnabled()) return ok(res, { enabled: false });
  return ok(res, getTitleState(req.user.id));
});

router.post("/me/titles/equip", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  const r = equipTitle(req.user.id, req.body?.titleId);
  if (r.error) return fail(res, r.error.status, r.error.code, r.error.message, r.error.details);
  return ok(res, { ...r.data, user: publicUser(findUserById(req.user.id)) }, r.status);
});

router.post("/me/titles/:id/buy", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  const r = buyTitle(req.user.id, req.params.id);
  if (r.error) return fail(res, r.error.status, r.error.code, r.error.message, r.error.details);
  return ok(res, r.data, r.status);
});

router.get("/me/rename-card", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!renameCardEnabled()) return ok(res, { enabled: false });
  return ok(res, getRenameState(req.user.id));
});

router.post("/me/rename-card/buy", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  const r = buyRenameCard(req.user.id);
  if (r.error) return fail(res, r.error.status, r.error.code, r.error.message, r.error.details);
  return ok(res, { ...r.data, user: publicUser(findUserById(req.user.id)) }, r.status);
});

export default router;
