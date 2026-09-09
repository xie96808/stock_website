/** Stage 2 account client: session cookie + CSRF + avatar/nickname settings */
const AVATAR_LABELS = ["", "鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];
const PASSWORD_HINT = "至少 4 位";
const AVATAR_MAX_EDGE = 192;
const AVATAR_JPEG_QUALITY = 0.72;
const AVATAR_TARGET_BYTES = 48 * 1024;

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

function perfEnabled() {
  try {
    return localStorage.getItem("STOCKGAME_PERF") === "1";
  } catch {
    return false;
  }
}

function perfLog(label, ms, extra) {
  if (!perfEnabled()) return;
  const bit = extra ? " " + JSON.stringify(extra) : "";
  console.log("[perf]", label, Math.round(ms) + "ms" + bit);
}

function zodiacAvatarUrl(id) {
  const n = String(id || 1).padStart(2, "0");
  return `/images/avatars/${n}.png`;
}

export function displayAvatarUrl(userOrId, avatarUrl) {
  if (userOrId && typeof userOrId === "object") {
    if (userOrId.avatarUrl) return userOrId.avatarUrl;
    return zodiacAvatarUrl(userOrId.avatarId || 1);
  }
  if (avatarUrl) return avatarUrl;
  return zodiacAvatarUrl(userOrId);
}

function unicodeLen(s) {
  return Array.from(String(s || "")).length;
}

function clientValidatePassword(pw) {
  const n = unicodeLen(pw);
  if (n < 4) return PASSWORD_HINT;
  if (n > 128) return "密码最多 128 个字符";
  return null;
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
  const t0 = performance.now();
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf || authState.csrfToken) headers["X-CSRF-Token"] = csrf || authState.csrfToken;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) {
    perfLog("api " + method + " " + path, performance.now() - t0, { status: 204 });
    return { ok: true, status: 204, data: null };
  }
  const json = await res.json().catch(() => ({}));
  perfLog("api " + method + " " + path, performance.now() - t0, { status: res.status });
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return { ok: true, status: res.status, data: json.data, requestId: json.requestId };
}

async function apiMultipart(path, formData, { method = "POST", csrf } = {}) {
  const t0 = performance.now();
  const headers = { Accept: "application/json" };
  if (csrf || authState.csrfToken) headers["X-CSRF-Token"] = csrf || authState.csrfToken;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers,
    body: formData,
  });
  const json = await res.json().catch(() => ({}));
  perfLog("api " + method + " " + path, performance.now() - t0, { status: res.status });
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.status = res.status;
    throw err;
  }
  return { ok: true, status: res.status, data: json.data };
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

function ensureToastHost() {
  if (document.getElementById("authToastHost")) return;
  document.body.appendChild(el(`<div class="auth-toast-host" id="authToastHost" aria-live="polite"></div>`));
}

function showToast(message, kind = "error") {
  ensureToastHost();
  const host = document.getElementById("authToastHost");
  const toast = el(`<div class="auth-toast auth-toast--${kind}" role="status">${message}</div>`);
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 280);
  }, 2600);
}

/** Mark primary action buttons busy so clicks feel instant under network RTT. */
function setBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    if (button.dataset.busyLabelReady !== "1") {
      button.dataset.idleLabel = button.textContent;
      button.dataset.busyLabelReady = "1";
    }
    button.disabled = true;
    button.classList.add("is-busy");
    button.setAttribute("aria-busy", "true");
    if (busyLabel) button.textContent = busyLabel;
  } else {
    button.disabled = false;
    button.classList.remove("is-busy");
    button.removeAttribute("aria-busy");
    if (button.dataset.idleLabel != null) button.textContent = button.dataset.idleLabel;
  }
}

function setFormBusy(form, busy, busyLabel) {
  if (!form) return;
  const btn = form.querySelector('button[type="submit"].auth-primary, button.auth-primary');
  setBusy(btn, busy, busyLabel);
  form.querySelectorAll("input, button, select, textarea").forEach((node) => {
    if (node === btn) return;
    if (busy) {
      if (!node.dataset.prevDisabled) node.dataset.prevDisabled = node.disabled ? "1" : "0";
      node.disabled = true;
    } else if (node.dataset.prevDisabled != null) {
      node.disabled = node.dataset.prevDisabled === "1";
      delete node.dataset.prevDisabled;
    }
  });
}

function ensureAuthDom() {
  // Chip may already exist in index.html (reserved layout).
  if (!document.getElementById("authChip")) {
    const chip = el(`<div class="auth-chip" id="authChip">
      <button type="button" class="auth-login-btn" id="authLoginBtn">登录 / 注册</button>
      <button type="button" class="auth-user-btn" id="authUserBtn" hidden>
        <img class="auth-avatar" id="authAvatarImg" alt="">
        <span id="authNickname"></span>
      </button>
    </div>`);
    const theme = document.querySelector(".theme-toggle");
    if (theme && theme.parentElement) theme.parentElement.insertBefore(chip, theme.nextSibling);
    else document.body.appendChild(chip);
  }

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
        <p class="auth-success" id="authSuccess" hidden></p>
        <form id="authLoginForm" class="auth-form">
          <label>用户名<input name="username" autocomplete="username" required></label>
          <label>密码<input name="password" type="password" autocomplete="current-password" required minlength="4"></label>
          <button type="submit" class="auth-primary">登录</button>
        </form>
        <form id="authRegisterForm" class="auth-form" hidden>
          <label>用户名<input name="username" autocomplete="username" required></label>
          <label>密码（${PASSWORD_HINT}）<input name="password" type="password" autocomplete="new-password" required minlength="4"></label>
          <label>确认密码<input name="password2" type="password" autocomplete="new-password" required minlength="4"></label>
          <div class="auth-nick-row">
            <label class="auth-nick-field">昵称（可选）
              <input name="nickname" id="registerNickname" maxlength="16" placeholder="掷骰生成或自填">
            </label>
            <button type="button" class="auth-dice" id="registerNickDice" title="随机昵称">🎲</button>
          </div>
          <div class="avatar-picker">
            <button type="button" class="avatar-preview-btn" id="registerAvatarPick" title="点击上传头像" aria-label="点击上传头像">
              <img class="avatar-preview" id="registerAvatarImg" alt="头像预览">
            </button>
            <input type="file" id="registerAvatarFile" accept="image/jpeg,image/png,image/webp" hidden>
            <div class="avatar-actions">
              <button type="button" class="auth-dice" id="registerAvatarDice" title="随机生肖" aria-label="随机生肖">🎲</button>
            </div>
          </div>
          <label class="auth-check"><input type="checkbox" name="terms" required> 我已阅读并同意服务条款</label>
          <button type="submit" class="auth-primary">注册</button>
        </form>
        <div id="authSettingsPanel" class="auth-form" hidden>
          <div class="avatar-picker">
            <button type="button" class="avatar-preview-btn" id="settingsAvatarPick" title="点击上传头像" aria-label="点击上传头像">
              <img class="avatar-preview" id="settingsAvatarImg" alt="头像预览">
            </button>
            <input type="file" id="settingsAvatarFile" accept="image/jpeg,image/png,image/webp" hidden>
            <div class="avatar-actions">
              <button type="button" class="auth-dice" id="settingsAvatarDice" title="随机生肖" aria-label="随机生肖">🎲</button>
            </div>
          </div>
          <div class="auth-nick-row">
            <label class="auth-nick-field">昵称
              <input id="settingsNickname" maxlength="16">
            </label>
            <button type="button" class="auth-dice" id="settingsNickDice" title="随机昵称">🎲</button>
          </div>
          <label class="auth-check"><input type="checkbox" id="settingsOptIn"> 参与排行榜</label>
          <button type="button" class="auth-primary" id="settingsSave">保存资料</button>
          <hr>
          <button type="button" class="auth-danger" id="authLogoutBtn">退出登录</button>
        </div>
      </div>
    </div>`));
  }

  if (ensureAuthDom._bound) return;
  ensureAuthDom._bound = true;

  document.getElementById("authLoginBtn").onclick = () => openAuthModal("login");
  document.getElementById("authUserBtn").onclick = () => openAuthModal("settings");
  document.getElementById("authCloseBtn").onclick = closeAuthModal;
  // Backdrop click must NOT close the auth modal (product feedback).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const m = document.getElementById("authModal");
      if (m && !m.hidden) closeAuthModal();
    }
  });
  document.querySelectorAll("#authGuestTabs .auth-tab").forEach((btn) => {
    btn.addEventListener("click", () => openAuthModal(btn.dataset.tab));
  });
  document.getElementById("authLoginForm").onsubmit = onLogin;
  document.getElementById("authRegisterForm").onsubmit = onRegister;
  document.getElementById("settingsSave").onclick = onSaveSettings;
  document.getElementById("registerAvatarDice").onclick = () => {
    pendingRegisterFile = null;
    pendingRegisterObjectUrl && URL.revokeObjectURL(pendingRegisterObjectUrl);
    pendingRegisterObjectUrl = null;
    setRegisterAvatar(randomAvatarId(pendingRegisterAvatarId));
  };
  document.getElementById("settingsAvatarDice").onclick = () => {
    pendingSettingsFile = null;
    pendingSettingsObjectUrl && URL.revokeObjectURL(pendingSettingsObjectUrl);
    pendingSettingsObjectUrl = null;
    setSettingsAvatar(randomAvatarId(pendingSettingsAvatarId), null);
  };
  document.getElementById("registerNickDice").onclick = () => {
    const input = document.getElementById("registerNickname");
    input.value = randomNickname(input.value);
  };
  document.getElementById("settingsNickDice").onclick = () => {
    const input = document.getElementById("settingsNickname");
    input.value = randomNickname(input.value);
  };
  document.getElementById("registerAvatarPick").onclick = () => {
    document.getElementById("registerAvatarFile").click();
  };
  document.getElementById("settingsAvatarPick").onclick = () => {
    document.getElementById("settingsAvatarFile").click();
  };
  document.getElementById("registerAvatarFile").onchange = onRegisterFile;
  document.getElementById("settingsAvatarFile").onchange = onSettingsFile;
  document.getElementById("authLogoutBtn").onclick = onLogout;
}

let pendingRegisterAvatarId = 1;
let pendingSettingsAvatarId = 1;
let pendingRegisterFile = null;
let pendingSettingsFile = null;
let pendingRegisterObjectUrl = null;
let pendingSettingsObjectUrl = null;

function setRegisterAvatar(id) {
  pendingRegisterAvatarId = id;
  const img = document.getElementById("registerAvatarImg");
  if (img) {
    img.src = pendingRegisterObjectUrl || zodiacAvatarUrl(id);
    img.alt = AVATAR_LABELS[id] || "avatar";
  }
}

function setSettingsAvatar(id, customUrl) {
  pendingSettingsAvatarId = id;
  const img = document.getElementById("settingsAvatarImg");
  if (img) {
    img.src = pendingSettingsObjectUrl || customUrl || zodiacAvatarUrl(id);
    img.alt = AVATAR_LABELS[id] || "avatar";
  }
}

function validateImageFile(file) {
  if (!file) return "请选择图片";
  const okType = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (!okType) return "仅支持 JPEG / PNG / WebP";
  if (file.size > 1024 * 1024) return "头像不能超过 1MB";
  return null;
}

/** Resize/compress avatar on the client to cut upload + nginx body time. */
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function compressAvatarFile(file) {
  if (!file) return null;
  // Tiny files: skip canvas work.
  if (file.size <= 48 * 1024 && file.type === "image/jpeg") return file;
  const t0 = performance.now();
  try {
    const img = await loadImageFromFile(file);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return file;
    const scale = Math.min(1, AVATAR_MAX_EDGE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return file;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    let quality = AVATAR_JPEG_QUALITY;
    let blob = await canvasToBlob(canvas, "image/jpeg", quality);
    while (blob && blob.size > AVATAR_TARGET_BYTES && quality > 0.45) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
    }
    if (!blob) return file;
    const out = new File([blob], (file.name || "avatar").replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    perfLog("avatar.compress", performance.now() - t0, {
      from: file.size,
      to: out.size,
      edge: Math.max(cw, ch),
    });
    // Prefer compressed only when smaller or dimensions reduced.
    if (out.size < file.size || scale < 1) return out;
    return file;
  } catch (e) {
    console.warn("avatar compress skipped", e);
    return file;
  }
}

async function onRegisterFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  const err = validateImageFile(file);
  if (err) {
    setError(err);
    showToast(err, "error");
    ev.target.value = "";
    return;
  }
  setError("");
  pendingRegisterFile = await compressAvatarFile(file);
  if (pendingRegisterObjectUrl) URL.revokeObjectURL(pendingRegisterObjectUrl);
  pendingRegisterObjectUrl = URL.createObjectURL(pendingRegisterFile);
  setRegisterAvatar(pendingRegisterAvatarId);
}

async function onSettingsFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  const err = validateImageFile(file);
  if (err) {
    setError(err);
    showToast(err, "error");
    ev.target.value = "";
    return;
  }
  setError("");
  pendingSettingsFile = await compressAvatarFile(file);
  if (pendingSettingsObjectUrl) URL.revokeObjectURL(pendingSettingsObjectUrl);
  pendingSettingsObjectUrl = URL.createObjectURL(pendingSettingsFile);
  setSettingsAvatar(pendingSettingsAvatarId, null);
}

function setError(msg) {
  const e = document.getElementById("authError");
  const s = document.getElementById("authSuccess");
  if (s) { s.hidden = true; s.textContent = ""; }
  if (!e) return;
  if (!msg) { e.hidden = true; e.textContent = ""; return; }
  e.hidden = false;
  e.textContent = msg;
}

function setSuccess(msg) {
  const e = document.getElementById("authError");
  const s = document.getElementById("authSuccess");
  if (e) { e.hidden = true; e.textContent = ""; }
  if (!s) return;
  if (!msg) { s.hidden = true; s.textContent = ""; return; }
  s.hidden = false;
  s.textContent = msg;
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
    tab === "settings" ? "资料设置" : tab === "register" ? "注册" : "登录";
}

export function openAuthModal(tab = "login") {
  ensureAuthDom();
  setError("");
  setSuccess("");
  if (tab === "settings") {
    if (!authState.user) {
      tab = "login";
    } else {
      document.getElementById("settingsNickname").value = authState.user.nickname;
      document.getElementById("settingsOptIn").checked = !!authState.user.leaderboardOptIn;
      pendingSettingsFile = null;
      if (pendingSettingsObjectUrl) {
        URL.revokeObjectURL(pendingSettingsObjectUrl);
        pendingSettingsObjectUrl = null;
      }
      setSettingsAvatar(authState.user.avatarId || 1, authState.user.avatarUrl);
    }
  }
  if (tab === "register") {
    pendingRegisterFile = null;
    if (pendingRegisterObjectUrl) {
      URL.revokeObjectURL(pendingRegisterObjectUrl);
      pendingRegisterObjectUrl = null;
    }
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
  const loginBtn = document.getElementById("authLoginBtn");
  const userBtn = document.getElementById("authUserBtn");
  loginBtn.hidden = logged;
  userBtn.hidden = !logged;
  const nickEl = document.getElementById("authNickname");
  const img = document.getElementById("authAvatarImg");
  if (logged) {
    nickEl.textContent = authState.user.nickname;
    img.src = displayAvatarUrl(authState.user);
    img.alt = AVATAR_LABELS[authState.user.avatarId] || "avatar";
  } else {
    // Fully reset chrome so logout never leaves stale nickname/avatar visible
    nickEl.textContent = "";
    img.removeAttribute("src");
    img.alt = "";
  }
}

async function uploadPendingAvatar(file) {
  if (!file) return null;
  const ready = await compressAvatarFile(file);
  const fd = new FormData();
  fd.append("avatar", ready, ready.name || "avatar.jpg");
  const { data } = await apiMultipart("/me/avatar", fd);
  return data.user;
}

async function onLogin(ev) {
  ev.preventDefault();
  setError("");
  const form = ev.target;
  const fd = new FormData(form);
  setFormBusy(form, true, "登录中…");
  const t0 = performance.now();
  try {
    const { data } = await api("/auth/login", {
      method: "POST",
      body: { username: fd.get("username"), password: fd.get("password") },
    });
    authState.user = data.user;
    authState.csrfToken = data.csrfToken;
    renderAuthChrome();
    closeAuthModal();
    showToast("登录成功", "success");
    perfLog("auth.login.total", performance.now() - t0);
  } catch (e) {
    setError(e.message);
    showToast(e.message || "登录失败", "error");
  } finally {
    setFormBusy(form, false);
  }
}

async function onRegister(ev) {
  ev.preventDefault();
  setError("");
  const form = ev.target;
  const fd = new FormData(form);
  if (fd.get("password") !== fd.get("password2")) {
    const msg = "两次密码不一致";
    setError(msg);
    showToast(msg, "error");
    return;
  }
  const pwErr = clientValidatePassword(fd.get("password"));
  if (pwErr) {
    setError(pwErr);
    showToast(pwErr, "error");
    return;
  }
  const nickname = String(fd.get("nickname") || "").trim();
  setFormBusy(form, true, "注册中…");
  const t0 = performance.now();
  try {
    const { data } = await api("/auth/register", {
      method: "POST",
      body: {
        username: fd.get("username"),
        password: fd.get("password"),
        nickname: nickname || undefined,
        avatarId: pendingRegisterAvatarId,
        termsVersion: "v1",
        leaderboardOptIn: true,
      },
    });
    authState.user = data.user;
    authState.csrfToken = data.csrfToken;
    if (pendingRegisterFile) {
      try {
        authState.user = await uploadPendingAvatar(pendingRegisterFile);
      } catch (upErr) {
        showToast(upErr.message || "头像上传失败，可稍后在设置中重试", "error");
      }
      pendingRegisterFile = null;
      if (pendingRegisterObjectUrl) {
        URL.revokeObjectURL(pendingRegisterObjectUrl);
        pendingRegisterObjectUrl = null;
      }
    }
    renderAuthChrome();
    closeAuthModal();
    showToast("注册成功", "success");
    perfLog("auth.register.total", performance.now() - t0);
  } catch (e) {
    setError(e.message);
    showToast(e.message || "注册失败", "error");
  } finally {
    setFormBusy(form, false);
  }
}

async function onSaveSettings() {
  setError("");
  setSuccess("");
  const saveBtn = document.getElementById("settingsSave");
  const panel = document.getElementById("authSettingsPanel");
  setBusy(saveBtn, true, "保存中…");
  if (panel) {
    panel.querySelectorAll("input, button").forEach((node) => {
      if (node === saveBtn) return;
      if (!node.dataset.prevDisabled) node.dataset.prevDisabled = node.disabled ? "1" : "0";
      node.disabled = true;
    });
  }
  const t0 = performance.now();
  try {
    if (pendingSettingsFile) {
      authState.user = await uploadPendingAvatar(pendingSettingsFile);
      pendingSettingsFile = null;
      if (pendingSettingsObjectUrl) {
        URL.revokeObjectURL(pendingSettingsObjectUrl);
        pendingSettingsObjectUrl = null;
      }
    }
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
    setSettingsAvatar(authState.user.avatarId || 1, authState.user.avatarUrl);
    setSuccess("已保存");
    showToast("已保存", "success");
    perfLog("auth.settings.total", performance.now() - t0);
  } catch (e) {
    setError(e.message);
    showToast(e.message || "保存失败", "error");
  } finally {
    setBusy(saveBtn, false);
    if (panel) {
      panel.querySelectorAll("input, button").forEach((node) => {
        if (node === saveBtn) return;
        if (node.dataset.prevDisabled != null) {
          node.disabled = node.dataset.prevDisabled === "1";
          delete node.dataset.prevDisabled;
        }
      });
    }
  }
}

async function onLogout() {
  const btn = document.getElementById("authLogoutBtn");
  setBusy(btn, true, "退出中…");
  const csrf = authState.csrfToken;
  // Optimistic chrome clear — do not wait on network for perceived logout.
  authState.user = null;
  renderAuthChrome();
  closeAuthModal();
  showToast("已退出登录", "success");
  try {
    await api("/auth/logout", { method: "POST", csrf });
  } catch {
    /* ignore — local session already cleared */
  } finally {
    authState.csrfToken = null;
    setBusy(btn, false);
  }
}

export async function initAuth() {
  ensureAuthDom();
  const t0 = performance.now();
  await refreshMe();
  perfLog("auth.init", performance.now() - t0);
}

if (typeof window !== "undefined") {
  window.__stockAuth = { initAuth, openAuthModal, getAuthState, refreshMe, displayAvatarUrl };
}
