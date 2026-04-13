/**
 * Lightweight production healthcheck.
 *
 * Run:
 *   node scripts/healthcheck.js
 *
 * Env vars:
 *   HEALTHCHECK_BASE_URL      (default: https://nba-deployment.vercel.app)
 *   HEALTHCHECK_API_BASE_URL  (default: <HEALTHCHECK_BASE_URL>/api)
 *   HEALTHCHECK_TIMEOUT_MS    (default: 20000)
 */

const BASE_URL = (process.env.HEALTHCHECK_BASE_URL || 'https://nba-deployment.vercel.app').replace(/\/+$/, '');
const API_BASE = (process.env.HEALTHCHECK_API_BASE_URL || `${BASE_URL}/api`).replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 20000);
const RETRIES = Number(process.env.HEALTHCHECK_RETRIES || 2);
const STRICT_SUPABASE = process.env.HEALTHCHECK_STRICT_SUPABASE === '1';
const TRANSIENT_HTTP_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

async function getTodayDailyNumber() {
  try {
    const mod = await import('../src/data/dailyPlayers.js');
    const fn = mod?.getDailyPuzzleDayIndex;
    if (typeof fn !== 'function') return 1;
    // Keep in sync with the app's offset (DAILY_PUZZLE_INDEX_OFFSET = 0 in App.jsx)
    return fn(new Date(), 0) + 1;
  } catch {
    return 1;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableError(error) {
  const msg = typeof error?.message === 'string' ? error.message : String(error);
  if (/aborted|timed?\s*out|timeout/i.test(msg)) return true;
  if (/network|fetch failed|socket|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(msg)) return true;
  const m = msg.match(/HTTP\s+(\d{3})/i);
  if (m) {
    const code = Number(m[1]);
    return TRANSIENT_HTTP_CODES.has(code);
  }
  return false;
}

async function fetchJsonWithRetry(url, options = {}, { timeoutMs = TIMEOUT_MS, retries = RETRIES } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Ramp timeout across attempts to absorb serverless cold starts.
      const attemptTimeout = Math.min(timeoutMs + attempt * 10000, 90000);
      const res = await fetchWithTimeout(
        url,
        { ...options, headers: { ...(options.headers || {}), accept: 'application/json' } },
        attemptTimeout
      );
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      }
      return body;
    } catch (e) {
      lastErr = e;
      const retryable = isRetryableError(e);
      if (attempt < retries && retryable) {
        const wait = 900 * (attempt + 1);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      break;
    }
  }
  if (lastErr) {
    const msg = typeof lastErr?.message === 'string' ? lastErr.message : String(lastErr);
    throw new Error(`Healthcheck request failed for ${url}: ${msg}`);
  }
  throw new Error(`Healthcheck request failed for ${url}`);
}

async function assertHomePage() {
  const res = await fetchWithTimeout(`${BASE_URL}/`);
  if (!res.ok) throw new Error(`Homepage failed: HTTP ${res.status}`);
  const html = await res.text();
  if (!/NBA Mantle/i.test(html)) {
    throw new Error('Homepage did not contain expected app text "NBA Mantle"');
  }
}

async function assertLeaderboard() {
  const url = `${API_BASE}/leaderboard?mode=daily&limit=10`;
  const body = await fetchJsonWithRetry(url);
  if (!body || typeof body !== 'object') throw new Error('Leaderboard payload not an object');
  if (!Array.isArray(body.entries)) throw new Error('Leaderboard payload missing entries[]');
  if (!Number.isFinite(body.dailyNumber)) throw new Error('Leaderboard payload missing dailyNumber');
}

async function assertProfile() {
  const url = `${API_BASE}/profile?mode=daily&anon_id=healthcheck`;
  const body = await fetchJsonWithRetry(url);
  if (!body || typeof body !== 'object') throw new Error('Profile payload not an object');
  if (!Number.isFinite(body.todayDailyNumber)) throw new Error('Profile payload missing todayDailyNumber');
  if (!Array.isArray(body.recent)) throw new Error('Profile payload missing recent[]');
}

async function assertCeiling() {
  const todayDailyNumber = await getTodayDailyNumber();
  const url = `${API_BASE}/ceiling`;
  const body = await fetchJsonWithRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ mode: 'daily', dailyNumber: todayDailyNumber }),
    },
    { timeoutMs: Math.max(TIMEOUT_MS, 30000), retries: Math.max(RETRIES, 5) }
  );
  if (!body || typeof body !== 'object') throw new Error('Ceiling payload not an object');
  if (!('ceiling' in body)) throw new Error('Ceiling payload missing ceiling');
}

async function assertReveal() {
  const todayDailyNumber = await getTodayDailyNumber();
  const url = `${API_BASE}/reveal`;
  const body = await fetchJsonWithRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ mode: 'daily', dailyNumber: todayDailyNumber }),
    },
    { timeoutMs: Math.max(TIMEOUT_MS, 30000), retries: Math.max(RETRIES, 5) }
  );
  if (!body || typeof body !== 'object') throw new Error('Reveal payload not an object');
  if (typeof body.answer !== 'string' || !body.answer) throw new Error('Reveal payload missing answer');
  if (!Array.isArray(body.top_5)) throw new Error('Reveal payload missing top_5[]');
}

async function runCheck(name, fn) {
  const started = Date.now();
  await fn();
  const ms = Date.now() - started;
  console.log(`OK ${name} (${ms}ms)`);
}

async function main() {
  const started = Date.now();
  console.log(`Healthcheck base: ${BASE_URL}`);
  console.log(`Healthcheck api : ${API_BASE}`);
  await runCheck('homepage', assertHomePage);
  // Gameplay-critical checks: don't rely on Supabase service-role env vars.
  await runCheck('ceiling', assertCeiling);
  await runCheck('reveal', assertReveal);

  // Optional: Supabase-powered UI helpers. If service-role env vars aren't configured,
  // these endpoints can 500 without affecting gameplay.
  try {
    await runCheck('leaderboard', assertLeaderboard);
  } catch (e) {
    if (STRICT_SUPABASE) throw e;
    console.warn('WARN leaderboard healthcheck:', e?.message || e);
  }

  try {
    await runCheck('profile', assertProfile);
  } catch (e) {
    if (STRICT_SUPABASE) throw e;
    console.warn('WARN profile healthcheck:', e?.message || e);
  }
  console.log(`Healthcheck passed (${Date.now() - started}ms)`);
}

main().catch((err) => {
  console.error('Healthcheck failed:', err?.message || err);
  process.exit(1);
});

