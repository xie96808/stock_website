/** Stage 2 account client: session cookie + CSRF + avatar settings */
const AVATAR_LABELS = ["","鼠","牛","虎","兔","龙","蛇","马","羊","猴","鸡","狗","猪"];

let authState = {
  user: null,
  csrfToken: null,
  ready: false,
};

function avatarUrl(id) {
  const n = String(id).padStart(2, "0");
  return `images/avatars/${n}.svg`;
}

export async function api(path, { method = "GET", body, csrf } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf || authState.csrfToken) headers["X-CSRF-Token"] = csrf || authState.csrfToken;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { ok: true, status: 204, data: null };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return { ok: true, status: res.status, data: json.data, requestId: json.requestId };
}

export function getAuthState() {
  return authState;
}

export async function refreshMe() {
  try {
    const { data } = await api("/me");
    authState.user = data.user;
    authState.csrfToken = data.csrfToken;
  } catch {
    authState.user = null;
    authState.csrfToken = null;
  }
  authState.ready = true;
  renderAuthChrome();
  return authState;
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function ensureAuthDom() {
  if (document.getElementById("authChip")) return;
  const chip = el(`<div class="auth-chip" id="authChip">
    <button type="button" class="auth-login-btn" id="authLoginBtn">登录 / 注册</button>
    <button type="button" class="auth-user-btn" id="authUserBtn" hidden>
      <img class="auth-avatar" id="authAvatarImg" alt="">
      <span id="authNickname"></span>
    </button>
  </div>`);
  const theme = document.querySelector(".theme-toggle");
  if (theme && theme.parentElement) theme.parentElement.insertBefore(chip, theme);
  else document.body.appendChild(chip);

  if (!document.getElementById("authModal")) {
    document.body.appendChild(el(`<div class="auth-modal" id="authModal" hidden>
      <div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">
        <button type="button" class="auth-close" id="authCloseBtn" aria-label="关闭">×</button>
        <div class="auth-tabs">
          <button type="button" class="auth-tab active" data-tab="login">登录</button>
          <button type="button" class="auth-tab" data-tab="register">注册</button>
          <button type="button" class="auth-tab" data-tab="recover">恢复</button>
          <button type="button" class="auth-tab" data-tab="settings" id="authTabSettings" hidden>设置</button>
        </div>
        <h2 id="authModalTitle">账号</h2>
        <p class="auth-error" id="authError" hidden></p>
        <form id="authLoginForm" class="auth-form">
          <label>用户名<input name="username" autocomplete="username" required></label>
          <label>密码<input name="password" type="password" autocomplete="current-password" required minlength="4"></label>
          <button type="submit" class="auth-primary">登录</button>
        </form>
        <form id="authRegisterForm" class="auth-form" hidden>
          <label>用户名<input name="username" autocomplete="username" required></label>
          <label>密码（至少 4 位）<input name="password" type="password" autocomplete="new-password" required minlength="4"></label>
          <label>确认密码<input name="password2" type="password" autocomplete="new-password" required minlength="4"></label>
          <label>昵称（可选）<input name="nickname" maxlength="16" placeholder="新同学"></label>
          <label class="auth-check"><input type="checkbox" name="terms" required> 我已阅读并同意服务条款</label>
          <button type="submit" class="auth-primary">注册</button>
        </form>
        <form id="authRecoverForm" class="auth-form" hidden>
          <label>用户名<input name="username" required></label>
          <label>恢复码<input name="recoveryCode" required></label>
          <label>新密码<input name="newPassword" type="password" required minlength="4"></label>
          <button type="submit" class="auth-primary">重置密码</button>
        </form>
        <div id="authSettingsPanel" class="auth-form" hidden>
          <div class="avatar-picker">
            <div class="avatar-grid" id="avatarGrid"></div>
            <button type="button" class="auth-dice" id="avatarDice" title="随机">🎲 随机生肖</button>
          </div>
          <label>昵称<input id="settingsNickname" maxlength="16"></label>
          <label class="auth-check"><input type="checkbox" id="settingsOptIn"> 参与排行榜（默认关闭）</label>
          <button type="button" class="auth-primary" id="settingsSave">保存资料</button>
          <hr>
          <form id="authChangePwForm" class="auth-form">
            <label>当前密码<input name="currentPassword" type="password" required></label>
            <label>新密码<input name="newPassword" type="password" required minlength="4"></label>
            <button type="submit">修改密码</button>
          </form>
          <button type="button" class="auth-secondary" id="authRecoveryReset">重新生成恢复码</button>
          <button type="button" class="auth-danger" id="authLogoutBtn">退出登录</button>
        </div>
        <div id="authRecoveryOnce" class="auth-recovery" hidden>
          <p>请立即保存恢复码（只显示一次）：</p>
          <code id="authRecoveryCode"></code>
          <button type="button" class="auth-primary" id="authRecoveryAck">我已保存</button>
        </div>
      </div>
    </div>`));
  }

  document.getElementById("authLoginBtn").onclick = () => openAuthModal("login");
  document.getElementById("authUserBtn").onclick = () => openAuthModal("settings");
  document.getElementById("authCloseBtn").onclick = closeAuthModal;
  document.getElementById("authModal").addEventListener("click", (e) => {
    if (e.target.id === "authModal") closeAuthModal();
  });
  document.querySelectorAll(".auth-tab").forEach((btn) => {
    btn.addEventListener("click", () => openAuthModal(btn.dataset.tab));
  });
  document.getElementById("authLoginForm").onsubmit = onLogin;
  document.getElementById("authRegisterForm").onsubmit = onRegister;
  document.getElementById("authRecoverForm").onsubmit = onRecover;
  document.getElementById("settingsSave").onclick = onSaveSettings;
  document.getElementById("avatarDice").onclick = onDice;
  document.getElementById("authChangePwForm").onsubmit = onChangePw;
  document.getElementById("authRecoveryReset").onclick = onResetRecovery;
  document.getElementById("authLogoutBtn").onclick = onLogout;
  document.getElementById("authRecoveryAck").onclick = () => {
    document.getElementById("authRecoveryOnce").hidden = true;
    closeAuthModal();
  };
  buildAvatarGrid();
}

let pendingAvatarId = 1;

function buildAvatarGrid() {
  const grid = document.getElementById("avatarGrid");
  if (!grid || grid.childElementCount) return;
  for (let i = 1; i <= 12; i++) {
    const b = el(`<button type="button" class="avatar-opt" data-id="${i}" title="${AVATAR_LABELS[i]}">
      <img src="${avatarUrl(i)}" alt="${AVATAR_LABELS[i]}">
      <span>${AVATAR_LABELS[i]}</span>
    </button>`);
    b.onclick = () => selectAvatar(i);
    grid.appendChild(b);
  }
}

function selectAvatar(id) {
  pendingAvatarId = id;
  document.querySelectorAll(".avatar-opt").forEach((n) => {
    n.classList.toggle("selected", Number(n.dataset.id) === id);
  });
}

function onDice() {
  let next = pendingAvatarId;
  for (let i = 0; i < 8 && next === pendingAvatarId; i++) next = 1 + Math.floor(Math.random() * 12);
  selectAvatar(next);
}

function setError(msg) {
  const e = document.getElementById("authError");
  if (!msg) { e.hidden = true; e.textContent = ""; return; }
  e.hidden = false;
  e.textContent = msg;
}

function showForms(tab) {
  const map = {
    login: "authLoginForm",
    register: "authRegisterForm",
    recover: "authRecoverForm",
    settings: "authSettingsPanel",
  };
  Object.entries(map).forEach(([k, id]) => {
    document.getElementById(id).hidden = k !== tab;
  });
  document.querySelectorAll(".auth-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("authTabSettings").hidden = !authState.user;
  document.getElementById("authModalTitle").textContent =
    tab === "settings" ? "个人设置" : tab === "register" ? "注册" : tab === "recover" ? "账号恢复" : "登录";
}

export function openAuthModal(tab = "login") {
  ensureAuthDom();
  setError("");
  document.getElementById("authRecoveryOnce").hidden = true;
  if (tab === "settings" && authState.user) {
    document.getElementById("settingsNickname").value = authState.user.nickname;
    document.getElementById("settingsOptIn").checked = !!authState.user.leaderboardOptIn;
    selectAvatar(authState.user.avatarId || 1);
  }
  showForms(tab);
  document.getElementById("authModal").hidden = false;
}

export function closeAuthModal() {
  const m = document.getElementById("authModal");
  if (m) m.hidden = true;
}

function renderAuthChrome() {
  ensureAuthDom();
  const logged = !!authState.user;
  document.getElementById("authLoginBtn").hidden = logged;
  document.getElementById("authUserBtn").hidden = !logged;
  if (logged) {
    document.getElementById("authNickname").textContent = authState.user.nickname;
    const img = document.getElementById("authAvatarImg");
    img.src = avatarUrl(authState.user.avatarId);
    img.alt = AVATAR_LABELS[authState.user.avatarId] || "avatar";
  }
}

async function onLogin(ev) {
  ev.preventDefault();
  setError("");
  const fd = new FormData(ev.target);
  try {
    const { data } = await api("/auth/login", {
      method: "POST",
      body: { username: fd.get("username"), password: fd.get("password") },
    });
    authState.user = data.user;
    authState.csrfToken = data.csrfToken;
    renderAuthChrome();
    closeAuthModal();
  } catch (e) {
    setError(e.message);
  }
}

async function onRegister(ev) {
  ev.preventDefault();
  setError("");
  const fd = new FormData(ev.target);
  if (fd.get("password") !== fd.get("password2")) {
    setError("两次密码不一致");
    return;
  }
  try {
    const { data } = await api("/auth/register", {
      method: "POST",
      body: {
        username: fd.get("username"),
        password: fd.get("password"),
        nickname: fd.get("nickname") || undefined,
        termsVersion: "v1",
        leaderboardOptIn: false,
      },
    });
    authState.user = data.user;
    authState.csrfToken = data.csrfToken;
    renderAuthChrome();
    showRecoveryOnce(data.recoveryCode);
  } catch (e) {
    setError(e.message);
  }
}

function showRecoveryOnce(code) {
  showForms("login");
  document.getElementById("authLoginForm").hidden = true;
  document.getElementById("authRecoveryOnce").hidden = false;
  document.getElementById("authRecoveryCode").textContent = code;
}

async function onRecover(ev) {
  ev.preventDefault();
  setError("");
  const fd = new FormData(ev.target);
  try {
    const { data } = await api("/auth/recover", {
      method: "POST",
      body: {
        username: fd.get("username"),
        recoveryCode: fd.get("recoveryCode"),
        newPassword: fd.get("newPassword"),
      },
    });
    authState.user = null;
    authState.csrfToken = null;
    renderAuthChrome();
    showRecoveryOnce(data.recoveryCode);
  } catch (e) {
    setError(e.message);
  }
}

async function onSaveSettings() {
  setError("");
  try {
    const { data } = await api("/me", {
      method: "PATCH",
      body: {
        nickname: document.getElementById("settingsNickname").value,
        avatarId: pendingAvatarId,
        leaderboardOptIn: document.getElementById("settingsOptIn").checked,
      },
    });
    authState.user = data.user;
    renderAuthChrome();
    setError("已保存");
  } catch (e) {
    setError(e.message);
  }
}

async function onChangePw(ev) {
  ev.preventDefault();
  setError("");
  const fd = new FormData(ev.target);
  try {
    await api("/me/password", {
      method: "POST",
      body: { currentPassword: fd.get("currentPassword"), newPassword: fd.get("newPassword") },
    });
    authState.user = null;
    authState.csrfToken = null;
    renderAuthChrome();
    openAuthModal("login");
    setError("密码已修改，请重新登录");
  } catch (e) {
    setError(e.message);
  }
}

async function onResetRecovery() {
  setError("");
  const cur = prompt("请输入当前密码以生成新恢复码");
  if (!cur) return;
  try {
    const { data } = await api("/me/recovery-code", {
      method: "POST",
      body: { currentPassword: cur },
    });
    showRecoveryOnce(data.recoveryCode);
  } catch (e) {
    setError(e.message);
  }
}

async function onLogout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {}
  authState.user = null;
  authState.csrfToken = null;
  renderAuthChrome();
  closeAuthModal();
}

export async function initAuth() {
  ensureAuthDom();
  await refreshMe();
}

if (typeof window !== "undefined") {
  window.__stockAuth = { initAuth, openAuthModal, getAuthState, refreshMe };
}
