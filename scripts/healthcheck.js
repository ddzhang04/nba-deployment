/**
 * Lightweight production healthcheck.
 *
 * Run:
 *   node scripts/healthcheck.js
 *
 * Env vars:
 *   HEALTHCHECK_BASE_URL      (default: https://nba-deployment.vercel.app)
 *   HEALTHCHECK_API_BASE_URL  (default: <HEALTHCHECK_BASE_URL>/api)
 *   HEALTHCHECK_TIMEOUT_MS    (default: 12000)
 */

const BASE_URL = (process.env.HEALTHCHECK_BASE_URL || 'https://nba-deployment.vercel.app').replace(/\/+$/, '');
const API_BASE = (process.env.HEALTHCHECK_API_BASE_URL || `${BASE_URL}/api`).replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 12000);

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function assertHomePage() {
  const res = await fetchWithTimeout(`${BASE_URL}/`);
  if (!res.ok) throw new Error(`Homepage failed: HTTP ${res.status}`);
  const html = await res.text();
  if (!/NBA Mantle/i.test(html)) {
    throw new Error('Homepage did not contain expected app text "NBA Mantle"');
  }
  console.log('OK homepage');
}

async function assertLeaderboard() {
  const url = `${API_BASE}/leaderboard?mode=daily&limit=10`;
  const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Leaderboard failed: HTTP ${res.status}`);
  const body = await res.json();
  if (!body || typeof body !== 'object') throw new Error('Leaderboard payload not an object');
  if (!Array.isArray(body.rows)) throw new Error('Leaderboard payload missing rows[]');
  console.log('OK leaderboard');
}

async function assertProfile() {
  const url = `${API_BASE}/profile?mode=daily&anon_id=healthcheck`;
  const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Profile failed: HTTP ${res.status}`);
  const body = await res.json();
  if (!body || typeof body !== 'object') throw new Error('Profile payload not an object');
  if (!body.stats || typeof body.stats !== 'object') throw new Error('Profile payload missing stats');
  console.log('OK profile');
}

async function main() {
  console.log(`Healthcheck base: ${BASE_URL}`);
  console.log(`Healthcheck api : ${API_BASE}`);
  await assertHomePage();
  await assertLeaderboard();
  await assertProfile();
  console.log('Healthcheck passed');
}

main().catch((err) => {
  console.error('Healthcheck failed:', err?.message || err);
  process.exit(1);
});

