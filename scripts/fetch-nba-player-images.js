/**
 * Build player-images.json from NBA.com players page (no browser).
 * Run: node scripts/fetch-nba-player-images.js
 *
 * The initial HTML includes ~50 players (first page). For full roster (~570),
 * run scripts/scrape-nba-players.js with Playwright when possible (e.g. headed browser).
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

function slugToName(slug) {
  return (slug || '')
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}

async function main() {
  const res = await fetch('https://www.nba.com/players', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const html = await res.text();
  const re = /\/player\/(\d+)\/([^/]+)\/?/g;
  const players = {};
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const slug = m[2];
    const name = slugToName(slug);
    if (!name || !id) continue;
    players[name] = {
      id,
      imageUrl: `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`,
    };
  }

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(players, null, 2), 'utf8');
  console.log('Wrote', Object.keys(players).length, 'players to', OUT_JSON);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
