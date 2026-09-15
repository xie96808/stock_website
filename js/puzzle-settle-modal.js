/**
 * F02 puzzle settle celebration modal — paper shell (mirrors F11 dailyQuizResultModal).
 * Includes 残局专属复盘 section when puzzleResult / session context is available.
 */
import {
  formatPuzzleSettleModal,
  renderGoalStarIcon,
  renderStarIcons,
} from './puzzle-settle-copy.js';
import { formatPuzzleDebrief } from './puzzle-debrief-copy.js';
import { amountWithCoinHtml } from './jiu-coin.js';

function modalEl() {
  return document.getElementById('puzzleSettleModal');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build HTML for debrief block (modal or result screen).
 * @param {ReturnType<typeof formatPuzzleDebrief>} debrief
 */
export function renderPuzzleDebriefHtml(debrief) {
  if (!debrief) return '';
  const parts = [];
  parts.push(`<div class="puzzle-debrief" data-status="${escapeHtml(debrief.status)}">`);
  parts.push(`<div class="puzzle-debrief-title">${escapeHtml(debrief.sectionTitle || '复盘')}</div>`);

  if (debrief.buyHoldCompare) {
    const c = debrief.buyHoldCompare;
    parts.push('<div class="puzzle-debrief-block puzzle-debrief-buyhold">');
    parts.push('<div class="puzzle-debrief-label">对照买持</div>');
    parts.push(`<div class="puzzle-debrief-summary">${escapeHtml(c.summaryLine)}</div>`);
    parts.push(`<p class="puzzle-debrief-p">${escapeHtml(c.paragraph)}</p>`);
    parts.push('</div>');
  }

  if (debrief.starBreakdown) {
    const s = debrief.starBreakdown;
    parts.push('<div class="puzzle-debrief-block puzzle-debrief-stars">');
    parts.push('<div class="puzzle-debrief-label">星级拆解</div>');
    if (s.starN != null) {
      parts.push(
        `<div class="puzzle-debrief-stars-row">${renderStarIcons(s.starN).html}</div>`
      );
    }
    parts.push('<ul class="puzzle-debrief-star-list">');
    const items = s.items?.length
      ? s.items
      : (s.lines || []).map((line) => ({ met: line.startsWith('✓'), label: line.replace(/^[✓○]\s*/, ''), ariaLabel: '' }));
    for (const item of items) {
      const met = !!item.met;
      const icon = renderGoalStarIcon(met, item.ariaLabel || (met ? '已达成' : '未达成'));
      parts.push(
        `<li class="puzzle-goal-row">${icon}<span class="puzzle-goal-label">${escapeHtml(item.label)}</span></li>`
      );
    }
    parts.push('</ul>');
    if (s.paragraph) {
      parts.push(`<p class="puzzle-debrief-p">${escapeHtml(s.paragraph)}</p>`);
    }
    parts.push('</div>');
  }

  if (debrief.teachingTip?.paragraph) {
    const tip = debrief.teachingTip;
    parts.push('<div class="puzzle-debrief-block puzzle-debrief-tip">');
    parts.push(
      `<div class="puzzle-debrief-label">${escapeHtml(tip.title || '本关提示')}</div>`
    );
    parts.push(`<p class="puzzle-debrief-p">${escapeHtml(tip.paragraph)}</p>`);
    parts.push('</div>');
  }

  if (debrief.situationParagraphs?.length) {
    parts.push('<div class="puzzle-debrief-block puzzle-debrief-situation">');
    parts.push('<div class="puzzle-debrief-label">本关情境</div>');
    for (const para of debrief.situationParagraphs) {
      parts.push(`<p class="puzzle-debrief-p">${escapeHtml(para)}</p>`);
    }
    parts.push('</div>');
  }

  if (debrief.bsNote) {
    parts.push(`<p class="puzzle-debrief-bs-note">${escapeHtml(debrief.bsNote)}</p>`);
  }

  parts.push('</div>');
  return parts.join('');
}

/**
 * Paint result-screen debrief host; suppress classic BS shell for puzzle.
 * @param {ReturnType<typeof formatPuzzleDebrief>|null} debrief
 */
export function paintPuzzleResultDebrief(debrief) {
  const host = document.getElementById('puzzleDebrief');
  const bsReport = document.getElementById('bsReport');
  const klineAnalysis = document.getElementById('klineAnalysis');
  const bsScoreDisplay = document.getElementById('bsScoreDisplay');

  if (bsScoreDisplay) bsScoreDisplay.textContent = '--';

  if (host) {
    if (debrief) {
      host.hidden = false;
      host.innerHTML = renderPuzzleDebriefHtml(debrief);
    } else {
      host.hidden = true;
      host.innerHTML = '';
    }
  }

  if (bsReport) {
    if (debrief) {
      bsReport.hidden = true;
      bsReport.innerHTML = '';
    } else {
      bsReport.hidden = false;
    }
  }

  if (klineAnalysis) {
    if (debrief) {
      klineAnalysis.hidden = true;
      klineAnalysis.innerHTML = '';
    } else {
      klineAnalysis.hidden = false;
    }
  }
}

/** Clear puzzle debrief hosts when leaving puzzle result (classic next). */
export function clearPuzzleResultDebrief() {
  const host = document.getElementById('puzzleDebrief');
  if (host) {
    host.hidden = true;
    host.innerHTML = '';
  }
  const bsReport = document.getElementById('bsReport');
  if (bsReport) bsReport.hidden = false;
  const klineAnalysis = document.getElementById('klineAnalysis');
  if (klineAnalysis) klineAnalysis.hidden = false;
}

function ensureBound() {
  const modal = modalEl();
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePuzzleSettleModal();
  });
}

/**
 * @param {{
 *   status?: 'pending'|'ok'|'fail',
 *   puzzleResult?: object|null,
 *   saveError?: string|null,
 *   theme?: string|null,
 *   teachingBrief?: string|null,
 *   openStateHint?: string|null,
 *   initialState?: object|null,
 *   maxOrders?: number|null,
 *   tradeHistory?: array,
 *   gameDays?: number|null,
 * }} state
 */
export function showPuzzleSettleModal(state) {
  ensureBound();
  const modal = modalEl();
  if (!modal) return;
  const copy = formatPuzzleSettleModal(state || { status: 'pending' });
  const debrief = formatPuzzleDebrief(state || { status: 'pending' });
  const titleEl = document.getElementById('puzzleSettleTitle');
  const starsEl = document.getElementById('puzzleSettleStars');
  const headlineEl = document.getElementById('puzzleSettleHeadline');
  const rewardEl = document.getElementById('puzzleSettleReward');
  const goalsEl = document.getElementById('puzzleSettleGoals');
  const edgeEl = document.getElementById('puzzleSettleEdge');
  const hintEl = document.getElementById('puzzleSettleHint');
  const failEl = document.getElementById('puzzleSettleFail');
  const debriefEl = document.getElementById('puzzleSettleDebrief');
  const body = document.getElementById('puzzleSettleBody');

  if (titleEl) titleEl.textContent = copy.title;
  if (starsEl) {
    starsEl.innerHTML =
      copy.starsHtml ||
      renderStarIcons(copy.starN, {
        pending: copy.status === 'pending' || copy.status === 'fail' || copy.starN == null,
      }).html;
    starsEl.className =
      'puzzle-settle-stars' +
      (copy.status === 'pending' || copy.status === 'fail' ? ' is-pending' : '') +
      (copy.starN != null && copy.starN >= 3 ? ' is-three' : '');
    if (copy.starsAriaLabel) starsEl.setAttribute('aria-label', copy.starsAriaLabel);
  }
  if (headlineEl) headlineEl.textContent = copy.headline;

  if (rewardEl) {
    if (copy.rewardGranted && copy.rewardAmount != null) {
      rewardEl.hidden = false;
      rewardEl.innerHTML =
        '首通奖励 +' + amountWithCoinHtml(copy.rewardAmount, { size: 16 });
    } else if (copy.rewardLine) {
      rewardEl.hidden = false;
      rewardEl.textContent = copy.rewardLine;
    } else {
      rewardEl.hidden = true;
      rewardEl.textContent = '';
    }
  }

  if (goalsEl) {
    const items = copy.goalItems?.length
      ? copy.goalItems
      : (copy.goalLines || []).map((line) => ({
          met: line.startsWith('✓') ? true : line.startsWith('○') ? false : null,
          label: line.replace(/^[✓○·]\s*/, ''),
          ariaLabel: '',
        }));
    if (items.length) {
      goalsEl.hidden = false;
      goalsEl.innerHTML = items
        .map((item) => {
          const met = item.met === true;
          const pending = item.met == null;
          const icon = pending
            ? '<span class="puzzle-star puzzle-star--goal puzzle-star--pending" aria-hidden="true"></span>'
            : renderGoalStarIcon(met, item.ariaLabel || (met ? '已达成' : '未达成'));
          return `<li class="puzzle-goal-row">${icon}<span class="puzzle-goal-label">${escapeHtml(item.label)}</span></li>`;
        })
        .join('');
    } else {
      goalsEl.hidden = true;
      goalsEl.innerHTML = '';
    }
  }

  if (edgeEl) {
    if (copy.edgeLine) {
      edgeEl.hidden = false;
      edgeEl.textContent = copy.edgeLine;
    } else {
      edgeEl.hidden = true;
      edgeEl.textContent = '';
    }
  }

  if (debriefEl) {
    debriefEl.hidden = false;
    debriefEl.innerHTML = renderPuzzleDebriefHtml(debrief);
  }

  // Also paint result-screen host when modal updates after finish.
  paintPuzzleResultDebrief(debrief);

  if (hintEl) {
    if (copy.hintLine) {
      hintEl.hidden = false;
      hintEl.textContent = copy.hintLine;
    } else {
      hintEl.hidden = true;
      hintEl.textContent = '';
    }
  }

  if (failEl) {
    if (copy.failNote) {
      failEl.hidden = false;
      failEl.textContent = copy.failNote;
    } else {
      failEl.hidden = true;
      failEl.textContent = '';
    }
  }

  if (body) {
    body.dataset.status = copy.status;
  }

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
}

export function closePuzzleSettleModal() {
  const modal = modalEl();
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
}

/** Dismiss celebration and return to puzzle chapter list (same as playAgain for puzzle). */
export function returnToPuzzleListFromSettleModal() {
  closePuzzleSettleModal();
  if (typeof window.playAgain === 'function') {
    window.playAgain();
  }
}
