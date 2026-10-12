import {
  computeBestPoints,
  computeBSReport,
  computeKlineAnalysisModel,
} from "../analysis-pure.js";
import { colorReturnHtml } from "./copy.js";

function mineTrades(view, kline, historyLength) {
  const trades = [];
  for (const row of view?.resolvedActions || []) {
    if (row.me !== "buy" && row.me !== "sell") continue;
    const bar = kline[historyLength + row.round];
    if (!bar) continue;
    trades.push({ type: row.me, day: row.round + 1, price: bar.open });
  }
  return trades;
}

function signalCards(points) {
  const renderPt = (point, kind) => {
    const tags = (point.reasons || []).map((reason) => `<span class="point-reason-tag">${reason.tag}</span>`).join("");
    const why = (point.reasons || []).map((reason) => reason.text).join("；");
    const when = point.date || `第 ${point.day} 天`;
    return `<div class="best-point-card">
      <div class="point-header">
        <span class="point-badge ${kind}">${kind === "buy" ? "信号买" : "信号卖"}</span>
        <span class="point-day">${when}</span>
        <span class="point-price">${Number(point.price).toFixed(2)}</span>
      </div>
      <div class="point-reason">${tags} ${why}</div>
    </div>`;
  };
  let html = `<div class="analysis-title">当时信号</div>
    <div class="analysis-text"><p>只用当日及以前的均线、量价、形态，不偷看后续行情。分数达到阈值后按强度选取，同类信号至少间隔 3 个交易日，最多各 3 个。黄钻是信号买，紫钻是信号卖。</p></div>`;
  if (!points.buys.length && !points.sells.length) {
    html += `<div class="analysis-text"><p>这段行情没有足够强的当时信号。</p></div>`;
  } else {
    html += points.buys.map((point) => renderPt(point, "buy")).join("");
    html += points.sells.map((point) => renderPt(point, "sell")).join("");
  }
  return html;
}

function operationReview(view, kline, historyLength, gameDays) {
  if (view?.terminal?.type !== "completed" || view.me?.returnPpm == null || gameDays < 2) return "";
  const report = computeBSReport({
    kline,
    historyLength,
    gameDays,
    trades: mineTrades(view, kline, historyLength),
    fillMode: "next_open",
    totalReturn: 1 + Number(view.me.returnPpm) / 1e6,
    tradeGains: [],
  });
  const scoreLabel = report.score != null ? `${report.score}分 · ${report.grade}` : "--";
  const details = (report.details || []).map((detail) => `
    <div class="bs-report-item">
      <span class="bs-item-label">${detail.label}</span>
      <span>
        <span class="bs-item-value ${detail.cls}">${detail.value}</span>
        <span style="color:var(--text-muted); font-size:0.75rem; margin-left:8px;">${detail.note}</span>
      </span>
    </div>`).join("");
  return `<div class="bs-report">
    <div class="bs-score-header">
      <span class="bs-score-title">操作复盘</span>
      <span class="bs-score-badge ${report.gradeCls}">${scoreLabel}</span>
    </div>
    <p class="pvp-analysis-note">这是对照普通局的买卖复盘，不是段位分，也不决定胜负。</p>
    <div class="bs-report-items">${details}</div>
    <div class="bs-comment">${report.comment || ""}</div>
  </div>`;
}

/**
 * Solo-style post-game K-line writeup for a finished battle.
 * Returns null when the revealed market is missing.
 */
export function buildPvpKlineAnalysis(view) {
  const market = view?.market;
  const history = market?.history || [];
  const game = market?.bars || [];
  if (!game.length) return null;
  const historyLength = market.historyLength || history.length;
  const gameDays = game.length;
  const kline = [...history, ...game].map((bar, index) => ({
    ...bar,
    date: index < historyLength ? "" : `第 ${index - historyLength + 1} 天`,
  }));
  const model = computeKlineAnalysisModel({ kline, historyLength, gameDays });
  const bestPoints = computeBestPoints({ kline, historyLength, gameDays });
  const tags = (model.tags || []).map((tag) => `<span class="trend-tag ${tag.cls}">${tag.text}</span>`).join("");
  const html = colorReturnHtml(`<div class="analysis-title">波段分析</div>
    <div class="trend-tags">${tags}</div>
    <div class="analysis-text">${model.analysisHtml || ""}</div>
    ${signalCards(bestPoints)}
    ${operationReview(view, kline, historyLength, gameDays)}`);
  return { html, bestPoints };
}
