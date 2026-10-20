/**
 * System announcements modal — paper/ink sketch UI.
 * Auto-opens unless localStorage says dismissed for today's local calendar day.
 */

import { formatShanghaiDateTime } from "./time.js";
import { openCtlOverlay, closeCtlOverlay } from "./controls.js";
const API = "/api/v1";
const STORAGE_KEY = "stockgame_announcements_dismissed_day";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function localDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isDismissedToday() {
  try {
    return localStorage.getItem(STORAGE_KEY) === localDayKey();
  } catch {
    return false;
  }
}

function dismissToday() {
  try {
    localStorage.setItem(STORAGE_KEY, localDayKey());
  } catch {
    /* ignore quota / private mode */
  }
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function ensureDom() {
  let btn = document.getElementById("announcementsBtn");
  const chip = document.getElementById("authChip");
  if (!btn && chip) {
    btn = el(
      `<button type="button" class="announcements-btn" id="announcementsBtn" title="系统公告" aria-label="系统公告">公告</button>`
    );
    chip.insertBefore(btn, chip.firstChild);
  }

  if (!document.getElementById("announcementsModal")) {
    document.body.appendChild(
      el(`<div class="announcements-modal" id="announcementsModal" hidden>
        <div class="announcements-dialog" role="dialog" aria-modal="true" aria-labelledby="announcementsTitle">
          <button type="button" class="announcements-close-x" id="announcementsCloseX" aria-label="关闭">×</button>
          <h2 id="announcementsTitle">系统公告</h2>
          <div class="announcements-list" id="announcementsList"></div>
          <p class="announcements-empty" id="announcementsEmpty" hidden>暂无公告</p>
          <div class="announcements-actions">
            <button type="button" class="announcements-secondary ctl ctl-secondary" id="announcementsDismissToday" data-ctl-kind="secondary" data-state="default"><span class="ctl-label">今日关闭</span></button>
            <button type="button" class="announcements-primary ctl ctl-primary" id="announcementsClose" data-ctl-kind="primary" data-state="default"><span class="ctl-label">关闭公告</span></button>
          </div>
        </div>
      </div>`)
    );
  }
}

function formatPublishedAt(iso) {
  if (!iso) return "";
  const formatted = formatShanghaiDateTime(iso);
  return escapeHtml(formatted || iso);
}

function renderList(items) {
  const list = document.getElementById("announcementsList");
  const empty = document.getElementById("announcementsEmpty");
  if (!list || !empty) return;
  if (!items?.length) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = items
    .map((n) => {
      const title = n.title
        ? `<h3 class="announcements-item-title">${escapeHtml(n.title)}</h3>`
        : "";
      const when = n.publishedAt
        ? `<time class="announcements-item-time" datetime="${escapeHtml(n.publishedAt)}">${formatPublishedAt(n.publishedAt)}</time>`
        : "";
      return `<article class="announcements-item">
        ${title}
        ${when}
        <div class="announcements-item-body">${escapeHtml(n.body).replace(/\n/g, "<br>")}</div>
      </article>`;
    })
    .join("");
}

let cachedItems = null;
let loading = null;

async function fetchAnnouncements() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(`${API}/announcements`, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => null);
      if (res.status !== 200) {
        cachedItems = [];
        return cachedItems;
      }
      cachedItems = json?.data?.items || [];
      return cachedItems;
    } catch {
      cachedItems = [];
      return cachedItems;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

// Bumped on every close so an in-flight async open (fetch) can't reopen after the user closed.
let openSeq = 0;

export function closeAnnouncementsModal() {
  openSeq += 1;
  const modal = document.getElementById("announcementsModal");
  if (modal) closeCtlOverlay(modal);
}

export async function openAnnouncementsModal({ force = true } = {}) {
  ensureDom();
  const seq = ++openSeq;
  const items = cachedItems ?? (await fetchAnnouncements());
  if (seq !== openSeq) return items;
  renderList(items);
  const modal = document.getElementById("announcementsModal");
  if (modal && modal.hidden) openCtlOverlay(modal);
  return items;
}

function wireEvents() {
  const btn = document.getElementById("announcementsBtn");
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      openAnnouncementsModal({ force: true }).catch(() => {});
    });
  }

  const modal = document.getElementById("announcementsModal");
  if (modal && !modal.dataset.wired) {
    modal.dataset.wired = "1";
    // The dialog scales in (§6.4 enter anim). A press that starts on a button
    // can release a few px off it while the box grows, so the browser fires the
    // click on the common ancestor instead of the button → close was dropped.
    // Remember which action button the pointer went down on and honour it.
    const ACTIONS = "#announcementsClose, #announcementsCloseX, #announcementsDismissToday";
    const actionAt = (x, y, pad) => {
      for (const b of modal.querySelectorAll(ACTIONS)) {
        const r = b.getBoundingClientRect();
        if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return b;
      }
      return null;
    };
    let downAction = null;
    modal.addEventListener(
      "pointerdown",
      (e) => {
        downAction =
          e.target?.closest?.(ACTIONS) ||
          actionAt(e.clientX, e.clientY, 4) ||
          (e.target === modal ? modal : null);
      },
      true
    );
    modal.addEventListener("click", (e) => {
      const hit = e.target?.closest?.(ACTIONS);
      const pending = downAction || (e.detail ? actionAt(e.clientX, e.clientY, 4) : null);
      downAction = null;
      if (hit) return; // button's own handler runs
      if (pending && pending !== modal) {
        if (pending.id === "announcementsDismissToday") dismissToday();
        closeAnnouncementsModal();
        return;
      }
      if (e.target === modal) closeAnnouncementsModal();
    });
    document.getElementById("announcementsCloseX")?.addEventListener("click", () => {
      closeAnnouncementsModal();
    });
    document.getElementById("announcementsClose")?.addEventListener("click", () => {
      closeAnnouncementsModal();
    });
    document.getElementById("announcementsDismissToday")?.addEventListener("click", () => {
      dismissToday();
      closeAnnouncementsModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && !modal.hidden) closeAnnouncementsModal();
    });
  }
}

/**
 * No auto-open over a PvP room / invite join (#/pvp/join/…, #/pvp/<matchId>):
 * the full-screen notice covered 「准备」 and the short ready window ran out
 * (M-09). The 公告 button in the header still opens it on demand.
 */
export function shouldAutoOpenAnnouncements(hash) {
  return !/^#\/pvp\/./.test(String(hash || ""));
}

/**
 * Init: ensure header control, wire events, auto-open if not dismissed today.
 */
export async function initAnnouncements() {
  ensureDom();
  wireEvents();
  const seq = ++openSeq;
  const items = await fetchAnnouncements();
  renderList(items);
  if (seq === openSeq && items.length && !isDismissedToday() && shouldAutoOpenAnnouncements(location.hash)) {
    const modal = document.getElementById("announcementsModal");
    if (modal && modal.hidden) openCtlOverlay(modal);
  }
}
