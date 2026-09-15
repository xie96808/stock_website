/**
 * User feedback to developer — entry from settings modal 「反馈」.
 * Text required; 1–3 optional JPEG/PNG/WebP images (client-compressed).
 */
import { api, apiMultipart, showToast, getAuthState, openAuthModal, selectIsAuthenticated } from "./auth.js";

const MAX_IMAGES = 3;
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.78;
const TARGET_BYTES = 280 * 1024;
const MAX_RAW_BYTES = 1024 * 1024;
const MAX_BODY = 4000;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function ensureDom() {
  if (document.getElementById("feedbackModal")) return;

  document.body.appendChild(
    el(`<div class="feedback-modal" id="feedbackModal" hidden>
      <div class="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedbackTitle">
        <button type="button" class="feedback-close-x" id="feedbackCloseX" aria-label="关闭">×</button>
        <h2 id="feedbackTitle">意见反馈</h2>
        <p class="feedback-hint">告诉开发者问题或建议。可附带 1–3 张截图（JPEG / PNG / WebP）。</p>
        <p class="feedback-error" id="feedbackError" hidden></p>
        <label class="feedback-label">反馈内容
          <textarea id="feedbackBody" rows="5" maxlength="4000" placeholder="请描述遇到的问题或想说的话…" required></textarea>
        </label>
        <div class="feedback-attach-row">
          <button type="button" class="feedback-attach-btn" id="feedbackPickImages">添加图片</button>
          <span class="feedback-attach-meta" id="feedbackAttachMeta">可选，最多 ${MAX_IMAGES} 张</span>
          <input type="file" id="feedbackImageFile" accept="image/jpeg,image/png,image/webp" multiple hidden>
        </div>
        <div class="feedback-previews" id="feedbackPreviews"></div>
        <div class="feedback-actions">
          <button type="button" class="feedback-secondary" id="feedbackCancel">取消</button>
          <button type="button" class="feedback-primary" id="feedbackSubmit">提交反馈</button>
        </div>
      </div>
    </div>`)
  );
}

/** Pending File objects after compress. */
let pendingFiles = [];
/** Object URLs for previews. */
let previewUrls = [];

function setError(msg) {
  const e = document.getElementById("feedbackError");
  if (!e) return;
  if (msg) {
    e.hidden = false;
    e.textContent = msg;
  } else {
    e.hidden = true;
    e.textContent = "";
  }
}

function clearPreviews() {
  for (const u of previewUrls) {
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* ignore */
    }
  }
  previewUrls = [];
  pendingFiles = [];
  const host = document.getElementById("feedbackPreviews");
  if (host) host.innerHTML = "";
  const meta = document.getElementById("feedbackAttachMeta");
  if (meta) meta.textContent = `可选，最多 ${MAX_IMAGES} 张`;
  const input = document.getElementById("feedbackImageFile");
  if (input) input.value = "";
}

function renderPreviews() {
  const host = document.getElementById("feedbackPreviews");
  if (!host) return;
  host.innerHTML = "";
  pendingFiles.forEach((file, idx) => {
    const url = previewUrls[idx];
    const item = el(`<div class="feedback-preview-item">
      <img alt="附件预览" src="${escapeHtml(url)}">
      <button type="button" class="feedback-preview-remove" data-idx="${idx}" aria-label="移除图片">×</button>
    </div>`);
    host.appendChild(item);
  });
  host.querySelectorAll(".feedback-preview-remove").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.idx);
      if (!Number.isInteger(i) || i < 0 || i >= pendingFiles.length) return;
      try {
        URL.revokeObjectURL(previewUrls[i]);
      } catch {
        /* ignore */
      }
      pendingFiles.splice(i, 1);
      previewUrls.splice(i, 1);
      renderPreviews();
      const meta = document.getElementById("feedbackAttachMeta");
      if (meta) {
        meta.textContent =
          pendingFiles.length === 0
            ? `可选，最多 ${MAX_IMAGES} 张`
            : `已选 ${pendingFiles.length} / ${MAX_IMAGES}`;
      }
    };
  });
  const meta = document.getElementById("feedbackAttachMeta");
  if (meta) {
    meta.textContent =
      pendingFiles.length === 0
        ? `可选，最多 ${MAX_IMAGES} 张`
        : `已选 ${pendingFiles.length} / ${MAX_IMAGES}`;
  }
}

function validateImageFile(file) {
  if (!file) return "请选择图片";
  const okType = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (!okType) return "仅支持 JPEG / PNG / WebP";
  if (file.size > MAX_RAW_BYTES) return "单张图片不能超过 1MB（可先压缩）";
  return null;
}

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

async function compressFeedbackFile(file) {
  if (!file) return null;
  if (file.size <= 96 * 1024 && file.type === "image/jpeg") return file;
  try {
    const img = await loadImageFromFile(file);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return file;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
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
    let quality = JPEG_QUALITY;
    let blob = await canvasToBlob(canvas, "image/jpeg", quality);
    while (blob && blob.size > TARGET_BYTES && quality > 0.45) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
    }
    if (!blob) return file;
    const out = new File([blob], (file.name || "shot").replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    if (out.size < file.size || scale < 1) return out;
    return file;
  } catch (e) {
    console.warn("feedback compress skipped", e);
    return file;
  }
}

export function openFeedbackModal() {
  ensureDom();
  const state = getAuthState();
  if (!selectIsAuthenticated(state)) {
    showToast("请先登录后再反馈", "error");
    openAuthModal("login");
    return;
  }
  setError("");
  const body = document.getElementById("feedbackBody");
  if (body) body.value = "";
  clearPreviews();
  const modal = document.getElementById("feedbackModal");
  modal.hidden = false;
  body?.focus();
}

export function closeFeedbackModal() {
  const modal = document.getElementById("feedbackModal");
  if (modal) modal.hidden = true;
  setError("");
  clearPreviews();
}

async function onPickImages(ev) {
  const files = Array.from(ev.target.files || []);
  ev.target.value = "";
  if (!files.length) return;
  const room = MAX_IMAGES - pendingFiles.length;
  if (room <= 0) {
    setError(`最多附带 ${MAX_IMAGES} 张图片`);
    showToast(`最多附带 ${MAX_IMAGES} 张图片`, "error");
    return;
  }
  const take = files.slice(0, room);
  for (const file of take) {
    const err = validateImageFile(file);
    if (err) {
      setError(err);
      showToast(err, "error");
      continue;
    }
    const ready = await compressFeedbackFile(file);
    if (ready.size > MAX_RAW_BYTES) {
      setError("压缩后仍超过 1MB，请换一张更小的图");
      showToast("图片过大", "error");
      continue;
    }
    pendingFiles.push(ready);
    previewUrls.push(URL.createObjectURL(ready));
  }
  setError("");
  renderPreviews();
}

async function onSubmit() {
  const state = getAuthState();
  if (!selectIsAuthenticated(state)) {
    showToast("请先登录后再反馈", "error");
    closeFeedbackModal();
    openAuthModal("login");
    return;
  }
  const bodyEl = document.getElementById("feedbackBody");
  const text = (bodyEl?.value || "").trim();
  if (!text) {
    setError("请填写反馈内容");
    showToast("请填写反馈内容", "error");
    bodyEl?.focus();
    return;
  }
  if ([...text].length > MAX_BODY) {
    setError(`反馈最多 ${MAX_BODY} 字`);
    return;
  }

  const submitBtn = document.getElementById("feedbackSubmit");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add("is-busy");
  }

  try {
    if (pendingFiles.length === 0) {
      await api("/feedback", { method: "POST", body: { body: text } });
    } else {
      const fd = new FormData();
      fd.append("body", text);
      for (const f of pendingFiles) {
        fd.append("images", f, f.name || "image.jpg");
      }
      await apiMultipart("/feedback", fd);
    }
    showToast("反馈已提交，谢谢！", "success");
    closeFeedbackModal();
  } catch (err) {
    const msg = err?.message || "提交失败，请稍后再试";
    setError(msg);
    showToast(msg, "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove("is-busy");
    }
  }
}

function bindSettingsEntry() {
  const btn = document.getElementById("settingsFeedbackBtn");
  if (!btn || btn.dataset.feedbackBound === "1") return;
  btn.dataset.feedbackBound = "1";
  btn.onclick = () => {
    // Close settings chrome lightly by opening feedback on top.
    openFeedbackModal();
  };
}

export function initFeedback() {
  ensureDom();
  bindSettingsEntry();

  // Settings panel may be created lazily by auth — observe once.
  const observer = new MutationObserver(() => bindSettingsEntry());
  observer.observe(document.body, { childList: true, subtree: true });

  document.getElementById("feedbackCloseX").onclick = closeFeedbackModal;
  document.getElementById("feedbackCancel").onclick = closeFeedbackModal;
  document.getElementById("feedbackSubmit").onclick = onSubmit;
  document.getElementById("feedbackPickImages").onclick = () => {
    document.getElementById("feedbackImageFile").click();
  };
  document.getElementById("feedbackImageFile").onchange = onPickImages;

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const m = document.getElementById("feedbackModal");
    if (m && !m.hidden) closeFeedbackModal();
  });
}
