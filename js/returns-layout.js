/**
 * Phone in-game layout: the key return figures sit on the first screen (Bill picked option A).
 *
 * - 收益率 (red/green), the 仓位 chip and 当日涨跌 go into the top progress card,
 *   replacing the 「市场在等待你的判断…」 filler (CSS hides #progressMood only once the card exists).
 * - The two hint lines fold into one line with an ⓘ that expands them; 快进 is slimmer (CSS).
 * Trade buttons keep their size. Desktop (>900px) is unchanged: every rule lives in a max-width query.
 *
 * Values are mirrored from the existing board nodes (#holdingPnl / #positionStatus / #dailyReturn),
 * so every solo mode (classic, 一把梭, 生存, 今日挑战, 残局) gets it without touching their code.
 */

/** Left over from the A/B preview toggle in PR #200; removed so nothing stale lingers. */
export const STALE_LAYOUT_KEY = "sg_returns_layout";

/** Tone for the mirrored value from the board node's class. */
export function toneOf(className = "") {
  const c = ` ${className} `;
  if (c.includes(" positive ")) return "positive";
  if (c.includes(" negative ")) return "negative";
  if (c.includes(" locked ")) return "locked";
  return "neutral";
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function buildCard() {
  const box = el("span", "rl-card");
  box.id = "rlCard";
  box.setAttribute("aria-live", "polite");
  const sub = el("span", "rl-sub");
  sub.append(el("span", "rl-k", "当日涨跌"), Object.assign(el("span", "rl-v neutral", "--"), { id: "rlCardDaily" }));
  box.append(
    el("span", "rl-k", "收益率"),
    Object.assign(el("strong", "rl-v neutral", "0.00%"), { id: "rlCardPnl" }),
    Object.assign(el("span", "board-chip rl-chip neutral", "空仓"), { id: "rlCardPos" }),
    sub,
  );
  return box;
}

function buildHintToggle() {
  const b = el("button", "rl-info");
  b.type = "button";
  b.id = "rlHintToggle";
  b.setAttribute("aria-label", "操作提示");
  b.setAttribute("aria-expanded", "false");
  b.append(el("span", "", "i"));
  b.addEventListener("click", () => {
    const open = !document.documentElement.classList.contains("rl-hints-open");
    document.documentElement.classList.toggle("rl-hints-open", open);
    b.setAttribute("aria-expanded", open ? "true" : "false");
  });
  return b;
}

function mirror(src, target, { chip = false } = {}) {
  if (!src || !target) return;
  const paint = () => {
    target.textContent = (src.textContent || "").trim() || "--";
    const tone = toneOf(src.className);
    target.className = chip ? `board-chip rl-chip ${tone}` : `rl-v ${tone}`;
  };
  paint();
  new MutationObserver(paint).observe(src, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
}

let started = false;

export function initReturnsLayout(win = window) {
  if (started || typeof document === "undefined") return;
  started = true;
  try { win.localStorage?.removeItem(STALE_LAYOUT_KEY); } catch { /* private mode */ }

  const meta = document.querySelector("#gameProgressShell .game-progress-meta");
  const zone = document.querySelector("#gameScreen .action-zone");
  if (!meta || !zone) return;
  const mood = document.getElementById("progressMood");
  const card = buildCard();
  if (mood) mood.after(card); else meta.append(card);
  meta.classList.add("rl-has-card");
  zone.classList.add("rl-zone");

  const hint = document.getElementById("actionHint");
  if (hint) {
    // display:contents on desktop, so the hint keeps its old grid placement there.
    const row = el("span", "rl-hint-row");
    hint.before(row);
    row.append(hint, buildHintToggle());
  }

  mirror(document.getElementById("holdingPnl"), document.getElementById("rlCardPnl"));
  mirror(document.getElementById("positionStatus"), document.getElementById("rlCardPos"), { chip: true });
  mirror(document.getElementById("dailyReturn"), document.getElementById("rlCardDaily"));
}
