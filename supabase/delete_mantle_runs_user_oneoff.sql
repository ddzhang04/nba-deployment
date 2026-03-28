-- One-off cleanup: delete mantle rows for a specific account.
-- Paste into Supabase SQL Editor and run once.
--
-- Your ID was given as: too47dcafa7-4bb8-466e-ac92-fc81e43dc47c
-- "too" is not valid in a UUID; this script uses 47dcafa7-4bb8-466e-ac92-fc81e43dc47c
-- If your real user id differs, replace the uuid below.

BEGIN;

-- mantle_runs: by user_id and by canonical anon_id form the app uses
DELETE FROM public.mantle_runs
WHERE user_id = '47dcafa7-4bb8-466e-ac92-fc81e43dc47c'::uuid
   OR anon_id = 'user:47dcafa7-4bb8-466e-ac92-fc81e43dc47c';

-- Optional: append-only history for same account
DELETE FROM public.mantle_run_attempts
WHERE user_id = '47dcafa7-4bb8-466e-ac92-fc81e43dc47c'::uuid;

COMMIT;
