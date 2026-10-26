import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { esc, fmtDur, fmtPct, barsSvg, lineSvg, renderAnalytics } from '../admin/analytics.js';

const html = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');

function sample(over = {}) {
  const series = Array.from({ length: 7 }, (_, i) => ({
    day: `2026-10-${String(20 + i).padStart(2, '0')}`, registered: i, active: i * 2, avgSeconds: i ? i * 60 : null,
    totalSeconds: i * 120, games: i * 3, pvpMatches: i,
  }));
  return {
    generatedAt: '2026-10-26T10:00:00.000Z', timezone: 'Asia/Shanghai', days: 7, today: '2026-10-26',
    tracking: { since: '2026-10-24', users: 3 },
    online: { now: 4, last10min: 6, windowSeconds: 90 },
    users: { total: 120, active: 118, disabled: 2, deleted: 1, newToday: 3, new7d: 20, new30d: 80, leaderboardOptIn: 60, leaderboardOptInRate: 0.5 },
    activity: { dau: 30, wau: 70, mau: 100, stickiness: 0.3, dormant7d: 12 },
    usage: {
      avgSecondsPerActiveUserToday: 600, avgSecondsPerActiveUser7d: 900, avgSecondsPerActiveUserWindow: 800,
      avgSecondsPerVisitWindow: 400, avgVisitsPerActiveUserWindow: 2.1, avgLifetimeSecondsPerUser: 2400, medianLifetimeSecondsPerUser: 1500,
      totalSecondsWindow: 7200, distribution: [{ key: 'lt5m', label: '< 5 分钟', users: 2 }, { key: 'm5_15', label: '5–15 分钟', users: 1 }],
    },
    top3: [
      { rank: 1, id: 7, username: 'alice', nickname: '<img src=x onerror=alert(1)>', avatarId: 3, status: 'active', totalSeconds: 7500, visits: 9, activeDays: 4, lastDay: '2026-10-26', avgSecondsPerActiveDay: 1875 },
      { rank: 2, id: 8, username: 'bob', nickname: 'Bob', avatarId: 1, status: 'disabled', totalSeconds: 3000, visits: 3, activeDays: 2, lastDay: '2026-10-25', avgSecondsPerActiveDay: 1500 },
    ],
    hours: {
      last24h: Array.from({ length: 24 }, (_, i) => ({ hour: i, users: i % 5 })),
      byHourOfDay: Array.from({ length: 24 }, (_, i) => ({ hour: i, avgUsers: i === 21 ? 5.5 : 1 })),
      peakHour: 21,
    },
    retention: { cohortFrom: '2026-09-27', d1: { cohort: 10, retained: 4, rate: 0.4 }, d7: { cohort: 0, retained: 0, rate: null }, activation: { registered: 20, played: 15, rate: 0.75 }, everPlayedRate: 0.8 },
    games: { startedWindow: 200, perActiveUserDayWindow: 1.5, byKind: [{ kind: 'classic', started: 120, settled: 90 }, { kind: 'oneshot', started: 80, settled: 40 }], pvpMatchesWindow: 12 },
    economy: { jiuCoinTotal: 5000, jiuCoinAvg: 42 },
    series,
    ...over,
  };
}

test('formatters', () => {
  assert.equal(fmtDur(null), '—');
  assert.equal(fmtDur(45), '45 秒');
  assert.equal(fmtDur(125), '2 分 5 秒');
  assert.equal(fmtDur(3600), '1 小时');
  assert.equal(fmtDur(7500), '2 小时 5 分');
  assert.equal(fmtPct(null), '—');
  assert.equal(fmtPct(0.4), '40.0%');
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('charts degrade to an empty state instead of NaN / blank svg', () => {
  assert.match(barsSvg([]), /an-empty/);
  assert.match(barsSvg([{ label: 'a', value: 0 }]), /an-empty/);
  assert.match(lineSvg([{ label: 'a', value: null }]), /an-empty/);
  const one = lineSvg([{ label: 'a', value: 5 }]);
  assert.doesNotMatch(one, /NaN/);
  assert.match(barsSvg([{ label: 'a', value: 1 }, { label: 'b', value: 3 }], { hi: 1 }), /var\(--ok\)/);
});

test('renderAnalytics: every section is present, user text is escaped', () => {
  const out = renderAnalytics(sample());
  for (const t of ['当前在线', '注册用户', '今日新增', '今日活跃', '月活', '人均每日使用时长',
    '每日新增注册', '每日活跃用户', '每日人均使用时长', '每日开局数',
    '累计时长 Top 3', '仅管理员可见', '使用时长', '访问时段', '留存与激活', '玩法与韭币', '统计口径']) {
    assert.ok(out.includes(t), `missing: ${t}`);
  }
  assert.doesNotMatch(out, /<img src=x/);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(out, /已禁用/);
  assert.match(out, /一把梭/);
  assert.match(out, /高峰 <b>21:00–21:59<\/b>/);
  assert.match(out, /样本不足/);
  assert.doesNotMatch(out, /NaN|undefined/);
});

test('renderAnalytics survives a brand-new install (no data at all)', () => {
  const empty = sample({
    tracking: { since: null, users: 0 }, online: { now: 0, last10min: 0, windowSeconds: 90 }, top3: [],
    usage: { avgSecondsPerActiveUserToday: null, avgSecondsPerActiveUser7d: null, avgSecondsPerActiveUserWindow: null, avgSecondsPerVisitWindow: null, avgVisitsPerActiveUserWindow: null, avgLifetimeSecondsPerUser: null, medianLifetimeSecondsPerUser: null, totalSecondsWindow: 0, distribution: [] },
    hours: { last24h: [], byHourOfDay: [], peakHour: null },
    retention: { cohortFrom: '2026-09-27', d1: { cohort: 0, retained: 0, rate: null }, d7: { cohort: 0, retained: 0, rate: null }, activation: { registered: 0, played: 0, rate: null }, everPlayedRate: null },
    games: { startedWindow: 0, perActiveUserDayWindow: null, byKind: [], pvpMatchesWindow: 0 },
    series: sample().series.map((s) => ({ ...s, registered: 0, active: 0, avgSeconds: null, games: 0, pvpMatches: 0 })),
  });
  const out = renderAnalytics(empty);
  assert.doesNotMatch(out, /NaN|undefined|null/);
  assert.match(out, /还没有收到任何心跳/);
});

test('admin page: new 「数据」 tab + panel exist, the old tabs are all still there', () => {
  assert.match(html, /data-tab="analytics"[^>]*>数据</);
  assert.match(html, /data-panel="analytics"/);
  assert.match(html, /<script type="module" src="\.\/analytics\.js">/);
  for (const t of ['users', 'coin', 'wheel', 'games', 'ann', 'fb', 'content', 'settings', 'pvp', 'version', 'audit', 'security']) {
    assert.match(html, new RegExp(`data-tab="${t}"`), `old tab ${t} must stay`);
    assert.match(html, new RegExp(`data-panel="${t}"`), `old panel ${t} must stay`);
  }
  // the default tab is still 账号
  assert.match(readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8'), /let initialTab = "users";/);
});
