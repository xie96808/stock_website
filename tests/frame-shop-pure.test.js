import test from "node:test";
import assert from "node:assert/strict";
import { actionFor, actionForBalance, captionFor, sortFrames, buyToast, errorToast } from "../js/frame-shop-pure.js";

const shop = (o = {}) => ({ id: "gold", name: "金边", kind: "shop", price: 1500, owned: false, equipped: false, buyable: true, affordable: true, desc: "d", ...o });

test("action: buy → confirm (second tap) for an affordable unowned shop frame", () => {
  assert.deepEqual(actionFor(shop()), { kind: "buy", label: "购买 1500", disabled: false });
  assert.deepEqual(actionFor(shop(), true), { kind: "confirm", label: "确认 -1500", disabled: false });
});

test("action: poor says how many coins are missing", () => {
  const f = shop({ affordable: false });
  assert.equal(actionFor(f).kind, "poor");
  assert.equal(actionFor(f).disabled, true);
  assert.equal(actionForBalance(f, 1200).label, "还差 300");
  assert.equal(actionForBalance(f, 99999).label, "韭币不足", "label from actionFor when called with an unusual flag");
});

test("action: owned → equip / unequip; achievement-only → locked", () => {
  assert.equal(actionFor(shop({ owned: true, buyable: false })).kind, "equip");
  assert.equal(actionFor(shop({ owned: true, equipped: true, buyable: false })).kind, "unequip");
  const locked = actionFor({ id: "laurel", kind: "achievement", owned: false, buyable: false, price: null });
  assert.deepEqual(locked, { kind: "locked", label: "成就解锁", disabled: true });
  assert.equal(actionFor(null).disabled, true);
  // ownership beats everything: an owned achievement frame can be worn
  assert.equal(actionFor({ kind: "achievement", owned: true, equipped: false, buyable: false }).kind, "equip");
});

test("armed state never turns an unaffordable or owned frame into a confirm", () => {
  assert.equal(actionFor(shop({ affordable: false }), true).kind, "poor");
  assert.equal(actionFor(shop({ owned: true, buyable: false }), true).kind, "equip");
});

test("caption: status first, then how to get it", () => {
  assert.equal(captionFor(shop({ owned: true, equipped: true })), "使用中");
  assert.equal(captionFor(shop({ owned: true })), "已拥有");
  assert.equal(captionFor({ kind: "achievement", hint: "成就「股神附体」" }), "成就「股神附体」");
  assert.equal(captionFor({ kind: "achievement" }), "成就解锁");
  assert.equal(captionFor(shop()), "d");
  assert.equal(captionFor(shop({ hint: "也可通过成就免费获得" })), "也可通过成就免费获得");
  assert.equal(captionFor(null), "");
});

test("sort: shop frames cheapest first, achievement-only last", () => {
  const list = [
    { id: "crown", kind: "achievement" },
    { id: "gold", kind: "shop", price: 1500 },
    { id: "ink_ring", kind: "shop", price: 300 },
    { id: "laurel", kind: "achievement" },
    { id: "bamboo", kind: "shop", price: 500 },
  ];
  assert.deepEqual(sortFrames(list).map((f) => f.id), ["ink_ring", "bamboo", "gold", "crown", "laurel"]);
  assert.deepEqual(sortFrames(null), []);
  assert.equal(list[0].id, "crown", "input untouched");
});

test("toasts", () => {
  assert.match(buyToast("金边", 1500), /金边.*1500/);
  assert.equal(errorToast({ code: "INSUFFICIENT_FUNDS" }), "韭币不足");
  assert.equal(errorToast({ code: "ALREADY_OWNED" }), "你已经拥有这个头像框");
  assert.equal(errorToast(null), "操作失败，请稍后再试");
});
