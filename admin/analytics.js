/**
 * 后台 · 「数据」标签：用户数据可视化（在线 / 注册 / 活跃 / 使用时长 / Top 3 / 留存 / 峰值时段 …）。
 * 只读，数据来自 GET /api/v1/admin/analytics。独立模块：不改动其它后台标签。
 */
const API = "/api/v1";
const REFRESH_MS = 30000;
const $ = (id) => document.getElementById(id);

let days = 30;
let loading = false;
let timer = null;
let seq = 0;

/* ---------------------------------------------------------------- format */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function fmtDur(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return "—";
  const s = Math.round(Number(sec));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60 ? `${s % 60} 秒` : ""}`.trim();
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}
export function fmtPct(rate) {
  return rate == null || !Number.isFinite(Number(rate)) ? "—" : `${(Number(rate) * 100).toFixed(1)}%`;
}
const fmtInt = (n) => (n == null ? "—" : Number(n).toLocaleString("zh-CN"));
const mmdd = (d) => (d ? String(d).slice(5) : "");
const KIND = {
  classic: "经典练习", daily: "今日挑战", archive_practice: "历史练习", puzzle: "残局挑战",
  oneshot: "一把梭", survival: "生存模式", ghost: "幽灵对局",
};

/* ---------------------------------------------------------------- charts (inline SVG, no deps) */
const W = 300;
const H = 90;

function emptyChart(msg = "暂无数据") {
  return `<div class="an-empty">${esc(msg)}</div>`;
}

/** Bars. items: [{ label, value, tip? }] */
export function barsSvg(items, { color = "var(--accent)", hi = -1 } = {}) {
  const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  if (!items.length || items.every((i) => !i.value)) return emptyChart();
  const gap = items.length > 40 ? 0.5 : 1.5;
  const bw = (W - gap * (items.length - 1)) / items.length;
  const rects = items.map((it, i) => {
    const v = Number(it.value) || 0;
    const h = Math.max(v > 0 ? 1.5 : 0, (v / max) * (H - 4));
    const x = i * (bw + gap);
    return `<rect x="${x.toFixed(2)}" y="${(H - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="1"
      fill="${i === hi ? "var(--ok)" : color}" opacity="${i === hi ? 1 : 0.85}"><title>${esc(it.tip ?? `${it.label}：${v}`)}</title></rect>`;
  }).join("");
  return `<svg class="an-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">${rects}</svg>`;
}

/** Line. items: [{ label, value|null, tip? }] — null breaks the line. */
export function lineSvg(items, { color = "var(--accent)" } = {}) {
  const vals = items.map((i) => (i.value == null ? null : Number(i.value)));
  const real = vals.filter((v) => v != null);
  if (!real.length) return emptyChart();
  const max = Math.max(1, ...real);
  const step = items.length > 1 ? W / (items.length - 1) : 0;
  const pt = (v, i) => `${(i * step).toFixed(2)},${(H - 3 - (v / max) * (H - 8)).toFixed(2)}`;
  const segs = [];
  let cur = [];
  vals.forEach((v, i) => {
    if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(pt(v, i));
  });
  if (cur.length) segs.push(cur);
  const lines = segs.map((s) => (s.length === 1
    ? `<circle cx="${s[0].split(",")[0]}" cy="${s[0].split(",")[1]}" r="1.8" fill="${color}" vector-effect="non-scaling-stroke"/>`
    : `<polyline points="${s.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`)).join("");
  const hit = items.map((it, i) => {
    const w = items.length > 1 ? W / items.length : W;
    return `<rect x="${(i * step - w / 2).toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${H}" fill="transparent"><title>${esc(it.tip ?? `${it.label}：${it.value ?? "—"}`)}</title></rect>`;
  }).join("");
  return `<svg class="an-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
    <line x1="0" y1="${H - 3}" x2="${W}" y2="${H - 3}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>${lines}${hit}</svg>`;
}

function chartCard(title, svg, caption, sub = "") {
  return `<div class="an-chart"><h3>${esc(title)}${sub ? ` <small>${esc(sub)}</small>` : ""}</h3>${svg}<p class="an-cap">${caption}</p></div>`;
}

function hbars(rows, { fmt = fmtInt } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length || rows.every((r) => !r.value)) return emptyChart();
  return `<div class="an-hbars">${rows.map((r) => `<div class="an-hrow"><span class="an-hl">${esc(r.label)}</span>
    <span class="an-htrack"><i style="width:${Math.max(r.value ? 2 : 0, (r.value / max) * 100).toFixed(1)}%"></i></span>
    <span class="an-hv">${esc(fmt(r.value))}${r.extra ? ` <small>${esc(r.extra)}</small>` : ""}</span></div>`).join("")}</div>`;
}

/* ---------------------------------------------------------------- sections */
function kpis(d) {
  const cards = [
    { v: fmtInt(d.online.now), l: "当前在线", sub: `10 分钟内 ${fmtInt(d.online.last10min)}`, big: true },
    { v: fmtInt(d.users.total), l: "注册用户", sub: `禁用 ${fmtInt(d.users.disabled)} · 已注销 ${fmtInt(d.users.deleted)}` },
    { v: fmtInt(d.users.newToday), l: "今日新增", sub: `近 7 天 ${fmtInt(d.users.new7d)}` },
    { v: fmtInt(d.activity.dau), l: "今日活跃", sub: `周活 ${fmtInt(d.activity.wau)}` },
    { v: fmtInt(d.activity.mau), l: "月活（30 天）", sub: `日活/月活 ${fmtPct(d.activity.stickiness)}` },
    { v: fmtDur(d.usage.avgSecondsPerActiveUser7d), l: "人均每日使用时长", sub: `近 7 天 · 今日 ${fmtDur(d.usage.avgSecondsPerActiveUserToday)}` },
  ];
  return `<div class="stats an-kpis">${cards.map((c) => `<div class="stat${c.big ? " an-big" : ""}"><b>${esc(c.v)}</b><span>${esc(c.l)}</span><em>${esc(c.sub)}</em></div>`).join("")}</div>`;
}

function trends(d) {
  const s = d.series;
  const first = mmdd(s[0]?.day);
  const last = mmdd(s[s.length - 1]?.day);
  const range = `${first} → ${last}`;
  const peak = (key) => s.reduce((b, x) => ((x[key] ?? 0) > (b?.[key] ?? -1) ? x : b), null);
  const regPk = peak("registered");
  const actPk = peak("active");
  const timeAvg = d.usage.avgSecondsPerActiveUserWindow;
  return `<div class="an-grid">
    ${chartCard("每日新增注册", barsSvg(s.map((x) => ({ label: mmdd(x.day), value: x.registered, tip: `${x.day}：新增 ${x.registered}` }))),
      `区间合计 <b>${fmtInt(s.reduce((a, x) => a + x.registered, 0))}</b>${regPk && regPk.registered ? ` · 最高 ${regPk.registered}（${mmdd(regPk.day)}）` : ""}`, range)}
    ${chartCard("每日活跃用户", lineSvg(s.map((x) => ({ label: mmdd(x.day), value: x.active, tip: `${x.day}：活跃 ${x.active}` }))),
      `今日 <b>${fmtInt(d.activity.dau)}</b>${actPk && actPk.active ? ` · 最高 ${actPk.active}（${mmdd(actPk.day)}）` : ""}`, range)}
    ${chartCard("每日人均使用时长", lineSvg(s.map((x) => ({ label: mmdd(x.day), value: x.avgSeconds == null ? null : Math.round(x.avgSeconds / 6) / 10, tip: `${x.day}：${x.avgSeconds == null ? "暂无数据" : fmtDur(x.avgSeconds)}` })), { color: "var(--ok)" }),
      timeAvg == null ? "采集刚开始，暂无数据" : `区间平均 <b>${fmtDur(timeAvg)}</b> / 活跃用户 / 天`, "分钟")}
    ${chartCard("每日开局数", barsSvg(s.map((x) => ({ label: mmdd(x.day), value: x.games, tip: `${x.day}：开局 ${x.games} · 对战 ${x.pvpMatches}` }))),
      `区间合计 <b>${fmtInt(d.games.startedWindow)}</b> 局 · 对战 ${fmtInt(d.games.pvpMatchesWindow)} 局（含机器人）`, range)}
  </div>`;
}

function usage(d) {
  const u = d.usage;
  const since = d.tracking.since;
  const note = since
    ? `时长从 <b>${esc(since)}</b> 起统计，已覆盖 ${fmtInt(d.tracking.users)} 位用户。`
    : "还没有收到任何心跳：用户更新到新版网页后才会开始累计。";
  return `<h2>使用时长</h2>
    <div class="stats">
      <div class="stat"><b>${fmtDur(u.avgSecondsPerVisitWindow)}</b><span>平均单次停留</span><em>区间内</em></div>
      <div class="stat"><b>${u.avgVisitsPerActiveUserWindow ?? "—"}</b><span>人均每日访问次数</span><em>区间内</em></div>
      <div class="stat"><b>${fmtDur(u.avgLifetimeSecondsPerUser)}</b><span>人均累计时长</span><em>中位数 ${fmtDur(u.medianLifetimeSecondsPerUser)}</em></div>
      <div class="stat"><b>${fmtDur(u.totalSecondsWindow)}</b><span>全站累计时长</span><em>区间内</em></div>
    </div>
    <div class="an-chart"><h3>累计时长分布 <small>按用户</small></h3>
      ${hbars(u.distribution.map((b) => ({ label: b.label, value: b.users })), { fmt: (v) => `${fmtInt(v)} 人` })}
    </div>
    <p class="note left">${note}「时长」= 页面可见且最近 5 分钟内有操作的累计时间；管理员账号不计入。</p>`;
}

const MEDALS = ["gold", "silver", "bronze"];
function top3(d) {
  if (!d.top3.length) return `<h2>累计时长 Top 3 <span class="tag">仅管理员可见</span></h2>${emptyChart("暂无数据，等用户开始使用后出现")}`;
  return `<h2>累计时长 Top 3 <span class="tag">仅管理员可见</span></h2>
    <ol class="an-top3">${d.top3.map((t) => `<li class="an-top an-${MEDALS[t.rank - 1] || "bronze"}">
      <span class="an-rank" aria-label="第 ${t.rank} 名">${t.rank}</span>
      <img class="ava" src="/images/avatars/${String(t.avatarId || 1).padStart(2, "0")}.png" alt="" width="40" height="40" data-fallback-src="/images/avatars/01.png" />
      <div class="an-who"><strong>${esc(t.nickname)}</strong><small>${esc(t.username)} · ID ${t.id}${t.status === "disabled" ? " · 已禁用" : ""}</small></div>
      <div class="an-time"><b>${esc(fmtDur(t.totalSeconds))}</b><small>累计</small></div>
      <div class="an-meta">活跃 ${fmtInt(t.activeDays)} 天 · 访问 ${fmtInt(t.visits)} 次 · 日均 ${esc(fmtDur(t.avgSecondsPerActiveDay))} · 最近 ${esc(mmdd(t.lastDay))}</div>
    </li>`).join("")}</ol>`;
}

function hours(d) {
  const h = d.hours;
  const peak = h.peakHour;
  const bars = h.byHourOfDay.map((b) => ({ label: `${b.hour}时`, value: b.avgUsers, tip: `${String(b.hour).padStart(2, "0")}:00–${String(b.hour).padStart(2, "0")}:59：平均 ${b.avgUsers} 人` }));
  const last = h.last24h.map((b) => ({ label: `${b.hour}时`, value: b.users, tip: `${String(b.hour).padStart(2, "0")}:00 时段：${b.users} 人` }));
  return `<h2>访问时段</h2><div class="an-grid">
    ${chartCard("近 24 小时每小时活跃人数", barsSvg(last), `当前整点 <b>${fmtInt(h.last24h[h.last24h.length - 1]?.users)}</b> 人`, "北京时间")}
    ${chartCard("一天里的高峰（区间平均）", barsSvg(bars, { hi: peak == null ? -1 : peak }),
      peak == null ? "暂无数据" : `高峰 <b>${String(peak).padStart(2, "0")}:00–${String(peak).padStart(2, "0")}:59</b>，平均 ${h.byHourOfDay[peak].avgUsers} 人`, "0–23 时")}
  </div>`;
}

function retention(d) {
  const r = d.retention;
  const cell = (x, label, hint) => `<div class="stat"><b>${fmtPct(x.rate)}</b><span>${label}</span><em>${x.cohort ? `${x.retained}/${x.cohort} 人` : "样本不足"} · ${hint}</em></div>`;
  return `<h2>留存与激活</h2><div class="stats">
    ${cell(r.d1, "次日留存", "注册后第 2 天仍活跃")}
    ${cell(r.d7, "7 日留存", "注册后第 8 天仍活跃")}
    <div class="stat"><b>${fmtPct(r.activation.rate)}</b><span>新用户开局率</span><em>${r.activation.registered ? `${r.activation.played}/${r.activation.registered} 人` : "样本不足"}</em></div>
    <div class="stat"><b>${fmtInt(d.activity.dormant7d)}</b><span>沉睡用户</span><em>注册满 7 天且 7 天没来</em></div>
  </div>
  <p class="note left">留存按近 ${Math.max(d.days, 30)} 天注册的用户统计（${esc(r.cohortFrom)} 起）。「活跃」= 当天有心跳、登录或开局，因此历史数据也能回算。</p>`;
}

function gamesAndEconomy(d) {
  const kinds = d.games.byKind.map((k) => ({
    label: KIND[k.kind] || k.kind, value: k.started,
    extra: k.started ? `完成 ${fmtPct(k.settled / k.started)}` : "",
  }));
  return `<h2>玩法与韭币</h2><div class="an-grid">
    <div class="an-chart"><h3>各玩法开局数 <small>近 ${d.days} 天</small></h3>${hbars(kinds, { fmt: (v) => `${fmtInt(v)} 局` })}
      <p class="an-cap">人均每活跃日 <b>${d.games.perActiveUserDayWindow == null ? "—" : d.games.perActiveUserDayWindow.toFixed(1)}</b> 局</p></div>
    <div class="an-chart"><h3>韭币</h3><div class="stats">
      <div class="stat"><b>${fmtInt(d.economy.jiuCoinTotal)}</b><span>流通总量</span><em>全部用户余额</em></div>
      <div class="stat"><b>${fmtInt(d.economy.jiuCoinAvg)}</b><span>人均余额</span><em>&nbsp;</em></div>
      <div class="stat"><b>${fmtPct(d.users.leaderboardOptInRate)}</b><span>上榜意愿</span><em>${fmtInt(d.users.leaderboardOptIn)} 人开启</em></div>
    </div></div>
  </div>`;
}

export function renderAnalytics(d) {
  return `${kpis(d)}${trends(d)}${top3(d)}${usage(d)}${hours(d)}${retention(d)}${gamesAndEconomy(d)}
    <p class="note left">统计口径：北京时间；只统计普通用户（不含管理员、已注销账号）；游客不登录无法统计在线。在线 = 最近 ${d.online.windowSeconds} 秒内有心跳。</p>`;
}

/* ---------------------------------------------------------------- loading */
function stamp(text) {
  const el = $("anStamp");
  if (el) el.textContent = text;
}

export async function loadAnalytics({ silent = false } = {}) {
  const body = $("anBody");
  if (!body || loading) return;
  loading = true;
  const mine = ++seq;
  if (!silent) body.innerHTML = `<p class="note left">加载中…</p>`;
  try {
    const res = await fetch(`${API}/admin/analytics?days=${days}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
    const json = await res.json().catch(() => null);
    if (mine !== seq) return;
    if (res.status !== 200 || !json?.data) {
      if (!silent || !body.querySelector(".an-kpis")) body.innerHTML = `<p class="msg">${esc(json?.error?.message || "读取失败")}</p>`;
      return;
    }
    body.innerHTML = renderAnalytics(json.data);
    const t = new Date(json.data.generatedAt);
    stamp(`更新于 ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`);
  } catch {
    if (!silent) body.innerHTML = `<p class="msg">网络错误，稍后重试</p>`;
  } finally {
    loading = false;
  }
}

function panelVisible() {
  const p = document.querySelector('.tabpanel[data-panel="analytics"]');
  const ops = $("opsPanel");
  return !!p && !p.classList.contains("hidden") && !(ops && ops.classList.contains("hidden")) && !document.hidden;
}

function startTimer() {
  if (timer) return;
  timer = setInterval(() => { if (panelVisible()) loadAnalytics({ silent: true }); }, REFRESH_MS);
}

export function initAnalytics() {
  const tab = document.querySelector('.tabs .tab[data-tab="analytics"]');
  if (!tab || !$("anBody")) return;
  tab.addEventListener("click", () => { loadAnalytics(); startTimer(); });
  $("anRefresh")?.addEventListener("click", () => loadAnalytics());
  $("anDays")?.addEventListener("change", (e) => { days = Number(e.target.value) || 30; loadAnalytics(); });
  document.addEventListener("visibilitychange", () => { if (panelVisible()) loadAnalytics({ silent: true }); });
}

if (typeof document !== "undefined" && document.getElementById) initAnalytics();
