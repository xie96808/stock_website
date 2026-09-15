/** Stage 5 minimal non-public admin shell */
const API = "/api/v1";

let csrfToken = null;
let adminVerified = false;

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

async function api(path, { method = "GET", body, csrf } = {}) {
  const headers = { Accept: "application/json" };
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
}

function showLoggedOut() {
  $("loginPanel").classList.remove("hidden");
  $("opsPanel").classList.add("hidden");
  csrfToken = null;
  adminVerified = false;
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

function renderUsers(items) {
  const el = $("userList");
  if (!items?.length) {
    el.innerHTML = `<div class="item">无结果</div>`;
    return;
  }
  el.innerHTML = items
    .map(
      (u) => `<div class="item">
      #${u.id} · <code>${escapeHtml(u.username)}</code> · ${escapeHtml(u.nickname)}
      · ${escapeHtml(u.status)} · ${escapeHtml(u.role)}
      · 韭币 ${u.jiuCoinBalance ?? 0}
      <button type="button" data-uid="${u.id}">填入</button>
    </div>`
    )
    .join("");
  el.querySelectorAll("button[data-uid]").forEach((btn) => {
    btn.onclick = () => {
      $("banUserId").value = btn.dataset.uid;
      if ($("delUserId")) $("delUserId").value = btn.dataset.uid;
      if ($("coinUserId")) $("coinUserId").value = btn.dataset.uid;
    };
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

$("userSearchBtn").onclick = async () => {
  setMsg($("opsMsg"), "");
  const qs = new URLSearchParams();
  if ($("userQ").value.trim()) qs.set("q", $("userQ").value.trim());
  if ($("userStatus").value) qs.set("status", $("userStatus").value);
  const r = await api(`/admin/users?${qs}`);
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "搜索失败");
    return;
  }
  renderUsers(r.json.data.items);
};

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

$("auditBtn").onclick = async () => {
  setMsg($("opsMsg"), "");
  const r = await api("/admin/audit-logs?limit=30");
  if (r.status !== 200) {
    setMsg($("opsMsg"), r.json?.error?.message || "加载审计失败");
    return;
  }
  const el = $("auditList");
  const items = r.json.data.items || [];
  if (!items.length) {
    el.innerHTML = `<div class="item">暂无审计</div>`;
    return;
  }
  el.innerHTML = items
    .map(
      (a) => `<div class="item">
      #${a.id} · ${escapeHtml(a.createdAt)} · actor=${a.actorId ?? "—"}
      · <code>${escapeHtml(a.action)}</code>
      · ${escapeHtml(a.targetType)}/${escapeHtml(a.targetId)}
      · ${escapeHtml(a.reason || "")}
    </div>`
    )
    .join("");
};


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
      · ${escapeHtml(a.publishedAt || "—")}
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

function renderFeedbackDetail(f) {
  const host = $("fbDetail");
  if (!host || !f) {
    if (host) host.innerHTML = "";
    return;
  }
  const imgs = (f.images || [])
    .map(
      (img) =>
        `<a href="${escapeHtml(img.url)}" target="_blank" rel="noopener">
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
  renderFeedbackDetail(r.json.data.feedback);
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
}

$("fbMarkReadBtn").onclick = () => patchFeedbackStatus("read");
$("fbArchiveBtn").onclick = () => patchFeedbackStatus("archived");


refreshSession().catch(() => showLoggedOut());
