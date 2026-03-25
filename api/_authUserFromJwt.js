/**
 * Resolve Supabase Auth user id from an access token.
 * Primary: supabase.auth.getUser(jwt). Fallback: Auth REST /user (works when JS client quirks fail).
 */
export async function getUserIdFromJwt(supabase, supabaseUrl, token) {
  if (!token || !supabase || !supabaseUrl) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data?.user?.id) return data.user.id;
  } catch {}

  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    '';
  if (!key) return null;

  try {
    const base = String(supabaseUrl).replace(/\/$/, '');
    const res = await fetch(`${base}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: key,
      },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j?.id === 'string' ? j.id : null;
  } catch {
    return null;
  }
}
