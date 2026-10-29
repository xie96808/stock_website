import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STICKER_ART, STICKER_IDS, isStickerId, stickerSvg, stickerLabel } from "../js/sticker-art-pure.js";
import { ENTRANCE_IDS, ENTRANCE_NAMES, isEntranceId, inkBlobPath, droplets, rayPath, bladePath, rainDrops, rng } from "../js/entrance-fx-pure.js";
import { ownedStickerIds, ownedPacks, lockedPacks, entranceCaption, packCaption, shouldPlayEntrance, cosBuyToast, errorToast, actionForBalance } from "../js/cosmetic-pure.js";

const serverSrc = readFileSync(new URL("../server/src/lib/cosmeticDefs.js", import.meta.url), "utf8");

test("every sticker is drawn: svg, two-character label, no broken numbers, no refs", () => {
  assert.equal(STICKER_IDS.length, 48);
  for (const id of STICKER_IDS) {
    assert.equal(isStickerId(id), true);
    const svg = stickerSvg(id);
    assert.match(svg, /^<svg class="stk( stk--(face|fine|grand))?" viewBox="0 0 100 100"/);
    assert.equal([...stickerLabel(id)].length, 2, `${id} label is two characters`);
    assert.ok(svg.includes(`>${stickerLabel(id)}</text>`), id);
    assert.ok(!/NaN|undefined/.test(svg), id);
    assert.ok(!/\sid=|url\(#|<(linearGradient|filter|clipPath|defs)\b/.test(svg), `${id} must be self-contained`);
  }
  assert.equal(new Set(STICKER_IDS.map((id) => stickerSvg(id))).size, 48, "all stickers look different");
});

test("premium kinds: faces, medallions and animated medallions carry the right classes and motion hooks", () => {
  for (const id of STICKER_IDS) {
    const a = STICKER_ART[id];
    const svg = stickerSvg(id);
    if (a.kind) assert.ok(svg.includes(`stk--${a.kind}`), id);
    else assert.ok(!svg.includes("stk--"), id);
    const moves = /class="stk-/.test(svg);
    if (a.kind === "grand") assert.ok(moves, `${id} (grand) animates`);
    if (!a.kind) assert.ok(!moves, `${id} (seal) is still`);
  }
  const grand = STICKER_IDS.filter((id) => STICKER_ART[id].kind === "grand");
  const fine = STICKER_IDS.filter((id) => STICKER_ART[id].kind === "fine");
  const faces = STICKER_IDS.filter((id) => STICKER_ART[id].kind === "face");
  assert.deepEqual([grand.length, fine.length, faces.length], [8, 8, 8]);
  // every animation class used by the art has a keyframes rule in the stylesheet
  const css = readFileSync(new URL("../css/cosmetics.css", import.meta.url), "utf8");
  const used = new Set(STICKER_IDS.flatMap((id) => [...stickerSvg(id).matchAll(/class="(stk-[a-z-]+)"/g)].map((m) => m[1])));
  for (const cls of used) assert.ok(css.includes(`.stk .${cls}`), `css for ${cls}`);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
});

test("unknown sticker ids draw nothing", () => {
  for (const bad of [undefined, null, "", "nope", "__proto__", "constructor", 3]) {
    assert.equal(isStickerId(bad), false);
    assert.equal(stickerSvg(bad), "");
    assert.equal(stickerLabel(bad), "");
  }
});

test("client art ids match the server catalogue exactly (stickers and effects)", () => {
  const serverStickers = [...serverSrc.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  for (const id of STICKER_IDS) assert.ok(serverStickers.includes(id), `server knows sticker ${id}`);
  const packBlock = serverSrc.slice(serverSrc.indexOf("PACKS"), serverSrc.indexOf("ENTRANCES = "));
  const listed = [...packBlock.matchAll(/stickers: Object\.freeze\(\[([^\]]+)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
  assert.deepEqual([...listed].sort(), [...STICKER_IDS].sort());
  const fx = [...serverSrc.matchAll(/\{ id: "([a-z_]+)", name: "([^"]+)", desc/g)].map((m) => [m[1], m[2]]);
  const serverFx = fx.filter(([id]) => !id.startsWith("pack_"));
  assert.deepEqual(serverFx.map(([id]) => id).sort(), [...ENTRANCE_IDS].sort());
  for (const [id, name] of serverFx) assert.equal(ENTRANCE_NAMES[id], name, `name of ${id}`);
});

test("entrance geometry is deterministic and finite", () => {
  assert.equal(inkBlobPath(9), inkBlobPath(9));
  assert.notEqual(inkBlobPath(9), inkBlobPath(10));
  for (const d of [inkBlobPath(), rayPath(), bladePath()]) assert.ok(!/NaN|undefined/.test(d));
  assert.equal(droplets(5, 11).length, 11);
  for (const p of droplets(5, 11, 70, 125)) {
    const dist = Math.hypot(p.x, p.y);
    assert.ok(dist >= 69 && dist <= 126, `droplet at ${dist}`);
  }
  const rain = rainDrops(13, 18);
  assert.equal(rain.length, 18);
  assert.deepEqual(rain, rainDrops(13, 18));
  for (const d of rain) assert.ok(d.delay >= 0 && d.delay <= 520 && d.dur >= 950 && d.h >= 34);
  const r = rng(1);
  const seq = Array.from({ length: 50 }, r);
  assert.ok(seq.every((x) => x >= 0 && x < 1));
  assert.equal(isEntranceId("ink_splash"), true);
  assert.equal(isEntranceId("pack_leek"), false);
  assert.equal(isEntranceId("__proto__"), false);
});

const state = {
  balance: 250,
  packs: [
    { id: "pack_a", name: "甲", kind: "pack", price: 200, owned: true, equipped: false, buyable: false, affordable: false, stickers: ["limit_up", "limit_down"] },
    { id: "pack_b", name: "乙", kind: "pack", price: 300, owned: false, equipped: false, buyable: true, affordable: false, stickers: ["got_cut"] },
  ],
  entrances: [],
};

test("tray helpers: owned stickers in pack order, locked packs listed", () => {
  assert.deepEqual(ownedStickerIds(state), ["limit_up", "limit_down"]);
  assert.deepEqual(lockedPacks(state).map((p) => p.id), ["pack_b"]);
  assert.deepEqual(ownedStickerIds(null), []);
  assert.deepEqual(lockedPacks({}), []);
});

test("tray tabs: owned packs cheapest first", () => {
  const two = { packs: [
    { id: "p2", price: 800, owned: true, stickers: ["bull"] },
    { id: "p1", price: 200, owned: true, stickers: ["limit_up"] },
    { id: "p3", price: 300, owned: false, stickers: ["got_cut"] },
  ] };
  assert.deepEqual(ownedPacks(two).map((p) => p.id), ["p1", "p2"]);
  assert.deepEqual(ownedPacks(null), []);
});

test("captions, buy button and toasts", () => {
  assert.equal(packCaption(state.packs[0]), "已拥有 · 2 个表情");
  assert.equal(packCaption({ desc: "介绍", owned: false }), "介绍");
  assert.equal(entranceCaption({ equipped: true }), "使用中");
  assert.equal(entranceCaption({ owned: true }), "已拥有");
  assert.equal(entranceCaption({ desc: "一团浓墨" }), "一团浓墨");
  assert.deepEqual(
    (({ kind, label }) => ({ kind, label }))(actionForBalance(state.packs[1], 250)),
    { kind: "poor", label: "购买 300" }
  );
  // An owned pack has nothing to equip: quiet, disabled 「已拥有」 (it used to say 装备 and fail on tap).
  const owned = actionForBalance(state.packs[0], 250);
  assert.deepEqual(owned, { kind: "owned", label: "已拥有", disabled: true });
  assert.equal(actionForBalance({ ...state.packs[0], equipped: true }, 250).kind, "owned");
  // entrance effects still equip / unequip
  const fx = { id: "ink_splash", kind: "entrance", price: 400, owned: true, equipped: false, buyable: false };
  assert.equal(actionForBalance(fx, 250).kind, "equip");
  assert.equal(actionForBalance({ ...fx, equipped: true }, 250).kind, "unequip");
  const rich = { ...state.packs[1], affordable: true };
  assert.equal(actionForBalance(rich, 400).label, "购买 300");
  assert.equal(actionForBalance(rich, 400, true).label, "确认 -300");
  assert.equal(cosBuyToast({ kind: "pack", name: "行情表情", price: 200 }), "已购买「行情表情」-200 韭币，进对局就能用");
  assert.match(cosBuyToast({ kind: "entrance", name: "泼墨", price: 400 }), /点「装备」使用$/);
  assert.equal(errorToast({ code: "INSUFFICIENT_FUNDS" }), "韭币不足");
  assert.equal(errorToast({ code: "ALREADY_OWNED" }), "你已经拥有它了");
  assert.equal(errorToast(null), "操作失败，请稍后再试");
});

test("entrance plays once per match, only at the start", () => {
  const base = { status: "playing", resolvedRounds: 0, playedFor: "", matchId: "m1" };
  assert.equal(shouldPlayEntrance(base), true);
  assert.equal(shouldPlayEntrance({ ...base, playedFor: "m1" }), false, "already played");
  assert.equal(shouldPlayEntrance({ ...base, playedFor: "m0" }), true, "a different match plays again");
  assert.equal(shouldPlayEntrance({ ...base, resolvedRounds: 3 }), false, "reloaded mid-match: no replay");
  assert.equal(shouldPlayEntrance({ ...base, status: "waiting_ready" }), false);
  assert.equal(shouldPlayEntrance({ ...base, matchId: null }), false);
});

test("room wiring: WS handler, tray and entrance hook are connected", () => {
  const room = readFileSync(new URL("../js/pvp/room.js", import.meta.url), "utf8");
  assert.match(room, /msg\.t === "match\.sticker"/);
  assert.match(room, /maybePlayEntrance\(\)/);
  assert.match(room, /initRoomCosmetics\(/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const needle of ["css/cosmetics.css", "initCosmeticShop", 'id="pvpStickerTray"', "data-cosmetic-open"]) {
    assert.ok(html.includes(needle), needle);
  }
});
