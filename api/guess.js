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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }

  const body = await readBody(req);
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'Invalid JSON body' });

  const guess = typeof body.guess === 'string' ? body.guess.trim() : '';
  const targetDirect = typeof body.target === 'string' ? body.target.trim() : '';
  const mode = body.mode === 'hardcore' ? 'hardcore' : 'daily';
  const dailyNumber = body.dailyNumber;

  if (!guess) return json(res, 400, { error: 'Missing guess' });

  const target = targetDirect || resolveDailyTarget({ mode, dailyNumber });
  if (!target) return json(res, 400, { error: 'Missing target' });

  try {
    const safeGuess = await canonicalizePlayerName(guess);
    const safeTarget = await canonicalizePlayerName(target);
    const upstream = await postUpstreamGuessWithRetry({ guess: safeGuess, target: safeTarget });
    if (!upstream.ok) {
      return json(res, 502, {
        error: 'Upstream error',
        upstreamStatus: upstream.status ?? null,
        message: upstream.error?.message || 'Unknown upstream failure',
      });
    }
    const data = upstream.data;

    // Only reveal answer on an exact hit (score 100).
    if (data?.score === 100) return json(res, 200, { ...data, answer: target });
    return json(res, 200, data);
  } catch (error) {
    return json(res, 502, {
      error: 'Upstream unreachable',
      message: error?.message || 'Unknown upstream failure',
    });
  }
}

