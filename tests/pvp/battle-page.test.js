import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PVP_PLACEMENT_GAMES,
  PVP_RATING_FLOOR,
  PVP_RATING_INITIAL,
  RANK_GROUPS,
  rawDelta,
  titleForRating,
} from "../../shared/pvpRating.js";
import { placementGamesLeft, rankTiers, ratingExamples, rulesHtml } from "../../js/pvp/rank-help.js";
import { PVP_INVITE_SHARE_TEXT, buildBattleSharePayload } from "../../js/pvp/copy.js";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("段位说明 tiers come straight from shared/pvpRating.js", () => {
  const tiers = rankTiers();
  assert.equal(tiers.length, RANK_GROUPS.length * 3);
  assert.equal(tiers[0].low, PVP_RATING_FLOOR);
  for (const t of tiers) {
    assert.equal(titleForRating(t.low).name, t.name);
    if (t.high != null) assert.equal(titleForRating(t.high).name, t.name);
    assert.ok(t.iconSlug);
  }
  assert.equal(tiers.at(-1).high, null);
  assert.equal(titleForRating(PVP_RATING_INITIAL).name, "散户一段");
});

test("placement countdown = PVP_PLACEMENT_GAMES minus rated results", () => {
  assert.equal(placementGamesLeft({ inPlacement: true, wins: 0, losses: 0, draws: 0 }), PVP_PLACEMENT_GAMES);
  assert.equal(placementGamesLeft({ inPlacement: true, wins: 2, losses: 3, draws: 1 }), PVP_PLACEMENT_GAMES - 6);
  assert.equal(placementGamesLeft({ inPlacement: true, wins: 20, losses: 0, draws: 0 }), null);
  assert.equal(placementGamesLeft({ inPlacement: false, wins: 1, losses: 0, draws: 0 }), null);
});

test("rule copy numbers are the Elo numbers, never hard-coded", () => {
  const ex = ratingExamples();
  assert.equal(ex.evenWin, rawDelta(PVP_RATING_INITIAL, PVP_RATING_INITIAL, 1));
  assert.equal(ex.evenLoss, rawDelta(PVP_RATING_INITIAL, PVP_RATING_INITIAL, 0));
  const html = rulesHtml();
  assert.match(html, new RegExp(`${PVP_PLACEMENT_GAMES} 局`));
  assert.match(html, new RegExp(`${PVP_RATING_FLOOR} 分`));
  assert.match(html, /pvp-num-up/);
  assert.match(html, /pvp-num-down/);
  assert.doesNotMatch(html, /平局各退|一局最长/);
  const src = read("js/pvp/rank-help.js");
  assert.doesNotMatch(src, /\b(16|700|1000|2100)\b/);
});

test("invite share text is one constant shared by link, copy and card", () => {
  const p = buildBattleSharePayload("abc23456", "https://x.test");
  assert.equal(PVP_INVITE_SHARE_TEXT, "还不来？同一段行情，和我 PK 收益率！");
  assert.equal(p.text, PVP_INVITE_SHARE_TEXT);
  assert.equal(p.clipboard, `${PVP_INVITE_SHARE_TEXT}\n${p.url}`);
  const invite = read("js/pvp/invite-share.js");
  assert.match(invite, /PVP_INVITE_SHARE_TEXT/);
  assert.match(invite, /execCommand\("copy"\)/);
  assert.match(invite, /链接已复制/);
  assert.match(invite, /deliverImage/);
  assert.match(invite, /renderInviteCardS6/);
  assert.doesNotMatch(invite + read("js/pvp/rank-help.js"), /\balert\(/);
  const html = read("index.html");
  assert.match(html, /id="pvpShareCopyBtn"/);
  assert.match(html, /id="pvpShareImageBtn"/);
  assert.doesNotMatch(html.split('class="pvp-rules"')[1].split("</ul>")[0], /平局各退|一局最长/);
});

test("lobby hero is H1, per-theme transparent art with webp + png at 600w/1200w", () => {
  const art = read("js/pvp/bot-art.js");
  assert.match(art, /img\.alt = "模拟对战"/);
  assert.match(art, /battle-hero-\$\{theme === THEME_DARK \? "dark" : "light"\}/);
  assert.match(art, /onThemeChange/);
  assert.doesNotMatch(art, /assets\/pvp\/battle-cover/);
  for (const t of ["light", "dark"]) {
    for (const s of ["", "-600"]) {
      for (const ext of ["webp", "png"]) {
        assert.ok(readFileSync(new URL(`assets/pvp/battle-hero-${t}${s}.${ext}`, root)).length > 1000);
      }
    }
  }
});

import {
  MASKED_STOCK_LABEL,
  S6_SAMPLE_BARS,
  graphemes,
  isUp,
  lastOhlc,
  movingAverage,
  ohlcText,
  splitHeadline,
  truncateToWidth,
} from "../../js/pvp/invite-card-s6.js";

test("S6 invite card never names a stock and computes O/H/L/C from the bars it draws", () => {
  const src = read("js/pvp/invite-card-s6.js");
  assert.doesNotMatch(src, /君实生物|688180|39\.63|39\.70|38\.03|38\.51/);
  assert.equal(MASKED_STOCK_LABEL, "神秘个股 · 开局揭晓");
  assert.doesNotMatch(src, /\d{4}-\d{2}-\d{2}/, "no date range on the card");
  assert.equal(S6_SAMPLE_BARS.length, 42);
  for (const [o, h, l, c, v] of S6_SAMPLE_BARS) {
    assert.ok(h >= Math.max(o, c) && l <= Math.min(o, c) && v > 0);
  }
  const last = S6_SAMPLE_BARS.at(-1);
  assert.deepEqual(lastOhlc(S6_SAMPLE_BARS), { open: last[0], high: last[1], low: last[2], close: last[3] });
  assert.equal(ohlcText(S6_SAMPLE_BARS), `开 ${last[0].toFixed(2)}  高 ${last[1].toFixed(2)}  低 ${last[2].toFixed(2)}  收 ${last[3].toFixed(2)}`);
  // volume bars and candle bodies share one up/down rule (red up, green down)
  assert.match(src, /fillStyle = isUp\(b\) \? C\.up : C\.down;[\s\S]*fillStyle = isUp\(b\) \? C\.up : C\.down;/);
  assert.equal(isUp([1, 2, 0.5, 1]), true);
  assert.equal(isUp([1, 2, 0.5, 0.9]), false);
  // server: stock is chosen at match start and revealed only after a completed settlement
  assert.match(read("server/src/lib/pvp/challenges.js"), /pickRandomWindow\(\)/);
  assert.match(read("server/src/lib/pvp/view.js"), /terminalType === "completed"[\s\S]*view\.identity = \{/);
});

test("S6 helpers: MA, headline split, nickname truncation", () => {
  assert.deepEqual(movingAverage([1, 2, 3, 4, 5, 6], 5), [null, null, null, null, 3, 4]);
  const w = (s) => graphemes(s).length * 10;
  assert.deepEqual(splitHeadline("还不来？同一段行情，和我 PK 收益率！", 100, w), ["还不来？同一段行情，", "和我 PK 收益率！"]);
  assert.equal(truncateToWidth("短名", 100, w), "短名");
  const cut = truncateToWidth("超级无敌长昵称的韭菜大王", 60, w);
  assert.ok(cut.endsWith("…") && w(cut) <= 60);
  assert.equal(truncateToWidth("👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦", 25, w), "👨‍👩‍👧‍👦…");
});
