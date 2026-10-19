import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok } from "../lib/http.js";
import { myItems } from "../lib/userItems.js";

const router = Router();

/** Inventory (后悔券 count) + the rewind settings the client needs to word the confirm sheet. */
router.get("/me/items", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  return ok(res, myItems(req.user.id));
});

export default router;
