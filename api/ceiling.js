const ONRENDER_API_BASE = 'https://nba-mantle-6-5.onrender.com/api';

import { DAILY_PLAYERS_WITH_FIXED_DAY1 as DAILY_PLAYERS } from '../src/data/dailyPlayers.js';
import { HARDCORE_DAILY_PLAYERS_WITH_FIXED_DAY1 as BALL_KNOWLEDGE_DAILY_PLAYERS } from '../src/data/ballKnowledgeDailyPlayers.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { return null; }
}

function resolveDailyTarget({ mode, dailyNumber }) {
  const n = Number(dailyNumber);
  if (!Number.isFinite(n) || n < 1) return '';
  const idx = Math.floor(n - 1);
  const list = mode === 'hardcore' ? BALL_KNOWLEDGE_DAILY_PLAYERS : DAILY_PLAYERS;
  if (!Array.isArray(list) || list.length === 0) return '';
  return String(list[idx % list.length] ?? '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }

  const body = await readBody(req);
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'Invalid JSON body' });

  const mode = body.mode === 'hardcore' ? 'hardcore' : 'daily';
  const dailyNumber = body.dailyNumber;
  const answer = resolveDailyTarget({ mode, dailyNumber });
  if (!answer) return json(res, 400, { error: 'Missing dailyNumber' });

  try {
    // Ask upstream for top_5 by doing a self-guess, then compute the closest ceiling.
    const r = await fetch(`${ONRENDER_API_BASE}/guess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ guess: answer, target: answer }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) return json(res, 502, { error: 'Upstream error' });
    const top5 = Array.isArray(data?.top_5) ? data.top_5 : [];
    const ceiling = Array.isArray(top5?.[0]) ? top5[0][1] : null;
    return json(res, 200, { ceiling: typeof ceiling === 'number' ? ceiling : null });
  } catch {
    return json(res, 502, { error: 'Upstream unreachable' });
  }
}

