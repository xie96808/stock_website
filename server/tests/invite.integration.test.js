import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

prepareTestEnv();
process.env.INVITE_REWARDS_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT } = await import("../src/lib/jiuCoin.js");
const inv = await import("../src/lib/invite.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

let seq = 0;
const uname = (p) => `${p}${Date.now().toString(36)}${seq++}`;

async function registerWith(code, ip) {
  for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
  const headers = ip ? { "X-Forwarded-For": ip } : {};
  const r = await api("/api/v1/auth/register", {
    method: "POST",
    headers,
    body: {
      username: uname("iv"), password: "pass1234", nickname: "受邀友", termsVersion: "v1",
      leaderboardOptIn: false, ...(code !== undefined ? { inviteCode: code } : {}),
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { user: r.json.data.user, csrfToken: r.json.data.csrfToken, invite: r.json.data.invite };
}

let gameKey = 0;
async function settle(auth) {
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `inv-${Date.now()}-${gameKey++}` },
    body: { fillMode: "next_open", pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 } },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const finish = await api(`/api/v1/games/${create.json.data.gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: actionsObj(holds(29)), finish: true },
  });
  assert.equal(finish.status, 201, JSON.stringify(finish.json));
  return finish.json.data;
}

async function myCode(auth) {
  const r = await api("/api/v1/me/invite");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
}

test("code helpers: normalize / alphabet", () => {
  assert.equal(inv.normalizeInviteCode(" ab-c2 34 "), "ABC234");
  assert.equal(inv.normalizeInviteCode("ABC12"), null); // too short
  assert.equal(inv.normalizeInviteCode("ABCDE0"), null); // 0 not in alphabet
  assert.equal(inv.normalizeInviteCode(null), null);
  const c = inv.randomInviteCode();
  assert.equal(inv.normalizeInviteCode(c), c);
});

test("config exposes inviteRewards; unauthenticated /me/invite is 401", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.json.data.features.inviteRewards, true);
  for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
  const r = await api("/api/v1/me/invite");
  assert.equal(r.status, 401);
});

test("happy path: invited friend's first settled game pays both, exactly once", async () => {
  const inviter = await register(uname("host"));
  const st = await myCode(inviter);
  assert.equal(st.enabled, true);
  assert.match(st.code, /^[A-Z2-9]{6}$/);
  assert.equal(st.inviterCoins, inv.INVITER_COINS);
  assert.equal((await myCode(inviter)).code, st.code, "code is stable");

  const friend = await registerWith(st.code.toLowerCase());
  assert.equal(friend.invite.accepted, true);
  assert.equal(friend.invite.inviteeCoins, inv.INVITEE_COINS);
  assert.equal(getJiuCoinBalance(friend.user.id), JIU_COIN_REGISTER_GRANT, "nothing is paid at sign-up");

  const done = await settle(friend);
  assert.deepEqual(done.inviteReward, { inviteeCoins: inv.INVITEE_COINS, inviterCoins: inv.INVITER_COINS });
  // game cost 20 + invite bonus 80
  assert.equal(getJiuCoinBalance(friend.user.id), JIU_COIN_REGISTER_GRANT - 20 + inv.INVITEE_COINS);
  assert.equal(getJiuCoinBalance(inviter.user.id), JIU_COIN_REGISTER_GRANT + inv.INVITER_COINS);

  const second = await settle(friend);
  assert.equal(second.inviteReward, undefined, "second game pays nothing more");
  assert.equal(getJiuCoinBalance(inviter.user.id), JIU_COIN_REGISTER_GRANT + inv.INVITER_COINS);

  const rows = openDb().prepare(`SELECT reason, delta FROM jiu_coin_ledger WHERE reason LIKE 'invite_%' AND ref_id = ?`).all(String(friend.user.id));
  assert.equal(rows.length, 2);

  // inviter's view
  const after = await (async () => {
    // log back in as the inviter
    for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
    const l = await api("/api/v1/auth/login", { method: "POST", body: { username: inviter.username, password: "pass1234" } });
    assert.equal(l.status, 200);
    return myCode(inviter);
  })();
  assert.equal(after.stats.invited, 1);
  assert.equal(after.stats.rewarded, 1);
  assert.equal(after.stats.coinsEarned, inv.INVITER_COINS);
});

test("bad / unknown / own code never blocks sign-up and pays nothing", async () => {
  const a = await registerWith("NOPE");
  assert.equal(a.invite.accepted, false);
  const b = await registerWith("ZZZZZZ"); // well-formed, unknown
  assert.equal(b.invite.accepted, false);
  const c = await registerWith(undefined);
  assert.equal(c.invite, undefined);
  const d = await settle(c);
  assert.equal(d.inviteReward, undefined);
});

test("an account can only be invited once", () => {
  const db = openDb();
  const host = db.prepare(`SELECT user_id, code FROM invite_codes LIMIT 1`).get();
  const other = db.prepare(`SELECT invitee_id FROM invite_redemptions LIMIT 1`).get();
  const again = inv.recordInviteRedemption(other.invitee_id, host.code, "9.9.9.9");
  assert.equal(again.accepted, false);
  assert.equal(again.reason, "already");
  const self = inv.recordInviteRedemption(host.user_id, host.code, "9.9.9.9");
  assert.equal(self.accepted, false);
  assert.equal(self.reason, "self");
});

test("inviter daily cap: invitee still paid, inviter not", async () => {
  const inviter = await register(uname("cap"));
  const { code } = await myCode(inviter);
  const results = [];
  for (let i = 0; i < inv.INVITER_DAILY_CAP + 1; i++) {
    const f = await registerWith(code, `10.0.${i}.1`);
    results.push(await settle(f));
  }
  const paid = results.map((r) => r.inviteReward?.inviterCoins);
  assert.deepEqual(paid, [...Array(inv.INVITER_DAILY_CAP).fill(inv.INVITER_COINS), 0]);
  assert.ok(results.every((r) => r.inviteReward.inviteeCoins === inv.INVITEE_COINS));
  assert.equal(
    getJiuCoinBalance(inviter.user.id),
    JIU_COIN_REGISTER_GRANT + inv.INVITER_COINS * inv.INVITER_DAILY_CAP
  );
});

test("same-IP farm is rejected after the per-IP cap, nobody paid", async () => {
  const inviter = await register(uname("farm"));
  const { code } = await myCode(inviter);
  const out = [];
  const friends = [];
  for (let i = 0; i < inv.IP_REWARD_CAP_24H + 1; i++) {
    const f = await registerWith(code, "203.0.113.77");
    friends.push(f);
    out.push(await settle(f));
  }
  assert.ok(out.slice(0, inv.IP_REWARD_CAP_24H).every((r) => r.inviteReward));
  const last = out[inv.IP_REWARD_CAP_24H];
  assert.equal(last.inviteReward, undefined);
  const row = openDb().prepare(`SELECT status, reject_reason FROM invite_redemptions WHERE invitee_id = ?`).get(friends[inv.IP_REWARD_CAP_24H].user.id);
  assert.equal(row.status, "rejected");
  assert.equal(row.reject_reason, "ip_cap");
  assert.equal(
    getJiuCoinBalance(friends[inv.IP_REWARD_CAP_24H].user.id),
    JIU_COIN_REGISTER_GRANT - 20
  );
});

test("flag off: register ignores the code, endpoint reports disabled, no payout", async () => {
  const inviter = await register(uname("off"));
  const { code } = await myCode(inviter);
  config.inviteRewardsEnabled = false;
  try {
    const f = await registerWith(code);
    assert.equal(f.invite, undefined);
    const done = await settle(f);
    assert.equal(done.inviteReward, undefined);
    const r = await api("/api/v1/me/invite");
    assert.equal(r.json.data.enabled, false);
    assert.equal(r.json.data.code, undefined);
  } finally {
    config.inviteRewardsEnabled = true;
  }
});
