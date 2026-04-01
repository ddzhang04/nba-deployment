const ONRENDER_API_BASE = 'https://nba-mantle-6-5.onrender.com/api';

const PLAYERS_CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes
let playersCacheTs = 0;
let playersByNormalized = null;
let playersMapPromise = null;

function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\./g, '')
    .replace(/[^a-zA-Z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function loadPlayersMap() {
  const now = Date.now();
  if (playersByNormalized && now - playersCacheTs < PLAYERS_CACHE_TTL_MS) return playersByNormalized;
  if (playersMapPromise) return playersMapPromise;

  playersMapPromise = (async () => {
    const r = await fetch(`${ONRENDER_API_BASE}/players`);
    const data = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(data)) throw new Error(`players list unavailable (${r.status})`);

    const map = new Map();
    for (const raw of data) {
      const name = String(raw || '').trim();
      if (!name) continue;
      const key = normalizeName(name);
      if (!key) continue;
      if (!map.has(key)) map.set(key, name);
    }

    playersByNormalized = map;
    playersCacheTs = Date.now();
    return map;
  })();

  try {
    return await playersMapPromise;
  } finally {
    playersMapPromise = null;
  }
}

export async function canonicalizePlayerName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  try {
    const map = await loadPlayersMap();
    const key = normalizeName(raw);
    return map.get(key) || raw;
  } catch {
    return raw;
  }
}

