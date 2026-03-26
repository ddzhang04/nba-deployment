-- NBA Mantle — run in Supabase SQL Editor (one project = one paste).
-- Fixes: missing tables/columns, unique constraint for upserts, optional RLS.

-- ---------------------------------------------------------------------------
-- 1) mantle_runs — daily / hardcore completions
-- ---------------------------------------------------------------------------
-- Base table (matches legacy installs that never had user_id / JSON columns).
CREATE TABLE IF NOT EXISTS public.mantle_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('daily', 'hardcore')),
  daily_number integer NOT NULL CHECK (daily_number >= 1),
  date text NOT NULL,
  answer text NOT NULL,
  guesses integer NOT NULL,
  won boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- IMPORTANT: add columns BEFORE any index on user_id (42703 if index runs first).
ALTER TABLE public.mantle_runs ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;
ALTER TABLE public.mantle_runs ADD COLUMN IF NOT EXISTS guess_history jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.mantle_runs ADD COLUMN IF NOT EXISTS top5 jsonb DEFAULT '[]'::jsonb;

-- Required for upserts from the app (anon_id + mode + daily_number)
CREATE UNIQUE INDEX IF NOT EXISTS mantle_runs_anon_mode_daily_uidx
  ON public.mantle_runs (anon_id, mode, daily_number);

CREATE INDEX IF NOT EXISTS mantle_runs_user_id_idx ON public.mantle_runs (user_id);
CREATE INDEX IF NOT EXISTS mantle_runs_anon_id_idx ON public.mantle_runs (anon_id);
CREATE INDEX IF NOT EXISTS mantle_runs_mode_daily_idx ON public.mantle_runs (mode, daily_number);

-- ---------------------------------------------------------------------------
-- 1b) mantle_run_attempts — append-only history (every completion = new row)
-- This prevents overwrites when you play the same daily on multiple accounts/devices.
-- `mantle_runs` remains the canonical "latest/best per daily" table for stats/leaderboards.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mantle_run_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  mode text NOT NULL CHECK (mode IN ('daily', 'hardcore')),
  daily_number integer NOT NULL CHECK (daily_number >= 1),
  date text NOT NULL,
  answer text NOT NULL,
  guesses integer NOT NULL,
  won boolean NOT NULL DEFAULT true,
  guess_history jsonb DEFAULT '[]'::jsonb,
  top5 jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mantle_run_attempts_user_id_idx ON public.mantle_run_attempts (user_id);
CREATE INDEX IF NOT EXISTS mantle_run_attempts_anon_id_idx ON public.mantle_run_attempts (anon_id);
CREATE INDEX IF NOT EXISTS mantle_run_attempts_mode_daily_idx ON public.mantle_run_attempts (mode, daily_number);

-- ---------------------------------------------------------------------------
-- 2) anon_links — tie device anon_id → Supabase auth user
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anon_links (
  anon_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS anon_links_user_id_idx ON public.anon_links (user_id);

-- ---------------------------------------------------------------------------
-- 3) profiles — display name / avatar (optional but used by the app)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  is_verified boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Supabase templates often use `id` as the FK to auth.users; policies below expect `user_id`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN id TO user_id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Row Level Security (RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE public.mantle_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mantle_run_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anon_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mantle_runs_insert" ON public.mantle_runs;
DROP POLICY IF EXISTS "mantle_runs_select" ON public.mantle_runs;
DROP POLICY IF EXISTS "mantle_runs_update" ON public.mantle_runs;
DROP POLICY IF EXISTS "mantle_run_attempts_insert" ON public.mantle_run_attempts;
DROP POLICY IF EXISTS "mantle_run_attempts_select" ON public.mantle_run_attempts;
DROP POLICY IF EXISTS "anon_links_all_own" ON public.anon_links;
DROP POLICY IF EXISTS "anon_links_select_own" ON public.anon_links;
DROP POLICY IF EXISTS "anon_links_insert_own" ON public.anon_links;
DROP POLICY IF EXISTS "anon_links_update_own" ON public.anon_links;
DROP POLICY IF EXISTS "anon_links_insert_authed" ON public.anon_links;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

CREATE POLICY "mantle_runs_insert" ON public.mantle_runs
  FOR INSERT TO authenticated, anon
  WITH CHECK (true);

CREATE POLICY "mantle_runs_select" ON public.mantle_runs
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "mantle_runs_update" ON public.mantle_runs
  FOR UPDATE TO authenticated, anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "mantle_run_attempts_insert" ON public.mantle_run_attempts
  FOR INSERT TO authenticated, anon
  WITH CHECK (true);

CREATE POLICY "mantle_run_attempts_select" ON public.mantle_run_attempts
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "anon_links_select_own" ON public.anon_links
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "anon_links_insert_own" ON public.anon_links
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "anon_links_update_own" ON public.anon_links
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Table privileges (RLS still applies; avoids edge cases where role lacked GRANT).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anon_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;

-- IMPORTANT: Without table privileges, RLS policies may not be enough.
-- The app inserts/selects directly from `mantle_runs` (and via fallback queries),
-- so both `anon` (guest) and `authenticated` roles need privileges.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mantle_runs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mantle_runs TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mantle_run_attempts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mantle_run_attempts TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Optional RPC for faster averages (app falls back if missing)
-- ---------------------------------------------------------------------------
-- Postgres cannot change OUT/RETURNS TABLE shape with CREATE OR REPLACE; drop first.
DROP FUNCTION IF EXISTS public.get_mantle_answer_averages(text) CASCADE;

CREATE OR REPLACE FUNCTION public.get_mantle_answer_averages(p_mode text)
RETURNS TABLE (daily_number int, avg numeric, wins bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    mr.daily_number::int,
    AVG(mr.guesses::numeric),
    COUNT(*)::bigint
  FROM public.mantle_runs mr
  WHERE mr.mode = p_mode
    AND mr.won = true
  GROUP BY mr.daily_number
  ORDER BY mr.daily_number;
$$;

-- Anyone can read global averages (same data the leaderboard uses).
GRANT EXECUTE ON FUNCTION public.get_mantle_answer_averages(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Optional: faster average for a single daily number (used by end-screen UI)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_mantle_answer_averages_for_daily(text, integer) CASCADE;

CREATE OR REPLACE FUNCTION public.get_mantle_answer_averages_for_daily(p_mode text, p_daily_number integer)
RETURNS TABLE (avg numeric, wins bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    AVG(mr.guesses::numeric) AS avg,
    COUNT(*)::bigint        AS wins
  FROM public.mantle_runs mr
  WHERE mr.mode = p_mode
    AND mr.won = true
    AND mr.daily_number = p_daily_number
  ;
$$;

GRANT EXECUTE ON FUNCTION public.get_mantle_answer_averages_for_daily(text, integer) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) Your runs on any device (one RPC — no Vercel /api/stats/* needed)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_my_mantle_runs() CASCADE;

CREATE OR REPLACE FUNCTION public.get_my_mantle_runs()
RETURNS SETOF public.mantle_runs
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mr.*
  FROM public.mantle_runs mr
  WHERE auth.uid() IS NOT NULL
    AND (
      mr.user_id = auth.uid()
      OR mr.anon_id IN (
        SELECT al.anon_id FROM public.anon_links al WHERE al.user_id = auth.uid()
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_my_mantle_runs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_mantle_runs() TO authenticated;
