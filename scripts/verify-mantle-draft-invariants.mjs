#!/usr/bin/env node
/**
 * Stress-tests merge helpers used for mid-game sign-in / cloud hydrate.
 * Run: npm run verify:draft
 *
 * Not a browser E2E — it proves pickBetter + guessCount invariants 1e6 times.
 */

import assert from 'node:assert/strict';
import {
  guessCountFromMantleCompletionEntry,
  pickBetterMantleCompletionEntry,
} from '../src/lib/mantleMerge.js';

const entry = (overrides) => ({
  date: '2026-03-01',
  completedAt: '2026-03-01T12:00:00.000Z',
  guesses: 0,
  guessHistory: [],
  won: true,
  answer: 'X',
  top5: [],
  ...overrides,
});

// --- Explicit scenarios (mid-game sign-in / stale cloud) ---

// Both losses: longer guess history must win
{
  const local = entry({ won: false, guesses: 3, guessHistory: [{ n: 1 }, { n: 2 }, { n: 3 }] });
  const cloud = entry({ won: false, guesses: 1, guessHistory: [{ n: 1 }] });
  const pick = pickBetterMantleCompletionEntry(local, cloud);
  assert.equal(pick, local, 'more guesses should beat shorter cloud row');
}

// Cloud win vs local loss: win wins
{
  const local = entry({ won: false, guesses: 5, guessHistory: new Array(5).fill({}) });
  const cloud = entry({ won: true, guesses: 6, guessHistory: new Array(6).fill({}) });
  assert.equal(pickBetterMantleCompletionEntry(local, cloud), cloud);
}

// Both wins: newer completedAt wins
{
  const older = entry({ won: true, completedAt: '2026-03-01T10:00:00.000Z', guesses: 4 });
  const newer = entry({ won: true, completedAt: '2026-03-01T15:00:00.000Z', guesses: 4 });
  assert.equal(pickBetterMantleCompletionEntry(older, newer), newer);
}

// guessCount uses max of array length vs numeric guesses
assert.equal(guessCountFromMantleCompletionEntry(entry({ guesses: 2, guessHistory: [{}, {}, {}] })), 3);

// --- 1,000,000 randomized merge rounds (deterministic RNG) ---

let seed = 0x9e3779b9;
function rand() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0xffffffff;
}

function randEntry() {
  const won = rand() > 0.4;
  const ghLen = Math.floor(rand() * 12);
  const guessHistory = ghLen ? Array.from({ length: ghLen }, () => ({ name: 'P', score: 50 })) : [];
  const guesses = Math.floor(rand() * 15);
  const t = 1600000000000 + Math.floor(rand() * 1e10);
  return entry({
    won,
    guesses,
    guessHistory,
    completedAt: new Date(t).toISOString(),
  });
}

const ROUNDS = 1_000_000;
for (let i = 0; i < ROUNDS; i++) {
  const a = randEntry();
  const b = randEntry();
  const p = pickBetterMantleCompletionEntry(a, b);

  // Result is always one of the inputs
  assert.ok(p === a || p === b, `round ${i}: result must be a or b`);

  const ca = guessCountFromMantleCompletionEntry(a);
  const cb = guessCountFromMantleCompletionEntry(b);
  const aw = a.won !== false;
  const bw = b.won !== false;

  if (aw !== bw) {
    assert.equal(p.won !== false, aw || bw, 'winner side must match boolean win');
  } else if (!aw && !bw) {
    const cp = guessCountFromMantleCompletionEntry(p);
    assert.ok(cp === Math.max(ca, cb) || ca === cb, 'non-win: should prefer max guesses when unequal');
  }
}

console.log(`verify-mantle-draft-invariants: OK — ${ROUNDS.toLocaleString()} random merge rounds + explicit cases passed.`);
