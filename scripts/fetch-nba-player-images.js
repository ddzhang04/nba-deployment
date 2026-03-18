/**
 * Build player-images.json from NBA.com (no browser), with optional
 * Basketball-Reference fallback for missing players.
 *
 * Run:
 *   node scripts/fetch-nba-player-images.js
 *
 * Behavior:
 * - Pulls players from NBA.com (main players + all team rosters).
 * - For any target players still missing a headshot, attempts to fetch
 *   a headshot from Basketball-Reference via `og:image` on the player page.
 *
 * Output: public/player-images.json
 *   { "Player Name": { "id": "123|jamesle01", "imageUrl": "https://..." } }
 */

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { NBA_ALL_STAR_NAMES, normalizePlayerName } from '../src/data/allStarPlayers.js';
import { DAILY_PLAYERS } from '../src/data/dailyPlayers.js';
import { BALL_KNOWLEDGE_DAILY_PLAYERS } from '../src/data/ballKnowledgeDailyPlayers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_JSON = join(ROOT, 'public', 'player-images.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const BBR_UA = UA;
const BBR_BASE = 'https://www.basketball-reference.com';

// All 30 NBA team IDs (NBA.com)
const TEAM_IDS = [
  1610612737, 1610612738, 1610612739, 1610612740, 1610612741, 1610612742,
  1610612743, 1610612744, 1610612745, 1610612746, 1610612747, 1610612748,
  1610612749, 1610612750, 1610612751, 1610612752, 1610612753, 1610612754,
  1610612755, 1610612756, 1610612757, 1610612758, 1610612759, 1610612760,
  1610612761, 1610612762, 1610612763, 1610612764, 1610612765, 1610612766,
];

function slugToName(slug) {
  return (slug || '')
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}

function extractPlayersFromHtml(html) {
  const re = /\/player\/(\d+)\/([^/]+)\/?/g;
  const byId = {};
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const slug = m[2];
    const name = slugToName(slug);
    if (!name || !id) continue;
    byId[id] = { id, name, imageUrl: `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png` };
  }
  return byId;
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  return res.text();
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...options.headers, 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

async function bbrFetchHtml(url, { retries = 4, baseDelayMs = 1800 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': BBR_UA } });
      if (res.status === 429) {
        const wait = baseDelayMs * (attempt + 1);
        console.warn(`  BBR 429 on attempt ${attempt + 1}, waiting ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      // Back off on transient errors too.
      if (attempt < retries) await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
    }
  }
  throw lastErr || new Error('BBR fetch failed');
}

function extractFirstPlayerHrefFromSearch(searchHtml) {
  // Example: /players/j/jamesle01.html
  const m = searchHtml.match(/href=["'](\/players\/[a-z]\/[a-z0-9]+\.html)["']/i);
  return m?.[1] ?? null;
}

function extractOgImageFromPlayerHtml(playerHtml) {
  // Basketball-Reference includes an og:image meta tag we can scrape reliably.
  const m = playerHtml.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (!m?.[1]) return null;
  const url = m[1];
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${BBR_BASE}${url}`;
  // Avoid mixed-content blocks when your app is served over https.
  if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
  return url;
}

async function fetchBasketballReferenceHeadshotForName(name, { bbrRetries = 4, bbrBaseDelayMs = 1800 } = {}) {
  // Search for the player, then scrape the og:image from their player page.
  const searchUrl = `${BBR_BASE}/search/search.fcgi?search=${encodeURIComponent(name)}&i=sup_players`;
  const searchHtml = await bbrFetchHtml(searchUrl, { retries: bbrRetries, baseDelayMs: bbrBaseDelayMs });
  const href = extractFirstPlayerHrefFromSearch(searchHtml);
  if (!href) return { reason: 'no_href' };

  const playerUrl = `${BBR_BASE}${href}`;
  const playerHtml = await bbrFetchHtml(playerUrl, { retries: bbrRetries, baseDelayMs: bbrBaseDelayMs });

  const imageUrl = extractOgImageFromPlayerHtml(playerHtml);
  if (!imageUrl) return { reason: 'no_og_image' };

  const id = href.split('/').pop().replace(/\.html$/i, '');
  return { id, imageUrl, reason: 'ok' };
}

async function main() {
  const useEnrichExisting = process.argv.includes('--enrichExisting');
  const targetsFromArg = process.argv.find((a) => a.startsWith('--targetsFrom='));
  const targetsFrom = targetsFromArg ? targetsFromArg.split('=')[1] : 'gameplayLists';
  const apiBaseArg = process.argv.find((a) => a.startsWith('--apiBase='));
  const API_BASE = apiBaseArg ? apiBaseArg.split('=')[1] : 'https://nba-mantle-6-5.onrender.com/api';
  const forceNamesArg = process.argv.find((a) => a.startsWith('--forceNames='));
  const forceNames = forceNamesArg
    ? forceNamesArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const bbrRetriesArg = process.argv.find((a) => a.startsWith('--bbrRetries='));
  const bbrRetries = bbrRetriesArg ? Number(bbrRetriesArg.split('=')[1]) : 4;
  const bbrBaseDelayMsArg = process.argv.find((a) => a.startsWith('--bbrBaseDelayMs='));
  const bbrBaseDelayMs = bbrBaseDelayMsArg ? Number(bbrBaseDelayMsArg.split('=')[1]) : 1800;

  const byId = {}; // id -> { id, name, imageUrl } (only used for full NBA refresh)
  const players = {}; // { [playerName]: { id, imageUrl } }

  if (useEnrichExisting) {
    console.log('Loading existing', OUT_JSON);
    const existing = JSON.parse(readFileSync(OUT_JSON, 'utf8'));
    for (const [name, entry] of Object.entries(existing)) {
      if (!entry?.imageUrl) continue;
      players[name] = entry;
    }
  } else {
    // 1) Main players page
    console.log('Fetching main players page...');
    const mainHtml = await fetchHtml('https://www.nba.com/players');
    Object.assign(byId, extractPlayersFromHtml(mainHtml));
    console.log('  Total so far:', Object.keys(byId).length);

    // 2) All team roster pages
    for (let i = 0; i < TEAM_IDS.length; i++) {
      const tid = TEAM_IDS[i];
      try {
        const html = await fetchHtml(`https://www.nba.com/team/${tid}/roster`);
        const teamPlayers = extractPlayersFromHtml(html);
        let added = 0;
        for (const [id, entry] of Object.entries(teamPlayers)) {
          if (!byId[id]) {
            byId[id] = entry;
            added++;
          }
        }
        if (added > 0) console.log(`  Team ${tid}: +${added} (total ${Object.keys(byId).length})`);
      } catch (e) {
        console.warn(`  Team ${tid} failed:`, e.message);
      }
      // Small delay to avoid hammering
      await new Promise((r) => setTimeout(r, 200));
    }

    // Output: key by name (last seen name wins for same id)
    for (const entry of Object.values(byId)) {
      players[entry.name] = { id: entry.id, imageUrl: entry.imageUrl };
    }
  }

  // Basketball-Reference fallback: fill missing headshots only for the
  // names that are relevant for this run.
  let targetNames;
  if (targetsFrom === 'backendPlayers') {
    console.log('Loading player names from backend:', `${API_BASE}/players`);
    const list = await fetchJson(`${API_BASE}/players`);
    if (!Array.isArray(list)) throw new Error('Backend /players did not return an array');
    targetNames = new Set(list);
  } else {
    // Default: gameplay lists (All-Stars + Daily + Hardcore Daily)
    targetNames = new Set([
      ...NBA_ALL_STAR_NAMES,
      ...DAILY_PLAYERS,
      ...BALL_KNOWLEDGE_DAILY_PLAYERS,
    ]);
  }
  const existingByNorm = new Set(Object.keys(players).map(normalizePlayerName));

  const maxMissingArg = process.argv.find((a) => a.startsWith('--maxMissing='));
  const maxMissing = maxMissingArg ? Number(maxMissingArg.split('=')[1]) : Infinity;

  const missingTargets = [];

  const pushIfMissing = (name) => {
    if (!targetNames.has(name)) return;
    const norm = normalizePlayerName(name);
    if (existingByNorm.has(norm)) return;
    if (missingTargets.includes(name)) return;
    missingTargets.push(name);
  };

  // If forcing names, prioritize them first.
  for (const name of forceNames) {
    pushIfMissing(name);
    if (missingTargets.length >= maxMissing) break;
  }

  // Then fill remaining slots in targetNames order.
  if (missingTargets.length < maxMissing) {
    for (const name of targetNames) {
      pushIfMissing(name);
      if (missingTargets.length >= maxMissing) break;
    }
  }

  if (missingTargets.length > 0) console.log('BBR fallback: missing targets', missingTargets.length);

  let filled = 0;
  for (let i = 0; i < missingTargets.length; i++) {
    const name = missingTargets[i];
    const norm = normalizePlayerName(name);
    if (existingByNorm.has(norm)) continue;

    try {
      // Small delay to reduce chances of being rate-limited.
      await new Promise((r) => setTimeout(r, 1100));
      const bbr = await fetchBasketballReferenceHeadshotForName(name, { bbrRetries, bbrBaseDelayMs });
      if (bbr?.imageUrl) {
        players[name] = { id: bbr.id, imageUrl: bbr.imageUrl };
        existingByNorm.add(norm);
        filled++;
        if (filled % 20 === 0) console.log('  BBR filled so far:', filled);
      } else {
        console.warn('  BBR no headshot for:', name, 'reason:', bbr?.reason || 'unknown');
      }
    } catch (e) {
      console.warn('  BBR failed for:', name, '-', e?.message || e);
    }
  }

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(players, null, 2), 'utf8');
  console.log('Wrote', Object.keys(players).length, 'players to', OUT_JSON, '(filled', filled, 'via BBR)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
