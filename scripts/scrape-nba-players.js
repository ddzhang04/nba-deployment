/**
 * Scrape NBA.com players list for IDs and build player -> image mapping.
 * Run: node scripts/scrape-nba-players.js
 *
 * Data produced:
 *   - public/player-images.json: { "Player Name": { "id": "123", "imageUrl": "https://cdn.nba.com/..." } }
 *   - Optional: download images to public/players/{id}.png (set DOWNLOAD_IMAGES = true)
 *
 * Note: NBA.com content and CDN images may be subject to their terms of use.
 * For production, consider using official NBA APIs or licensed data.
 */

import { firefox } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_JSON = join(ROOT, 'public', 'player-images.json');
const OUT_DIR = join(ROOT, 'public', 'players');
const DOWNLOAD_IMAGES = false; // set true to save images locally

// Slug "bam-adebayo" -> "Bam Adebayo"
function slugToName(slug) {
  return (slug || '')
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}

async function main() {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  const players = {}; // name -> { id, imageUrl }

  try {
    await page.goto('https://www.nba.com/players', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for player links to appear (page may render table via JS)
    await page.waitForSelector('a[href*="/player/"]', { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Paginate: NBA.com shows "of 12" pages
    for (let p = 1; p <= 12; p++) {
      await page.waitForTimeout(1500);
      const links = await page.$$('a[href*="/player/"]');
      for (const link of links) {
        const href = await link.getAttribute('href');
        const text = (await link.textContent()) || '';
        const match = href && href.match(/\/player\/(\d+)\/([^/]+)\/?/);
        if (!match) continue;
        const [, id, slug] = match;
        const nameFromSlug = slugToName(slug);
        const name = (nameFromSlug || text.replace(/\s+/g, ' ').trim()).trim();
        if (!name || !id) continue;
        const imageUrl = `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`;
        players[name] = { id, imageUrl };
      }
      const nextBtn = await page.$('button[aria-label="Next page"], a:has-text("Next"), [data-next], button:has-text("Next")');
      if (!nextBtn) break;
      const disabled = await nextBtn.getAttribute('disabled');
      if (disabled !== null) break;
      await nextBtn.click();
    }

    mkdirSync(dirname(OUT_JSON), { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(players, null, 2), 'utf8');
    console.log('Wrote', Object.keys(players).length, 'players to', OUT_JSON);

    if (DOWNLOAD_IMAGES) {
      mkdirSync(OUT_DIR, { recursive: true });
      const https = await import('https');
      const fs = await import('fs');
      for (const [name, { id, imageUrl }] of Object.entries(players)) {
        const path = join(OUT_DIR, `${id}.png`);
        if (fs.existsSync(path)) continue;
        await new Promise((resolve, reject) => {
          https.get(imageUrl, (res) => {
            const file = fs.createWriteStream(path);
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          }).on('error', reject);
        });
      }
      console.log('Downloaded images to', OUT_DIR);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
