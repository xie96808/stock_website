/**
 * System announcements modal — paper/ink sketch UI.
 * Auto-opens unless localStorage says dismissed for today's local calendar day.
 */

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
            <button type="button" class="announcements-secondary" id="announcementsDismissToday">今日关闭</button>
            <button type="button" class="announcements-primary" id="announcementsClose">关闭公告</button>
          </div>
        </div>
      </div>`)
    );
  }
}

function formatPublishedAt(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime())) return escapeHtml(iso);
    return escapeHtml(
      d.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  } catch {
    return escapeHtml(iso);
  }
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

export function closeAnnouncementsModal() {
  const modal = document.getElementById("announcementsModal");
  if (modal) modal.hidden = true;
}

export async function openAnnouncementsModal({ force = true } = {}) {
  ensureDom();
  const items = cachedItems ?? (await fetchAnnouncements());
  renderList(items);
  const modal = document.getElementById("announcementsModal");
  if (modal) modal.hidden = false;
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
    modal.addEventListener("click", (e) => {
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
 * Init: ensure header control, wire events, auto-open if not dismissed today.
 */
export async function initAnnouncements() {
  ensureDom();
  wireEvents();
  const items = await fetchAnnouncements();
  renderList(items);
  if (items.length && !isDismissedToday()) {
    const modal = document.getElementById("announcementsModal");
    if (modal) modal.hidden = false;
  }
}
