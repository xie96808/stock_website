/** Stage 2 account client: session cookie + CSRF + avatar/nickname settings */
const AVATAR_LABELS = ["", "鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];

/** Playful stock / 韭菜-themed A的B nickname parts (keep A的B within 2–16 code points). */
const NICK_A = [
  "进击", "发光", "沉默", "暴躁", "佛系", "熬夜", "抄底", "追高", "满仓", "空仓",
  "躺平", "起飞", "破防", "回血", "加仓", "割肉", "复盘", "梭哈", "止盈", "止损",
  "潜伏", "暴富", "亏哭", "躺赢", "逆风", "顺风", "硬刚", "摸鱼", "清醒", "上头",
  "稳住", "翻车", "解套", "红温", "蓝瘦", "干饭", "肝帝", "躺尸", "打新", "惜售",
];
const NICK_B = [
  "韭菜", "套牢盘", "牛散", "游资", "打工人", "小散", "股东", "多头", "空头", "红盘",
  "绿盘", "本金", "仓位", "钱包", "子弹", "心态", "理智", "梦想", "涨停板", "跌停板",
  "筹码", "心肝", "账户", "信仰", "持仓", "夜盘", "本金怪", "韭菜盒", "子弹怪", "仓位怪",
];

let authState = {
  user: null,
  csrfToken: null,
  ready: false,
};

function avatarUrl(id) {
  const n = String(id).padStart(2, "0");
  return `images/avatars/${n}.svg`;
}

function randomInt(min, maxInclusive) {
  return min + Math.floor(Math.random() * (maxInclusive - min + 1));
}

function randomAvatarId(exclude) {
  let next = exclude;
  for (let i = 0; i < 8 && next === exclude; i++) next = randomInt(1, 12);
  return next;
}

function randomNickname(exclude) {
  let nick = exclude;
  for (let i = 0; i < 12 && nick === exclude; i++) {
    const a = NICK_A[randomInt(0, NICK_A.length - 1)];
    const b = NICK_B[randomInt(0, NICK_B.length - 1)];
    nick = `${a}的${b}`;
  }
  return nick;
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
        <div class="auth-tabs" id="authGuestTabs">
          <button type="button" class="auth-tab active" data-tab="login">登录</button>
          <button type="button" class="auth-tab" data-tab="register">注册</button>
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
          <div class="auth-nick-row">
            <label class="auth-nick-field">昵称（可选）
              <input name="nickname" id="registerNickname" maxlength="16" placeholder="掷骰生成或自填">
            </label>
            <button type="button" class="auth-dice" id="registerNickDice" title="随机昵称">🎲</button>
          </div>
          <div class="avatar-picker">
            <img class="avatar-preview" id="registerAvatarImg" alt="头像预览">
            <button type="button" class="auth-dice" id="registerAvatarDice" title="随机生肖">🎲 随机生肖</button>
          </div>
          <label class="auth-check"><input type="checkbox" name="terms" required> 我已阅读并同意服务条款</label>
          <button type="submit" class="auth-primary">注册</button>
        </form>
        <div id="authSettingsPanel" class="auth-form" hidden>
          <div class="avatar-picker">
            <img class="avatar-preview" id="settingsAvatarImg" alt="头像预览">
            <button type="button" class="auth-dice" id="settingsAvatarDice" title="随机生肖">🎲 随机生肖</button>
          </div>
          <div class="auth-nick-row">
            <label class="auth-nick-field">昵称
              <input id="settingsNickname" maxlength="16">
            </label>
            <button type="button" class="auth-dice" id="settingsNickDice" title="随机昵称">🎲</button>
          </div>
          <label class="auth-check"><input type="checkbox" id="settingsOptIn"> 参与排行榜（默认关闭）</label>
          <button type="button" class="auth-primary" id="settingsSave">保存资料</button>
          <hr>
          <form id="authChangePwForm" class="auth-form">
            <label>当前密码<input name="currentPassword" type="password" required></label>
            <label>新密码<input name="newPassword" type="password" required minlength="4"></label>
            <button type="submit">修改密码</button>
          </form>
          <button type="button" class="auth-danger" id="authLogoutBtn">退出登录</button>
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
  document.querySelectorAll("#authGuestTabs .auth-tab").forEach((btn) => {
    btn.addEventListener("click", () => openAuthModal(btn.dataset.tab));
  });
  document.getElementById("authLoginForm").onsubmit = onLogin;
  document.getElementById("authRegisterForm").onsubmit = onRegister;
  document.getElementById("settingsSave").onclick = onSaveSettings;
  document.getElementById("registerAvatarDice").onclick = () => setRegisterAvatar(randomAvatarId(pendingRegisterAvatarId));
  document.getElementById("settingsAvatarDice").onclick = () => setSettingsAvatar(randomAvatarId(pendingSettingsAvatarId));
  document.getElementById("registerNickDice").onclick = () => {
    const input = document.getElementById("registerNickname");
    input.value = randomNickname(input.value);
  };
  document.getElementById("settingsNickDice").onclick = () => {
    const input = document.getElementById("settingsNickname");
    input.value = randomNickname(input.value);
  };
  document.getElementById("authChangePwForm").onsubmit = onChangePw;
  document.getElementById("authLogoutBtn").onclick = onLogout;
}

let pendingRegisterAvatarId = 1;
let pendingSettingsAvatarId = 1;

function setRegisterAvatar(id) {
  pendingRegisterAvatarId = id;
  const img = document.getElementById("registerAvatarImg");
  if (img) {
    img.src = avatarUrl(id);
    img.alt = AVATAR_LABELS[id] || "avatar";
  }
}

function setSettingsAvatar(id) {
  pendingSettingsAvatarId = id;
  const img = document.getElementById("settingsAvatarImg");
  if (img) {
    img.src = avatarUrl(id);
    img.alt = AVATAR_LABELS[id] || "avatar";
  }
}

function setError(msg) {
  const e = document.getElementById("authError");
  if (!msg) { e.hidden = true; e.textContent = ""; return; }
  e.hidden = false;
  e.textContent = msg;
}

function showForms(tab) {
  const guest = tab === "login" || tab === "register";
  document.getElementById("authGuestTabs").hidden = !guest;
  document.getElementById("authLoginForm").hidden = tab !== "login";
  document.getElementById("authRegisterForm").hidden = tab !== "register";
  document.getElementById("authSettingsPanel").hidden = tab !== "settings";
  document.querySelectorAll("#authGuestTabs .auth-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  document.getElementById("authModalTitle").textContent =
    tab === "settings" ? "个人设置" : tab === "register" ? "注册" : "登录";
}

export function openAuthModal(tab = "login") {
  ensureAuthDom();
  setError("");
  if (tab === "settings") {
    if (!authState.user) {
      tab = "login";
    } else {
      document.getElementById("settingsNickname").value = authState.user.nickname;
      document.getElementById("settingsOptIn").checked = !!authState.user.leaderboardOptIn;
      setSettingsAvatar(authState.user.avatarId || 1);
    }
  }
  if (tab === "register") {
    setRegisterAvatar(randomAvatarId(pendingRegisterAvatarId));
    const nick = document.getElementById("registerNickname");
    if (nick && !nick.value) nick.value = randomNickname("");
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
  const nickname = String(fd.get("nickname") || "").trim();
  try {
    const { data } = await api("/auth/register", {
      method: "POST",
      body: {
        username: fd.get("username"),
        password: fd.get("password"),
        nickname: nickname || undefined,
        avatarId: pendingRegisterAvatarId,
        termsVersion: "v1",
        leaderboardOptIn: false,
      },
    });
    authState.user = data.user;
    authState.csrfToken = data.csrfToken;
    renderAuthChrome();
    closeAuthModal();
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
        avatarId: pendingSettingsAvatarId,
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
