/**
 * Build player-images.json from NBA.com (no browser).
 * Run: node scripts/fetch-nba-player-images.js
 *
 * Fetches the main players page (~50) plus all 30 team roster pages to get
 * 500+ players. Dedupes by player ID.
 *
 * Output: public/player-images.json
 *   { "Player Name": { "id": "123", "imageUrl": "https://cdn.nba.com/headshots/nba/latest/260x190/123.png" } }
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_JSON = join(ROOT, 'public', 'player-images.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

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

async function main() {
  const byId = {}; // id -> { id, name, imageUrl }

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
  const players = {};
  for (const entry of Object.values(byId)) {
    players[entry.name] = { id: entry.id, imageUrl: entry.imageUrl };
  }

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(players, null, 2), 'utf8');
  console.log('Wrote', Object.keys(players).length, 'players to', OUT_JSON);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
