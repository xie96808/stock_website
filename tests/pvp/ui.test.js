import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildKlineOption } from "../../js/kline-option.js";
import {
  formatRemain,
  formatWinRate,
  lockCaption,
  marksFromView,
  opponentLockText,
  pvpEntryVisible,
  reasonLabel,
  resultHeadline,
  roundCaption,
} from "../../js/pvp/copy.js";

const root = new URL("../../", import.meta.url);

test("pvp copy names the round, the lock, and the result in words", () => {
  assert.equal(pvpEntryVisible({}), false);
  assert.equal(pvpEntryVisible({ pvpBattle: true }), true);
  assert.equal(
    roundCaption({ status: "playing", round: 4, market: { revealedDay: 4 } }),
    "决策回合 4/29 · 已见第 4/30 个交易日"
  );
  assert.equal(lockCaption({ submitting: true }), "提交中");
  assert.equal(lockCaption({ locked: true }), "已锁定");
  assert.equal(lockCaption({}), "尚未锁定");
  assert.equal(opponentLockText(false), "未锁定");
  assert.equal(opponentLockText(true), "已锁定");
  assert.equal(reasonLabel("completed_drawdown"), "回撤决胜");
  assert.equal(reasonLabel("forfeit"), "认输");
  assert.equal(reasonLabel("ready_timeout"), "准备超时");
  assert.equal(
    resultHeadline({ terminal: { reason: "completed_drawdown" }, me: { outcome: "win" } }),
    "收益相同，回撤更小，你赢了"
  );
  assert.equal(
    resultHeadline({ terminal: { reason: "forfeit" }, me: { outcome: "win" } }),
    "对手认输，你赢了"
  );
  assert.equal(
    resultHeadline({ terminal: { reason: "ready_timeout" } }),
    "准备超时，本局没有扣费"
  );
  assert.equal(formatRemain(1500), "2 秒");
  assert.equal(formatWinRate(null), "");
  assert.equal(formatWinRate(0), "0.0%");
  assert.equal(formatWinRate(0.5), "50.0%");
  assert.equal(
    resultHeadline({ terminal: { reason: "account_unavailable" }, me: { outcome: "win" } }),
    "对手账号不能继续，你赢了"
  );
  assert.equal(resultHeadline({ terminal: { reason: "admin_abort" } }), "系统结束了这局");
  const marks = marksFromView({
    resolvedActions: [{ round: 1, me: "buy", opponent: "sell" }],
    terminal: { type: "completed" },
    market: { bars: [{ label: "d30" }] },
  });
  assert.deepEqual(marks, [
    { label: "d2", side: "me", kind: "buy" },
    { label: "d2", side: "opponent", kind: "sell" },
    { label: "d30", side: "me", kind: "valuation" },
  ]);
});

test("pvp chart uses h/d labels and shape markers, candles stay red and green", () => {
  const bars = [
    { label: "h1", open: 10, close: 11, low: 9, high: 12, volume: 1.5 },
    { label: "d1", open: 11, close: 10, low: 9.5, high: 12.5, volume: 2 },
  ];
  const opt = buildKlineOption({
    mode: "pvp",
    bars,
    historyLength: 1,
    pvpMarks: [
      { label: "d1", side: "me", kind: "buy" },
      { label: "d1", side: "opponent", kind: "sell" },
    ],
  });
  assert.deepEqual(opt.xAxis[0].data, ["h1", "d1"]);
  const points = opt.series[0].markPoint.data;
  const mine = points.find((point) => point.value === "我买");
  const opp = points.find((point) => point.value === "对手卖");
  assert.equal(mine.symbol, "circle");
  assert.equal(mine.itemStyle.color, "#8a7350");
  assert.equal(opp.symbol, "triangle");
  assert.equal(opp.itemStyle.color, "#4d6278");
  assert.notEqual(mine.itemStyle.color, "#e05252");
  assert.notEqual(mine.itemStyle.color, "#3db86a");
  assert.equal(opt.series[0].itemStyle.color, "#e05252");
  assert.equal(opt.series[0].itemStyle.color0, "#3db86a");
  assert.equal(opt.series[0].markLine, undefined);
  const tip = opt.tooltip.formatter([{ seriesName: "K线", dataIndex: 0, data: [] }]);
  assert.match(tip, /h1/);
  assert.match(tip, /量 /);
  assert.doesNotMatch(tip, /2024|万手/);
});

test("hub keeps 选择玩法 and hides the battle entry until the flag is on", () => {
  const html = readFileSync(new URL("index.html", root), "utf8");
  const sim = html.split('id="simHub"')[1].split('id="playModes"')[0];
  assert.match(sim, /选择玩法/);
  assert.match(sim, /id="pvpEntryCard" hidden/);
  assert.match(html, /id="pvpLobbyScreen"/);
  assert.match(html, /id="pvpRoomScreen"/);
  assert.match(html, /id="pvpResultScreen"/);
  assert.match(html, /id="pvpHistoryScreen"/);
  assert.match(html, /现在没有可约战的对手。去玩幽灵对局，或稍后再来。/);
  assert.match(html, /进入页面不会自动打开可约战/);
  assert.match(html, /留下/);
  assert.match(html, /回到大厅（计时继续）/);
  assert.match(html, /认输/);
  assert.match(html, /切到后台后，计时仍按服务器继续/);
  assert.match(html, /id="pvpResultHeadline"/);
  assert.match(html, /战绩只对你自己可见/);
  const lobby = readFileSync(new URL("js/pvp/lobby.js", root), "utf8");
  const room = readFileSync(new URL("js/pvp/room.js", root), "utf8");
  assert.match(lobby, /eligibility\?\.message/);
  assert.doesNotMatch(`${lobby}\n${room}`, /resetGame|fastForward|fast-forward|beforeunload/);
  assert.match(readFileSync(new URL("css/style.css", root), "utf8"), /pvp\.css/);
  const resultHtml = html.split('id="pvpResultScreen"')[1].split('id="pvpHistoryScreen"')[0];
  assert.match(resultHtml, /疑似作弊/);
  assert.match(resultHtml, /恶意弃权/);
  assert.match(resultHtml, /昵称问题/);
  assert.match(resultHtml, />其他</);
  assert.doesNotMatch(resultHtml, /id="pvpBuy"/);
  const profile = readFileSync(new URL("js/pvp/profile-battle.js", root), "utf8");
  const resultJs = readFileSync(new URL("js/pvp/result.js", root), "utf8");
  assert.doesNotMatch(profile, /累计收益/);
  assert.match(profile, /formatWinRate/);
  assert.match(resultJs, /复盘分析暂时不可用，胜负和奖励不受影响/);
  assert.match(resultJs, /已屏蔽，之后不能再约战。这局的结果不变。/);
  assert.doesNotMatch(resultJs, /pvpBuy|累计收益/);
});
