/**
 * P4: the hand-drawn back pill already carries the ← arrow. Wrap a leading
 * "←" text glyph in .p4-back-glyph (hidden by CSS) so it isn't drawn twice.
 * Text content/aria stays; works for buttons rendered later (MutationObserver).
 */
const BACK_SEL =
  ".hub-back, .academy-back, .zone-back-btn, .puzzle-screen-back, .leaderboard-back, .my-games-back, .hindsight-back, .pvp-back, .sg-back";

function wrapGlyph(btn) {
  if (!btn || btn.dataset.p4Back === "1") return;
  const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const m = node.nodeValue.match(/^(\s*)(←|‹|<)\s*/);
    if (m) {
      const span = document.createElement("span");
      span.className = "p4-back-glyph";
      span.setAttribute("aria-hidden", "true");
      span.textContent = m[0];
      node.nodeValue = node.nodeValue.slice(m[0].length);
      node.parentNode.insertBefore(span, node);
      break;
    }
    if (node.nodeValue.trim()) break;
  }
  btn.dataset.p4Back = "1";
}

/* Fixed top chrome (纸/墨 · 缩放 · 公告/韭币/账号) floats over the page; once the page
   scrolls, html.is-chrome-scrolled shows a paper band behind it so content no longer
   shows through the gaps between the chips (base.css body::after). */
let chromeBandBound = false;
export function initChromeBand(win = typeof window !== "undefined" ? window : null) {
  if (!win || chromeBandBound) return;
  chromeBandBound = true;
  const html = win.document.documentElement;
  let raf = 0;
  const sync = () => {
    raf = 0;
    html.classList.toggle("is-chrome-scrolled", (win.scrollY || 0) > 4);
  };
  win.addEventListener("scroll", () => { if (!raf) raf = win.requestAnimationFrame(sync); }, { passive: true });
  sync();
}

export function initP4Controls(root = document) {
  if (root === (typeof document !== "undefined" ? document : null)) initChromeBand();
  root.querySelectorAll(BACK_SEL).forEach(wrapGlyph);
  if (typeof MutationObserver !== "function" || !root.body) return;
  let queued = false;
  const mo = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      root.querySelectorAll(BACK_SEL).forEach((b) => {
        if (b.dataset.p4Back !== "1") wrapGlyph(b);
      });
    });
  });
  mo.observe(root.body, { childList: true, subtree: true });
}
