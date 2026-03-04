# Scripts

## Player images (NBA.com)

### What data we have

- **`public/player-images.json`**  
  Map of player name → `{ id, imageUrl }`:
  - `id`: NBA.com numeric player ID
  - `imageUrl`: `https://cdn.nba.com/headshots/nba/latest/260x190/{id}.png` (260×190 headshots)

Names in the JSON come from NBA.com URL slugs (e.g. `bam-adebayo` → `Bam Adebayo`). The app matches API names using exact key and normalized name (no accents, case-insensitive) so variants like “LaMelo Ball” still resolve when the JSON has “Lamelo Ball”.

### How to regenerate

1. **Recommended: main page + all 30 team rosters (~530+ players, no browser)**  
   ```bash
   node scripts/fetch-nba-player-images.js
   ```  
   Fetches the NBA.com players page plus each team’s roster page and merges by player ID. Takes ~30 seconds.

2. **Full roster (~570 players, needs browser)**  
   ```bash
   node scripts/scrape-nba-players.js
   ```  
   Uses Playwright (Firefox) to open NBA.com, paginate through all 12 pages, and collect every player. Requires:
   - `npx playwright install` (and `npx playwright install chromium` if you switch the script back to Chromium)
   - A working browser; the players table may not appear in headless mode on some setups. If it times out, try running in headed mode or on a different machine.

NBA.com content and CDN images may be subject to their terms of use. For production, consider official NBA APIs or licensed data.
