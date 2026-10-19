/** Stage 5 minimal non-public admin shell */
const API = "/api/v1";

let csrfToken = null;
let adminVerified = false;
/** Tabs whose data was loaded this session (cleared on logout). */
const tabLoaded = new Set();

function $(id) {
  return document.getElementById(id);
}

function setMsg(el, text, ok = false) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("ok", !!ok && !!text);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, { method = "GET", body, csrf, headers: extra } = {}) {
  const headers = { Accept: "application/json", ...(extra || {}) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf) headers["X-CSRF-Token"] = csrf;
  const res = await fetch(`${API}${path}`, {
    method,
    credentials: "same-origin",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  if (res.status !== 204) {
    json = await res.json().catch(() => null);
  }
  return { status: res.status, json };
}

function showLoggedIn(user) {
  $("loginPanel").classList.add("hidden");
  $("opsPanel").classList.remove("hidden");
  $("whoami").textContent = `${user.nickname || user.username}（${user.username}）`;
  updateVerifyBadge();
  const cur = document.querySelector('.tabs .tab[aria-selected="true"]');
  if (cur) queueMicrotask(() => cur.click());
  queueMicrotask(() => refreshFbBadge().catch(() => {}));
}

function showLoggedOut() {
  $("loginPanel").classList.remove("hidden");
  $("opsPanel").classList.add("hidden");
  csrfToken = null;
  adminVerified = false;
  tabLoaded.clear();
}

function updateVerifyBadge() {
  const b = $("verifyBadge");
  if (adminVerified) {
    b.textContent = "已二次验证";
    b.classList.add("ok");
  } else {
    b.textContent = "未二次验证";
    b.classList.remove("ok");
  }
}

async function refreshSession() {
  const me = await api("/me");
  if (me.status !== 200 || me.json?.data?.user?.role !== "admin") {
    showLoggedOut();
    if (me.status === 200 && me.json?.data?.user) {
      setMsg($("loginMsg"), "当前账号不是管理员");
    }
    return false;
  }
  csrfToken = me.json.data.csrfToken;
  const sess = await api("/admin/session");
  if (sess.status === 404) {
    setMsg($("loginMsg"), "管理 API 未启用（ADMIN_ENABLED）或网络未放行");
    showLoggedOut();
    return false;
  }
  if (sess.status !== 200) {
    setMsg($("loginMsg"), sess.json?.error?.message || "无法访问管理接口");
    showLoggedOut();
    return false;
  }
  adminVerified = !!sess.json.data.adminVerified;
  showLoggedIn(me.json.data.user);
  return true;
}

$("loginBtn").onclick = async () => {
  setMsg($("loginMsg"), "");
  const username = $("loginUser").value.trim();
  const password = $("loginPass").value;
  const r = await api("/auth/login", { method: "POST", body: { username, password } });
  if (r.status !== 200) {
    setMsg($("loginMsg"), r.json?.error?.message || "登录失败");
    return;
  }
  csrfToken = r.json.data.csrfToken;
  if (r.json.data.user.role !== "admin") {
    await api("/auth/logout", { method: "POST", csrf: csrfToken });
    setMsg($("loginMsg"), "当前账号不是管理员");
    return;
  }
  await refreshSession();
};

$("logoutBtn").onclick = async () => {
  if (csrfToken) await api("/auth/logout", { method: "POST", csrf: csrfToken });
  showLoggedOut();
  setMsg($("loginMsg"), "已退出", true);
};

$("reauthBtn").onclick = async () => {
  setMsg($("opsMsg"), "");
  const password = $("reauthPass").value;
  const r = await api("/admin/reauth", {
    method: "POST",
    csrf: csrfToken,
    body: { password },
  });
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "二次验证失败");
    adminVerified = false;
    updateVerifyBadge();
    return;
  }
  adminVerified = true;
  $("reauthPass").value = "";
  updateVerifyBadge();
  setMsg($("opsMsg"), "二次验证成功（约 15 分钟有效）", true);
};

let userCursor = null;
let userQuery = "";
let userSearchSeq = 0;
const userDetailCache = new Map();

function presetAvatarSrc(u) {
  return `/images/avatars/${String(u.avatarId || 1).padStart(2, "0")}.png`;
}
function avatarSrc(u) {
  return u.avatarUrl || presetAvatarSrc(u);
}
// Broken custom avatar → the user's preset, then the default preset.
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!img || img.tagName !== "IMG" || !img.classList.contains("ava")) return;
  const src = img.getAttribute("src") || "";
  const fb = img.dataset.fallbackSrc || "/images/avatars/01.png";
  if (src !== fb) img.setAttribute("src", fb);
  else if (src !== "/images/avatars/01.png") img.setAttribute("src", "/images/avatars/01.png");
}, true);

function ppmPct(ppm) {
  if (ppm == null || !Number.isFinite(Number(ppm))) return "—";
  return `${(Number(ppm) / 10000).toFixed(2)}%`;
}

const RESULT_LABEL = { win: "胜", loss: "负", draw: "平" };

function userRowHtml(u) {
  return `<details class="item user-row" data-row-uid="${u.id}">
      <summary>
        <img class="ava" src="${escapeHtml(avatarSrc(u))}" data-fallback-src="${escapeHtml(presetAvatarSrc(u))}" alt="" width="32" height="32" loading="lazy" decoding="async">
        <span class="who"><strong>${escapeHtml(u.nickname)}</strong> <code>${escapeHtml(u.username)}</code></span>
        <span class="meta">#${u.id} · <span class="st st-${escapeHtml(u.status)}">${escapeHtml(u.status)}</span> · ${escapeHtml(u.role)}
        · 韭币 ${u.jiuCoinBalance ?? 0}</span>
        <button type="button" data-uid="${u.id}">填入</button>
      </summary>
      <div class="user-detail" data-detail-uid="${u.id}"><p class="note left">展开加载详情…</p></div>
    </details>`;
}

function userDetailHtml(u, d) {
  const user = d?.user || u;
  const st = d?.stats || {};
  const p = d?.pvp || null;
  const recent = p && !p.empty && p.recent?.length
    ? p.recent.map((r) => `<span class="res res-${escapeHtml(r)}">${RESULT_LABEL[r] || escapeHtml(r)}</span>`).join("")
    : "—";
  const pvpLine = !p || p.empty
    ? `<dd>暂无对战记录</dd>`
    : `<dd>${escapeHtml(p.title?.name || "—")} · 积分 ${p.rating ?? "—"}${p.title?.inPlacement ? "（定级中）" : ""}</dd>
       <dt>对战战绩</dt><dd>${p.wins} 胜 ${p.losses} 负 ${p.draws} 平 · 胜率 ${Math.round((p.winRate || 0) * 100)}% · 近期逃跑 ${p.recentForfeits ?? 0}</dd>
       <dt>近期</dt><dd class="recent">${recent}</dd>`;
  const isBan = user.status === "disabled";
  const canMod = user.role !== "admin" && user.status !== "deleted";
  return `<dl class="kv">
      <dt>签名</dt><dd>${user.signature ? escapeHtml(user.signature) : "<span class=\"dim\">（未设置）</span>"}</dd>
      <dt>韭币</dt><dd>${user.jiuCoinBalance ?? 0}</dd>
      <dt>单机战绩</dt><dd>已结算 ${st.settledCount ?? 0} · 有效 ${st.validCount ?? 0} · 已下榜 ${st.hiddenCount ?? 0}</dd>
      <dt>段位</dt>${pvpLine}
      <dt>上榜</dt><dd>${user.leaderboardOptIn ? "参与" : "不参与"}</dd>
      <dt>注册</dt><dd>${escapeHtml(user.createdAt || "—")}${user.deletedAt ? ` · 注销 ${escapeHtml(user.deletedAt)}` : ""}</dd>
    </dl>
    ${canMod ? `<div class="row inline-mod">
      <input class="grow" data-reason-uid="${user.id}" maxlength="200" placeholder="原因（必填）" />
      <button type="button" data-ban-uid="${user.id}" data-to="${isBan ? "active" : "disabled"}">${isBan ? "解禁" : "禁用"}</button>
      <button type="button" class="ghost" data-pw-uid="${user.id}">重置密码…</button>
    </div>` : `<p class="note left">${user.role === "admin" ? "管理员账号不可在此禁用或重置密码" : "已注销账号请用「软删/恢复」处理"}</p>`}`;
}

async function loadUserDetail(uid, force = false) {
  const box = document.querySelector(`[data-detail-uid="${uid}"]`);
  if (!box) return;
  if (!force && userDetailCache.has(uid)) {
    box.innerHTML = userDetailHtml(null, userDetailCache.get(uid));
    wireDetail(box);
    return;
  }
  const r = await api(`/admin/users/${encodeURIComponent(uid)}`);
  if (r.status !== 200) {
    box.innerHTML = `<p class="msg">${escapeHtml(r.json?.error?.message || "详情加载失败")}</p>`;
    return;
  }
  userDetailCache.set(uid, r.json.data);
  const cur = document.querySelector(`[data-detail-uid="${uid}"]`);
  if (!cur) return;
  cur.innerHTML = userDetailHtml(null, r.json.data);
  wireDetail(cur);
}

function wireDetail(box) {
  box.querySelectorAll("button[data-ban-uid]").forEach((btn) => {
    btn.onclick = async () => {
      if (btn.disabled) return;
      const uid = btn.dataset.banUid;
      const reason = box.querySelector(`[data-reason-uid="${uid}"]`)?.value || "";
      if (!reason.trim()) {
        setMsg($("opsMsg"), "请填写原因");
        return;
      }
      btn.disabled = true;
      try {
        const r = await api(`/admin/users/${encodeURIComponent(uid)}/status`, {
          method: "PATCH",
          csrf: csrfToken,
          body: { status: btn.dataset.to, reason },
        });
        if (r.status === 403 && r.json?.error?.code === "ADMIN_REAUTH_REQUIRED") {
          adminVerified = false;
          updateVerifyBadge();
        }
        if (r.status !== 200) {
          setMsg($("opsMsg"), r.json?.error?.message || "操作失败");
          return;
        }
        setMsg($("opsMsg"), `用户 #${uid} 状态已更新为 ${r.json.data.user.status}`, true);
        userDetailCache.delete(Number(uid));
        await reloadUserRow(Number(uid));
      } finally {
        btn.disabled = false;
      }
    };
  });
  box.querySelectorAll("button[data-pw-uid]").forEach((btn) => {
    btn.onclick = () => {
      $("pwResetUserId").value = btn.dataset.pwUid;
      setResultHidden();
      selectTab("security");
      $("pwResetReason").focus();
    };
  });
}

async function reloadUserRow(uid) {
  const r = await api(`/admin/users/${encodeURIComponent(uid)}`);
  if (r.status !== 200) return;
  userDetailCache.set(uid, r.json.data);
  const row = document.querySelector(`[data-row-uid="${uid}"]`);
  if (!row) return;
  const wasOpen = row.open;
  const tmp = document.createElement("div");
  tmp.innerHTML = userRowHtml(r.json.data.user);
  const fresh = tmp.firstElementChild;
  row.replaceWith(fresh);
  wireUserRow(fresh);
  if (wasOpen) fresh.open = true;
}

function fillUserId(uid) {
  $("banUserId").value = uid;
  if ($("delUserId")) $("delUserId").value = uid;
  if ($("coinUserId")) $("coinUserId").value = uid;
  if ($("pwResetUserId")) $("pwResetUserId").value = uid;
}

function wireUserRow(row) {
  const btn = row.querySelector("button[data-uid]");
  if (btn) {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      fillUserId(btn.dataset.uid);
      setMsg($("opsMsg"), `已填入用户 #${btn.dataset.uid}`, true);
    };
  }
  row.addEventListener("toggle", () => {
    if (row.open) loadUserDetail(Number(row.dataset.rowUid));
  });
}

function renderUsers(items, { append = false } = {}) {
  const el = $("userList");
  if (!append) el.innerHTML = "";
  if (!items?.length && !append) {
    el.innerHTML = `<div class="item">无结果</div>`;
    return;
  }
  const tmp = document.createElement("div");
  tmp.innerHTML = (items || []).map(userRowHtml).join("");
  [...tmp.children].forEach((row) => {
    el.appendChild(row);
    wireUserRow(row);
  });
}


$("coinAdjustBtn").onclick = async () => {
  setMsg($("opsMsg"), "");
  const id = $("coinUserId").value.trim();
  const op = $("coinOp").value;
  const amount = Number($("coinAmount").value);
  const reason = $("coinReason").value;
  const r = await api(`/admin/users/${encodeURIComponent(id)}/jiu-coin`, {
    method: "POST",
    csrf: csrfToken,
    body: { op, amount, reason },
  });
  if (r.status === 403 && r.json?.error?.code === "ADMIN_REAUTH_REQUIRED") {
    adminVerified = false;
    updateVerifyBadge();
  }
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "韭币调整失败");
    return;
  }
  setMsg(
    $("opsMsg"),
    `韭币已调整：余额 ${r.json.data.balance}（Δ ${r.json.data.delta}）`,
    true
  );
  $("userSearchBtn").click();
};

async function searchUsers({ more = false } = {}) {
  setMsg($("opsMsg"), "");
  const qs = new URLSearchParams();
  if (more) {
    if (!userCursor) return;
    qs.set("cursor", userCursor);
    for (const [k, v] of new URLSearchParams(userQuery)) qs.set(k, v);
  } else {
    if ($("userQ").value.trim()) qs.set("q", $("userQ").value.trim());
    if ($("userStatus").value) qs.set("status", $("userStatus").value);
    userQuery = qs.toString();
    userDetailCache.clear();
  }
  const seq = ++userSearchSeq;
  const moreBtn = $("userMoreBtn");
  moreBtn.disabled = true;
  const r = await api(`/admin/users?${qs}`);
  if (seq !== userSearchSeq) return;
  moreBtn.disabled = false;
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "搜索失败");
    return;
  }
  renderUsers(r.json.data.items, { append: more });
  userCursor = r.json.data.nextCursor || null;
  moreBtn.classList.toggle("hidden", !userCursor);
}

$("userSearchBtn").onclick = () => searchUsers();
$("userMoreBtn").onclick = () => searchUsers({ more: true });
$("userQ").addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchUsers();
});

$("banBtn").onclick = async () => {
  setMsg($("opsMsg"), "");
  const id = $("banUserId").value.trim();
  const status = $("banStatus").value;
  const reason = $("banReason").value;
  const r = await api(`/admin/users/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    csrf: csrfToken,
    body: { status, reason },
  });
  if (r.status === 403 && r.json?.error?.code === "ADMIN_REAUTH_REQUIRED") {
    adminVerified = false;
    updateVerifyBadge();
  }
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "操作失败");
    return;
  }
  setMsg($("opsMsg"), `用户状态已更新为 ${r.json.data.user.status}`, true);
  $("userSearchBtn").click();
};

function renderGames(items) {
  const el = $("gameList");
  if (!items?.length) {
    el.innerHTML = `<div class="item">无结果</div>`;
    return;
  }
  el.innerHTML = items
    .map(
      (g) => `<div class="item">
      <code>${escapeHtml(g.gameId)}</code>
      · 用户 #${g.userId} ${escapeHtml(g.nickname)}
      · ${escapeHtml(g.fillMode)} · ppm ${g.returnPpm}
      · ${escapeHtml(g.validity)} · hidden=${g.leaderboardHidden ? 1 : 0}
      ${g.rewindPaidWith ? `· 反悔方式：${g.rewindPaidWith === "ticket" ? "后悔券" : "韭币"}（${escapeHtml(g.assistClass || "")}）` : ""}
      <button type="button" data-gid="${escapeHtml(g.gameId)}">填入</button>
    </div>`
    )
    .join("");
  el.querySelectorAll("button[data-gid]").forEach((btn) => {
    btn.onclick = () => {
      $("modGameId").value = btn.dataset.gid;
    };
  });
}

$("gameSearchBtn").onclick = async () => {
  setMsg($("opsMsg"), "");
  const qs = new URLSearchParams();
  if ($("gameQ").value.trim()) qs.set("q", $("gameQ").value.trim());
  const r = await api(`/admin/games?${qs}`);
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "搜索失败");
    return;
  }
  renderGames(r.json.data.items);
};

$("modBtn").onclick = async () => {
  setMsg($("opsMsg"), "");
  const id = $("modGameId").value.trim();
  const action = $("modAction").value;
  const reason = $("modReason").value;
  const r = await api(`/admin/games/${encodeURIComponent(id)}/moderation`, {
    method: "PATCH",
    csrf: csrfToken,
    body: { action, reason },
  });
  if (r.status === 403 && r.json?.error?.code === "ADMIN_REAUTH_REQUIRED") {
    adminVerified = false;
    updateVerifyBadge();
  }
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "操作失败");
    return;
  }
  const g = r.json.data.game;
  setMsg(
    $("opsMsg"),
    `战绩已更新：validity=${g.validity} hidden=${g.leaderboardHidden ? 1 : 0}`,
    true
  );
  $("gameSearchBtn").click();
};

let auditCursor = null;
let auditQuery = "";
let auditSeq = 0;

function auditItemHtml(a) {
  const diff = a.before || a.after
    ? `<div class="diff"><code>${escapeHtml(JSON.stringify(a.before ?? null))}</code> → <code>${escapeHtml(JSON.stringify(a.after ?? null))}</code></div>`
    : "";
  return `<div class="item">
      #${a.id} · ${escapeHtml(a.createdAt)} · actor=${a.actorId ?? "—"}
      · <code>${escapeHtml(a.action)}</code>
      · ${escapeHtml(a.targetType)}/${escapeHtml(a.targetId)}
      · ${escapeHtml(a.reason || "")}
    ${diff}</div>`;
}

async function loadAudit({ more = false } = {}) {
  setMsg($("opsMsg"), "");
  const qs = new URLSearchParams();
  if (more) {
    if (!auditCursor) return;
    for (const [k, v] of new URLSearchParams(auditQuery)) qs.set(k, v);
    qs.set("cursor", auditCursor);
  } else {
    qs.set("limit", "30");
    const actor = ($("auditActor")?.value || "").trim();
    if (actor) {
      if (!/^\d+$/.test(actor)) return setMsg($("opsMsg"), "操作者 ID 需为数字");
      qs.set("actorId", actor);
    }
    const action = ($("auditAction")?.value || "").trim();
    if (action) qs.set("action", action);
    const tt = $("auditTargetType")?.value || "";
    if (tt) qs.set("targetType", tt);
    const tid = ($("auditTargetId")?.value || "").trim();
    if (tid) qs.set("targetId", tid);
    auditQuery = qs.toString();
  }
  const seq = ++auditSeq;
  const moreBtn = $("auditMoreBtn");
  if (moreBtn) moreBtn.disabled = true;
  const r = await api(`/admin/audit-logs?${qs}`);
  if (seq !== auditSeq) return;
  if (moreBtn) moreBtn.disabled = false;
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "加载审计失败");
    return;
  }
  const el = $("auditList");
  const items = r.json.data.items || [];
  if (!more && !items.length) {
    el.innerHTML = `<div class="item">暂无审计</div>`;
  } else if (more) {
    el.insertAdjacentHTML("beforeend", items.map(auditItemHtml).join(""));
  } else {
    el.innerHTML = items.map(auditItemHtml).join("");
  }
  auditCursor = r.json.data.nextCursor || null;
  if (moreBtn) moreBtn.classList.toggle("hidden", !auditCursor);
}

$("auditBtn").onclick = () => loadAudit();
if ($("auditMoreBtn")) $("auditMoreBtn").onclick = () => loadAudit({ more: true });
if ($("auditClearBtn")) {
  $("auditClearBtn").onclick = () => {
    ["auditActor", "auditAction", "auditTargetId"].forEach((k) => ($(k).value = ""));
    $("auditTargetType").value = "";
    loadAudit();
  };
}

async function handleAdminUserMutation(path, body, successMsg) {
  setMsg($("opsMsg"), "");
  const r = await api(path, {
    method: "POST",
    csrf: csrfToken,
    body,
  });
  if (r.status === 403 && r.json?.error?.code === "ADMIN_REAUTH_REQUIRED") {
    adminVerified = false;
    updateVerifyBadge();
  }
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "操作失败");
    return;
  }
  setMsg($("opsMsg"), successMsg(r.json.data.user), true);
  $("userSearchBtn").click();
}

$("softDeleteBtn").onclick = async () => {
  const id = $("delUserId").value.trim();
  const reason = $("delReason").value;
  await handleAdminUserMutation(
    `/admin/users/${encodeURIComponent(id)}/soft-delete`,
    { reason },
    (u) => `用户 #${u.id} 已软删（status=${u.status}）`
  );
};

$("restoreUserBtn").onclick = async () => {
  const id = $("delUserId").value.trim();
  const reason = $("delReason").value;
  await handleAdminUserMutation(
    `/admin/users/${encodeURIComponent(id)}/restore`,
    { reason },
    (u) => `用户 #${u.id} 已恢复（status=${u.status}）`
  );
};


function parsePositiveId(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function handleAnnReauthRequired(r) {
  if (r.status === 403 && r.json?.error?.code === "ADMIN_REAUTH_REQUIRED") {
    adminVerified = false;
    updateVerifyBadge();
    setMsg($("annMsg"), "请先二次验证管理员密码");
    return true;
  }
  return false;
}

let annScheduled = {};
function renderAnnouncements(items) {
  const el = $("annList");
  if (!el) return;
  if (!items?.length) {
    el.innerHTML = `<div class="item">无公告</div>`;
    return;
  }
  el.innerHTML = items
    .map(
      (a) => `<div class="item">
      #${a.id} · <code>${escapeHtml(a.status)}</code>
      · ${escapeHtml(a.title || "(无标题)")}
      · ${escapeHtml((a.body || "").slice(0, 48))}
      · ${escapeHtml(a.publishedAt || "—")}${annScheduled[a.id] && a.status === "draft" ? ` <span class="tag over">定时 ${escapeHtml(fmtBeijing(annScheduled[a.id]))}</span>` : ""}
      <button type="button" data-ann="${a.id}">填入</button>
    </div>`
    )
    .join("");
  el.querySelectorAll("button[data-ann]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.ann;
      $("annId").value = id;
      const r = await api(`/admin/announcements/${encodeURIComponent(id)}`);
      if (r.status !== 200) {
        setMsg($("annMsg"), r.json?.error?.message || "加载失败");
        return;
      }
      const a = r.json.data.announcement;
      $("annTitle").value = a.title || "";
      $("annBody").value = a.body || "";
      $("annStatus").value = a.status || "draft";
      renderAnnPreview();
    };
  });
}

$("annSearchBtn").onclick = async () => {
  setMsg($("annMsg"), "");
  const qs = new URLSearchParams();
  if ($("annStatusFilter").value) qs.set("status", $("annStatusFilter").value);
  const r = await api(`/admin/announcements?${qs}`);
  if (r.status !== 200) {
    setMsg($("annMsg"), r.json?.error?.message || "加载公告失败");
    return;
  }
  {
    const sm = await api("/admin/announcements-scheduled");
    annScheduled = sm.status === 200 ? sm.json.data.scheduled || {} : {};
  }
  renderAnnouncements(r.json.data.items);
};

$("annCreateBtn").onclick = async () => {
  setMsg($("annMsg"), "");
  const r = await api("/admin/announcements", {
    method: "POST",
    csrf: csrfToken,
    body: {
      title: $("annTitle").value.trim() || null,
      body: $("annBody").value,
      status: $("annStatus").value || "draft",
    },
  });
  if (handleAnnReauthRequired(r)) return;
  if (r.status !== 201 && r.status !== 200) {
    setMsg($("annMsg"), r.json?.error?.message || "创建失败");
    return;
  }
  setMsg($("annMsg"), `公告 #${r.json.data.announcement.id} 已创建`, true);
  $("annId").value = String(r.json.data.announcement.id);
  $("annSearchBtn").click();
};

$("annUpdateBtn").onclick = async () => {
  setMsg($("annMsg"), "");
  const id = parsePositiveId($("annId").value);
  if (!id) {
    setMsg($("annMsg"), "请先填入有效的公告 ID");
    return;
  }
  const r = await api(`/admin/announcements/${id}`, {
    method: "PATCH",
    csrf: csrfToken,
    body: {
      title: $("annTitle").value.trim() || null,
      body: $("annBody").value,
      status: $("annStatus").value,
    },
  });
  if (handleAnnReauthRequired(r)) return;
  if (r.status !== 200) {
    setMsg($("annMsg"), r.json?.error?.message || "更新失败");
    return;
  }
  setMsg($("annMsg"), `公告 #${r.json.data.announcement.id} 已更新`, true);
  $("annSearchBtn").click();
};

$("annPublishBtn").onclick = async () => {
  setMsg($("annMsg"), "");
  const raw = $("annId").value.trim();
  const bodyText = $("annBody").value;
  if (!raw) {
    if (!String(bodyText || "").trim()) {
      setMsg($("annMsg"), "请先填写公告正文，或填入要发布的公告 ID");
      return;
    }
    const r = await api("/admin/announcements", {
      method: "POST",
      csrf: csrfToken,
      body: {
        title: $("annTitle").value.trim() || null,
        body: bodyText,
        status: "published",
      },
    });
    if (handleAnnReauthRequired(r)) return;
    if (r.status !== 201 && r.status !== 200) {
      setMsg($("annMsg"), r.json?.error?.message || "发布失败");
      return;
    }
    const created = r.json.data.announcement;
    $("annId").value = String(created.id);
    $("annStatus").value = "published";
    setMsg($("annMsg"), `公告 #${created.id} 已发布`, true);
    $("annSearchBtn").click();
    return;
  }
  const id = parsePositiveId(raw);
  if (!id) {
    setMsg($("annMsg"), "公告 ID 无效");
    return;
  }
  const body = {
    status: "published",
  };
  if (bodyText.trim()) body.body = bodyText;
  if ($("annTitle").value.trim()) body.title = $("annTitle").value.trim();
  const r = await api(`/admin/announcements/${id}`, {
    method: "PATCH",
    csrf: csrfToken,
    body,
  });
  if (handleAnnReauthRequired(r)) return;
  if (r.status !== 200) {
    setMsg($("annMsg"), r.json?.error?.message || "发布失败");
    return;
  }
  $("annStatus").value = "published";
  setMsg($("annMsg"), `公告 #${r.json.data.announcement.id} 已发布`, true);
  $("annSearchBtn").click();
};

$("annArchiveBtn").onclick = async () => {
  setMsg($("annMsg"), "");
  const id = parsePositiveId($("annId").value);
  if (!id) {
    setMsg($("annMsg"), "请先填入有效的公告 ID");
    return;
  }
  const r = await api(`/admin/announcements/${id}/archive`, {
    method: "POST",
    csrf: csrfToken,
    body: {},
  });
  if (handleAnnReauthRequired(r)) return;
  if (r.status !== 200) {
    setMsg($("annMsg"), r.json?.error?.message || "归档失败");
    return;
  }
  $("annStatus").value = "archived";
  setMsg($("annMsg"), `公告 #${r.json.data.announcement.id} 已归档`, true);
  $("annSearchBtn").click();
};




function renderFeedbackList(items) {
  const host = $("fbList");
  if (!host) return;
  if (!items.length) {
    host.innerHTML = "<p class=\"note\">暂无反馈</p>";
    return;
  }
  host.innerHTML = items
    .map(
      (f) =>
        `<div class="row between item">
      #${f.id} · <code>${escapeHtml(f.status)}</code>
      · 用户 #${f.userId} ${escapeHtml(f.nickname || "")} (${escapeHtml(f.username || "")})
      · 图 ${f.imageCount || 0}
      · ${escapeHtml((f.body || "").slice(0, 48))}
      · ${escapeHtml(f.createdAt || "—")}
      <button type="button" data-fbid="${f.id}">填入</button>
    </div>`
    )
    .join("");
  host.querySelectorAll("[data-fbid]").forEach((btn) => {
    btn.onclick = () => {
      $("fbId").value = btn.getAttribute("data-fbid");
      $("fbLoadBtn").click();
    };
  });
}

let fbNoteState = null;
function renderFeedbackDetail(f, note) {
  const host = $("fbDetail");
  if (note !== undefined) fbNoteState = note ? { ...note, id: f?.id } : null;
  renderFeedbackNote(f);
  if (!host || !f) {
    if (host) host.innerHTML = "";
    return;
  }
  const imgs = (f.images || [])
    .map(
      (img) =>
        `<a href="${escapeHtml(img.url)}" target="_blank" rel="noopener" data-lightbox="${escapeHtml(img.url)}">
          <img src="${escapeHtml(img.url)}" alt="反馈图" style="max-width:160px;max-height:160px;border:1px solid #666;border-radius:8px;margin:4px;object-fit:cover" />
        </a>`
    )
    .join("");
  host.innerHTML = `<div class="item">
    <p><strong>#${f.id}</strong> · <code>${escapeHtml(f.status)}</code>
      · 用户 #${f.userId} ${escapeHtml(f.nickname || "")} (<code>${escapeHtml(f.username || "")}</code>)
      · ${escapeHtml(f.createdAt || "")}</p>
    <pre style="white-space:pre-wrap;font:inherit;background:#fffdf8;border:1px solid #ccc;border-radius:8px;padding:10px;margin:8px 0">${escapeHtml(f.body || "")}</pre>
    <div>${imgs || "<span class=\"note\">无图片</span>"}</div>
  </div>`;
  host.querySelectorAll("a[data-lightbox]").forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      openLightbox(a.dataset.lightbox, a);
    };
  });
}

function handleFbReauthRequired(r) {
  if (r.status === 403 && r.json?.error?.code === "ADMIN_REAUTH_REQUIRED") {
    setMsg($("fbMsg"), "请先二次验证管理员密码");
    return true;
  }
  return false;
}

$("fbSearchBtn").onclick = async () => {
  setMsg($("fbMsg"), "");
  const st = $("fbStatusFilter").value;
  const qs = st ? `status=${encodeURIComponent(st)}` : "";
  const r = await api(`/admin/feedback${qs ? `?${qs}` : ""}`);
  if (r.status !== 200) {
    setMsg($("fbMsg"), r.json?.error?.message || "加载失败");
    return;
  }
  renderFeedbackList(r.json.data.items || []);
};

$("fbLoadBtn").onclick = async () => {
  setMsg($("fbMsg"), "");
  const id = parsePositiveId($("fbId").value);
  if (!id) {
    setMsg($("fbMsg"), "请填入有效的反馈 ID");
    return;
  }
  const r = await api(`/admin/feedback/${id}`);
  if (r.status !== 200) {
    setMsg($("fbMsg"), r.json?.error?.message || "加载失败");
    return;
  }
  renderFeedbackDetail(r.json.data.feedback, r.json.data.adminNote || { note: "" });
  setMsg($("fbMsg"), `已加载 #${id}`, true);
};

async function patchFeedbackStatus(status) {
  setMsg($("fbMsg"), "");
  const id = parsePositiveId($("fbId").value);
  if (!id) {
    setMsg($("fbMsg"), "请填入有效的反馈 ID");
    return;
  }
  const r = await api(`/admin/feedback/${id}`, {
    method: "PATCH",
    csrf: csrfToken,
    body: { status },
  });
  if (handleFbReauthRequired(r)) return;
  if (r.status !== 200) {
    setMsg($("fbMsg"), r.json?.error?.message || "更新失败");
    return;
  }
  renderFeedbackDetail(r.json.data.feedback);
  setMsg($("fbMsg"), `反馈 #${id} 已标为 ${status}`, true);
  $("fbSearchBtn").click();
  refreshFbBadge();
}

$("fbMarkReadBtn").onclick = () => patchFeedbackStatus("read");
$("fbArchiveBtn").onclick = () => patchFeedbackStatus("archived");


refreshSession().catch(() => showLoggedOut());


/* ---- tabs ---- */
const TAB_KEY = "adminTab";
function selectTab(name) {
  const tabs = [...document.querySelectorAll(".tabs .tab")];
  if (!tabs.some((t) => t.dataset.tab === name)) name = "users";
  tabs.forEach((t) => {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll(".tabpanel").forEach((p) => {
    p.classList.toggle("hidden", p.dataset.panel !== name);
  });
  try { sessionStorage.setItem(TAB_KEY, name); } catch { /* ignore */ }
}
document.querySelectorAll(".tabs .tab").forEach((t, i, all) => {
  t.addEventListener("click", () => selectTab(t.dataset.tab));
  t.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const n = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
    selectTab(n.dataset.tab);
    n.focus();
  });
});
let initialTab = "users";
try { initialTab = sessionStorage.getItem(TAB_KEY) || "users"; } catch { /* ignore */ }
selectTab(initialTab);

/* ---- password reset (admin -> user) ---- */
function setResultHidden() {
  const box = $("pwResetResult");
  box.innerHTML = "";
  box.classList.add("hidden");
}

let pwResetBusy = false;
$("pwResetBtn").onclick = async () => {
  if (pwResetBusy) return;
  setMsg($("opsMsg"), "");
  setResultHidden();
  const id = parsePositiveId($("pwResetUserId").value);
  const reason = $("pwResetReason").value.trim();
  if (!id) return setMsg($("opsMsg"), "请填写有效的用户 ID");
  if (!reason) return setMsg($("opsMsg"), "请填写原因");
  if (!window.confirm(`确认为用户 #${id} 生成临时密码？旧密码会立即失效，所有设备下线。`)) return;
  pwResetBusy = true;
  $("pwResetBtn").disabled = true;
  try {
    const r = await api(`/admin/users/${id}/password-reset`, {
      method: "POST",
      csrf: csrfToken,
      body: { reason },
    });
    if (r.status === 403 && r.json?.error?.code === "ADMIN_REAUTH_REQUIRED") {
      adminVerified = false;
      updateVerifyBadge();
    }
    if (r.status !== 200) {
      setMsg($("opsMsg"), r.json?.error?.message || "重置失败");
      return;
    }
    const d = r.json.data;
    const box = $("pwResetResult");
    box.innerHTML = `<p>用户 <code>${escapeHtml(d.username)}</code>（#${d.userId}）的临时密码，只显示这一次：</p>
      <div class="row"><code class="pw" id="pwResetValue">${escapeHtml(d.tempPassword)}</code>
      <button type="button" id="pwCopyBtn">复制</button>
      <button type="button" id="pwHideBtn" class="ghost">我已记下，隐藏</button></div>
      <p class="note left">已下线 ${d.sessionsRevoked ?? 0} 个会话。</p>`;
    box.classList.remove("hidden");
    $("pwResetReason").value = "";
    $("pwCopyBtn").onclick = async () => {
      try {
        await navigator.clipboard.writeText(d.tempPassword);
        setMsg($("opsMsg"), "临时密码已复制", true);
      } catch {
        const range = document.createRange();
        range.selectNodeContents($("pwResetValue"));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        setMsg($("opsMsg"), "无法自动复制，已选中，请手动复制");
      }
    };
    $("pwHideBtn").onclick = setResultHidden;
    setMsg($("opsMsg"), `已为用户 #${d.userId} 重置密码`, true);
  } finally {
    pwResetBusy = false;
    $("pwResetBtn").disabled = false;
  }
};

/* ---- change own password ---- */
let selfPwBusy = false;
$("selfPwBtn").onclick = async () => {
  if (selfPwBusy) return;
  setMsg($("opsMsg"), "");
  const currentPassword = $("selfPwCur").value;
  const newPassword = $("selfPwNew").value;
  if (!currentPassword || !newPassword) return setMsg($("opsMsg"), "请填写当前密码和新密码");
  if (newPassword !== $("selfPwNew2").value) return setMsg($("opsMsg"), "两次输入的新密码不一致");
  selfPwBusy = true;
  $("selfPwBtn").disabled = true;
  try {
    const r = await api("/me/password", {
      method: "POST",
      csrf: csrfToken,
      body: { currentPassword, newPassword },
    });
    if (r.status !== 204 && r.status !== 200) {
      setMsg($("opsMsg"), r.json?.error?.message || "修改失败");
      return;
    }
    ["selfPwCur", "selfPwNew", "selfPwNew2"].forEach((k) => ($(k).value = ""));
    showLoggedOut();
    setMsg($("loginMsg"), "密码已修改，请用新密码重新登录", true);
  } finally {
    selfPwBusy = false;
    $("selfPwBtn").disabled = false;
  }
};


/* ---- shared helpers for batch 2 ---- */
function newIdemKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function reauthLost(r) {
  if (r.status === 403 && r.json?.error?.code === "ADMIN_REAUTH_REQUIRED") {
    adminVerified = false;
    updateVerifyBadge();
  }
}

async function guarded(btn, fn) {
  if (!btn || btn.dataset.busy === "1") return;
  btn.dataset.busy = "1";
  btn.disabled = true;
  try {
    await fn();
  } finally {
    btn.dataset.busy = "";
    btn.disabled = false;
  }
}

/* ---- feature switches ---- */
const GROUP_LABEL = { site: "站点", feature: "玩法", pvp: "对战" };
let settingsCache = null;
let settingsSeq = 0;

function fmtVal(it, v) {
  if (it.type === "bool") return v ? "开" : "关";
  return String(v);
}

function settingRowHtml(it) {
  let control = "";
  if (it.type === "bool") {
    control = `<button type="button" class="switch ${it.value ? "on" : ""}" role="switch" aria-checked="${it.value ? "true" : "false"}" data-set-key="${it.key}" data-set-bool="${it.value ? "false" : "true"}">${it.value ? "已开启" : "已关闭"}</button>`;
  } else if (it.type === "int") {
    control = `<input type="number" inputmode="numeric" min="${it.min}" max="${it.max}" step="1" value="${it.value}" data-set-input="${it.key}" aria-label="${escapeHtml(it.label)}" />
      <button type="button" data-set-key="${it.key}" data-set-save="1">保存</button>`;
  } else {
    control = `<select data-set-input="${it.key}" aria-label="${escapeHtml(it.label)}">${it.options.map((o) => `<option value="${escapeHtml(o)}" ${o === it.value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>
      <button type="button" data-set-key="${it.key}" data-set-save="1">保存</button>`;
  }
  const meta = it.overridden
    ? `<span class="tag over">已覆盖</span> 环境默认 ${escapeHtml(fmtVal(it, it.envValue))}${it.updatedAt ? ` · ${escapeHtml(it.updatedAt)}${it.updatedBy ? ` · #${it.updatedBy}` : ""}` : ""}`
    : `<span class="tag">默认</span> 来自环境变量`;
  return `<div class="item setting" data-setting="${it.key}">
      <div class="s-head"><strong>${escapeHtml(it.label)}</strong> <code>${escapeHtml(it.key)}</code></div>
      <div class="s-meta">${meta}${it.note ? ` · ${escapeHtml(it.note)}` : ""}${it.type === "int" ? ` · 范围 ${it.min}–${it.max}` : ""}</div>
      <div class="row s-ctl">${control}${it.overridden ? `<button type="button" class="ghost" data-set-key="${it.key}" data-set-reset="1">恢复默认</button>` : ""}</div>
    </div>`;
}

function renderSettings() {
  if (!settingsCache) return;
  const groups = { site: [], feature: [], pvp: [] };
  for (const it of settingsCache) (groups[it.group] || groups.feature).push(it);
  const setList = $("setList");
  setList.innerHTML = ["site", "feature", "pvp"]
    .map((g) => `<h3 class="grp">${GROUP_LABEL[g]}</h3>` + groups[g].filter((it) => g !== "pvp" || it.type === "bool").map(settingRowHtml).join(""))
    .join("");
  $("pvpParamList").innerHTML = groups.pvp.filter((it) => it.type !== "bool").map(settingRowHtml).join("");
  for (const box of [setList, $("pvpParamList")]) wireSettings(box);
}

async function loadSettings() {
  const seq = ++settingsSeq;
  const r = await api("/admin/settings");
  if (seq !== settingsSeq) return;
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "读取开关失败");
    return;
  }
  settingsCache = r.json.data.items;
  renderSettings();
}

async function saveSetting(key, value, label) {
  const reason = $("setReason").value.trim();
  if (reason.length < 2) {
    setMsg($("opsMsg"), "请先在「开关」页填写改动原因（至少 2 个字）");
    return;
  }
  const r = await api(`/admin/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    csrf: csrfToken,
    body: { value, reason },
  });
  reauthLost(r);
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "保存失败");
    return;
  }
  const st = r.json.data.setting;
  settingsCache = settingsCache.map((it) => (it.key === key ? st : it));
  renderSettings();
  setMsg($("opsMsg"), value === null ? `「${label}」已恢复默认：${fmtVal(st, st.value)}` : `「${label}」已设为 ${fmtVal(st, st.value)}`, true);
}

function wireSettings(box) {
  box.querySelectorAll("button[data-set-key]").forEach((btn) => {
    btn.onclick = () => guarded(btn, async () => {
      const key = btn.dataset.setKey;
      const it = settingsCache.find((x) => x.key === key);
      if (!it) return;
      if (btn.dataset.setReset) {
        if (!window.confirm(`把「${it.label}」恢复为环境默认（${fmtVal(it, it.envValue)}）？`)) return;
        return saveSetting(key, null, it.label);
      }
      let value;
      if (it.type === "bool") {
        value = btn.dataset.setBool === "true";
        if (!window.confirm(`确认${value ? "开启" : "关闭"}「${it.label}」？对所有用户立即生效。`)) return;
      } else {
        const input = box.querySelector(`[data-set-input="${key}"]`);
        if (it.type === "int") {
          value = Number(input.value);
          if (!Number.isInteger(value) || value < it.min || value > it.max) {
            setMsg($("opsMsg"), `「${it.label}」需为 ${it.min}–${it.max} 的整数`);
            return;
          }
        } else value = input.value;
        if (value === it.value) {
          setMsg($("opsMsg"), `「${it.label}」没有变化`);
          return;
        }
      }
      await saveSetting(key, value, it.label);
    });
  });
}

$("setRefreshBtn").onclick = () => guarded($("setRefreshBtn"), loadSettings);

/* ---- PvP ---- */
let pvpDraining = false;
const pvpCursors = { match: null, report: null };
const pvpSeq = { overview: 0, match: 0, report: 0 };

async function loadPvpOverview() {
  const seq = ++pvpSeq.overview;
  const r = await api("/admin/pvp/overview");
  if (seq !== pvpSeq.overview) return;
  const box = $("pvpOverview");
  if (r.status !== 200) {
    box.innerHTML = `<p class="msg">${escapeHtml(r.json?.error?.message || "读取失败")}</p>`;
    return;
  }
  const d = r.json.data;
  pvpDraining = !!d.draining;
  box.innerHTML = `<div class="stat"><b>${pvpDraining ? "已停新局" : "正常接局"}</b><span>状态</span></div>
    <div class="stat"><b>${d.activeRooms ?? 0}</b><span>进行中房间</span></div>
    <div class="stat"><b>${d.waitingReady ?? 0}</b><span>等待准备</span></div>
    <div class="stat"><b>${d.playing ?? 0}</b><span>对局中</span></div>
    <div class="stat"><b>${d.openReports ?? 0}</b><span>待处理举报</span></div>`;
  $("pvpDrainBtn").textContent = pvpDraining ? "恢复接新局" : "停止接新局";
}

function pvpReason() {
  const v = $("pvpReason").value.trim();
  if (v.length < 2) {
    setMsg($("opsMsg"), "请填写原因（至少 2 个字）");
    return null;
  }
  return v;
}

$("pvpRefreshBtn").onclick = () => guarded($("pvpRefreshBtn"), async () => {
  await Promise.all([loadPvpOverview(), loadSettings()]);
});

$("pvpDrainBtn").onclick = () => guarded($("pvpDrainBtn"), async () => {
  const reason = pvpReason();
  if (!reason) return;
  const to = !pvpDraining;
  if (!window.confirm(to ? "停止接新局？进行中的对局不受影响。" : "恢复接新局？")) return;
  const r = await api("/admin/pvp/drain", {
    method: "POST", csrf: csrfToken, body: { drain: to, reason }, headers: { "Idempotency-Key": newIdemKey() },
  });
  reauthLost(r);
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "操作失败");
  setMsg($("opsMsg"), to ? "已停止接新局" : "已恢复接新局", true);
  await loadPvpOverview();
});

$("pvpAbortBtn").onclick = () => guarded($("pvpAbortBtn"), async () => {
  const reason = pvpReason();
  if (!reason) return;
  const pre = await api("/admin/pvp/abort-active", { method: "POST", csrf: csrfToken, body: { reason } , headers: { "Idempotency-Key": newIdemKey() } });
  reauthLost(pre);
  if (pre.status !== 200) return setMsg($("opsMsg"), pre.json?.error?.message || "预览失败");
  const p = pre.json.data;
  const n = (p.waitingReady ?? 0) + (p.playing ?? 0);
  if (!n) return setMsg($("opsMsg"), "当前没有进行中的对局", true);
  if (!window.confirm(`将中止 ${n} 局（等待 ${p.waitingReady ?? 0} · 对局中 ${p.playing ?? 0}），并退还入场韭币。确认？`)) return;
  const r = await api("/admin/pvp/abort-active", {
    method: "POST", csrf: csrfToken, body: { confirm: true, reason }, headers: { "Idempotency-Key": newIdemKey() },
  });
  reauthLost(r);
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "中止失败");
  setMsg($("opsMsg"), `已中止 ${r.json.data.matchIds?.length ?? n} 局`, true);
  await loadPvpOverview();
});

function matchRowHtml(m) {
  return `<details class="item user-row" data-match="${escapeHtml(m.matchId)}">
    <summary class="plain"><span class="who"><code>${escapeHtml(String(m.matchId).slice(0, 8))}</code> · <span class="st st-${escapeHtml(m.status)}">${escapeHtml(m.status)}</span>${m.terminalReason ? ` · ${escapeHtml(m.terminalReason)}` : ""}</span>
    <span class="meta">${escapeHtml(m.createdAt ? new Date(Number(m.createdAt) || m.createdAt).toLocaleString("zh-CN", { hour12: false }) : "—")}</span></summary>
    <div class="user-detail" data-match-detail="${escapeHtml(m.matchId)}"><p class="note left">展开加载…</p></div>
  </details>`;
}

function matchDetailHtml(d) {
  const players = (d.players || []).map((p) => `<li>座位 ${p.seat} · 用户 #${p.userId} · ${escapeHtml(p.outcome || "—")} · 收益 ${ppmPct(p.returnPpm)} · 回撤 ${ppmPct(p.mddPpm)} · 韭币 ${p.coinDelta ?? 0}</li>`).join("");
  const ledger = (d.ledger || []).map((l) => `<li>#${l.userId} ${l.delta > 0 ? "+" : ""}${l.delta} ${escapeHtml(l.reason)}</li>`).join("");
  return `<dl class="kv">
    <dt>对局</dt><dd><code>${escapeHtml(d.matchId)}</code></dd>
    <dt>股票</dt><dd>${escapeHtml(d.stockName || "—")} ${escapeHtml(d.stockCode || "")}</dd>
    <dt>结果</dt><dd>${escapeHtml(d.terminalType || d.status)}${d.winnerUserId ? ` · 胜者 #${d.winnerUserId}` : ""} · 回合 ${d.resolvedRounds ?? 0}</dd>
    <dt>选手</dt><dd><ul class="plain">${players || "<li>—</li>"}</ul></dd>
    <dt>流水</dt><dd><ul class="plain">${ledger || "<li>—</li>"}</ul></dd>
  </dl>`;
}

async function loadMatches({ more = false } = {}) {
  const qs = new URLSearchParams({ limit: "20" });
  const st = $("pvpMatchStatus").value;
  if (st) qs.set("status", st);
  if (more) {
    if (!pvpCursors.match) return;
    qs.set("cursor", pvpCursors.match);
  }
  const seq = ++pvpSeq.match;
  $("pvpMatchMoreBtn").disabled = true;
  const r = await api(`/admin/pvp/matches?${qs}`);
  if (seq !== pvpSeq.match) return;
  $("pvpMatchMoreBtn").disabled = false;
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "查询失败");
  const el = $("pvpMatchList");
  const items = r.json.data.entries || [];
  if (!more) el.innerHTML = items.length ? "" : `<div class="item">无结果</div>`;
  el.insertAdjacentHTML("beforeend", items.map(matchRowHtml).join(""));
  el.querySelectorAll("details[data-match]:not([data-wired])").forEach((row) => {
    row.dataset.wired = "1";
    row.addEventListener("toggle", async () => {
      if (!row.open || row.dataset.loaded) return;
      const id = row.dataset.match;
      const d = await api(`/admin/pvp/matches/${encodeURIComponent(id)}`);
      const box = row.querySelector("[data-match-detail]");
      if (d.status !== 200) {
        box.innerHTML = `<p class="msg">${escapeHtml(d.json?.error?.message || "加载失败")}</p>`;
        return;
      }
      row.dataset.loaded = "1";
      box.innerHTML = matchDetailHtml(d.json.data);
    });
  });
  pvpCursors.match = r.json.data.nextCursor || null;
  $("pvpMatchMoreBtn").classList.toggle("hidden", !pvpCursors.match);
}

const REPORT_REASON = { cheating: "作弊", abuse: "辱骂", afk: "挂机", other: "其他" };
function reportRowHtml(p) {
  const open = p.status === "open";
  return `<div class="item" data-report="${p.id}">
    #${p.id} · 对局 <code>${escapeHtml(String(p.matchId).slice(0, 8))}</code> · #${p.reporterId} 举报 #${p.reportedId}
    · ${escapeHtml(REPORT_REASON[p.reason] || p.reason)} · ${escapeHtml(p.status)}
    ${p.detail ? `<div class="dim">${escapeHtml(p.detail)}</div>` : ""}
    ${open ? `<div class="row"><button type="button" data-rep-id="${p.id}" data-rep-to="resolved">已处理</button><button type="button" class="ghost" data-rep-id="${p.id}" data-rep-to="dismissed">驳回</button></div>` : ""}
  </div>`;
}

async function loadReports({ more = false } = {}) {
  const qs = new URLSearchParams({ limit: "20", status: $("pvpReportStatus").value });
  if (more) {
    if (!pvpCursors.report) return;
    qs.set("cursor", pvpCursors.report);
  }
  const seq = ++pvpSeq.report;
  $("pvpReportMoreBtn").disabled = true;
  const r = await api(`/admin/pvp/reports?${qs}`);
  if (seq !== pvpSeq.report) return;
  $("pvpReportMoreBtn").disabled = false;
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "查询失败");
  const el = $("pvpReportList");
  const items = r.json.data.entries || [];
  if (!more) el.innerHTML = items.length ? "" : `<div class="item">无结果</div>`;
  el.insertAdjacentHTML("beforeend", items.map(reportRowHtml).join(""));
  el.querySelectorAll("button[data-rep-id]:not([data-wired])").forEach((btn) => {
    btn.dataset.wired = "1";
    btn.onclick = () => guarded(btn, async () => {
      const reason = pvpReason();
      if (!reason) return;
      const r2 = await api(`/admin/pvp/reports/${btn.dataset.repId}`, {
        method: "PATCH", csrf: csrfToken, body: { status: btn.dataset.repTo, reason }, headers: { "Idempotency-Key": newIdemKey() },
      });
      reauthLost(r2);
      if (r2.status !== 200) return setMsg($("opsMsg"), r2.json?.error?.message || "处理失败");
      setMsg($("opsMsg"), `举报 #${btn.dataset.repId} 已${btn.dataset.repTo === "resolved" ? "处理" : "驳回"}`, true);
      await Promise.all([loadReports(), loadPvpOverview()]);
    });
  });
  pvpCursors.report = r.json.data.nextCursor || null;
  $("pvpReportMoreBtn").classList.toggle("hidden", !pvpCursors.report);
}

$("pvpMatchBtn").onclick = () => loadMatches();
$("pvpMatchMoreBtn").onclick = () => loadMatches({ more: true });
$("pvpReportBtn").onclick = () => loadReports();
$("pvpReportMoreBtn").onclick = () => loadReports({ more: true });

/* ---- app version (read-only) ---- */
function fmtBytes(n) {
  if (!Number.isFinite(n)) return "—";
  return `${(n / 1024 / 1024).toFixed(2)} MB（${n.toLocaleString("en-US")} B）`;
}

$("verBtn").onclick = () => guarded($("verBtn"), async () => {
  const box = $("verBox");
  box.innerHTML = `<div class="item">读取中…</div>`;
  let j;
  try {
    const res = await fetch(`/download/app-version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    j = await res.json();
  } catch (e) {
    box.innerHTML = `<div class="item msg">读取失败：${escapeHtml(e.message || String(e))}</div>`;
    return;
  }
  let sizeCheck = "未核对";
  try {
    const u = new URL(j.apkUrl, location.href);
    if (u.origin === location.origin) {
      const h = await fetch(u.pathname, { method: "HEAD", cache: "no-store" });
      const len = Number(h.headers.get("content-length"));
      sizeCheck = !h.ok ? `APK 不可访问（HTTP ${h.status}）` : len === Number(j.size) ? "✓ 与清单一致" : `✗ 实际 ${fmtBytes(len)}`;
    } else sizeCheck = "APK 不在本站，跳过核对";
  } catch {
    sizeCheck = "核对失败";
  }
  const pub = j.publishedAt ? new Date(j.publishedAt).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) + "（北京时间）" : "—";
  box.innerHTML = `<div class="item"><dl class="kv">
    <dt>版本</dt><dd><strong>${escapeHtml(j.versionName)}</strong>（versionCode ${escapeHtml(j.versionCode)}）</dd>
    <dt>强制更新</dt><dd>低于 versionCode ${escapeHtml(j.minSupportedVersionCode ?? 1)} 时强制</dd>
    <dt>发布时间</dt><dd>${escapeHtml(pub)}</dd>
    <dt>大小</dt><dd>${fmtBytes(Number(j.size))} · ${escapeHtml(sizeCheck)}</dd>
    <dt>SHA-256</dt><dd><code class="wrap">${escapeHtml(j.sha256)}</code></dd>
    <dt>下载</dt><dd><a href="${escapeHtml(j.apkUrl)}" rel="noopener">${escapeHtml(j.apkUrl)}</a></dd>
    <dt>更新说明</dt><dd class="pre">${escapeHtml(j.notes || "")}</dd>
  </dl></div>`;
});

/* ---- lazy-load per tab ---- */
const TAB_LOADERS = {
  settings: () => loadSettings(),
  pvp: () => Promise.all([loadPvpOverview(), loadSettings()]),
};
document.querySelectorAll(".tabs .tab").forEach((t) => {
  t.addEventListener("click", () => {
    const fn = TAB_LOADERS[t.dataset.tab];
    if (fn && !tabLoaded.has(t.dataset.tab) && !$("opsPanel").classList.contains("hidden")) {
      tabLoaded.add(t.dataset.tab);
      fn();
    }
  });
});


/* ================= batch 3 ================= */
function parseUtcSql(s) {
  if (!s) return null;
  const t = Date.parse(String(s).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
  return Number.isFinite(t) ? t : null;
}
function isFutureUtc(s) {
  const t = parseUtcSql(s);
  return t != null && t > Date.now();
}
function fmtBeijing(s) {
  const t = typeof s === "number" ? s : parseUtcSql(s);
  if (t == null) return String(s || "—");
  return new Date(t).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/* ---- announcement preview + schedule ---- */
function renderAnnPreview() {
  const box = $("annPreview");
  if (!box) return;
  const title = $("annTitle").value.trim();
  const body = $("annBody").value.trim();
  if (!title && !body) {
    box.innerHTML = `<p class="dim">在上方输入标题和正文即可预览</p>`;
    return;
  }
  box.innerHTML = `<div class="announcements-dialog ann-preview-dialog">
      <h2 class="announcements-title">系统公告</h2>
      <div class="announcements-list"><article class="announcements-item">
        ${title ? `<h3 class="announcements-item-title">${escapeHtml(title)}</h3>` : ""}
        <time class="announcements-item-time">${escapeHtml(fmtBeijing(Date.now()))}</time>
        <div class="announcements-item-body">${escapeHtml(body).replace(/\n/g, "<br>")}</div>
      </article></div>
    </div>`;
}
$("annTitle").addEventListener("input", renderAnnPreview);
$("annBody").addEventListener("input", renderAnnPreview);

function beijingLocalToIso(v) {
  // datetime-local value is wall-clock; interpret it as Asia/Shanghai (UTC+8, no DST).
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v || "");
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]);
  return new Date(t).toISOString();
}

$("annScheduleBtn").onclick = () => guarded($("annScheduleBtn"), async () => {
  setMsg($("annMsg"), "");
  const id = parsePositiveId($("annId").value);
  if (!id) return setMsg($("annMsg"), "请先「新建」或「填入」一条公告（需要 ID）");
  const iso = beijingLocalToIso($("annPublishAt").value);
  if (!iso) return setMsg($("annMsg"), "请选择发布时间");
  if (!window.confirm(`公告 #${id} 将于 ${fmtBeijing(Date.parse(iso))}（北京时间）自动上线，确认？`)) return;
  const r = await api(`/admin/announcements/${id}/schedule`, { method: "POST", csrf: csrfToken, body: { publishAt: iso } });
  if (handleAnnReauthRequired(r)) return;
  if (r.status !== 200) return setMsg($("annMsg"), r.json?.error?.message || "定时失败");
  await $("annSearchBtn").onclick();
  setMsg($("annMsg"), `公告 #${id} 已定时：${fmtBeijing(r.json.data.scheduledAt)}（北京时间）自动发布`, true);
});

$("annUnscheduleBtn").onclick = () => guarded($("annUnscheduleBtn"), async () => {
  setMsg($("annMsg"), "");
  const id = parsePositiveId($("annId").value);
  if (!id) return setMsg($("annMsg"), "请先「填入」一条定时公告");
  const r = await api(`/admin/announcements/${id}/schedule`, { method: "DELETE", csrf: csrfToken });
  if (handleAnnReauthRequired(r)) return;
  if (r.status !== 200) return setMsg($("annMsg"), r.json?.error?.message || "取消失败");
  await $("annSearchBtn").onclick();
  setMsg($("annMsg"), `公告 #${id} 已取消定时（仍为草稿）`, true);
});

/* ---- feedback badge, note, lightbox ---- */
async function refreshFbBadge() {
  const r = await api("/admin/feedback-unread");
  const b = $("fbUnreadBadge");
  if (r.status !== 200 || !b) return;
  const n = Number(r.json.data.count) || 0;
  b.textContent = n > 99 ? "99+" : String(n);
  b.classList.toggle("hidden", n === 0);
}

function renderFeedbackNote(f) {
  const box = $("fbNoteBox");
  if (!box) return;
  if (!f) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  if (fbNoteState && fbNoteState.id === f.id) {
    $("fbNote").value = fbNoteState.note || "";
    $("fbNoteMeta").textContent = fbNoteState.at ? `上次保存 ${fmtBeijing(fbNoteState.at)}${fbNoteState.by ? ` · #${fbNoteState.by}` : ""}` : "";
  }
}

$("fbNoteBtn").onclick = () => guarded($("fbNoteBtn"), async () => {
  setMsg($("fbMsg"), "");
  const id = parsePositiveId($("fbId").value);
  if (!id) return setMsg($("fbMsg"), "请先加载一条反馈");
  const r = await api(`/admin/feedback/${id}/note`, { method: "PUT", csrf: csrfToken, body: { note: $("fbNote").value } });
  if (handleFbReauthRequired(r)) return;
  if (r.status !== 200) return setMsg($("fbMsg"), r.json?.error?.message || "保存失败");
  fbNoteState = { ...(r.json.data.note || {}), id };
  $("fbNoteMeta").textContent = `已保存 ${fmtBeijing(fbNoteState.at)}`;
  setMsg($("fbMsg"), `反馈 #${id} 备注已保存`, true);
});

let lightboxReturn = null;
function openLightbox(url, from) {
  let lb = $("lightbox");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "lightbox";
    lb.className = "lightbox";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.setAttribute("aria-label", "反馈图片");
    lb.innerHTML = `<img alt="反馈图片" /><button type="button" class="lb-close" aria-label="关闭">关闭</button>`;
    document.body.appendChild(lb);
    lb.addEventListener("click", (e) => {
      if (e.target === lb || e.target.classList.contains("lb-close")) closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !lb.classList.contains("hidden")) closeLightbox();
    });
  }
  lightboxReturn = from || null;
  lb.querySelector("img").src = url;
  lb.classList.remove("hidden");
  lb.querySelector(".lb-close").focus();
}
function closeLightbox() {
  const lb = $("lightbox");
  if (!lb) return;
  lb.classList.add("hidden");
  lb.querySelector("img").removeAttribute("src");
  if (lightboxReturn) lightboxReturn.focus();
}

/* ---- content overview ---- */
async function loadContent() {
  const r = await api("/admin/content/overview");
  const box = $("contentOverview");
  if (r.status !== 200) {
    box.innerHTML = `<p class="msg">${escapeHtml(r.json?.error?.message || "读取失败")}</p>`;
    return;
  }
  const d = r.json.data;
  const on = (v) => `<span class="tag ${v ? "over" : ""}">${v ? "开" : "关"}</span>`;
  const q = d.quiz;
  const chapters = d.puzzles.chapters.map((c) => `<tr><td>${escapeHtml(c.chapterId)}</td><td>${c.published}/${c.levels}</td><td>${c.players}</td><td>${c.twoStarClears}</td><td>${c.played7d}</td></tr>`).join("");
  box.innerHTML = `<div class="stats">
      <div class="stat"><b>${on(d.flags.quizRewards)}</b><span>答题奖励</span></div>
      <div class="stat"><b>${on(d.flags.puzzleChapter)}</b><span>残局</span></div>
      <div class="stat"><b>${on(d.flags.puzzleWeekly)}</b><span>周榜</span></div>
      <div class="stat"><b>${on(d.flags.dailyChallenge)}</b><span>每日挑战</span></div>
      <div class="stat"><b>${on(d.flags.ghostDuel)}</b><span>幽灵对局</span></div>
    </div>
    <h3 class="grp">每日答题（${escapeHtml(q.today)}）</h3>
    <dl class="kv">
      <dt>题库</dt><dd>${q.activeQuestions} 题启用</dd>
      <dt>今日题组</dt><dd>${q.todaySet ? `${q.todaySet.questions} 题 · 完成奖 ${q.todaySet.rewardComplete} · 全对加 ${q.todaySet.rewardBonus}（≥${q.todaySet.bonusMinCorrect} 题）` : "尚未生成（首个用户打开时生成）"}</dd>
      <dt>今日</dt><dd>开始 ${q.attemptsToday} · 完成 ${q.settledToday} · 发放 ${q.coinsToday} 韭币</dd>
      <dt>近 7 天</dt><dd>${q.attempts7d} 次作答</dd>
    </dl>
    <h3 class="grp">残局章节</h3>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>章节</th><th>上线/关卡</th><th>玩家</th><th>两星</th><th>7天活跃</th></tr></thead><tbody>${chapters || `<tr><td colspan="5">暂无章节</td></tr>`}</tbody></table></div>
    <h3 class="grp">今日挑战</h3>
    <p class="note left">${d.daily.missing ? `${escapeHtml(d.daily.date)} 尚未生成` : `${escapeHtml(d.daily.date)} · ${escapeHtml(d.daily.stockName)}（${escapeHtml(d.daily.stockCode)}）· 参与 ${d.daily.attempts} · 完成 ${d.daily.settled}`}</p>`;
}
$("contentRefreshBtn").onclick = () => guarded($("contentRefreshBtn"), loadContent);

/* ---- daily board ---- */
let dailySeq = 0;
function todayBeijing() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}
async function loadDaily() {
  const date = $("dailyDate").value || todayBeijing();
  $("dailyDate").value = date;
  const seq = ++dailySeq;
  const r = await api(`/admin/daily/board?date=${encodeURIComponent(date)}`);
  if (seq !== dailySeq) return;
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "读取失败");
  const d = r.json.data;
  $("dailyInfo").innerHTML = d.challenge
    ? `<p class="note left">${escapeHtml(d.date)} · ${escapeHtml(d.challenge.stockName)}（${escapeHtml(d.challenge.stockCode)}）· ${d.challenge.gameDays} 天 · 共 ${d.entries.length} 条记录</p>`
    : `<p class="note left">${escapeHtml(d.date)} 没有挑战</p>`;
  const el = $("dailyList");
  if (!d.entries.length) {
    el.innerHTML = `<div class="item">无记录</div>`;
    return;
  }
  let rank = 0;
  el.innerHTML = d.entries.map((e) => {
    const onBoard = e.boardEligible && e.status === "settled" && e.userStatus === "active";
    if (onBoard) rank += 1;
    const action = e.hiddenByAdmin
      ? `<button type="button" data-daily="${escapeHtml(e.attemptId)}" data-hide="false">恢复上榜</button>`
      : onBoard ? `<button type="button" data-daily="${escapeHtml(e.attemptId)}" data-hide="true">隐藏</button>` : "";
    return `<div class="item daily-row">
      <span class="rank">${onBoard ? `#${rank}` : "—"}</span>
      <span class="who"><strong>${escapeHtml(e.nickname || "")}</strong> <code>${escapeHtml(e.username || "")}</code> · #${e.userId}</span>
      <span class="meta">${escapeHtml(e.status)} · 收益 ${ppmPct(e.returnPpm)} · 回撤 ${ppmPct(e.mddPpm)}${e.hiddenByAdmin ? ` · <span class="tag over">后台隐藏</span>` : !onBoard ? " · 不在榜" : ""}</span>
      ${action}
    </div>`;
  }).join("");
  el.querySelectorAll("button[data-daily]").forEach((btn) => {
    btn.onclick = () => guarded(btn, async () => {
      const reason = $("dailyReason").value.trim();
      if (reason.length < 2) return setMsg($("opsMsg"), "请填写原因（至少 2 个字）");
      const hide = btn.dataset.hide === "true";
      if (hide && !window.confirm("把这条记录移出每日挑战公开榜？")) return;
      const r2 = await api(`/admin/daily/attempts/${encodeURIComponent(btn.dataset.daily)}`, { method: "PATCH", csrf: csrfToken, body: { hide, reason } });
      reauthLost(r2);
      if (r2.status !== 200) return setMsg($("opsMsg"), r2.json?.error?.message || "操作失败");
      setMsg($("opsMsg"), hide ? "已从公开榜隐藏" : "已恢复上榜", true);
      await loadDaily();
    });
  });
}
$("dailyBtn").onclick = () => guarded($("dailyBtn"), loadDaily);

/* ---- share links ---- */
let shareCursor = null;
let shareSeq = 0;
const SHARE_LABEL = { open: "进行中", joined: "已加入", cancelled: "已作废", expired: "已过期" };
async function loadShares({ more = false } = {}) {
  const qs = new URLSearchParams({ limit: "20" });
  const st = $("shareStatus").value;
  if (st) qs.set("status", st);
  if (more) {
    if (!shareCursor) return;
    qs.set("cursor", shareCursor);
  }
  const seq = ++shareSeq;
  $("shareMoreBtn").disabled = true;
  const r = await api(`/admin/pvp/shares?${qs}`);
  if (seq !== shareSeq) return;
  $("shareMoreBtn").disabled = false;
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "查询失败");
  const el = $("shareList");
  const items = r.json.data.items || [];
  if (!more) el.innerHTML = items.length ? "" : `<div class="item">无结果</div>`;
  el.insertAdjacentHTML("beforeend", items.map((s) => `<div class="item" data-share="${escapeHtml(s.code)}">
      <code>${escapeHtml(s.code)}</code> · ${escapeHtml(s.nickname || "")} #${s.fromUserId} · ${SHARE_LABEL[s.status] || escapeHtml(s.status)}
      · 创建 ${escapeHtml(fmtBeijing(Number(s.createdAt)))} · 到期 ${escapeHtml(fmtBeijing(Number(s.expiresAt)))}
      ${s.status === "open" ? `<button type="button" data-revoke="${escapeHtml(s.code)}">作废</button>` : ""}
    </div>`).join(""));
  el.querySelectorAll("button[data-revoke]:not([data-wired])").forEach((btn) => {
    btn.dataset.wired = "1";
    btn.onclick = () => guarded(btn, async () => {
      const reason = pvpReason();
      if (!reason) return;
      if (!window.confirm(`作废分享链接 ${btn.dataset.revoke}？对方将无法再加入。`)) return;
      const r2 = await api(`/admin/pvp/shares/${encodeURIComponent(btn.dataset.revoke)}/revoke`, { method: "POST", csrf: csrfToken, body: { reason } });
      reauthLost(r2);
      if (r2.status !== 200) return setMsg($("opsMsg"), r2.json?.error?.message || "作废失败");
      setMsg($("opsMsg"), `链接 ${btn.dataset.revoke} 已作废`, true);
      await loadShares();
    });
  });
  shareCursor = r.json.data.nextCursor || null;
  $("shareMoreBtn").classList.toggle("hidden", !shareCursor);
}
$("shareBtn").onclick = () => loadShares();
$("shareMoreBtn").onclick = () => loadShares({ more: true });

TAB_LOADERS.content = () => Promise.all([loadContent(), loadDaily()]);


/* ================= 幸运转盘 (lucky wheel) ================= */
const WHEEL_KIND_LABEL = { jiu_coin: "韭币", item: "后悔券", spin: "再转一次" };
let wheelCfg = null; // last server payload (adminGetConfig)
let wheelDraft = []; // editable sectors
let wheelLogCursor = null;
let wheelPreviewSeq = 0;
let wheelPreviewTimer = null;

function wheelPrizeText(p) {
  if (!p) return "—";
  const sub = p.substituted ? "（折算）" : "";
  if (p.kind === "jiu_coin") return `${p.amount} 韭币${p.isJackpot ? " 🎰大奖" : ""}${sub}`;
  if (p.kind === "item") return `${p.label || p.item} ×${p.qty}`;
  return "再转一次";
}

function wheelReason(id) {
  const v = $(id).value.trim();
  if (v.length < 2 || v.length > 200) {
    setMsg($("opsMsg"), "请先填写原因（2–200 字）");
    return null;
  }
  return v;
}

function wheelRenderSwitch() {
  const on = !!wheelCfg?.settings?.enabled;
  $("wheelState").textContent = on ? "转盘：已开启（每日领取已停用）" : "转盘：已关闭（沿用每日领取）";
  $("wheelState").classList.toggle("over", on);
  $("wheelToggle").textContent = on ? "关闭转盘" : "开启转盘";
  $("wheelToggle").classList.toggle("on", on);
  $("wheelDailyFree").value = wheelCfg?.settings?.dailyFree ?? 1;
}

function wheelDraftFromActive() {
  const c = wheelCfg.active;
  wheelDraft = c.sectors.map((s) => ({ pos: s.pos, kind: s.kind, amount: s.amount ?? 100, item: s.item || "rewind_ticket", qty: s.qty ?? 1, weight: s.weight, jackpot: !!s.jackpot }));
  $("wheelTicketValue").value = c.ticketCoinValue;
}

function wheelDraftPayload() {
  return {
    ticketCoinValue: Number($("wheelTicketValue").value),
    sectors: wheelDraft.map((d) => {
      const s = { pos: d.pos, kind: d.kind, weight: Number(d.weight) };
      if (d.kind === "jiu_coin") s.amount = Number(d.amount);
      if (d.kind === "item") { s.item = d.item; s.qty = Number(d.qty); }
      if (d.kind === "spin") s.qty = 1;
      if (d.jackpot) s.jackpot = true;
      return s;
    }),
  };
}

function wheelRenderRows() {
  const items = wheelCfg.constraints.itemsAvailable;
  $("wheelRows").innerHTML = wheelDraft.map((d, i) => {
    const kindOpts = Object.entries(WHEEL_KIND_LABEL)
      .map(([k, l]) => `<option value="${k}"${k === d.kind ? " selected" : ""}${k === "item" && !items ? " disabled" : ""}>${l}${k === "item" && !items ? "（未部署）" : ""}</option>`)
      .join("");
    const amt = d.kind === "jiu_coin"
      ? `<input data-w="amount" data-i="${i}" type="number" min="1" max="${wheelCfg.constraints.coinMax}" step="1" value="${escapeHtml(d.amount)}" style="max-width:6rem" />`
      : d.kind === "item"
        ? `<input data-w="qty" data-i="${i}" type="number" min="1" max="${wheelCfg.constraints.itemQtyMax}" step="1" value="${escapeHtml(d.qty)}" style="max-width:6rem" />`
        : `<span class="dim">×1</span>`;
    return `<tr>
      <td>${i}</td>
      <td><select data-w="kind" data-i="${i}">${kindOpts}</select></td>
      <td>${amt}</td>
      <td><input data-w="weight" data-i="${i}" type="number" min="1" max="10000" step="1" value="${escapeHtml(d.weight)}" style="max-width:6rem" /></td>
      <td class="dim" data-pct="${i}">${(Number(d.weight) / 100).toFixed(1)}%</td>
      <td><input data-w="jackpot" data-i="${i}" type="checkbox"${d.jackpot ? " checked" : ""} /></td>
    </tr>`;
  }).join("");
  $("wheelRows").querySelectorAll("[data-w]").forEach((el) => {
    const handler = () => {
      const d = wheelDraft[Number(el.dataset.i)];
      const f = el.dataset.w;
      if (f === "jackpot") d.jackpot = el.checked;
      else if (f === "kind") { d.kind = el.value; wheelRenderRows(); }
      else d[f] = el.value;
      wheelAfterEdit();
    };
    el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", handler);
  });
  wheelAfterEdit();
}

function wheelAfterEdit() {
  const sum = wheelDraft.reduce((a, d) => a + (Number(d.weight) || 0), 0);
  const tag = $("wheelWeightSum");
  tag.textContent = `权重和 ${sum} / 10000`;
  tag.classList.toggle("over", sum !== 10000);
  wheelDraft.forEach((d, i) => {
    const c = $("wheelRows").querySelector(`[data-pct="${i}"]`);
    if (c) c.textContent = `${((Number(d.weight) || 0) / 100).toFixed(1)}%`;
  });
  clearTimeout(wheelPreviewTimer);
  wheelPreviewTimer = setTimeout(wheelPreview, 250);
}

function wheelRenderEv(ev, extraMsg, warnings) {
  const c = wheelCfg.constraints;
  const vs = ev ? (ev.ev - c.legacyDailyEv).toFixed(1) : "—";
  $("wheelEv").innerHTML = ev
    ? `<div class="stat"><b>${ev.ev}</b><span>期望值 / 日（允许 ${c.evMin}–${c.evMax}）</span></div>
       <div class="stat"><b>${vs}</b><span>对比原每日领取 ${c.legacyDailyEv}</span></div>
       <div class="stat"><b>${ev.evRealistic}</b><span>券按 70% 兑现</span></div>
       <div class="stat"><b>${ev.sd}</b><span>单次标准差</span></div>
       <div class="stat"><b>${(ev.pJackpot * 100).toFixed(1)}%</b><span>大奖概率</span></div>
       <div class="stat"><b>${ev.spinsPerDay}</b><span>每日平均转数</span></div>`
    : `<div class="stat"><b>—</b><span>期望值</span></div>`;
  const lines = [];
  if (extraMsg) lines.push(`<span style="color:var(--accent)">${escapeHtml(extraMsg)}</span>`);
  for (const w of warnings || []) lines.push(`⚠ ${escapeHtml(w.message)}`);
  $("wheelWarn").innerHTML = lines.join("<br>");
}

async function wheelPreview() {
  if (!wheelCfg) return;
  const seq = ++wheelPreviewSeq;
  const r = await api("/admin/lucky-wheel/config/preview", { method: "POST", csrf: csrfToken, body: wheelDraftPayload() });
  if (seq !== wheelPreviewSeq) return;
  if (r.status === 200) wheelRenderEv(r.json.data.ev, "", r.json.data.warnings);
  else wheelRenderEv(r.json?.error?.ev || null, r.json?.error?.message || "配置无效");
}

function wheelRenderVersions() {
  const active = wheelCfg.active.version;
  $("wheelVersions").innerHTML = wheelCfg.versions.map((v) => `<div class="item"><div class="row between">
      <span>v${v.version}${v.version === active ? " · 当前" : ""} · 期望 ${v.ev} · ${escapeHtml(v.note || "")}</span>
      <span class="dim">${fmtBeijing(v.createdAt)}${v.createdBy ? ` · #${v.createdBy}` : ""}</span>
      ${v.version === active ? "" : `<button type="button" class="ghost" data-wheel-restore="${v.version}">恢复为新版本</button>`}
    </div></div>`).join("");
  $("wheelVersions").querySelectorAll("[data-wheel-restore]").forEach((b) => {
    b.onclick = () => guarded(b, async () => {
      const reason = wheelReason("wheelCfgReason");
      if (!reason) return;
      const ver = Number(b.dataset.wheelRestore);
      if (!window.confirm(`把 v${ver} 的奖品表复制为新的当前版本？对所有玩家立即生效。`)) return;
      const r = await api("/admin/lucky-wheel/config", { method: "PUT", csrf: csrfToken, body: { restoreVersion: ver, reason } });
      reauthLost(r);
      if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "恢复失败");
      setMsg($("opsMsg"), `已恢复，当前为 v${r.json.data.version}`, true);
      await loadWheel();
    });
  });
}

async function loadWheel() {
  const r = await api("/admin/lucky-wheel");
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "读取转盘配置失败");
  wheelCfg = r.json.data;
  wheelRenderSwitch();
  wheelDraftFromActive();
  wheelRenderRows();
  wheelRenderVersions();
  await Promise.all([loadWheelStats(), wheelSearch(), loadRewindStats()]);
}

async function wheelPutSetting(key, value, label) {
  const reason = wheelReason("wheelSwReason");
  if (!reason) return;
  const r = await api(`/admin/settings/${encodeURIComponent(key)}`, { method: "PUT", csrf: csrfToken, body: { value, reason } });
  reauthLost(r);
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "保存失败");
  setMsg($("opsMsg"), `「${label}」已设为 ${value}`, true);
  settingsCache = null;
  await loadWheel();
}

$("wheelToggle").onclick = () => guarded($("wheelToggle"), async () => {
  const to = !wheelCfg.settings.enabled;
  if (!window.confirm(to ? "开启幸运转盘？每日领取将停用，玩家改转盘。对所有用户立即生效。" : "关闭幸运转盘并恢复每日领取？对所有用户立即生效。")) return;
  await wheelPutSetting("luckyWheelEnabled", to, "幸运转盘");
});
$("wheelDailySave").onclick = () => guarded($("wheelDailySave"), async () => {
  const n = Number($("wheelDailyFree").value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return setMsg($("opsMsg"), "每日免费次数需为 1–5 的整数");
  await wheelPutSetting("luckyWheelDailyFree", n, "转盘每日免费次数");
});
$("wheelLoadA").onclick = () => {
  if (!wheelCfg) return;
  wheelDraft = wheelCfg.tableA.map((s) => ({ pos: s.pos, kind: s.kind, amount: s.amount ?? 100, item: "rewind_ticket", qty: 1, weight: s.weight, jackpot: !!s.jackpot }));
  $("wheelTicketValue").value = 50;
  wheelRenderRows();
};
function wheelLoadPreset(name) {
  const t = wheelCfg?.presets?.[name];
  if (!t) return setMsg($("opsMsg"), "服务器未提供该预设（API 版本过旧）");
  wheelDraft = t.map((s) => ({ pos: s.pos, kind: s.kind, amount: s.amount ?? 100, item: s.item || "rewind_ticket", qty: s.qty ?? 1, weight: s.weight, jackpot: !!s.jackpot }));
  $("wheelTicketValue").value = 50;
  wheelRenderRows();
  setMsg($("opsMsg"), `已载入表 ${name}（未保存）。检查期望值后填写原因并「保存新版本」才会生效。`, true);
}
$("wheelLoadC1").onclick = () => wheelLoadPreset("C1");
$("wheelLoadC2").onclick = () => wheelLoadPreset("C2");

const ITEM_REASON_LABEL = { wheel_prize: "转盘奖励", rewind_use: "反悔使用", admin_grant: "管理员发放", admin_revoke: "管理员扣除" };
async function loadUserItems() {
  const id = Number($("itemUser").value.trim());
  if (!Number.isInteger(id)) return setMsg($("opsMsg"), "请填写用户 ID");
  const r = await api(`/admin/users/${id}/items`);
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "读取背包失败");
  const d = r.json.data;
  $("itemInfo").textContent = d.items.map((i) => `${i.label} ×${i.qty}`).join("　") || "空";
  $("itemLedger").innerHTML = d.ledger.map((l) => `<tr><td>${escapeHtml(l.createdAt)}</td><td>${l.delta > 0 ? "+" : ""}${l.delta}</td><td>${l.qtyAfter}</td><td>${escapeHtml(ITEM_REASON_LABEL[l.reason] || l.reason)}</td><td>${escapeHtml(l.refType ? `${l.refType}:${l.refId || ""}` : "")}</td></tr>`).join("");
}
$("itemLoad").onclick = () => guarded($("itemLoad"), loadUserItems);
$("itemAdjust").onclick = () => guarded($("itemAdjust"), async () => {
  const reason = wheelReason("itemReason");
  if (!reason) return;
  const id = Number($("itemUser").value.trim());
  const delta = Number($("itemDelta").value);
  if (!Number.isInteger(id) || !Number.isInteger(delta) || delta === 0) return setMsg($("opsMsg"), "请填写用户 ID 和非零整数数量");
  if (!window.confirm(`${delta > 0 ? "发放" : "扣除"} ${Math.abs(delta)} 张后悔券给用户 #${id}？`)) return;
  const r = await api(`/admin/users/${id}/items`, { method: "POST", csrf: csrfToken, headers: { "Idempotency-Key": newIdemKey() }, body: { itemType: "rewind_ticket", delta, reason } });
  reauthLost(r);
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "操作失败");
  setMsg($("opsMsg"), `用户 #${id} 后悔券现为 ${r.json.data.qty} 张`, true);
  $("itemReason").value = "";
  await loadUserItems();
});

async function loadRewindStats() {
  const r = await api(`/admin/rewind/stats?days=${encodeURIComponent($("rwStatDays").value)}`);
  if (r.status !== 200) return; // older API: section stays empty
  const d = r.json.data;
  const t = d.totals;
  $("rwStats").innerHTML = `
    <div class="stat"><b>${t.coinRewinds}</b><span>韭币反悔</span></div>
    <div class="stat"><b>${t.ticketRewinds}</b><span>券反悔</span></div>
    <div class="stat"><b>${t.cleanBoardTicketSharePct == null ? "—" : `${t.cleanBoardTicketSharePct}%`}</b><span>普通榜中券局占比（${t.cleanBoardTicketGames}/${t.cleanBoardGames}）</span></div>
    <div class="stat"><b>${d.tickets.issuedWheel}</b><span>转盘发券</span></div>
    <div class="stat"><b>${d.tickets.issuedAdmin}</b><span>管理员发券</span></div>
    <div class="stat"><b>${d.tickets.redeemed}${d.tickets.redeemRatePct == null ? "" : `（${d.tickets.redeemRatePct}%）`}</b><span>已使用</span></div>
    <div class="stat"><b>${d.tickets.held}</b><span>持有中（${d.tickets.holders} 人）</span></div>`;
  $("rwWarn").textContent = d.warning ? `⚠ 券局平均收益高于未反悔对局超过 1 个合并标准差（n ≥ ${d.minN}）。可考虑把券局改记反悔榜或降低券的权重。` : `样本 ≥ ${d.minN} 局才判断是否告警。`;
  $("rwReturns").innerHTML = d.returns.map((x) => `<tr><td>${escapeHtml(`${x.fillMode} / ${String(x.datasetVersion || "").slice(0, 8)}`)}</td><td>${x.ticket.n}</td><td>${x.ticket.meanPct ?? "—"}</td><td>${x.unrewound.n}</td><td>${x.unrewound.meanPct ?? "—"}</td><td>${x.diffPct ?? "—"}${x.warning ? " ⚠" : ""}</td><td>${x.pooledSdPct ?? "—"}</td></tr>`).join("");
}
$("rwStatRefresh").onclick = () => guarded($("rwStatRefresh"), loadRewindStats);
async function rwReclassify(dryRun) {
  const reason = wheelReason("rwReReason");
  if (!reason) return;
  const to = $("rwReTo").value;
  const since = $("rwReSince").value.trim() || null;
  if (!dryRun && !window.confirm(`把已有券局移到${to === "undo" ? "反悔榜" : "普通榜"}${since ? `（${since} 起）` : "（全部）"}？会立即影响排行榜。`)) return;
  const r = await api("/admin/rewind-tickets/reclassify", { method: "POST", csrf: csrfToken, body: { to, since, dryRun, reason } });
  reauthLost(r);
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "归类失败");
  const d = r.json.data;
  setMsg($("opsMsg"), `${dryRun ? "试算" : "已归类"}：对局 ${d.sessions}，成绩 ${d.results}`, true);
  if (!dryRun) await loadRewindStats();
}
$("rwReDry").onclick = () => guarded($("rwReDry"), () => rwReclassify(true));
$("rwReApply").onclick = () => guarded($("rwReApply"), () => rwReclassify(false));

$("wheelReload").onclick = () => { if (wheelCfg) { wheelDraftFromActive(); wheelRenderRows(); } };
$("wheelTicketValue").addEventListener("input", wheelAfterEdit);
$("wheelCfgSave").onclick = () => guarded($("wheelCfgSave"), async () => {
  const reason = wheelReason("wheelCfgReason");
  if (!reason) return;
  const body = { ...wheelDraftPayload(), reason };
  const pre = await api("/admin/lucky-wheel/config/preview", { method: "POST", csrf: csrfToken, body: wheelDraftPayload() });
  if (pre.status !== 200) return setMsg($("opsMsg"), pre.json?.error?.message || "配置无效");
  const warn = (pre.json.data.warnings || []).map((w) => w.message).join("\n");
  if (!window.confirm(`保存为新版本？期望值 ${pre.json.data.ev.ev}。对所有玩家立即生效。${warn ? `\n\n提示：\n${warn}` : ""}`)) return;
  const r = await api("/admin/lucky-wheel/config", { method: "PUT", csrf: csrfToken, body });
  reauthLost(r);
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "保存失败");
  setMsg($("opsMsg"), `已保存为 v${r.json.data.version}（期望值 ${r.json.data.ev.ev}）`, true);
  $("wheelCfgReason").value = "";
  await loadWheel();
});

$("wheelGrantBtn").onclick = () => guarded($("wheelGrantBtn"), async () => {
  const reason = wheelReason("wheelGrantReason");
  if (!reason) return;
  const userId = Number($("wheelGrantUser").value.trim());
  const spins = Number($("wheelGrantSpins").value);
  const expiresDate = $("wheelGrantExpire").value.trim() || null;
  if (!Number.isInteger(userId) || !Number.isInteger(spins)) return setMsg($("opsMsg"), "请填写有效的用户 ID 和次数");
  const r = await api("/admin/lucky-wheel/grant", {
    method: "POST", csrf: csrfToken, headers: { "Idempotency-Key": newIdemKey() }, body: { userId, spins, expiresDate, reason },
  });
  reauthLost(r);
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "发放失败");
  setMsg($("opsMsg"), `已向用户 #${userId} 发放 ${spins} 次转盘`, true);
  $("wheelGrantReason").value = "";
});

async function loadWheelStats() {
  const r = await api(`/admin/lucky-wheel/stats?days=${encodeURIComponent($("wheelStatDays").value)}`);
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "读取统计失败");
  const d = r.json.data;
  const t = d.totals;
  $("wheelStats").innerHTML = `
    <div class="stat"><b>${d.today.spins}</b><span>今日转数</span></div>
    <div class="stat"><b>${t.spins}</b><span>区间转数</span></div>
    <div class="stat"><b>${t.users}</b><span>区间人数</span></div>
    <div class="stat"><b>${t.realizedPerDraw ?? "—"}</b><span>实发 / 次（配置 ${t.configuredPerDraw ?? "—"}）</span></div>
    <div class="stat"><b>${t.realizedPerUserDay ?? "—"}</b><span>人均 / 日（期望 ${d.configuredEv.ev}）</span></div>
    <div class="stat"><b>${t.driftPct == null ? "—" : `${t.driftPct}%`}${t.driftWarning ? " ⚠" : ""}</b><span>偏差（≥500 次才告警）</span></div>
    <div class="stat"><b>${t.jackpots}</b><span>大奖</span></div>
    <div class="stat"><b>${t.substituted}</b><span>折算次数</span></div>`;
  $("wheelSeries").innerHTML = d.series.slice().reverse().map((x) => `<tr><td>${escapeHtml(x.date)}</td><td>${x.spins}</td><td>${x.users}</td><td>${x.coins}</td><td>${x.coinValue}</td><td>${x.jackpots}</td><td>${x.items}</td><td>${x.spinAgain}</td><td>${x.substituted}</td></tr>`).join("");
}
$("wheelStatRefresh").onclick = () => guarded($("wheelStatRefresh"), loadWheelStats);
$("wheelStatDays").onchange = loadWheelStats;

async function wheelSearch({ more = false } = {}) {
  const qs = new URLSearchParams({ limit: "30" });
  if ($("wheelLogUser").value.trim()) qs.set("userId", $("wheelLogUser").value.trim());
  if ($("wheelLogDate").value.trim()) qs.set("date", $("wheelLogDate").value.trim());
  if ($("wheelLogMin").value.trim()) qs.set("minValue", $("wheelLogMin").value.trim());
  if (more && wheelLogCursor) qs.set("cursor", String(wheelLogCursor));
  const r = await api(`/admin/lucky-wheel/spins?${qs}`);
  if (r.status !== 200) return setMsg($("opsMsg"), r.json?.error?.message || "读取记录失败");
  const rows = r.json.data.items.map((x) => `<tr><td>${fmtBeijing(x.at)}</td><td>#${x.userId} ${escapeHtml(x.nickname || x.username || "")}</td><td>${x.source === "credit" ? "补发/再转" : "每日"}</td><td>${x.sector}</td><td>${escapeHtml(wheelPrizeText(x.prize))}</td><td>v${x.configVersion}</td><td>${x.roll}</td><td>${x.balanceAfter}</td></tr>`).join("");
  if (more) $("wheelLog").insertAdjacentHTML("beforeend", rows);
  else $("wheelLog").innerHTML = rows || `<tr><td colspan="8" class="dim">暂无记录</td></tr>`;
  wheelLogCursor = r.json.data.nextCursor;
  $("wheelLogMore").classList.toggle("hidden", !wheelLogCursor);
}
$("wheelLogSearch").onclick = () => guarded($("wheelLogSearch"), () => wheelSearch());
$("wheelLogMore").onclick = () => guarded($("wheelLogMore"), () => wheelSearch({ more: true }));

TAB_LOADERS.wheel = () => loadWheel();
