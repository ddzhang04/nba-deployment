/**
 * Vercel/Node request query: sometimes missing or wrong shape; parse from URL when needed.
 */
export function parseQuery(req) {
  const raw = req?.query;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length > 0) {
    return raw;
  }
  if (typeof raw === 'string' && raw.length) {
    const out = {};
    new URLSearchParams(raw).forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  const url = typeof req?.url === 'string' ? req.url : '';
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  if (!q) return {};
  const out = {};
  new URLSearchParams(q).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
