/**
 * Hand-drawn art for the three PvP bots and the 双人对战 hub cover.
 * Art lands in assets/pvp/ as bot-a / bot-b / bot-glitch / battle-hero
 * (.webp + .png, 256 and 512). Until the files are committed the READY flags
 * stay false and every caller keeps the current avatar / sketch, so nothing
 * 404s. If an image fails at runtime we fall back to the old avatar.
 *
 * Bot art and the lobby hero (battle-hero-{light,dark}, 1200x600 + 600x300,
 * transparent) are wired.
 */
import { displayAvatarUrl } from "../auth.js";
import { applyFrameToImg } from "../avatar-frame.js";
import { getTheme, onThemeChange, THEME_DARK } from "../theme.js";

export const BOT_ART_READY = true;
export const COVER_ART_READY = true;
const ART_V = "20261013h";

// Server bots (server/src/lib/pvp/botUsers.js): nickname + avatarId must both
// match so a real player can never pick up bot art.
const BOTS = [
  { names: ["做T机器神"], avatarId: 2, file: "bot-a" },
  { names: ["追涨小白条", "追涨小白"], avatarId: 11, file: "bot-b" },
  { names: ["波段菠菜机", "波段韭菜机"], avatarId: 7, file: "bot-glitch" },
];

export function botArtKey(person) {
  if (!person) return null;
  const nick = String(person.nickname || "").trim();
  const bot = BOTS.find((b) => b.names.includes(nick));
  if (!bot) return null;
  if (person.isBot === true) return bot.file;
  return Number(person.avatarId) === bot.avatarId && !person.avatarUrl ? bot.file : null;
}

function artUrl(file, size, ext) {
  // 512 art has no suffix (bot-a.png), 256 is bot-a-256.png.
  const suffix = size >= 512 ? "" : "-256";
  return `assets/pvp/${file}${suffix}.${ext}?v=${ART_V}`;
}

/**
 * Set an avatar <img> for a PvP participant: bot art when available, otherwise
 * the normal avatar. A load error on bot art falls back to the normal avatar.
 */
const failedArt = new Set(); // keys whose art failed once: skip on re-render (no flicker / repeat 404s)

export function setPvpAvatar(img, person, { size = 48 } = {}) {
  if (!img) return;
  applyFrameToImg(img, person && person.avatarFrame, person && person.avatarMedal);
  const fallback = displayAvatarUrl(person || { avatarId: 1 });
  const raw = BOT_ART_READY ? botArtKey(person) : null;
  const key = raw && !failedArt.has(raw) ? raw : null;
  img.onerror = null;
  img.removeAttribute("srcset");
  if (!key) {
    img.classList.remove("pvp-bot-art");
    delete img.dataset.botArt;
    img.src = fallback;
    return;
  }
  img.classList.add("pvp-bot-art");
  img.dataset.botArt = key;
  img.onerror = () => {
    img.onerror = null;
    failedArt.add(key);
    img.removeAttribute("srcset");
    img.classList.remove("pvp-bot-art");
    delete img.dataset.botArt;
    img.src = fallback;
  };
  img.srcset = `${artUrl(key, 256, "webp")} 1x, ${artUrl(key, 512, "webp")} 2x`;
  img.src = artUrl(key, size > 128 ? 512 : 256, "png");
}

/** Hero H1 (Bill, PR #199): transparent ink art per theme, page paper shows through. */
const HERO_V = "20261020h1";
const heroUrl = (theme, w, ext) =>
  `assets/pvp/battle-hero-${theme === THEME_DARK ? "dark" : "light"}${w === 600 ? "-600" : ""}.${ext}?v=${HERO_V}`;
let stopHeroTheme = null;

function paintHero(webp, img, theme) {
  webp.srcset = `${heroUrl(theme, 600, "webp")} 600w, ${heroUrl(theme, 1200, "webp")} 1200w`;
  img.srcset = `${heroUrl(theme, 600, "png")} 600w, ${heroUrl(theme, 1200, "png")} 1200w`;
  img.src = heroUrl(theme, 1200, "png");
  img.dataset.theme = theme === THEME_DARK ? "dark" : "light";
}

/** Swap the hub sketch for the drawn hero (keeps the sketch on failure). */
export function mountBattleCover(sketch) {
  if (!COVER_ART_READY || !sketch || sketch.dataset.coverMounted === "1") return;
  sketch.dataset.coverMounted = "1";
  const picture = document.createElement("picture");
  picture.className = "pvp-cover-wrap";
  const webp = document.createElement("source");
  webp.type = "image/webp";
  const sizes = "(max-width: 720px) 92vw, 560px";
  webp.sizes = sizes;
  const img = document.createElement("img");
  img.className = "pvp-cover";
  // The hero has its title lettered in, so once it loads the text title row is
  // visually hidden (kept as the accessible heading). On failure the sketch and
  // the text title come back.
  img.alt = "模拟对战";
  img.width = 1200;
  img.height = 600;
  img.sizes = sizes;
  img.decoding = "async";
  paintHero(webp, img, getTheme());
  const screen = sketch.closest("#pvpLobbyScreen");
  img.addEventListener("load", () => { screen?.classList.add("pvp-hub-has-cover"); }, { once: true });
  img.addEventListener("error", () => {
    picture.remove();
    sketch.removeAttribute("hidden");
    screen?.classList.remove("pvp-hub-has-cover");
    if (stopHeroTheme) { stopHeroTheme(); stopHeroTheme = null; }
  }, { once: true });
  picture.append(webp, img);
  sketch.setAttribute("hidden", "");
  sketch.after(picture);
  // 纸/墨 flips live: swap to the matching ink so there is no light-ink-on-dark halo.
  if (stopHeroTheme) stopHeroTheme();
  stopHeroTheme = onThemeChange((next) => paintHero(webp, img, next));
}
