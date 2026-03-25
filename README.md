# NBA Mantle

Guess a mystery NBA player by similarity scores — Wordle-style.  
Live: [https://nba-deployment.vercel.app/](https://nba-deployment.vercel.app/)

## Simple setup (do this once)

1. **Supabase project** — Create a project at [supabase.com](https://supabase.com).

2. **Run the SQL** — In Supabase: **SQL Editor → New query**, paste everything in [`supabase/setup.sql`](supabase/setup.sql), **Run**.  
   That creates tables, RLS, and two RPCs:
   - `get_mantle_answer_averages` — global averages (called from the browser)
   - `get_my_mantle_runs` — your daily/hardcore history when signed in (cross-device)

3. **Frontend env** (`.env.local` or Vercel **Environment Variables** for the site):

   ```bash
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   VITE_SUPABASE_OAUTH_REDIRECT_TO=https://your-site.vercel.app/   # if using Google OAuth
   ```

4. **Vercel env** (only for server routes under `api/` — leaderboard, profile, etc.):

   ```bash
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...   # never put this in the frontend
   ```

5. **Deploy** — Push to GitHub / deploy on Vercel.

**Account sync** is entirely **Supabase from the browser**: save = `upsert` on `mantle_runs`, load = `rpc('get_my_mantle_runs')`. No separate `/api/stats/*` layer.

Sign in **once per device** so `anon_links` ties that device’s `anon_id` to your user (needed for history from before `user_id` was on every row).

---

## Stack

- React 19 + Vite  
- Supabase (Auth + Postgres + RPC)  
- Vercel `api/` — **only** guess / reveal / ceiling (hide answers) + leaderboard/profile helpers  
- Render (or similar) — full player list + similarity engine (`API_BASE` in `src/App.jsx`)

## Game modes

- **Daily** / **Hardcore Daily** — shared calendar puzzles  
- **All Stars 1986+**, **Classic**, **All** — random mystery players from the pool  

## Local dev

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually port 5173).  
`/api/*` on Vercel does not run inside `npm run dev`; use **`vercel dev`** if you need those routes locally.

## `api/` routes (game secrets only)

- `POST /api/guess`, `POST /api/reveal`, `POST /api/ceiling` — daily/hardcore  
- `GET /api/leaderboard`, `GET /api/profile` — need `SUPABASE_*` on Vercel  

Stats and saves use **Supabase directly** from the client after you run `setup.sql`.

## Edit daily puzzles

- `src/data/dailyPlayers.js` — `DAILY_PLAYERS`, `DAILY_PUZZLE_EPOCH`  
- `src/data/ballKnowledgeDailyPlayers.js` — hardcore rotation  

## Optional: static app without same-origin `/api`

If the UI is hosted somewhere that has no `/api`, set:

```bash
VITE_API_ORIGIN=https://your-vercel-deployment.vercel.app
```

## Scripts

See [`scripts/README.md`](scripts/README.md) for player image helpers.

## Troubleshooting

| Problem | Check |
|--------|--------|
| Can’t sign in / no Supabase | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` |
| History missing after sign-in | Re-run `setup.sql` (includes `get_my_mantle_runs`), sign in on each device once |
| Global average empty | RPC + RLS from `setup.sql`; browser Network → calls to `supabase.co` |
| Leaderboard/profile 500 on Vercel | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on that project |
