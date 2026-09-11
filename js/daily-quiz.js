// ========== F11 每日计奖题组 ==========
import { api, getAuthState, openAuthModal, showToast, refreshMe } from './auth.js';
import { amountWithCoinHtml } from './jiu-coin.js';

let quizRewardsEnabled = false;
let dailyCache = null;
let flow = {
  attemptId: null,
  questions: [],
  index: 0,
  submitting: false,
  settled: null,
};

export function isQuizRewardsEnabled() {
  return quizRewardsEnabled;
}

/** Soft-read public config; hide card when flag off or request fails. */
export async function refreshQuizRewardsFlag() {
  try {
    const res = await fetch('/api/v1/config', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const json = await res.json().catch(() => ({}));
    quizRewardsEnabled = !!(json?.data?.features?.quizRewards);
  } catch {
    quizRewardsEnabled = false;
  }
  return quizRewardsEnabled;
}

function cardEl() {
  return document.getElementById('dailyQuizCard');
}

function hideRewardedSurfaces() {
  const card = cardEl();
  if (card) card.hidden = true;
  const zone = document.getElementById('dailyQuizZone');
  if (zone) zone.style.display = 'none';
  const results = document.getElementById('dailyQuizResults');
  if (results) results.style.display = 'none';
}

export async function refreshDailyQuizCard() {
  const card = cardEl();
  if (!card) return;
  if (!quizRewardsEnabled) {
    hideRewardedSurfaces();
    return;
  }
  card.hidden = false;
  const stateEl = document.getElementById('dailyQuizCardState');
  const ctaEl = document.getElementById('dailyQuizCardCta');
  try {
    dailyCache = (await api('/quiz/daily')).data;
  } catch (e) {
    if (e.code === 'QUIZ_REWARDS_DISABLED' || e.status === 404) {
      quizRewardsEnabled = false;
      hideRewardedSurfaces();
      return;
    }
    if (stateEl) stateEl.textContent = '状态加载失败，点此重试';
    if (ctaEl) ctaEl.textContent = '重试';
    return;
  }

  const d = dailyCache;
  if (!d.ready) {
    if (stateEl) stateEl.textContent = d.message || '今日题组准备中';
    if (ctaEl) ctaEl.textContent = '稍后再来';
    card.classList.add('is-disabled');
    return;
  }
  card.classList.remove('is-disabled');

  const maxLabel = amountWithCoinHtml(d.maxReward, { size: 14 });
  const meta = document.getElementById('dailyQuizCardMeta');
  if (meta) {
    meta.innerHTML = `5题 · 最多 ${maxLabel}`;
  }

  if (d.status === 'settled') {
    if (stateEl) stateEl.innerHTML = `已领 ${amountWithCoinHtml(d.rewardAmount, { size: 14 })}`;
    if (ctaEl) ctaEl.textContent = '查看结果';
  } else if (d.status === 'in_progress') {
    if (stateEl) stateEl.textContent = `进行中 ${d.answeredCount}/5`;
    if (ctaEl) ctaEl.textContent = '继续';
  } else {
    if (stateEl) stateEl.textContent = '未开始';
    if (ctaEl) ctaEl.textContent = '开始今日题组';
  }
}

export async function onDailyQuizCardClick() {
  if (!quizRewardsEnabled) return;
  const auth = getAuthState();
  if (!auth?.user) {
    showToast('登录后才能领取今日题组奖励（游客仍可去训练区免费练习）', 'error');
    openAuthModal('login');
    return;
  }
  if (dailyCache && !dailyCache.ready) {
    showToast(dailyCache.message || '今日题组准备中', 'error');
    return;
  }
  if (dailyCache?.status === 'settled' && dailyCache.attemptId) {
    await showDailyQuizResults(dailyCache.attemptId);
    return;
  }
  await enterDailyQuizZone();
}

export async function enterDailyQuizZone() {
  const auth = getAuthState();
  if (!auth?.user) {
    openAuthModal('login');
    return;
  }
  try {
    const created = await api('/quiz/daily/attempts', { method: 'POST', body: {} });
    flow.attemptId = created.data.attemptId;
    const daily = (await api('/quiz/daily')).data;
    dailyCache = daily;
    if (!daily.ready) {
      showToast(daily.message || '今日题组准备中', 'error');
      return;
    }
    flow.questions = daily.questions || [];
    flow.settled = daily.status === 'settled' ? daily : null;
    // Resume at first unanswered
    const answeredIds = new Set(flow.questions.filter((q) => q.yourOptionId).map((q) => q.id));
    let idx = flow.questions.findIndex((q) => !answeredIds.has(q.id));
    if (idx < 0) idx = flow.questions.length - 1;
    flow.index = Math.max(0, idx);

    document.getElementById('academyLanding').style.display = 'none';
    document.getElementById('knowledgeZone').style.display = 'none';
    document.getElementById('trainingZone').style.display = 'none';
    document.getElementById('trainingResults').style.display = 'none';
    const results = document.getElementById('dailyQuizResults');
    if (results) results.style.display = 'none';
    document.getElementById('dailyQuizZone').style.display = 'block';

    if (daily.status === 'settled') {
      await showDailyQuizResults(flow.attemptId);
      return;
    }
    renderDailyQuestion();
  } catch (e) {
    showToast(e.message || '无法开始今日题组', 'error');
  }
}

function renderDailyQuestion() {
  const q = flow.questions[flow.index];
  const container = document.getElementById('dailyQuizQuestionContainer');
  const labels = ['A', 'B', 'C', 'D'];
  if (!q || !container) return;

  const locked = !!q.yourOptionId;
  let html =
    '<span class="quiz-question-type theory">今日计奖</span>' +
    '<div class="quiz-question-text">第 ' + (flow.index + 1) + ' 题：' + escapeHtml(q.stem) + '</div>' +
    '<div class="quiz-options">';
  (q.options || []).forEach((opt, i) => {
    const selected = locked && q.yourOptionId === opt.id;
    html +=
      '<div class="quiz-option' + (selected ? ' selected' : '') + '" data-option-id="' + escapeAttr(opt.id) + '"' +
      (locked ? ' style="pointer-events:none"' : ' onclick="selectDailyQuizAnswer(\'' + escapeAttr(opt.id) + '\')"') + '>' +
      '<div class="quiz-option-label">' + labels[i] + '</div>' +
      '<div class="quiz-option-text">' + escapeHtml(opt.text) + '</div></div>';
  });
  html += '</div>';
  if (locked) {
    html += '<div class="quiz-explanation"><strong>已锁定首次答案。</strong>全部提交后统一看解析，结算前不公布对错。</div>';
  }
  container.innerHTML = html;

  const total = flow.questions.length || 5;
  document.getElementById('dailyQuizProgressBar').style.width = ((flow.index + 1) / total * 100) + '%';
  document.getElementById('dailyQuizProgressText').textContent = (flow.index + 1) + ' / ' + total;
  const nextBtn = document.getElementById('dailyQuizNextBtn');
  nextBtn.disabled = !locked || flow.submitting;
  nextBtn.textContent = flow.index >= total - 1 ? (locked ? '查看结果' : '请先作答') : '下一题';
}

export async function selectDailyQuizAnswer(optionId) {
  if (flow.submitting) return;
  const q = flow.questions[flow.index];
  if (!q || q.yourOptionId) return;
  flow.submitting = true;
  // Keep next disabled while the request is in flight.
  const nextBtn = document.getElementById('dailyQuizNextBtn');
  if (nextBtn) nextBtn.disabled = true;
  try {
    const res = await api('/quiz/attempts/' + encodeURIComponent(flow.attemptId) + '/answers', {
      method: 'POST',
      body: { questionId: q.id, optionId },
    });
    q.yourOptionId = res.data.optionId || optionId;
    if (res.data.status === 'settled' && res.data.settled) {
      flow.settled = res.data.settled;
      flow.submitting = false;
      try { await refreshMe(); } catch (_) {}
      await showDailyQuizResults(flow.attemptId, res.data.settled);
      return;
    }
  } catch (e) {
    showToast(e.message || '提交失败', 'error');
  } finally {
    // Clear before re-render — otherwise nextBtn stays disabled forever
    // (renderDailyQuestion used to run while submitting===true).
    flow.submitting = false;
    if (document.getElementById('dailyQuizZone')?.style.display !== 'none' &&
        document.getElementById('dailyQuizResults')?.style.display !== 'block') {
      renderDailyQuestion();
    }
  }
}

export async function dailyQuizNext() {
  const q = flow.questions[flow.index];
  if (!q?.yourOptionId) return;
  if (flow.index >= flow.questions.length - 1) {
    // Last already submitted via select; if somehow pending, no-op
    if (flow.settled) await showDailyQuizResults(flow.attemptId, flow.settled);
    return;
  }
  flow.index += 1;
  renderDailyQuestion();
}

export async function showDailyQuizResults(attemptId, settledHint) {
  document.getElementById('dailyQuizZone').style.display = 'none';
  document.getElementById('academyLanding').style.display = 'none';
  document.getElementById('trainingZone').style.display = 'none';
  document.getElementById('trainingResults').style.display = 'none';
  const panel = document.getElementById('dailyQuizResults');
  panel.style.display = 'block';

  let review = null;
  try {
    review = (await api('/quiz/attempts/' + encodeURIComponent(attemptId))).data;
  } catch (e) {
    showToast(e.message || '无法加载解析', 'error');
  }

  const firstCorrect = review?.firstCorrectCount ?? settledHint?.firstCorrectCount ?? 0;
  const rewardAmount = review?.rewardAmount ?? settledHint?.rewardAmount ?? 0;
  const complete = 10;
  const bonus = rewardAmount > complete ? rewardAmount - complete : 0;

  document.getElementById('dailyQuizResultCard').innerHTML =
    '<h2 class="daily-quiz-result-title">今日题组结算</h2>' +
    '<div class="quiz-score ' + (firstCorrect >= 4 ? 'high' : firstCorrect >= 3 ? 'medium' : 'low') + '">' +
    firstCorrect + ' / 5 首次答对</div>' +
    '<div class="daily-quiz-reward-breakdown">' +
    '<div>完成 5 题　+' + amountWithCoinHtml(complete, { size: 14 }) + '</div>' +
    '<div>首次正确 ≥4　+' + amountWithCoinHtml(bonus, { size: 14 }) + (bonus ? '' : '（未达成）') + '</div>' +
    '<div class="daily-quiz-reward-total">合计　+' + amountWithCoinHtml(rewardAmount, { size: 16 }) + '</div>' +
    '<p class="daily-quiz-reward-note">与每日领取互不影响；重练不改分、不重发。</p>' +
    '</div>';

  const labels = ['A', 'B', 'C', 'D'];
  let details = '';
  (review?.questions || []).forEach((q, i) => {
    const optMap = Object.fromEntries((q.options || []).map((o) => [o.id, o.text]));
    const your = q.yourOptionId ? (optMap[q.yourOptionId] || q.yourOptionId) : '未作答';
    const correct = optMap[q.correctOptionId] || q.correctOptionId;
    const ok = !!q.yourCorrect;
    const color = ok ? '#3db86a' : '#e05252';
    const icon = ok ? '&#10003;' : '&#10007;';
    details +=
      '<div class="quiz-result-item ' + (ok ? 'correct-item' : 'wrong') + '">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
      '<span style="font-family:\'JetBrains Mono\';font-weight:700;color:' + color + ';font-size:1.1rem">' + icon + '</span>' +
      '<span style="font-size:0.82rem;color:var(--text-muted)">第 ' + (i + 1) + ' 题</span></div>' +
      '<div style="font-size:0.9rem;color:var(--text-primary);margin-bottom:8px">' + escapeHtml(q.stem) + '</div>' +
      '<div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:4px">' +
      '你的答案：<span style="color:' + (ok ? '#3db86a' : '#e05252') + '">' + escapeHtml(your) + '</span> | ' +
      '正确答案：<span style="color:#3db86a">' + escapeHtml(correct) + '</span></div>' +
      '<div style="font-size:0.82rem;color:var(--text-muted);line-height:1.6;margin-top:6px">' + escapeHtml(q.explanation || '') + '</div>' +
      '</div>';
  });
  document.getElementById('dailyQuizResultDetails').innerHTML = details || '<p>暂无解析</p>';
  await refreshDailyQuizCard();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s ?? '').replace(/['"<>&\\]/g, '');
}
