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
  assert.match(invite, /INVITE_CARD_ART/);
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
