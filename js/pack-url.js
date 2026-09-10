/**
 * Versioned pack URL helpers (Phase 4 residual).
 * datasetSha === server datasetVersion (sha256 of stocks_data.json bytes).
 */

export const PACK_META_URL = 'data/pack-meta.json';
export const PACK_FALLBACK_URL = 'data/stocks_data.json';
export const PACK_JS_FALLBACK_URL = 'data/stocks_data.js';
/** Legacy IDB key when pack-meta / sha is unavailable (local unversioned). */
export const LEGACY_IDB_KEY = 'stocks-pack-v1';

const SHA256_RE = /^[a-f0-9]{64}$/;

export function normalizeDatasetSha(value) {
  if (value == null) return null;
  const sha = String(value).trim().toLowerCase();
  return SHA256_RE.test(sha) ? sha : null;
}

/** `data/stocks_data.<sha>.json` or null if sha invalid. */
export function versionedPackUrl(datasetSha) {
  const sha = normalizeDatasetSha(datasetSha);
  if (!sha) return null;
  return `data/stocks_data.${sha}.json`;
}

/** IDB object key: full sha when known, else legacy constant. */
export function idbKeyForPack(datasetSha) {
  const sha = normalizeDatasetSha(datasetSha);
  return sha || LEGACY_IDB_KEY;
}

/**
 * Normalize pack-meta.json / version.json pack fields.
 * @returns {{ datasetSha: string, datasetVersion: string, packUrl: string, fallbackUrl: string, fallbackJsUrl: string } | null}
 */
export function normalizePackMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sha = normalizeDatasetSha(raw.datasetSha || raw.datasetVersion);
  if (!sha) return null;
  const packUrl =
    (typeof raw.packUrl === 'string' && raw.packUrl.trim()) ||
    versionedPackUrl(sha);
  return {
    datasetSha: sha,
    datasetVersion: sha,
    packUrl,
    fallbackUrl:
      (typeof raw.fallbackUrl === 'string' && raw.fallbackUrl.trim()) ||
      PACK_FALLBACK_URL,
    fallbackJsUrl:
      (typeof raw.fallbackJsUrl === 'string' && raw.fallbackJsUrl.trim()) ||
      PACK_JS_FALLBACK_URL,
  };
}
