import { createClient } from '@supabase/supabase-js';
import { json } from '../_http.js';

/**
 * GET /api/stats/ping — no auth. Verifies Vercel env + DB reachability.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Method not allowed' });
  }

  const hasUrl = !!process.env.SUPABASE_URL;
  const hasService = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!hasUrl || !hasService) {
    return json(res, 500, {
      ok: false,
      hasUrl,
      hasService,
      hint: 'Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to this Vercel project (Settings → Environment Variables), then redeploy.',
    });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { error } = await supabase.from('mantle_runs').select('daily_number').limit(1);
    return json(res, 200, {
      ok: true,
      hasUrl,
      hasService,
      tableOk: !error,
      dbError: error ? error.message : null,
      dbCode: error?.code || null,
    });
  } catch (e) {
    return json(res, 500, {
      ok: false,
      hasUrl,
      hasService,
      detail: String(e?.message || e),
    });
  }
}
