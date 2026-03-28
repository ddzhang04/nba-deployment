/**
 * Cloud vs local merge for Daily / Hardcore completion maps (used by App.jsx hydrate).
 * Kept in a plain module so we can stress-test invariants with `npm run verify:draft`.
 */

/** Guess count from a stored daily/hardcore completion entry (local or merged from cloud). */
export function guessCountFromMantleCompletionEntry(ent) {
  if (!ent || typeof ent !== 'object') return 0;
  const gh = Array.isArray(ent.guessHistory) ? ent.guessHistory.length : 0;
  const g = Number(ent.guesses);
  return Math.max(gh, Number.isFinite(g) ? g : 0);
}

/**
 * When local and cloud both have a row for the same daily, pick the better snapshot.
 * Wins beat losses/reveals; among same outcome, prefer more guesses; then newer completedAt.
 */
export function pickBetterMantleCompletionEntry(local, cloud) {
  if (!local || typeof local !== 'object') return cloud;
  if (!cloud || typeof cloud !== 'object') return local;
  const lw = local.won !== false;
  const cw = cloud.won !== false;
  if (lw && cw) {
    const at = String(local.completedAt || '');
    const bt = String(cloud.completedAt || '');
    return bt > at ? cloud : local;
  }
  if (lw !== cw) return lw ? local : cloud;
  const lh = guessCountFromMantleCompletionEntry(local);
  const ch = guessCountFromMantleCompletionEntry(cloud);
  if (ch !== lh) return ch > lh ? cloud : local;
  const at = String(local.completedAt || '');
  const bt = String(cloud.completedAt || '');
  return bt > at ? cloud : local;
}
