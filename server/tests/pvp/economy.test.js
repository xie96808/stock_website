import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv } from "../helpers.js";
import { balanceOf, pvpLedger, seedUser } from "./fixture.js";

prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { migrate } = await import("../../src/db/migrate.js");
const { chargePvpEntry } = await import("../../src/lib/pvp/economy.js");
const { withImmediate } = await import("../../src/lib/pvp/tx.js");

migrate();
const db = openDb();

test.after(() => closeDb());

test("E01 entry charges both players on one match id", () => {
  const a = seedUser(db, { name: "eco-a", classics: 0, balance: 500 });
  const b = seedUser(db, { name: "eco-b", classics: 0, balance: 500 });
  withImmediate(db, () => {
    chargePvpEntry(db, { userId: a, matchId: "m-both", cost: 20, economyVersion: "pvp-eco-v1" });
    chargePvpEntry(db, { userId: b, matchId: "m-both", cost: 20, economyVersion: "pvp-eco-v1" });
  });
  assert.equal(balanceOf(db, a), 480);
  assert.equal(balanceOf(db, b), 480);
  assert.deepEqual(
    pvpLedger(db, "m-both").map((row) => row.delta),
    [-20, -20]
  );
});

test("a second entry for the same player does not stick", () => {
  const a = seedUser(db, { name: "eco-retry", classics: 0, balance: 100 });
  withImmediate(db, () => {
    chargePvpEntry(db, { userId: a, matchId: "m-retry", cost: 20, economyVersion: "pvp-eco-v1" });
  });
  assert.throws(() =>
    withImmediate(db, () => {
      chargePvpEntry(db, { userId: a, matchId: "m-retry", cost: 20, economyVersion: "pvp-eco-v1" });
    })
  );
  assert.equal(balanceOf(db, a), 80);
  assert.equal(pvpLedger(db, "m-retry").length, 1);
});

test("C03 a failed teammate charge rolls back the first deduction", () => {
  const a = seedUser(db, { name: "eco-roll-a", classics: 0, balance: 500 });
  const b = seedUser(db, { name: "eco-roll-b", classics: 0, balance: 10 });
  assert.throws(() =>
    withImmediate(db, () => {
      chargePvpEntry(db, { userId: a, matchId: "m-roll", cost: 20, economyVersion: "pvp-eco-v1" });
      chargePvpEntry(db, { userId: b, matchId: "m-roll", cost: 20, economyVersion: "pvp-eco-v1" });
    })
  );
  assert.equal(balanceOf(db, a), 500);
  assert.equal(balanceOf(db, b), 10);
  assert.equal(pvpLedger(db, "m-roll").length, 0);
});
