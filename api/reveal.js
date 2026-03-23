const ONRENDER_API_BASE = 'https://nba-mantle-6-5.onrender.com/api';

import { DAILY_PLAYERS } from '../src/data/dailyPlayers.js';
import { BALL_KNOWLEDGE_DAILY_PLAYERS } from '../src/data/ballKnowledgeDailyPlayers.js';
import { canonicalizePlayerName } from './_canonicalize.js';

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postUpstreamGuessWithRetry(payload, { attempts = 3, timeoutMs = 12000, retryDelayMs = 500 } = {}) {
  let lastStatus = null;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(`${ONRENDER_API_BASE}/guess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await r.json().catch(() => null);
      if (r.ok && data) return { ok: true, status: r.status, data };
      lastStatus = r.status;
      lastError = new Error(`Upstream status ${r.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < attempts - 1) await sleep(retryDelayMs * (attempt + 1));
  }
  return { ok: false, status: lastStatus, error: lastError };
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }

  const body = await readBody(req);
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'Invalid JSON body' });

  const mode = body.mode === 'hardcore' ? 'hardcore' : 'daily';
  const dailyNumber = body.dailyNumber;
  console.log('[api/reveal] request', { mode, dailyNumber });
  const answer = resolveDailyTarget({ mode, dailyNumber });
  if (!answer) return json(res, 400, { error: 'Missing dailyNumber' });

  try {
    // Ask upstream for top_5 by doing a self-guess.
    const upstreamStartedAt = Date.now();
    const safeAnswer = await canonicalizePlayerName(answer);
    const upstream = await postUpstreamGuessWithRetry({ guess: safeAnswer, target: safeAnswer });
    if (!upstream.ok) {
      console.error('[api/reveal] upstream error', {
        mode,
        dailyNumber,
        status: upstream.status ?? null,
        upstreamMs: Date.now() - upstreamStartedAt,
        totalMs: Date.now() - startedAt,
        message: upstream.error?.message || 'Unknown upstream failure',
      });
      // Graceful fallback: still return answer even when top_5 lookup fails.
      return json(res, 200, { answer, top_5: [] });
    }
    const data = upstream.data;
    const top_5 = Array.isArray(data?.top_5) ? data.top_5 : [];
    console.log('[api/reveal] success', {
      mode,
      dailyNumber,
      status: upstream.status ?? null,
      top5Count: top_5.length,
      upstreamMs: Date.now() - upstreamStartedAt,
      totalMs: Date.now() - startedAt,
    });
    return json(res, 200, { answer, top_5 });
  } catch (error) {
    console.error('[api/reveal] upstream unreachable', {
      mode,
      dailyNumber,
      totalMs: Date.now() - startedAt,
      message: error?.message || 'unknown',
    });
    return json(res, 502, { error: 'Upstream unreachable' });
  }
}

