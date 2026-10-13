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
    "决策回合 4/29"
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
  const mine = points.find((point) => point.value === "买");
  const opp = points.find((point) => point.value === "对手卖");
  assert.equal(mine.symbol, "roundRect");
  assert.equal(mine.itemStyle.color, "#e05252");
  assert.equal(mine.label.show, true);
  assert.equal(mine.label.formatter, "{c}");
  assert.equal(mine.symbolOffset[0], 0);
  assert.ok(mine.symbolOffset[1] >= 24);
  assert.equal(opp.label.show, true);
  assert.equal(opp.symbolOffset[0], 0);
  assert.ok(opp.symbolOffset[1] <= -24);
  assert.equal(opp.symbol, "diamond");
  assert.match(String(opp.itemStyle.color), /7c4dff/i);
  const oppBuy = buildKlineOption({
    mode: "pvp",
    bars,
    historyLength: 1,
    pvpMarks: [{ label: "d1", side: "opponent", kind: "buy" }],
  }).series[0].markPoint.data.find((point) => point.value === "对手买");
  assert.equal(oppBuy.itemStyle.color, "#2f6fed");
  assert.equal(oppBuy.symbol, "diamond");
  assert.equal(opt.tooltip.triggerOn, "click");
  assert.equal(opt.animation, false);
  const valued = buildKlineOption({
    mode: "pvp",
    bars,
    historyLength: 1,
    pvpMarks: [{ label: "d1", side: "me", kind: "valuation" }],
  }).series[0].markPoint.data.find((point) => point.value === "期末估值");
  assert.ok(valued);
  assert.equal(valued.label.show, true);
  assert.doesNotMatch(JSON.stringify(valued), /"估值"/);
  assert.equal(opt.series[0].itemStyle.color, "#e05252");
  assert.equal(opt.series[0].itemStyle.color0, "#3db86a");
  assert.equal(opt.series[0].markLine, undefined);
  assert.equal(opt.series[0].barWidth, "76%");
  assert.ok(opt.grid[0].right <= 12);
  assert.ok(opt.grid[0].left <= 44);
  assert.equal(opt.dataZoom[0].start, 0);
  assert.equal(opt.dataZoom[0].end, 100);
  assert.equal(opt.dataZoom[0].maxSpan, 100);
  const bottomAxis = opt.xAxis[opt.xAxis.length - 1];
  assert.equal(bottomAxis.axisLabel.formatter("h1"), "");
  assert.equal(bottomAxis.axisLabel.formatter("h15"), "");
  assert.equal(bottomAxis.axisLabel.formatter("d1"), "1");
  assert.equal(bottomAxis.axisLabel.formatter("d12"), "12");
  const many = Array.from({ length: 60 }, (_, i) => ({
    label: i < 30 ? `h${i + 1}` : `d${i - 29}`, open: 1, close: 1, low: 1, high: 1, volume: 1,
  }));
  const dayOne = many.slice(0, 31);
  const wide = buildKlineOption({
    mode: "pvp", bars: dayOne, historyLength: 30, chartWidth: 1200, showDataZoomSlider: false,
  });
  assert.equal(wide.dataZoom[0].start, 0);
  assert.equal(wide.dataZoom[0].end, 100);
  assert.equal(wide.dataZoom[0].maxSpan, 100);
  const narrow = buildKlineOption({
    mode: "pvp", bars: many, historyLength: 30, chartWidth: 360, showDataZoomSlider: false,
  });
  assert.equal(narrow.dataZoom[0].start, 0);
  assert.equal(narrow.dataZoom[0].end, 100);
  assert.ok(narrow.dataZoom[0].maxSpan >= 100);
  const kept = buildKlineOption({
    mode: "pvp", bars: many, historyLength: 30, showDataZoomSlider: false, resetDataZoom: false,
  });
  assert.equal(kept.dataZoom[0].start, undefined);
  assert.equal(kept.dataZoom[0].end, undefined);
  assert.equal(kept.dataZoom[0].maxSpan, 100);
  const tip = opt.tooltip.formatter([{ seriesName: "K线", dataIndex: 0, data: [] }]);
  assert.doesNotMatch(tip, /h1/);
  assert.match(tip, /量 /);
  assert.doesNotMatch(tip, /2024|万手/);
  const dayTip = opt.tooltip.formatter([{ seriesName: "K线", dataIndex: 1, data: [] }]);
  assert.match(dayTip, /第1天/);
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
  assert.match(html, /现在没有可约战的对手。也可以去玩幽灵对局，或稍后再来。/);
  assert.match(html, /打开应用就能被约到/);
  assert.match(html, /id="pvpReadyMarkMe"/);
  assert.match(html, /id="pvpReadyMarkOpp"/);
  assert.match(html, /id="pvpInviteIgnore"/);
  assert.match(html, /id="pvpInviteAccept"/);
  assert.match(html, /id="pvpInviteDecline"/);
  assert.match(html, /id="pvpReportToggle"/);
  assert.match(html, /id="pvpWinDialog"/);
  assert.match(html, /id="pvpShareBtn"/);
  assert.match(html, /id="pvpLobbyLoading"/);
  assert.match(html, /id="pvpTradePrimary"/);
  assert.match(html, /id="pvpMsgOpen"/);
  assert.match(html, /id="pvpMsgPicker"/);
  assert.match(html, /assets\/controls\/ctl-buy-default\.png/);
  assert.match(html, /assets\/controls\/ctl-msg-default\.png/);
  assert.match(html, /assets\/controls\/ctl-hold-default\.png/);
  assert.match(html, /这你都买？进厂打螺丝吧/);
  assert.match(html, /技术回调，慌个锤子/);
  assert.match(html, /id="pvpHold"/);
  assert.match(html, /aria-label="保持"/);
  assert.match(html, /id="pvpBuy"/);
  assert.match(html, /id="pvpSell"/);
  assert.match(html, /id="pvpTradeSegment"/);
  assert.match(html, /assets\/pvp\/settle-rank-badge\.png/);
  assert.match(html, /assets\/pvp\/settle-buy-hold\.png/);
  assert.doesNotMatch(html, /收益决胜/);
  assert.doesNotMatch(html, /嘲讽/);
  assert.doesNotMatch(html, /正常结束/);
  assert.match(html, /id="pvpBattleTop"/);
  assert.doesNotMatch(html, /id="pvpTrade"/);
  assert.match(html, /id="pvpReadyClockNum">15</);
  assert.match(html, /id="pvpWinMeAvatar"/);
  assert.match(html, /id="pvpWinOppAvatar"/);
  assert.match(html, /id="pvpWinIdentity"/);
  assert.match(html, /id="pvpWinPeriod"/);
  assert.match(html, /id="pvpResultPeriod"/);
  assert.doesNotMatch(html, /id="pvpWinMeMdd"/);
  assert.doesNotMatch(html, /id="pvpWinOppMdd"/);
  assert.doesNotMatch(html, /id="pvpSelfLock"/);
  assert.doesNotMatch(html, /尚未锁定/);
  assert.match(html, /id="pvpResultRatingBox"/);
  assert.match(html, /买入持有/);
  assert.doesNotMatch(html, /id="pvpAvailable"/);
  assert.doesNotMatch(html, /看到第/);
  assert.doesNotMatch(html, /已见第/);
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
  assert.match(resultHtml, /class="pvp-gift-row"/);
  assert.match(resultHtml, /aria-label="花花"/);
  assert.match(resultHtml, /aria-label="番茄"/);
  assert.match(resultHtml, /aria-label="烟斗"/);
  assert.match(resultHtml, /aria-label="咖啡"/);
  assert.match(resultHtml, /🌸/);
  assert.match(resultHtml, /🍅/);
  assert.match(resultHtml, /💨/);
  assert.match(resultHtml, /☕/);
  assert.doesNotMatch(resultHtml.split('id="pvpWinDialog"')[1] || "", /回撤/);
  assert.doesNotMatch(resultHtml, /用来对照你的/);
  assert.doesNotMatch(resultHtml, /这是段位分的变化/);
  assert.match(resultHtml, /id="pvpReportPanel" hidden/);
  assert.doesNotMatch(resultHtml.split('id="pvpReadyPanel"')[0], /还未准备/);
  assert.match(html, /id="pvpResultRatingRange"/);
  const profile = readFileSync(new URL("js/pvp/profile-battle.js", root), "utf8");
  const resultJs = readFileSync(new URL("js/pvp/result.js", root), "utf8");
  assert.doesNotMatch(profile, /累计收益/);
  assert.match(profile, /formatWinRate/);
  assert.match(resultJs, /复盘分析暂时不可用，胜负和奖励不受影响/);
  assert.match(readFileSync(new URL("js/pvp/analysis-view.js", root), "utf8"), /波段分析/);
  assert.match(readFileSync(new URL("js/pvp/analysis-view.js", root), "utf8"), /当时信号/);
  assert.match(readFileSync(new URL("js/pvp/analysis-view.js", root), "utf8"), /不决定胜负/);
  assert.match(profile, /升级还需/);
  assert.match(profile, /rankPoints/);
  assert.doesNotMatch(profile, /段位分 \$\{profile\.rating\}/);
  assert.match(resultJs, /已屏蔽，之后不能再约战。这局的结果不变。/);
  assert.doesNotMatch(resultJs, /pvpBuy|累计收益/);
  assert.doesNotMatch(resultJs, /这是段位分的变化/);
  assert.match(resultJs, /celebrate = false/);
  assert.match(room, /celebrate:\s*true/);
  const analysis = readFileSync(new URL("js/pvp/analysis-view.js", root), "utf8");
  assert.doesNotMatch(analysis, /下面是这段行情|技术复盘/);
  const notices = readFileSync(new URL("js/pvp/notices.js", root), "utf8");
  assert.match(notices, /送来\$\{GIFT_NAME\[kind\]\}/);
  assert.match(notices, /烟斗/);
  assert.match(notices, /咖啡/);
  assert.match(notices, /GIFT_MS = 1700/);
  assert.match(notices, /🌸/);
  assert.doesNotMatch(notices, /<svg/);
  assert.doesNotMatch(notices, /送来 \$\{emoji\}/);
  const css = readFileSync(new URL("css/pvp.css", root), "utf8");
  assert.match(css, /pvp-settle-card/);
  assert.match(css, /max-width:\s*360px/);
  assert.match(css, /pvp-gift-caption/);
  assert.match(css, /\.pvp-gift-row \{[^}]*flex-wrap:\s*wrap;/);
  assert.match(css, /position:\s*absolute/);
  assert.match(room, /已行动/);
  assert.doesNotMatch(room, /pvpSelfLock|lockCaption|opponentLockText/);
  assert.match(lobby, /已复制邀请链接，粘贴到微信会显示卡片/);
  assert.match(lobby, /navigator\.share/);
  assert.match(lobby, /StockGameApp/);
  assert.match(lobby, /buildBattleSharePayload/);
  const shareCopy = readFileSync(new URL("js/pvp/copy.js", root), "utf8");
  assert.match(shareCopy, /invite\.html\?c=/);
  assert.match(shareCopy, /buildBattleInviteUrl/);
  assert.match(shareCopy, /早知道当初不炒了/);
  const inviteHtml = readFileSync(new URL("invite.html", root), "utf8");
  assert.match(inviteHtml, /property="og:title"/);
  assert.match(inviteHtml, /property="og:image"/);
  assert.match(inviteHtml, /property="og:description"/);
  assert.match(inviteHtml, /#\/pvp\/join\//);
  assert.match(html, /routePvpPath/);
  const play = html.split('id="pvpPlayPanel"')[1].split('id="pvpLeaveDialog"')[0];
  assert.doesNotMatch(play, /锁定/);
  assert.match(resultJs, /formatCoin/);
  assert.match(lobby, /pvp-recent-mark/);
  assert.match(lobby, /is-win/);
  assert.match(css, /pvp-recent-mark/);
  assert.match(room, /pvpTradePrimary/);
  assert.match(room, /postTaunt|match\.taunt/);
  assert.match(room, /pvp-trade-bar|paintTopClocks|pvpMsgOpen|pvpBottom|bottomMode/);
  assert.match(room, /assets\/controls\/ctl-/);
  assert.match(resultJs, /marketMissing|paintResultBody/);
  assert.match(resultJs, /pvpResultRatingRange/);
  assert.match(resultJs, /对手收益/);
  assert.doesNotMatch(resultJs, /回撤 \$\{escapeHtml\(formatPpm\(view\?\.me\?\.mddPpm\)\)/);
  assert.doesNotMatch(resultJs, /nickname \|\| "对手"\}收益/);
  assert.match(readFileSync(new URL("js/pvp/profile-battle.js", root), "utf8"), /更换头像/);
  assert.match(readFileSync(new URL("js/auth.js", root), "utf8"), /for="settingsAvatarFile"/);
  assert.match(css, /pvp-settle-art|pvp-taunt-bubble|pvp-sketch-ctl/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.match(css, /pvp-score\[data-outcome="win"\][\s\S]*box-shadow:\s*none/);
  assert.doesNotMatch(css, /嘲讽/);
});

test("pvp y-axis names relative price so it is not read as a real quote", () => {
  const bars = [
    { label: "h1", open: 10, close: 11, low: 9, high: 12, volume: 1 },
    { label: "d1", open: 11, close: 10, low: 9.5, high: 12.5, volume: 2 },
  ];
  const opt = buildKlineOption({ mode: "pvp", bars, historyLength: 1, resetDataZoom: true });
  assert.match(String(opt.yAxis[0].name || ""), /相对价/);
});

test("pvp chart includes MA legend and MACD panel", () => {
  const bars = Array.from({ length: 40 }, (_, i) => ({
    label: i < 20 ? `h${i + 1}` : `d${i - 19}`,
    open: 10 + i * 0.1,
    close: 10.2 + i * 0.12,
    low: 9.8 + i * 0.1,
    high: 10.5 + i * 0.12,
    volume: 1 + i,
  }));
  const opt = buildKlineOption({ mode: "pvp", bars, historyLength: 20, resetDataZoom: true });
  assert.equal(opt.grid.length, 3);
  assert.equal(opt.xAxis.length, 3);
  assert.equal(opt.yAxis.length, 3);
  const names = opt.series.map((s) => s.name);
  assert.ok(names.includes("MACD"));
  assert.ok(names.includes("DIF"));
  assert.ok(names.includes("DEA"));
  assert.ok(names.includes("5日线"));
  assert.deepEqual(opt.dataZoom[0].xAxisIndex, [0, 1, 2]);
  const tip = opt.tooltip.formatter([
    { seriesName: "K线", dataIndex: 35, data: [] },
    { seriesName: "5日线", dataIndex: 35, data: 12.5 },
    { seriesName: "DIF", dataIndex: 35, data: 0.12 },
  ]);
  assert.match(tip, /5日线/);
  assert.match(tip, /DIF/);
});


test("battle chart can hide MA legend and toggle bottom indicator pane", () => {
  const bars = [
    { label: "h1", open: 10, close: 11, low: 9, high: 12, volume: 1.5 },
    { label: "d1", open: 11, close: 10, low: 9.5, high: 12.5, volume: 2 },
  ];
  const vol = buildKlineOption({
    mode: "pvp", bars, historyLength: 1, showLegend: false, pvpBottom: "volume", resetDataZoom: true,
  });
  assert.equal(vol.legend.show, false);
  assert.equal(vol.grid.length, 2);
  assert.ok(vol.series.some((s) => s.name === "成交量"));
  assert.ok(!vol.series.some((s) => s.name === "MACD"));
  const macd = buildKlineOption({
    mode: "pvp", bars, historyLength: 1, showLegend: false, pvpBottom: "macd", resetDataZoom: true,
  });
  assert.equal(macd.grid.length, 2);
  assert.ok(macd.series.some((s) => s.name === "MACD"));
  assert.ok(!macd.series.some((s) => s.name === "成交量"));
});
