# NBA Mantle

NBA player guessing game inspired by Wordle. Guess a player, get a similarity score, and work toward the exact match.

Live app: [https://nba-deployment.vercel.app/](https://nba-deployment.vercel.app/)

## Stack

- React 19 + Vite
- Supabase (auth + stats storage)
- Vercel serverless API routes in `api/`

## Game Modes

- `Daily` - one shared puzzle per day
- `Hardcore Daily` - separate daily rotation, same daily cadence
- `All Stars 1986+` (`easy`)
- `Classic` (2011+ debut with minimum career length checks)
- `All` (full pool)

## Current Features

- Autocomplete search + keyboard navigation
- Guess history with similarity breakdowns
- Daily/Hardcore completion persistence
- Account sign-in (email/password + Google OAuth)
- Cross-device sync of daily/hardcore history after sign-in
- Top-5 reveal/end-screen flow
- Favorites + UI preference persistence in localStorage
- Daily stats/averages and streak-style history views

## Project Structure

- `src/App.jsx` - main UI and gameplay state
- `src/data/dailyPlayers.js` - daily rotation + epoch
- `src/data/ballKnowledgeDailyPlayers.js` - hardcore daily rotation
- `api/` - serverless routes used by the app
- `scripts/` - data/image helper scripts

## Local Development

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Environment

Create `.env.local` (or equivalent for your host) with:

```bash
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_SUPABASE_OAUTH_REDIRECT_TO=https://your-app-url-or-localhost-callback
```

Serverless routes in `api/` use server-side env vars:

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Run

```bash
npm run dev
```

Default Vite URL: [http://localhost:5173](http://localhost:5173)

### Build / Preview

```bash
npm run build
npm run preview
```

## API Routes (in this repo)

- `POST /api/guess` - secure daily/hardcore guess scoring
- `POST /api/reveal` - secure daily/hardcore answer reveal
- `POST /api/ceiling` - score ceiling for the active daily puzzle
- `GET /api/stats/averages` - global average guesses by mode/daily number
- `POST /api/stats/submit` - save completion records
- `GET /api/leaderboard` - leaderboard data
- `GET /api/profile` - profile summary data

The frontend also calls external/backend endpoints via `API_BASE` in `src/App.jsx` (players list/data and non-daily guess paths).

## Daily Rotation Configuration

Edit:

- `src/data/dailyPlayers.js`
  - `DAILY_PLAYERS`
  - `DAILY_PUZZLE_EPOCH`
- `src/data/ballKnowledgeDailyPlayers.js`
  - hardcore daily rotation list

## Account Sync Notes

- Runs are stored in `mantle_runs` with `mode`, `daily_number`, `anon_id`, and optionally `user_id`, `guess_history`, `top5`.
- On sign-in, the app hydrates progress by:
  - account `user_id` (primary), and
  - linked/current `anon_id` values (fallback/back-compat)
- Signing out clears account-local daily/hardcore progress from local storage and resets visible puzzle state.

## Supabase Schema Requirements

Minimum tables used by this app:

### `mantle_runs`

Required columns:
- `anon_id` `text` (not null)
- `mode` `text` (expects `daily` or `hardcore`)
- `daily_number` `int` (not null)
- `date` `text` or `date`
- `answer` `text`
- `guesses` `int`
- `won` `boolean`
- `created_at` timestamp (recommended default `now()`)

Used by newer sync/features (recommended):
- `user_id` `uuid` (nullable, links run to account)
- `guess_history` `jsonb` (nullable)
- `top5` `jsonb` (nullable)

Recommended uniqueness:
- unique index on `("anon_id","mode","daily_number")`

Recommended performance indexes:
- index on `("user_id","mode","daily_number")`
- index on `("anon_id","mode","daily_number")`

### `anon_links`

Required columns:
- `anon_id` `text` (primary key or unique)
- `user_id` `uuid`
- `created_at` timestamp

### `profiles`

Required columns:
- `user_id` `uuid` (primary key or unique)
- `display_name` `text`
- `avatar_url` `text`
- `is_verified` `boolean`
- `updated_at` timestamp

### RLS / Permissions (high level)

- Client-side app reads/writes `mantle_runs`, `anon_links`, and `profiles` through the anon key, so your RLS policies must allow the intended operations for authenticated users.
- Serverless routes in `api/` use `SUPABASE_SERVICE_ROLE_KEY` and bypass RLS; keep this key server-side only.
- If account sync fails, check policy denials first (Supabase logs) before debugging frontend code.

## Troubleshooting

**Signed in but daily/hardcore history is missing**
- Verify same account on both devices
- Check Supabase tables: `mantle_runs`, `anon_links`, `profiles`
- Confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Look for `Account progress sync error` in console

**Players not loading**
- Verify backend/player endpoints configured in `API_BASE`
- Check browser network failures and CORS

## Scripts

See `scripts/README.md` for image/data helper scripts (including NBA player image generation).
