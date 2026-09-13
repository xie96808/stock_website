/**
 * F02 puzzle settle celebration modal — paper shell (mirrors F11 dailyQuizResultModal).
 */
import { formatPuzzleSettleModal } from './puzzle-settle-copy.js';
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
 * }} state
 */
export function showPuzzleSettleModal(state) {
  ensureBound();
  const modal = modalEl();
  if (!modal) return;
  const copy = formatPuzzleSettleModal(state || { status: 'pending' });
  const titleEl = document.getElementById('puzzleSettleTitle');
  const starsEl = document.getElementById('puzzleSettleStars');
  const headlineEl = document.getElementById('puzzleSettleHeadline');
  const rewardEl = document.getElementById('puzzleSettleReward');
  const goalsEl = document.getElementById('puzzleSettleGoals');
  const edgeEl = document.getElementById('puzzleSettleEdge');
  const hintEl = document.getElementById('puzzleSettleHint');
  const failEl = document.getElementById('puzzleSettleFail');
  const body = document.getElementById('puzzleSettleBody');

  if (titleEl) titleEl.textContent = copy.title;
  if (starsEl) {
    starsEl.textContent = copy.starsGlyph;
    starsEl.className =
      'puzzle-settle-stars' +
      (copy.status === 'pending' || copy.status === 'fail' ? ' is-pending' : '') +
      (copy.starN != null && copy.starN >= 3 ? ' is-three' : '');
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
    if (copy.goalLines?.length) {
      goalsEl.hidden = false;
      goalsEl.innerHTML = copy.goalLines
        .map((line) => `<li>${escapeHtml(line)}</li>`)
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
