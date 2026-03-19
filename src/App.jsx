import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './NBAGuessGame.css'; // Import the CSS file
import { isAllStarPlayerName, normalizePlayerName } from './data/allStarPlayers';
import { DAILY_PUZZLE_EPOCH, DAILY_PLAYERS } from './data/dailyPlayers';
import { BALL_KNOWLEDGE_DAILY_PLAYERS } from './data/ballKnowledgeDailyPlayers';
import { supabase } from './lib/supabaseClient';

const NBAGuessGame = () => {
  const [targetPlayer, setTargetPlayer] = useState('');
  const [guess, setGuess] = useState('');
  const [guessHistory, setGuessHistory] = useState([]);
  const [gameWon, setGameWon] = useState(false);
  const [guessCount, setGuessCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [top5Players, setTop5Players] = useState([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [allPlayers, setAllPlayers] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [gameMode, setGameMode] = useState('daily');
  const [filteredPlayers, setFilteredPlayers] = useState([]);
  const [playersData, setPlayersData] = useState({});
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showMoreGames, setShowMoreGames] = useState(false);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [playerImagesMap, setPlayerImagesMap] = useState({}); // normalized key -> { id, imageUrl }
  const [targetMaxSimilar, setTargetMaxSimilar] = useState(null);
  const [prefetchedTargetTop5, setPrefetchedTargetTop5] = useState([]); // top_5 for current target (prefetched)
  const [prefetchedTargetTop5Loading, setPrefetchedTargetTop5Loading] = useState(false);
  const [prefetchedTargetTop5For, setPrefetchedTargetTop5For] = useState(null); // playerName the prefetched top5 belongs to

  const STORAGE_RESET_VERSION = 'v3'; // bump to force fresh local storage for everyone
  const key = (k) => `${k}-${STORAGE_RESET_VERSION}`;

  const bestPrevRef = useRef(null);
  const [bestSoFar, setBestSoFar] = useState(null);
  const [bestDelta, setBestDelta] = useState(null);

  const FAVORITES_KEY = key('nba-mantle-favorites');
  const [favoritePlayerKeys, setFavoritePlayerKeys] = useState(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const favoritePlayerKeySet = useMemo(() => new Set(favoritePlayerKeys), [favoritePlayerKeys]);

  const [nextDailyCountdown, setNextDailyCountdown] = useState(null);

  const [showDailyHistoryPanel, setShowDailyHistoryPanel] = useState(() => {
    try {
      const raw = localStorage.getItem(key('nba-mantle-ui-show-daily-history'));
      if (raw === '0') return false;
      if (raw === '1') return true;
      return true;
    } catch {
      return true;
    }
  });
  const [showHardcoreHistoryPanel, setShowHardcoreHistoryPanel] = useState(() => {
    try {
      const raw = localStorage.getItem(key('nba-mantle-ui-show-hardcore-history'));
      if (raw === '0') return false;
      if (raw === '1') return true;
      return true;
    } catch {
      return true;
    }
  });
  const [postWinGlobalDailyAverage, setPostWinGlobalDailyAverage] = useState(null); // { avg, wins } | null
  const [postWinGlobalDailyAverageLoading, setPostWinGlobalDailyAverageLoading] = useState(false);
  const [supabaseDebug, setSupabaseDebug] = useState({ lastSubmitOk: null, lastError: '' });
  const [backendWarming, setBackendWarming] = useState(false);
  const [shakeInput, setShakeInput] = useState(false);
  const [pulseGuessName, setPulseGuessName] = useState(null);
  const [confettiBurstId, setConfettiBurstId] = useState(null);
  const [showFavorites, setShowFavorites] = useState(false);
  const [guessHistorySort, setGuessHistorySort] = useState('score'); // 'score' | 'chronological'

  // API base URL - updated to match your backend
  const API_BASE = 'https://nba-mantle-6-5.onrender.com/api';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timeout);
    }
  };
  const fetchJsonWithRetry = async (url, options = {}, { timeoutMs = 15000, retries = 1, retryDelayMs = 600 } = {}) => {
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchWithTimeout(url, options, timeoutMs);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (attempt < retries) {
          await sleep(retryDelayMs);
          continue;
        }
      }
    }
    throw lastErr || new Error('Request failed');
  };

  const getOrCreateAnalyticsId = () => {
    try {
      const analyticsKey = key('nba-mantle-analytics-id');
      const existing = localStorage.getItem(analyticsKey);
      if (existing) return existing;
      const id =
        (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
          ? globalThis.crypto.randomUUID()
          : `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      localStorage.setItem(analyticsKey, id);
      return id;
    } catch {
      return '';
    }
  };

  const submitCompletionToCloud = async ({ mode, dailyNumber, date, answer, guesses, won }) => {
    try {
      // Best-effort: never block gameplay UI on this.
      const anon_id = getOrCreateAnalyticsId();

      if (!supabase) {
        setSupabaseDebug({ lastSubmitOk: false, lastError: 'Supabase not configured (missing VITE env vars)' });
        return;
      }

      // Frontend-only approach: write directly to Supabase using anon key.
      // Use "ignoreDuplicates" so we don't need UPDATE RLS policies.
      const { error } = await supabase.from('mantle_runs').upsert(
        {
          anon_id,
          mode,
          daily_number: dailyNumber,
          date,
          answer,
          guesses,
          won,
        },
        { onConflict: 'anon_id,mode,daily_number', ignoreDuplicates: true }
      );
      if (error) {
        console.error('Supabase submit error:', error);
        setSupabaseDebug({ lastSubmitOk: false, lastError: error?.message || 'Supabase submit failed' });
      } else {
        setSupabaseDebug({ lastSubmitOk: true, lastError: '' });
      }
    } catch {
      // ignore
    }
  };

  const resetAllLocalDataNow = () => {
    try {
      // Remove all keys we own, across versions, plus the reset marker.
      const markerKey = 'nba-mantle-storage-reset-marker';
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k === markerKey || k.startsWith('nba-mantle-')) {
          localStorage.removeItem(k);
        }
      }
    } catch {}
    try { sessionStorage.clear(); } catch {}
    // Hard reload so React state can't keep stale data
    try { window.location.reload(); } catch {}
  };

  // (intentionally no public "test write" in production UI)

  const fetchGlobalDailyAverage = async ({ mode, dailyNumber }) => {
    // mode: 'daily' | 'hardcore'
    if (!supabase) return null;
    const m = mode === 'hardcore' ? 'hardcore' : 'daily';
    const n = Number(dailyNumber);
    if (!Number.isFinite(n) || n < 1) return null;

    // Simple frontend-only approach (OK for early data): pull guesses and compute avg.
    // Uses count=exact so you still see true win count even if we cap rows.
    const { data, count, error } = await supabase
      .from('mantle_runs')
      .select('guesses', { count: 'exact' })
      .eq('mode', m)
      .eq('daily_number', n)
      .eq('won', true)
      .limit(5000);

    if (error) {
      console.error('Supabase daily avg error:', error);
      return null;
    }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return { avg: null, wins: count ?? 0 };
    const total = rows.reduce((sum, r) => sum + (typeof r?.guesses === 'number' ? r.guesses : 0), 0);
    return { avg: total / rows.length, wins: count ?? rows.length };
  };

  // Cache player name list locally so the UI feels instant on repeat visits.
  // We still refresh from the API in the background.
  const PLAYERS_CACHE_KEY = key('nba-mantle-players-cache');
  const PLAYERS_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
  const readPlayersCache = () => {
    try {
      const raw = localStorage.getItem(PLAYERS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.players)) return null;
      if (typeof parsed?.ts !== 'number') return null;
      if (Date.now() - parsed.ts > PLAYERS_CACHE_TTL_MS) return null;
      return parsed.players;
    } catch {
      return null;
    }
  };
  const writePlayersCache = (players) => {
    try {
      localStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify({ ts: Date.now(), players }));
    } catch {}
  };

  // Cache full players_data locally (this can be large / slower to download).
  // This makes Classic/Easy filtering fast even if the backend is warming up.
  const PLAYERS_DATA_CACHE_KEY = key('nba-mantle-players-data-cache-v2');
  const PLAYERS_DATA_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
  const readPlayersDataCache = () => {
    try {
      const raw = localStorage.getItem(PLAYERS_DATA_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.data !== 'object' || parsed.data === null) return null;
      if (typeof parsed?.ts !== 'number') return null;
      if (Date.now() - parsed.ts > PLAYERS_DATA_CACHE_TTL_MS) return null;
      return parsed.data;
    } catch {
      return null;
    }
  };
  const writePlayersDataCache = (data) => {
    try {
      localStorage.setItem(PLAYERS_DATA_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
  };

  // Fallback modern NBA players (only used if API loading fails)
  const modernPlayers = [
    'LeBron James', 'Stephen Curry', 'Kevin Durant', 'Giannis Antetokounmpo',
    'Luka Dončić', 'Jayson Tatum', 'Joel Embiid', 'Nikola Jokić', 'Damian Lillard',
    'Jimmy Butler', 'Kawhi Leonard', 'Anthony Davis', 'Russell Westbrook',
    'James Harden', 'Chris Paul', 'Klay Thompson', 'Draymond Green',
    'Paul George', 'Kyrie Irving', 'Bradley Beal', 'Devin Booker',
    'Donovan Mitchell', 'Ja Morant', 'Trae Young', 'Zion Williamson',
    'Pascal Siakam', 'Bam Adebayo', 'Jaylen Brown', 'Tyler Herro'
  ];

  // Daily mode: one puzzle per day (seeded by calendar). Same puzzle for everyone globally.
  // Use UTC so the day index is the same for everyone regardless of timezone.
  const getDailyPuzzleIndex = () => {
    const epoch = new Date(DAILY_PUZZLE_EPOCH + 'T00:00:00.000Z').getTime();
    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.max(0, Math.floor((todayUTC - epoch) / 86400000));
  };
  const getDailyPlayerForIndex = (index) =>
    DAILY_PLAYERS[index % DAILY_PLAYERS.length] ?? DAILY_PLAYERS[0];
  const getBallKnowledgeDailyPlayer = (index) =>
    BALL_KNOWLEDGE_DAILY_PLAYERS[index % BALL_KNOWLEDGE_DAILY_PLAYERS.length] ?? BALL_KNOWLEDGE_DAILY_PLAYERS[0];

  // Allow playing a past daily by selecting a specific day index.
  // This affects Daily + Ball Knowledge Daily (same calendar).
  const [selectedDailyIndexOverride, setSelectedDailyIndexOverride] = useState(null); // number | null
  const [showPastDailyPicker, setShowPastDailyPicker] = useState(false);
  const todayDailyIndex = getDailyPuzzleIndex();
  const activeDailyIndex =
    (gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && selectedDailyIndexOverride != null
      ? selectedDailyIndexOverride
      : todayDailyIndex;
  const activeDailyNumber = activeDailyIndex + 1;
  const isPastDailySelected = activeDailyIndex !== todayDailyIndex;

  const formatHMS = useCallback((ms) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }, []);

  const getISODateForDailyIndex = (index) => {
    try {
      const epochUTC = Date.UTC(
        Number(DAILY_PUZZLE_EPOCH.slice(0, 4)),
        Number(DAILY_PUZZLE_EPOCH.slice(5, 7)) - 1,
        Number(DAILY_PUZZLE_EPOCH.slice(8, 10))
      );
      const d = new Date(epochUTC + index * 86400000);
      return d.toISOString().slice(0, 10);
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  };

  // Next daily puzzle time (UTC midnight rollover).
  useEffect(() => {
    const isDailyMode = gameMode === 'daily' || gameMode === 'ballKnowledgeDaily';
    if (!isDailyMode) {
      setNextDailyCountdown(null);
      return;
    }

    const tick = () => {
      const now = new Date();
      const nextUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
      setNextDailyCountdown(formatHMS(nextUtcMidnight.getTime() - now.getTime()));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [gameMode, formatHMS]);

  // Past daily mantles: keyed by daily number, value = { date, guesses, guessHistory, won, answer, top5 }
  // Once you play a daily (win or lose), you can't play it again.
  const DAILY_COMPLETIONS_KEY = key('nba-mantle-daily-completions');
  const getDailyCompletionsFromStorage = () => {
    try {
      const raw = localStorage.getItem(DAILY_COMPLETIONS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const out = {};
      for (const [num, val] of Object.entries(parsed)) {
        if (typeof val === 'string') {
          out[num] = { date: val, guesses: null, guessHistory: [], won: true, answer: '', top5: [] };
        } else {
          const arr = Array.isArray(val?.guessHistory) ? val.guessHistory : [];
          const top5 = Array.isArray(val?.top5) ? val.top5 : [];
          out[num] = { date: val?.date ?? '', guesses: val?.guesses ?? null, guessHistory: arr, won: val?.won !== false, answer: val?.answer ?? '', top5 };
        }
      }
      return out;
    } catch {
      return {};
    }
  };
  const saveDailyCompletionToStorage = (dailyNumber, dateStr, guesses = null, guessHistory = [], won = true, answer = '', top5 = []) => {
    const prev = getDailyCompletionsFromStorage();
    const next = { ...prev, [String(dailyNumber)]: { date: dateStr, guesses, guessHistory, won, answer, top5 } };
    try {
      localStorage.setItem(DAILY_COMPLETIONS_KEY, JSON.stringify(next));
    } catch {}
    return next;
  };

  const [dailyCompletions, setDailyCompletions] = useState({});
  const [selectedDailyDetail, setSelectedDailyDetail] = useState(null);
  // Lock out replaying any daily that already has a saved completion (today or past).
  const dailyAlreadyPlayed = gameMode === 'daily' && dailyCompletions[String(activeDailyNumber)] != null;

  const BALL_KNOWLEDGE_DAILY_KEY = key('nba-mantle-ball-knowledge-daily');
  const getBallKnowledgeDailyFromStorage = () => {
    try {
      const raw = localStorage.getItem(BALL_KNOWLEDGE_DAILY_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const out = {};
      for (const [num, val] of Object.entries(parsed)) {
        if (typeof val === 'string') {
          out[num] = { date: val, guesses: null, guessHistory: [], won: true, answer: '', top5: [] };
        } else {
          const arr = Array.isArray(val?.guessHistory) ? val.guessHistory : [];
          const top5 = Array.isArray(val?.top5) ? val.top5 : [];
          out[num] = { date: val?.date ?? '', guesses: val?.guesses ?? null, guessHistory: arr, won: val?.won !== false, answer: val?.answer ?? '', top5 };
        }
      }
      return out;
    } catch {
      return {};
    }
  };
  const saveBallKnowledgeDailyToStorage = (dailyNumber, dateStr, guesses = null, guessHistory = [], won = true, answer = '', top5 = []) => {
    const prev = getBallKnowledgeDailyFromStorage();
    const next = { ...prev, [String(dailyNumber)]: { date: dateStr, guesses, guessHistory, won, answer, top5 } };
    try {
      localStorage.setItem(BALL_KNOWLEDGE_DAILY_KEY, JSON.stringify(next));
    } catch {}
    return next;
  };
  const [ballKnowledgeDailyCompletions, setBallKnowledgeDailyCompletions] = useState({});
  const [selectedBallKnowledgeDetail, setSelectedBallKnowledgeDetail] = useState(null);
  // Lock out replaying any hardcore daily that already has a saved completion (today or past).
  const ballKnowledgeDailyAlreadyPlayed = gameMode === 'ballKnowledgeDaily' && ballKnowledgeDailyCompletions[String(activeDailyNumber)] != null;
  useEffect(() => {
    // Ensure a true "start fresh" on new reset versions (and avoid Fast Refresh keeping old state).
    try {
      const markerKey = 'nba-mantle-storage-reset-marker';
      const prevMarker = localStorage.getItem(markerKey);

      if (prevMarker !== STORAGE_RESET_VERSION) {
        const oldKeys = [
          'nba-mantle-ui-show-daily-history',
          'nba-mantle-ui-show-hardcore-history',
          'nba-mantle-ui-show-averages',
          'nba-mantle-ui-averages-scope',
          'nba-mantle-analytics-id-v1',
          'nba-mantle-players-cache-v1',
          'nba-mantle-daily-completions-v12',
          'nba-mantle-ball-knowledge-daily-v1',
        ];
        for (const k of oldKeys) localStorage.removeItem(k);

        // Clear other known nba-mantle keys from prior versions.
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (k.startsWith('nba-mantle-') && !k.endsWith(`-${STORAGE_RESET_VERSION}`) && k !== markerKey) {
            localStorage.removeItem(k);
          }
        }

        localStorage.setItem(markerKey, STORAGE_RESET_VERSION);
      }
    } catch {}

    // Now load post-reset values
    setDailyCompletions(getDailyCompletionsFromStorage());
    setBallKnowledgeDailyCompletions(getBallKnowledgeDailyFromStorage());
  }, []);

  const resetPuzzleState = () => {
    setGuess('');
    setGuessHistory([]);
    setGameWon(false);
    setGuessCount(0);
    setError('');
    setTop5Players([]);
    setShowAnswer(false);
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
    setPostWinGlobalDailyAverage(null);
    setPostWinGlobalDailyAverageLoading(false);
    bestPrevRef.current = null;
    setBestSoFar(null);
    setBestDelta(null);
  };

  // Persist favorites so they survive refresh.
  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoritePlayerKeys));
    } catch {}
  }, [favoritePlayerKeys, FAVORITES_KEY]);

  // Track best score (+delta when it improves).
  useEffect(() => {
    if (!Array.isArray(guessHistory) || guessHistory.length === 0) {
      setBestSoFar(null);
      setBestDelta(null);
      bestPrevRef.current = null;
      return;
    }
    const bestNow = Math.max(...guessHistory.map((g) => (typeof g?.score === 'number' ? g.score : -Infinity)));
    const prevBest = bestPrevRef.current;
    setBestSoFar(bestNow);
    if (typeof prevBest === 'number' && bestNow > prevBest) {
      setBestDelta(bestNow - prevBest);
    } else {
      setBestDelta(null);
    }
    bestPrevRef.current = bestNow;
  }, [guessHistory]);

  const getActiveCompletionEntry = () => {
    if (gameMode === 'daily') return dailyCompletions[String(activeDailyNumber)] ?? null;
    if (gameMode === 'ballKnowledgeDaily') return ballKnowledgeDailyCompletions[String(activeDailyNumber)] ?? null;
    return null;
  };

  const getEndScreenModel = () => {
    const completion = getActiveCompletionEntry();
    const completionWon = typeof completion === 'object' && completion != null ? completion?.won !== false : false;
    const completionGuesses = typeof completion === 'object' && completion != null ? completion?.guesses ?? null : null;
    const completionAnswer = typeof completion === 'object' && completion != null ? completion?.answer ?? '' : '';

    const isDailyMode = gameMode === 'daily' || gameMode === 'ballKnowledgeDaily';
    if (!isDailyMode) {
      if (gameWon) {
        return { state: 'won', answer: targetPlayer, guesses: guessCount, canShare: true, canReveal: false, completionKey: null };
      }
      if (showAnswer) {
        return { state: 'revealed', answer: targetPlayer, guesses: null, canShare: false, canReveal: false, completionKey: null };
      }
      return null;
    }

    if (dailyAlreadyPlayed || ballKnowledgeDailyAlreadyPlayed) {
      if (completionWon) {
        return { state: 'won', answer: completionAnswer || targetPlayer, guesses: completionGuesses, canShare: true, canReveal: false, completionKey: String(activeDailyNumber) };
      }
      return { state: 'revealed', answer: completionAnswer || targetPlayer, guesses: null, canShare: false, canReveal: false, completionKey: String(activeDailyNumber) };
    }

    if (gameWon) {
      return { state: 'won', answer: targetPlayer, guesses: guessCount, canShare: true, canReveal: false, completionKey: null };
    }
    if (showAnswer) {
      return { state: 'revealed', answer: targetPlayer, guesses: null, canShare: false, canReveal: false, completionKey: null };
    }
    return null;
  };

  // Sync daily targets when you pick a past day (this was the main "past mantles" bug).
  useEffect(() => {
    if (gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily') return;
    const correctTarget =
      gameMode === 'daily'
        ? getDailyPlayerForIndex(activeDailyIndex)
        : getBallKnowledgeDailyPlayer(activeDailyIndex);
    setTargetPlayer(correctTarget);
    fetchTargetMaxSimilarity(correctTarget);
    resetPuzzleState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameMode, activeDailyIndex]);

  // If the selected daily is already completed, restore its end-state (including Top 5).
  useEffect(() => {
    if (gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily') return;
    const completion = getActiveCompletionEntry();
    if (!completion) return;

    const restoredHistory = Array.isArray(completion?.guessHistory) ? completion.guessHistory : [];
    setGuessHistory(restoredHistory);
    setGuessCount(typeof completion?.guesses === 'number' ? completion.guesses : restoredHistory.length);

    const won = completion?.won !== false;
    setGameWon(won);
    setShowAnswer(!won);

    const top5 = Array.isArray(completion?.top5) ? completion.top5 : [];
    if (top5.length) {
      setTop5Players(top5);
      return;
    }

    // Fallback: if older saves don't have top5, re-fetch it based on answer/target.
    const answer = completion?.answer || targetPlayer;
    if (!answer) return;
    // Important: protect against async responses from the *previous* daily mode/daily.
    // This prevents showing Daily Top 5 on Ball Knowledge Daily after a quick switch.
    let cancelled = false;
    const modeAtStart = gameMode;
    const activeDailyNumberAtStart = activeDailyNumber;
    (async () => {
      try {
        const result = await fetchJsonWithRetry(
          `${API_BASE}/guess`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ guess: answer, target: answer }),
          },
          { timeoutMs: 25000, retries: 1, retryDelayMs: 800 }
        );
        const fetchedTop5 = Array.isArray(result?.top_5) ? result.top_5 : [];
        if (cancelled) return;
        if (modeAtStart !== gameMode) return;
        if (activeDailyNumberAtStart !== activeDailyNumber) return;
        if (fetchedTop5.length) setTop5Players(fetchedTop5);
      } catch {}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameMode, activeDailyNumber, dailyAlreadyPlayed, ballKnowledgeDailyAlreadyPlayed]);

  // After a win (or when viewing a completed daily), show global average guesses for this daily (if available).
  useEffect(() => {
    if (!targetPlayer) return;
    if (gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily') return;
    if (!gameWon && !dailyAlreadyPlayed && !ballKnowledgeDailyAlreadyPlayed) return;
    let cancelled = false;
    const run = async () => {
      setPostWinGlobalDailyAverageLoading(true);
      try {
        if (cancelled) return;
        const modeKey = gameMode === 'ballKnowledgeDaily' ? 'hardcore' : 'daily';
        const result = await fetchGlobalDailyAverage({ mode: modeKey, dailyNumber: activeDailyNumber });
        if (cancelled) return;
        setPostWinGlobalDailyAverage(result);
      } catch {
        setPostWinGlobalDailyAverage(null);
      } finally {
        if (!cancelled) setPostWinGlobalDailyAverageLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameWon, dailyAlreadyPlayed, ballKnowledgeDailyAlreadyPlayed, targetPlayer, gameMode, activeDailyNumber]);

  // Auto-dismiss confetti after a win.
  useEffect(() => {
    if (!confettiBurstId) return;
    const id = setTimeout(() => setConfettiBurstId(null), 3600);
    return () => clearTimeout(id);
  }, [confettiBurstId]);

  const filterPlayersForMode = (players, playerData, mode) => {
    if (mode === 'all' || mode === 'daily' || mode === 'ballKnowledgeDaily') {
      return players;
    }

    return players.filter(playerName => {
      const player = playerData[playerName];

      if (mode === 'easy') {
        // All Stars 1986 or Later: use cleaned list from allStarPlayers.js only
        return isAllStarPlayerName(playerName);
      }

      if (!player) {
        return false;
      }

      const startYear = player.start_year || 0;
      const seasonsCount = player.seasons_count || player.career_length || 0;

      if (mode === 'classic') {
        // Classic mode: 2011+ debut with 6+ seasons
        return startYear >= 2011 && seasonsCount >= 6;
      }

      return true;
    });
  };

  const fetchTargetMaxSimilarity = async (playerName) => {
    if (!playerName) {
      setTargetMaxSimilar(null);
      setPrefetchedTargetTop5([]);
      setPrefetchedTargetTop5Loading(false);
      setPrefetchedTargetTop5For(null);
      return;
    }

    try {
      // Clear any stale prefetched values until this request finishes.
      setPrefetchedTargetTop5For(playerName);
      setPrefetchedTargetTop5([]);
      setPrefetchedTargetTop5Loading(true);
      const result = await fetchJsonWithRetry(
        `${API_BASE}/guess`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            guess: playerName,
            target: playerName,
          }),
        },
        { timeoutMs: 20000, retries: 1, retryDelayMs: 700 }
      );

      const top5 = result?.top_5 || [];
      setPrefetchedTargetTop5(Array.isArray(top5) ? top5 : []);
      if (Array.isArray(top5) && top5.length > 0) {
        const [, score] = top5[0];
        setTargetMaxSimilar(typeof score === 'number' ? score : null);
      } else {
        setTargetMaxSimilar(null);
      }
    } catch (e) {
      setTargetMaxSimilar(null);
      setPrefetchedTargetTop5([]);
      setPrefetchedTargetTop5For(null);
    } finally {
      setPrefetchedTargetTop5Loading(false);
    }
  };

  const startNewGame = () => {
    let chosenPlayer;
    if (gameMode === 'daily') {
      // Respect past-daily selection (if any)
      chosenPlayer = getDailyPlayerForIndex(activeDailyIndex);
      setTargetPlayer(chosenPlayer);
      fetchTargetMaxSimilarity(chosenPlayer);
    } else if (gameMode === 'ballKnowledgeDaily') {
      // Respect past-daily selection (if any)
      chosenPlayer = getBallKnowledgeDailyPlayer(activeDailyIndex);
      setTargetPlayer(chosenPlayer);
      fetchTargetMaxSimilarity(chosenPlayer);
    } else {
      // Don't use full list fallback for All Stars Only when backend hasn't provided is_all_star
      const playersToUse = filteredPlayers.length > 0
        ? filteredPlayers
        : gameMode === 'easy'
          ? []
          : modernPlayers;
      if (playersToUse.length === 0) return;
      chosenPlayer = playersToUse[Math.floor(Math.random() * playersToUse.length)];
      setTargetPlayer(chosenPlayer);
      fetchTargetMaxSimilarity(chosenPlayer);
    }
    resetPuzzleState();
    console.log('New game started with:', chosenPlayer, 'Mode:', gameMode);
  };

  const handleModeChange = (newMode) => {
    setGameMode(newMode);
    
    // Filter players based on new mode
    const filtered = filterPlayersForMode(allPlayers, playersData, newMode);
    setFilteredPlayers(filtered);
    
    // Start a new game with the new mode (or clear target if no players for this mode)
    if (filtered.length > 0) {
      const target =
        newMode === 'daily'
          ? getDailyPlayerForIndex(selectedDailyIndexOverride != null ? selectedDailyIndexOverride : getDailyPuzzleIndex())
          : newMode === 'ballKnowledgeDaily'
          ? getBallKnowledgeDailyPlayer(selectedDailyIndexOverride != null ? selectedDailyIndexOverride : getDailyPuzzleIndex())
          : filtered[Math.floor(Math.random() * filtered.length)];
      setTargetPlayer(target);
      fetchTargetMaxSimilarity(target);
    } else {
      setTargetPlayer('');
      setTargetMaxSimilar(null);
    }
    
    // Reset game state
    setGuess('');
    setGuessHistory([]);
    setGameWon(false);
    setGuessCount(0);
    setError('');
    setTop5Players([]);
    setShowAnswer(false);
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
    
    console.log('Mode changed to:', newMode, 'Players available:', filtered.length);
  };

  useEffect(() => {
    const loadPlayerNames = async () => {
      // 1) Render instantly from cache (if present), then refresh from API.
      const cached = readPlayersCache();
      if (cached?.length) {
        const sortedCached = [...cached].sort();
        setAllPlayers(sortedCached);
        setFilteredPlayers(filterPlayersForMode(sortedCached, playersData, gameMode));
      }

      // 1b) Render instantly from players_data cache (if present).
      const cachedPlayersData = readPlayersDataCache();
      if (cachedPlayersData) {
        setPlayersData(cachedPlayersData);
        if (cached?.length) {
          setFilteredPlayers((prev) => {
            const base = cached?.length ? [...cached].sort() : prev;
            const filtered = filterPlayersForMode(base, cachedPlayersData, gameMode);
            return filtered.length ? filtered : base;
          });
        }
      }

      try {
        // 2) Load player names (fast endpoint) and update UI immediately.
        setBackendWarming(true);
        let playerNames = null;
        try {
          playerNames = await fetchJsonWithRetry(`${API_BASE}/players`, {}, { timeoutMs: 9000, retries: 1, retryDelayMs: 700 });
        } catch {
          playerNames = await fetchJsonWithRetry(`${API_BASE}/player_awards`, {}, { timeoutMs: 9000, retries: 1, retryDelayMs: 700 });
        } finally {
          setBackendWarming(false);
        }
        writePlayersCache(playerNames);
        const sortedPlayers = [...playerNames].sort();
        setAllPlayers(sortedPlayers);

        // Without players_data, keep the app playable using all names.
        setFilteredPlayers(sortedPlayers);
        const initialTarget =
          gameMode === 'daily'
            ? getDailyPlayerForIndex(activeDailyIndex)
            : gameMode === 'ballKnowledgeDaily'
            ? getBallKnowledgeDailyPlayer(activeDailyIndex)
            : sortedPlayers[Math.floor(Math.random() * sortedPlayers.length)];
        setTargetPlayer(initialTarget);
        fetchTargetMaxSimilarity(initialTarget);

        // 3) Load full players_data in the background (improves classic/easy filtering).
        (async () => {
          try {
            const fullData = await fetchJsonWithRetry(
              `${API_BASE}/players_data?v=2`,
              {},
              { timeoutMs: 20000, retries: 1, retryDelayMs: 900 }
            );
            if (!fullData) return;
            setPlayersData(fullData);
            writePlayersDataCache(fullData);

            const filtered = filterPlayersForMode(sortedPlayers, fullData, gameMode);
            setFilteredPlayers(filtered.length ? filtered : sortedPlayers);

            // If current mode relies on players_data (classic/easy), ensure the target is valid.
            if (gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily' && gameMode !== 'all') {
              const pool = filtered.length ? filtered : sortedPlayers;
              setTargetPlayer((prev) => (pool.includes(prev) ? prev : pool[Math.floor(Math.random() * pool.length)]));
            }
          } catch {
            // ignore (keep gameplay usable without fullData)
          }
        })();
      } catch (error) {
        setBackendWarming(false);
        console.error('Could not load players from API, using fallback:', error);
        const fallback = modernPlayers;
        setAllPlayers(fallback);
        setFilteredPlayers(fallback);
        const target = gameMode === 'daily' ? getDailyPlayerForIndex(activeDailyIndex) : gameMode === 'ballKnowledgeDaily' ? getBallKnowledgeDailyPlayer(activeDailyIndex) : fallback[Math.floor(Math.random() * fallback.length)];
        setTargetPlayer(target);
        fetchTargetMaxSimilarity(target);
      }

      setGuess('');
      setGuessHistory([]);
      setGameWon(false);
      setGuessCount(0);
      setError('');
      setTop5Players([]);
      setShowAnswer(false);
      setSuggestions([]);
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    };

    loadPlayerNames();
  }, []);

  // Load player headshots (from public/player-images.json, built by scripts/fetch-nba-player-images.js)
  useEffect(() => {
    let cancelled = false;
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '';
    fetch((base ? base + '/' : '/') + 'player-images.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const byNormalized = {};
        for (const [name, entry] of Object.entries(data)) {
          if (!entry || !entry.imageUrl) continue;
          byNormalized[name] = entry;
          byNormalized[normalizePlayerName(name)] = entry;
        }
        setPlayerImagesMap(byNormalized);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const getPlayerImage = (name) => {
    if (!name || !playerImagesMap) return null;
    const entry = playerImagesMap[name] ?? playerImagesMap[normalizePlayerName(name)];
    return entry?.imageUrl ?? null;
  };

  const getPlayerInitials = (name) => {
    const safe = String(name || '').trim();
    if (!safe) return 'NB';
    const parts = safe.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '';
    const last = (parts.length > 1 ? parts[parts.length - 1]?.[0] : parts[0]?.[1]) ?? '';
    const initials = `${first}${last}`.toUpperCase();
    return initials || 'NB';
  };

  const renderPlayerAvatar = (name, { size = 40, radius = 8 } = {}) => {
    const img = getPlayerImage(name);
    if (img) {
      return (
        <img
          src={img}
          alt={`${name} headshot`}
          loading="lazy"
          decoding="async"
          style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', flexShrink: 0 }}
        />
      );
    }

    return (
      <div
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: 'rgba(59, 130, 246, 0.18)',
          border: '1px solid rgba(59, 130, 246, 0.35)',
          display: 'grid',
          placeItems: 'center',
          color: '#e0f2fe',
          fontWeight: 900,
          fontSize: Math.max(11, Math.round(size * 0.28)),
          textTransform: 'uppercase'
        }}
      >
        {getPlayerInitials(name)}
      </div>
    );
  };

  const isFavoritePlayer = (name) => {
    if (!name) return false;
    return favoritePlayerKeySet.has(normalizePlayerName(name));
  };

  const toggleFavoritePlayer = (name) => {
    if (!name) return;
    const k = normalizePlayerName(name);
    setFavoritePlayerKeys((prev) => {
      if (prev.includes(k)) return prev.filter((x) => x !== k);
      return [...prev, k];
    });
  };

  const triggerInputShake = () => {
    setShakeInput(true);
    setTimeout(() => setShakeInput(false), 440);
  };

  const makeGuess = async () => {
    if (!guess.trim()) return;
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(-1);
    setLoading(true);
    setError('');

    try {
      const result = await fetchJsonWithRetry(
        `${API_BASE}/guess`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            guess: guess.trim(),
            target: targetPlayer,
          }),
        },
        { timeoutMs: 25000, retries: 1, retryDelayMs: 800 }
      );

      const { score, matched_name, breakdown, top_5 } = result;

        const newGuess = {
          name: matched_name || guess.trim(),
          score: score,
          breakdown: breakdown || {}
        };

        const alreadyGuessed = guessHistory.some(g => g.name === newGuess.name);
        
        if (!alreadyGuessed) {
          setPulseGuessName(newGuess.name);
          setTimeout(() => setPulseGuessName(null), 900);

          setGuessHistory(prev => {
            const updated = [...prev, newGuess];
            return updated;
          });

          const newCount = guessCount + 1;
          setGuessCount(prev => prev + 1);

          if (score === 100) {
            setGameWon(true);
            setConfettiBurstId(Date.now());
            const canUsePrefetchedTop5 =
              prefetchedTargetTop5For === targetPlayer && Array.isArray(prefetchedTargetTop5) && prefetchedTargetTop5.length > 0;
            setTop5Players((top_5 && top_5.length) ? top_5 : (canUsePrefetchedTop5 ? prefetchedTargetTop5 : []));
            if (gameMode === 'daily') {
              const dateStr = getISODateForDailyIndex(activeDailyIndex);
              const fullHistory = [...guessHistory, newGuess].map((g) => ({ name: g.name, score: g.score }));
              if (!isPastDailySelected || dailyCompletions[String(activeDailyNumber)] == null) {
                const top5ToStore = (top_5 && top_5.length) ? top_5 : (canUsePrefetchedTop5 ? prefetchedTargetTop5 : []);
                const next = saveDailyCompletionToStorage(activeDailyNumber, dateStr, newCount, fullHistory, true, targetPlayer, top5ToStore);
                setDailyCompletions(next);
                submitCompletionToCloud({ mode: 'daily', dailyNumber: activeDailyNumber, date: dateStr, answer: targetPlayer, guesses: newCount, won: true });
              }
            } else if (gameMode === 'ballKnowledgeDaily') {
              const dateStr = getISODateForDailyIndex(activeDailyIndex);
              const fullHistory = [...guessHistory, newGuess].map((g) => ({ name: g.name, score: g.score }));
              if (!isPastDailySelected || ballKnowledgeDailyCompletions[String(activeDailyNumber)] == null) {
                const top5ToStore = (top_5 && top_5.length) ? top_5 : (canUsePrefetchedTop5 ? prefetchedTargetTop5 : []);
                const next = saveBallKnowledgeDailyToStorage(activeDailyNumber, dateStr, newCount, fullHistory, true, targetPlayer, top5ToStore);
                setBallKnowledgeDailyCompletions(next);
                submitCompletionToCloud({ mode: 'hardcore', dailyNumber: activeDailyNumber, date: dateStr, answer: targetPlayer, guesses: newCount, won: true });
              }
            }
          }
        } else {
          setError('You have already guessed this player!');
          triggerInputShake();
        }

        setGuess('');
    } catch (err) {
      setError(backendWarming ? 'Waking up the server… try again in a moment.' : 'Connection error. Please check your internet connection and try again.');
      console.error('API Error:', err);
    }

    setLoading(false);
  };

  const revealAnswer = async () => {
    if (!targetPlayer) return;
    
    setLoading(true);
    let top5Now = [];
    try {
      if (prefetchedTargetTop5For === targetPlayer && Array.isArray(prefetchedTargetTop5) && prefetchedTargetTop5.length > 0) {
        top5Now = prefetchedTargetTop5;
      } else {
        const result = await fetchJsonWithRetry(
          `${API_BASE}/guess`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({
              guess: targetPlayer,
              target: targetPlayer,
            }),
          },
          { timeoutMs: 25000, retries: 1, retryDelayMs: 800 }
        );
        top5Now = Array.isArray(result?.top_5) ? result.top_5 : [];
      }
    } catch (err) {
      console.error('Error fetching top 5:', err);
    }

    setTop5Players(top5Now);
    
    setShowAnswer(true);
    if (gameMode === 'daily') {
      const dateStr = getISODateForDailyIndex(activeDailyIndex);
      const history = guessHistory.map((g) => ({ name: g.name, score: g.score }));
      if (!isPastDailySelected || dailyCompletions[String(activeDailyNumber)] == null) {
        const next = saveDailyCompletionToStorage(activeDailyNumber, dateStr, guessCount, history, false, targetPlayer, top5Now || []);
        setDailyCompletions(next);
        submitCompletionToCloud({ mode: 'daily', dailyNumber: activeDailyNumber, date: dateStr, answer: targetPlayer, guesses: guessCount, won: false });
      }
    } else if (gameMode === 'ballKnowledgeDaily') {
      const dateStr = getISODateForDailyIndex(activeDailyIndex);
      const history = guessHistory.map((g) => ({ name: g.name, score: g.score }));
      if (!isPastDailySelected || ballKnowledgeDailyCompletions[String(activeDailyNumber)] == null) {
        const next = saveBallKnowledgeDailyToStorage(activeDailyNumber, dateStr, guessCount, history, false, targetPlayer, top5Now || []);
        setBallKnowledgeDailyCompletions(next);
        submitCompletionToCloud({ mode: 'hardcore', dailyNumber: activeDailyNumber, date: dateStr, answer: targetPlayer, guesses: guessCount, won: false });
      }
    }
    setLoading(false);
  };

  const handleSuggestionSelect = (selectedName) => {
    setGuess(selectedName);
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
  };

  const copyToClipboardBestEffort = async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const handleShare = async (override) => {
    const mode = override?.mode ?? gameMode;
    const dailyNumber = override?.dailyNumber ?? activeDailyNumber;
    const answer = override?.answer ?? targetPlayer;
    const guesses = override?.guesses ?? guessCount;
    if (!answer) return;

    const shareText =
      mode === 'daily'
        ? `🏀 I got the daily NBA Mantle #${dailyNumber} in ${guesses} guesses! Show me what you got 👉 https://nba-deployment.vercel.app/`
        : mode === 'hardcore' || mode === 'ballKnowledgeDaily'
        ? `🏀 I got Hardcore Daily #${dailyNumber} in ${guesses} guesses! Show me what you got 👉 https://nba-deployment.vercel.app/`
        : (() => {
            const modeLabel =
              mode === 'classic'
                ? 'Classic'
                : mode === 'easy'
                ? 'All Stars 1986 or Later'
                : 'All Players';
            return `🏀 I guessed ${answer} in ${guesses} guesses on NBA Mantle (${modeLabel} mode)! Think you know ball? Try it here 👉 https://nba-deployment.vercel.app/`;
          })();

    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
        return;
      }
    } catch {
      // fall back to clipboard
    }

    const copied = await copyToClipboardBestEffort(shareText);
    if (copied) {
      setShowCopyToast(true);
      setTimeout(() => setShowCopyToast(false), 2500);
    } else {
      setError('Could not share/copy. Please copy manually.');
    }
  };

  const getScoreColor = (score) => {
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    if (score >= 40) return '#f97316';
    return '#ef4444';
  };

  const ScoreBar = ({ score, showLabel = true, animate = false }) => {
    const percentage = Math.max(0, Math.min(100, score));
    const color = getScoreColor(score);
    
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
        <div className={animate ? 'nm-scorebar-animate' : ''}>
          <div className="nm-scorebar-track">
            <div
              className="nm-scorebar-fill"
              style={{
                width: `${percentage}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${color}dd, ${color})`,
                boxShadow: `0 0 10px ${color}40`,
                transition: 'width 0.3s ease',
                transform: 'translateZ(0)'
              }}
            />
            {showLabel && (
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  color: percentage > 30 ? 'white' : color,
                  textShadow: percentage > 30 ? '0 1px 2px rgba(0,0,0,0.8)' : 'none',
                  fontWeight: 'bold',
                  fontSize: '12px'
                }}
              >
                {score}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            color: color,
            fontWeight: 'bold',
            fontSize: '12px',
            minWidth: '40px'
          }}
        >
          {score}/100
        </div>
      </div>
    );
  };

  const escapeRegExp = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const renderHighlightedName = (name, query) => {
    const text = String(name || '');
    const q = String(query || '').trim();
    if (!q) return text;

    const safe = escapeRegExp(q);
    const re = new RegExp(`(${safe})`, 'ig');
    if (!re.test(text)) return text;
    re.lastIndex = 0;

    const parts = text.split(re);
    const qLower = q.toLowerCase();
    return parts.map((part, idx) => {
      const isMatch = part.toLowerCase() === qLower;
      return isMatch ? (
        <span key={`${part}-${idx}`} style={{ color: '#93c5fd', fontWeight: 900 }}>
          {part}
        </span>
      ) : (
        <span key={`${part}-${idx}`}>{part}</span>
      );
    });
  };

  const ConfettiBurst = () => {
    const pieces = useMemo(() => {
      const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a78bfa', '#06b6d4', '#f472b6'];
      const count = 120;
      return Array.from({ length: count }).map((_, i) => {
        const x = Math.random() * 100;
        const dx = (Math.random() * 200 - 100) * 0.9; // px
        const dy = 420 + Math.random() * 520; // px
        const rot = Math.random() * 720 - 360; // deg
        const c = colors[i % colors.length];
        const delay = Math.random() * 180; // ms
        const w = 4 + Math.random() * 6;
        const h = 8 + Math.random() * 10;
        return { x, dx, dy, rot, c, delay, w, h };
      });
    }, []);

    return (
      <div className="nm-confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <span
            key={i}
            className="nm-confetti-piece"
            style={{
              left: `${p.x}%`,
              width: `${p.w}px`,
              height: `${p.h}px`,
              ['--x']: `${p.dx}px`,
              ['--y']: `${p.dy}px`,
              ['--rot']: `${p.rot}deg`,
              ['--c']: p.c,
              ['--d']: `${p.delay}ms`,
            }}
          />
        ))}
      </div>
    );
  };

  const formatBreakdownKey = (key) => {
    const labels = {
      shared_seasons: 'Shared Seasons on Same Team',
      shared_teammates: 'Shared Teammates',
      shared_teams: 'Shared Franchises',
      position_match: 'Position Similarity',
      era_similarity: 'Era Overlap',
      career_length_similarity: 'Career Length Similarity',
      all_star_overlap: 'All-Star Overlap',
      all_nba_overlap: 'All-NBA Overlap',
      all_defense_overlap: 'All-Defense Overlap',
      all_rookie_overlap: 'All-Rookie Overlap',
      award_overlap: 'Award Overlap',
      // Legacy keys kept for backwards compatibility
      shared_streak_bonus: 'Consecutive Seasons Bonus',
      team_tenure: 'Tenure Bonus',
      start_year_diff: 'Draft Era',
      shared_all_star: 'All-Star',
      shared_all_team: 'All-Team',
      all_team_overlap: 'All-Team Overlap',
      shared_awards: 'Awards'
    };
    return labels[key] || key.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: [
        // subtle vignette
        'radial-gradient(900px 520px at 50% 15%, rgba(0, 0, 0, 0.22), transparent 60%)',
        // hardwood grain lines
        'repeating-linear-gradient(90deg, rgba(0,0,0,0.10) 0px, rgba(0,0,0,0.10) 2px, rgba(0,0,0,0.00) 2px, rgba(0,0,0,0.00) 40px)',
        // warm wood base
        'linear-gradient(135deg, #2b170a 0%, #5b3418 28%, #8a5a2b 55%, #b47c3c 78%, #8a5a2b 100%)',
      ].join(', '),
      color: 'white',
      fontFamily: 'inherit'
    }}>
      {/* Copy-to-clipboard toast */}
      {showCopyToast && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#16a34a',
            color: 'white',
            padding: '10px 18px',
            borderRadius: '999px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
            fontSize: '0.9rem',
            fontWeight: 'bold',
            zIndex: 60,
          }}
        >
          ✅ Share message copied to clipboard
        </div>
      )}

      {confettiBurstId && <ConfettiBurst key={confettiBurstId} burstId={confettiBurstId} />}

      <div className="game-content-wrapper" style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
        {/* Header */}
        <div className="game-header" style={{ 
          background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.82), rgba(30, 41, 59, 0.72))',
          borderRadius: '12px',
          padding: '18px',
          marginBottom: '24px',
          textAlign: 'center',
          border: '1px solid rgba(255, 255, 255, 0.10)',
          backdropFilter: 'blur(6px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '18px' }}>
            <span style={{ fontSize: '32px' }}>🏀</span>
            <h1 style={{ fontSize: '2.5rem', fontWeight: 900, margin: 0, letterSpacing: '0.5px', background: 'linear-gradient(45deg, #fbbf24, #fb7185)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>NBA Mantle</h1>
            <span style={{ fontSize: '32px' }}>🎯</span>
          </div>

          <p style={{ color: '#94a3b8', margin: '0 auto 10px', fontSize: '1.06rem', lineHeight: 1.35, maxWidth: '62ch' }}>
            Guess the mystery NBA player by finding similar players. Daily puzzle and unlimited free play modes.
          </p>
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.88rem', margin: '0 auto 18px', lineHeight: 1.3, maxWidth: '62ch' }}>
            Data is current through the <strong>2024–2025</strong> NBA season (no current season yet).
          </div>

          <div style={{ minHeight: '26px', marginBottom: '16px' }}>
            <p style={{ color: '#f59e0b', margin: 0, fontSize: '0.95rem', opacity: targetMaxSimilar != null ? 1 : 0.55 }}>
              {targetMaxSimilar != null ? (
                <>
                  The closest any other player gets to this mystery player is about{' '}
                  <span style={{ fontWeight: 800 }}>{targetMaxSimilar}/100</span>.
                </>
              ) : (
                <>Calculating closest-player ceiling…</>
              )}
            </p>
          </div>

          <div className="header-buttons" style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '6px', marginBottom: '4px' }}>
            <button
              onClick={() => setShowHowToPlay(true)}
              className="how-to-play-btn"
              style={{
                padding: '6px 12px',
                borderRadius: '10px',
                border: '1px solid #4b5563',
                backgroundColor: '#111827',
                color: '#94a3b8',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span>❓</span>
              <span>How to Play</span>
            </button>

            <button
              onClick={() => setShowFavorites(true)}
              style={{
                padding: '6px 12px',
                borderRadius: '10px',
                border: '1px solid rgba(251, 191, 36, 0.55)',
                backgroundColor: 'rgba(251, 191, 36, 0.12)',
                color: '#fde68a',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontWeight: 900
              }}
              title="View your favorite players"
            >
              <span>⭐</span>
              <span>Favorites</span>
            </button>

            {(() => {
              // Hide destructive "reset" for normal users.
              // Enable by visiting with `?tester=1` (or `?tester=true`) OR setting localStorage `nba-mantle-tester=1`.
              try {
                const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
                const q = qs ? (qs.get('tester') || '') : '';
                if (q === '1' || q === 'true') return true;
                return localStorage.getItem('nba-mantle-tester') === '1';
              } catch {
                return false;
              }
            })() && (
              <button
                onClick={resetAllLocalDataNow}
                style={{
                  padding: '6px 12px',
                  borderRadius: '10px',
                  border: '1px solid rgba(248, 113, 113, 0.55)',
                  backgroundColor: 'rgba(127, 29, 29, 0.35)',
                  color: '#fecaca',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 800,
                }}
                title="Clears your saved history and reloads"
              >
                🧹 Reset local data
              </button>
            )}

            <button
              onClick={() => setShowMoreGames(true)}
              style={{
                padding: '6px 12px',
                borderRadius: '10px',
                border: '1px solid #4b5563',
                backgroundColor: '#111827',
                color: '#94a3b8',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span>🎮</span>
              <span>More / About</span>
            </button>
          </div>

          {/* Game Mode Selection */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleModeChange('easy')}
                style={{
                  padding: '10px 20px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  backgroundColor: gameMode === 'easy' ? '#22c55e' : '#475569',
                  color: 'white'
                }}
              >
                😊 All Stars 1986 or Later
              </button>
              <button
                onClick={() => handleModeChange('classic')}
                style={{
                  padding: '10px 20px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  backgroundColor: gameMode === 'classic' ? '#3b82f6' : '#475569',
                  color: 'white'
                }}
              >
                🏆 Classic Mode
              </button>
              <button
                onClick={() => handleModeChange('all')}
                style={{
                  padding: '10px 20px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  backgroundColor: gameMode === 'all' ? '#3b82f6' : '#475569',
                  color: 'white'
                }}
              >
                🌟 All Players
              </button>
            </div>
            <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleModeChange('daily')}
                style={{
                  padding: '14px 32px',
                  borderRadius: '10px',
                  border: gameMode === 'daily' ? '2px solid #a78bfa' : '2px solid #475569',
                  fontWeight: 'bold',
                  fontSize: '1.1rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  backgroundColor: gameMode === 'daily' ? '#8b5cf6' : '#475569',
                  color: 'white',
                  boxShadow: gameMode === 'daily' ? '0 4px 14px rgba(139, 92, 246, 0.4)' : 'none'
                }}
              >
                📅 Daily #{todayDailyIndex + 1}
              </button>
              <button
                onClick={() => handleModeChange('ballKnowledgeDaily')}
                style={{
                  padding: '14px 32px',
                  borderRadius: '10px',
                  border: gameMode === 'ballKnowledgeDaily' ? '2px solid #f59e0b' : '2px solid #475569',
                  fontWeight: 'bold',
                  fontSize: '1.1rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  backgroundColor: gameMode === 'ballKnowledgeDaily' ? '#d97706' : '#475569',
                  color: 'white',
                  boxShadow: gameMode === 'ballKnowledgeDaily' ? '0 4px 14px rgba(217, 119, 6, 0.4)' : 'none'
                }}
              >
                🧠 Hardcore Daily #{todayDailyIndex + 1}
              </button>
            </div>
            <div style={{ marginTop: '8px', fontSize: '14px', color: '#94a3b8' }}>
              {gameMode === 'daily' &&
                `Daily #${activeDailyNumber}${isPastDailySelected ? ' (Past)' : ''} — Same puzzle for everyone • Reveal anytime`}
              {gameMode === 'ballKnowledgeDaily' &&
                `Hardcore Daily #${activeDailyNumber}${isPastDailySelected ? ' (Past)' : ''} — Same puzzle for everyone • Reveal anytime`}
              {gameMode === 'easy' &&
                `All Stars 1986 or Later (${filteredPlayers.length} players)`}
              {gameMode === 'classic' && 
                `Classic: Modern era players (2011+) with 6+ seasons (${filteredPlayers.length} players)`}
              {gameMode === 'all' && 
                `All Players: Complete database (${filteredPlayers.length} players)`}
            </div>

            {(gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && (
              <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setShowPastDailyPicker(true)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '999px',
                    border: '1px solid #334155',
                    backgroundColor: 'rgba(15, 23, 42, 0.55)',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  {gameMode === 'ballKnowledgeDaily' ? '🗓️ Pick a past Hardcore Daily' : '🗓️ Pick a past day'}
                </button>
                {selectedDailyIndexOverride != null && (
                  <button
                    type="button"
                    onClick={() => setSelectedDailyIndexOverride(null)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '999px',
                      border: '1px solid #334155',
                      backgroundColor: 'rgba(148, 163, 184, 0.08)',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 700,
                    }}
                  >
                    {gameMode === 'ballKnowledgeDaily' ? "↩ Back to today's Hardcore Daily" : '↩ Back to today'}
                  </button>
                )}
              </div>
            )}

            {showPastDailyPicker && (
              <div
                onClick={() => setShowPastDailyPicker(false)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: 'rgba(15,23,42,0.85)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 60,
                  padding: '16px',
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    maxWidth: '460px',
                    maxHeight: '85vh',
                    background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                    borderRadius: '16px',
                    padding: '18px',
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.75)',
                    border: '1px solid #334155',
                    overflowY: 'auto',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div>
                      <div style={{ color: '#e5e7eb', fontWeight: 800, fontSize: '1.05rem' }}>
                        Play a past {gameMode === 'ballKnowledgeDaily' ? 'Hardcore Daily' : 'daily'}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '2px' }}>
                        Select a day to play. Today is #{todayDailyIndex + 1}.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPastDailyPicker(false)}
                      style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '20px', padding: '4px 8px', borderRadius: '4px' }}
                    >
                      ×
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDailyIndexOverride(null);
                        setShowPastDailyPicker(false);
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '12px',
                        border: selectedDailyIndexOverride == null ? '1px solid rgba(59, 130, 246, 0.55)' : '1px solid #334155',
                        backgroundColor: selectedDailyIndexOverride == null ? 'rgba(59, 130, 246, 0.14)' : 'rgba(15, 23, 42, 0.4)',
                        color: '#e5e7eb',
                        cursor: 'pointer',
                        fontWeight: 800,
                        fontSize: '0.9rem',
                      }}
                    >
                      Today
                    </button>
                    <div style={{ color: '#94a3b8', fontSize: '0.85rem', alignSelf: 'center' }}>
                      Tip: you can view past days here. Completed days can’t be replayed.
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: '8px' }}>
                    {Array.from({ length: Math.min(30, todayDailyIndex + 1) }).map((_, i) => {
                      const idx = todayDailyIndex - i;
                      const num = idx + 1;
                      const iso = getISODateForDailyIndex(idx);
                      let displayDate = iso;
                      try {
                        const d = new Date(iso + 'T12:00:00');
                        if (!isNaN(d.getTime())) displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                      } catch {}
                      const dailyEntry = dailyCompletions[String(num)];
                      const hardcoreEntry = ballKnowledgeDailyCompletions[String(num)];
                      const isSelected = selectedDailyIndexOverride === idx || (selectedDailyIndexOverride == null && idx === todayDailyIndex);
                      return (
                        <button
                          key={num}
                          type="button"
                          onClick={() => {
                            setSelectedDailyIndexOverride(idx);
                            setShowPastDailyPicker(false);
                          }}
                          style={{
                            textAlign: 'left',
                            padding: '12px 12px',
                            borderRadius: '12px',
                            border: isSelected ? '1px solid rgba(59, 130, 246, 0.6)' : '1px solid #334155',
                            backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.14)' : 'rgba(15, 23, 42, 0.35)',
                            color: '#e5e7eb',
                            cursor: 'pointer',
                            font: 'inherit',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                            <div style={{ fontWeight: 800 }}>Daily #{num}</div>
                            <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{displayDate}</div>
                          </div>
                          <div style={{ marginTop: '6px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ color: '#c4b5fd', fontSize: '0.85rem', fontWeight: 700 }}>
                              Daily: {dailyEntry ? (dailyEntry?.won !== false ? `✓ ${dailyEntry?.guesses ?? '?'} guesses` : '— revealed') : 'not played'}
                            </span>
                            <span style={{ color: '#fcd34d', fontSize: '0.85rem', fontWeight: 700 }}>
                              Hardcore: {hardcoreEntry ? (hardcoreEntry?.won !== false ? `✓ ${hardcoreEntry?.guesses ?? '?'} guesses` : '— revealed') : 'not played'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {Object.keys(dailyCompletions).length > 0 && (
              <div style={{
                marginTop: '14px',
                padding: '14px 16px',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(139, 92, 246, 0.06))',
                borderRadius: '12px',
                border: '1px solid rgba(139, 92, 246, 0.35)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowDailyHistoryPanel((prev) => {
                      const next = !prev;
                      try { localStorage.setItem(key('nba-mantle-ui-show-daily-history'), next ? '1' : '0'); } catch {}
                      return next;
                    });
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    font: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div
                      aria-hidden
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '10px',
                        display: 'grid',
                        placeItems: 'center',
                        backgroundColor: 'rgba(139, 92, 246, 0.18)',
                        border: '1px solid rgba(139, 92, 246, 0.35)',
                        flex: '0 0 auto',
                      }}
                    >
                      🏆
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#e9d5ff', fontWeight: 900, fontSize: '14px', lineHeight: 1.2 }}>
                        Your daily mantles
                        <span style={{ color: '#94a3b8', fontWeight: 600, fontSize: '12px', marginLeft: '8px' }}>
                          {Object.keys(dailyCompletions).length} played
                        </span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '3px' }}>
                        {showDailyHistoryPanel ? 'Click to hide' : 'Click to show'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' }}>
                    <span style={{ color: '#c4b5fd', fontWeight: 900, fontSize: '12px' }}>
                      {showDailyHistoryPanel ? 'Hide' : 'Show'}
                    </span>
                    <div style={{ color: '#c4b5fd', fontWeight: 900, fontSize: '18px', lineHeight: 1 }}>
                      {showDailyHistoryPanel ? '▾' : '▸'}
                    </div>
                  </div>
                </button>
                {showDailyHistoryPanel && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                  {Object.entries(dailyCompletions)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([num, entry]) => {
                      const dateStr = typeof entry === 'string' ? entry : entry?.date ?? '';
                      const guesses = typeof entry === 'object' && entry != null ? entry.guesses : null;
                      let displayDate = dateStr;
                      try {
                        const d = new Date(dateStr + 'T12:00:00');
                        if (!isNaN(d.getTime())) {
                          displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        }
                      } catch {}
                      return (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setSelectedDailyDetail(num)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            backgroundColor: 'rgba(139, 92, 246, 0.2)',
                            border: '1px solid rgba(139, 92, 246, 0.4)',
                            fontSize: '13px',
                            color: '#e9d5ff',
                            cursor: 'pointer',
                            font: 'inherit'
                          }}
                        >
                          <span style={{ color: '#a78bfa', fontWeight: '600' }}>Daily #{num}</span>
                          {entry?.answer && (
                            <>
                              <span style={{ color: '#94a3b8', fontSize: '12px' }}>·</span>
                              <span style={{ color: '#e9d5ff' }}>{entry.answer}</span>
                            </>
                          )}
                          <span style={{ color: '#94a3b8', fontSize: '12px' }}>·</span>
                          <span style={{ color: '#c4b5fd' }}>{displayDate}</span>
                          {guesses != null && (
                            <>
                              <span style={{ color: '#94a3b8', fontSize: '12px' }}>·</span>
                              <span style={{ color: '#fbbf24', fontWeight: '600' }}>{guesses} guess{guesses !== 1 ? 'es' : ''}</span>
                            </>
                          )}
                          <span style={{ color: entry?.won !== false ? '#10b981' : '#94a3b8', marginLeft: '2px' }}>{entry?.won !== false ? '✓' : '—'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Daily detail modal: tap a completed daily to see guesses */}
            {selectedDailyDetail != null && dailyCompletions[selectedDailyDetail] && (
              <div
                onClick={() => setSelectedDailyDetail(null)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: 'rgba(15,23,42,0.85)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 50,
                  padding: '16px'
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    maxWidth: '420px',
                    maxHeight: '85vh',
                    background: 'linear-gradient(135deg, #1e293b, #334155)',
                    borderRadius: '16px',
                    padding: '20px',
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                    border: '1px solid rgba(139, 92, 246, 0.4)',
                    overflowY: 'auto'
                  }}
                >
                  {(() => {
                    const entry = dailyCompletions[selectedDailyDetail];
                    const dateStr = entry?.date ?? '';
                    let displayDate = dateStr;
                    try {
                      const d = new Date(dateStr + 'T12:00:00');
                      if (!isNaN(d.getTime())) {
                        displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                      }
                    } catch {}
                    // Display in saved order only (chronological—never sort)
                    const history = Array.isArray(entry?.guessHistory) ? entry.guessHistory : [];
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                          <div>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#e5e7eb' }}>Daily #{selectedDailyDetail}</h3>
                            <p style={{ margin: '4px 0 0', fontSize: '0.9rem', color: '#94a3b8' }}>{entry?.answer ? `Answer: ${entry.answer} · ` : ''}{displayDate}{entry?.guesses != null ? ` · ${entry.guesses} guess${entry.guesses !== 1 ? 'es' : ''}` : ''}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedDailyDetail(null)}
                            style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '20px', padding: '4px 8px', borderRadius: '4px' }}
                          >
                            ×
                          </button>
                        </div>
                        <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '10px' }}>Each player you guessed (in order)</div>
                        {history.length === 0 ? (
                          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>No guesses saved for this daily.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {history.map((item, idx) => (
                              <div
                                key={idx}
                                style={{
                                  padding: '10px 12px',
                                  borderRadius: '8px',
                                  backgroundColor: 'rgba(15, 23, 42, 0.5)',
                                  border: '1px solid #334155'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                  <span style={{ fontWeight: '600', color: '#f1f5f9' }}>{idx + 1}. {item.name}</span>
                                  <span style={{ color: getScoreColor(item.score), fontWeight: 'bold', fontSize: '14px' }}>{item.score}/100</span>
                                </div>
                                <ScoreBar score={item.score} showLabel={false} />
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Past Ball Knowledge Dailies */}
            {Object.keys(ballKnowledgeDailyCompletions).length > 0 && (
              <div style={{
                marginTop: '14px',
                padding: '14px 16px',
                background: 'linear-gradient(135deg, rgba(217, 119, 6, 0.12), rgba(217, 119, 6, 0.06))',
                borderRadius: '12px',
                border: '1px solid rgba(217, 119, 6, 0.35)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowHardcoreHistoryPanel((prev) => {
                      const next = !prev;
                      try { localStorage.setItem(key('nba-mantle-ui-show-hardcore-history'), next ? '1' : '0'); } catch {}
                      return next;
                    });
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    font: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div
                      aria-hidden
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '10px',
                        display: 'grid',
                        placeItems: 'center',
                        backgroundColor: 'rgba(217, 119, 6, 0.16)',
                        border: '1px solid rgba(217, 119, 6, 0.32)',
                        flex: '0 0 auto',
                      }}
                    >
                      🧠
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#fef3c7', fontWeight: 900, fontSize: '14px', lineHeight: 1.2 }}>
                        Your hardcore dailies
                        <span style={{ color: '#94a3b8', fontWeight: 600, fontSize: '12px', marginLeft: '8px' }}>
                          {Object.keys(ballKnowledgeDailyCompletions).length} played
                        </span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '3px' }}>
                        {showHardcoreHistoryPanel ? 'Click to hide' : 'Click to show'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' }}>
                    <span style={{ color: '#fcd34d', fontWeight: 900, fontSize: '12px' }}>
                      {showHardcoreHistoryPanel ? 'Hide' : 'Show'}
                    </span>
                    <div style={{ color: '#fcd34d', fontWeight: 900, fontSize: '18px', lineHeight: 1 }}>
                      {showHardcoreHistoryPanel ? '▾' : '▸'}
                    </div>
                  </div>
                </button>
                {showHardcoreHistoryPanel && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                  {Object.entries(ballKnowledgeDailyCompletions)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([num, entry]) => {
                      const dateStr = typeof entry === 'string' ? entry : entry?.date ?? '';
                      const guesses = typeof entry === 'object' && entry != null ? entry.guesses : null;
                      let displayDate = dateStr;
                      try {
                        const d = new Date(dateStr + 'T12:00:00');
                        if (!isNaN(d.getTime())) {
                          displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        }
                      } catch {}
                      return (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setSelectedBallKnowledgeDetail(num)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            backgroundColor: 'rgba(217, 119, 6, 0.2)',
                            border: '1px solid rgba(217, 119, 6, 0.4)',
                            fontSize: '13px',
                            color: '#fef3c7',
                            cursor: 'pointer',
                            font: 'inherit'
                          }}
                        >
                          <span style={{ color: '#f59e0b', fontWeight: '600' }}>BKD #{num}</span>
                          {entry?.answer && (
                            <>
                              <span style={{ color: '#94a3b8', fontSize: '12px' }}>·</span>
                              <span style={{ color: '#fef3c7' }}>{entry.answer}</span>
                            </>
                          )}
                          <span style={{ color: '#94a3b8', fontSize: '12px' }}>·</span>
                          <span style={{ color: '#fcd34d' }}>{displayDate}</span>
                          {guesses != null && (
                            <>
                              <span style={{ color: '#94a3b8', fontSize: '12px' }}>·</span>
                              <span style={{ color: '#fbbf24', fontWeight: '600' }}>{guesses} guess{guesses !== 1 ? 'es' : ''}</span>
                            </>
                          )}
                          <span style={{ color: entry?.won !== false ? '#10b981' : '#94a3b8', marginLeft: '2px' }}>{entry?.won !== false ? '✓' : '—'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Hardcore Daily detail modal */}
            {selectedBallKnowledgeDetail != null && ballKnowledgeDailyCompletions[selectedBallKnowledgeDetail] && (
              <div
                onClick={() => setSelectedBallKnowledgeDetail(null)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: 'rgba(15,23,42,0.85)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 50,
                  padding: '16px'
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    maxWidth: '420px',
                    maxHeight: '85vh',
                    background: 'linear-gradient(135deg, #1e293b, #334155)',
                    borderRadius: '16px',
                    padding: '20px',
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                    border: '1px solid rgba(217, 119, 6, 0.4)',
                    overflowY: 'auto'
                  }}
                >
                  {(() => {
                    const entry = ballKnowledgeDailyCompletions[selectedBallKnowledgeDetail];
                    const dateStr = entry?.date ?? '';
                    let displayDate = dateStr;
                    try {
                      const d = new Date(dateStr + 'T12:00:00');
                      if (!isNaN(d.getTime())) {
                        displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                      }
                    } catch {}
                    const history = Array.isArray(entry?.guessHistory) ? entry.guessHistory : [];
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                          <div>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#e5e7eb' }}>Hardcore Daily #{selectedBallKnowledgeDetail}</h3>
                            <p style={{ margin: '4px 0 0', fontSize: '0.9rem', color: '#94a3b8' }}>{entry?.answer ? `Answer: ${entry.answer} · ` : ''}{displayDate}{entry?.guesses != null ? ` · ${entry.guesses} guess${entry.guesses !== 1 ? 'es' : ''}` : ''}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedBallKnowledgeDetail(null)}
                            style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '20px', padding: '4px 8px', borderRadius: '4px' }}
                          >
                            ×
                          </button>
                        </div>
                        <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '10px' }}>Each player you guessed (in order)</div>
                        {history.length === 0 ? (
                          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>No guesses saved for this daily.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {history.map((item, idx) => (
                              <div
                                key={idx}
                                style={{
                                  padding: '10px 12px',
                                  borderRadius: '8px',
                                  backgroundColor: 'rgba(15, 23, 42, 0.5)',
                                  border: '1px solid #334155'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                  <span style={{ fontWeight: '600', color: '#f1f5f9' }}>{idx + 1}. {item.name}</span>
                                  <span style={{ color: getScoreColor(item.score), fontWeight: 'bold', fontSize: '14px' }}>{item.score}/100</span>
                                </div>
                                <ScoreBar score={item.score} showLabel={false} />
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'center', gap: '32px', flexWrap: 'wrap', fontSize: '1.1rem', alignItems: 'center' }}>
            {(gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && (
              <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>Guesses: {guessCount}</span>
            )}
            {(gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && !isPastDailySelected && nextDailyCountdown != null && (
              <span style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: '1rem' }}>
                Next in {nextDailyCountdown} UTC
              </span>
            )}
            {(gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && bestSoFar != null && (
              <span style={{ color: '#34d399', fontWeight: 'bold', fontSize: '1rem' }}>
                Best: {bestSoFar}{bestDelta != null ? ` (+${bestDelta})` : ''}
              </span>
            )}
            {gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily' && (
              <span style={{ color: '#fbbf24' }}>⚡ Attempt #{guessCount}</span>
            )}
            {!gameWon && !showAnswer && (
              <span style={{ color: '#94a3b8' }}>Mystery Player: ???</span>
            )}
            {(gameWon || showAnswer) && (
              <span style={{ color: '#10b981' }}>Answer: {targetPlayer}</span>
            )}
          </div>
        </div>

        {/* How to Play Modal */}
        {showHowToPlay && (
          <div
            onClick={() => setShowHowToPlay(false)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(15,23,42,0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: '16px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: '540px',
                maxHeight: '100%',
                background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                borderRadius: '16px',
                padding: '20px',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.75)',
                border: '1px solid #334155',
                overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h2 style={{ fontSize: '1.4rem', margin: 0, color: '#e5e7eb' }}>How to Play NBA Mantle</h2>
                <button
                  onClick={() => setShowHowToPlay(false)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#9ca3af',
                    cursor: 'pointer',
                    fontSize: '18px',
                    padding: '4px 8px',
                    borderRadius: '999px',
                  }}
                >
                  ×
                </button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gap: '12px',
                  marginBottom: '14px',
                }}
              >
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: '1px solid #334155',
                    background: 'rgba(15, 23, 42, 0.35)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                    <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '0.95rem' }}>🎯 Goal</div>
                    <div style={{ color: '#93c5fd', fontWeight: 700, fontSize: '0.95rem' }}>Get to 100</div>
                  </div>
                  <div style={{ marginTop: '6px', color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.45 }}>
                    Guess players to find the <strong>mystery player</strong>. Each guess gives a <strong>0–100</strong> similarity score.
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: '1px solid #334155',
                    background: 'rgba(15, 23, 42, 0.35)',
                  }}
                >
                  <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '0.95rem', marginBottom: '8px' }}>⚡ How it works</div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <div style={{ width: '22px', height: '22px', borderRadius: '8px', backgroundColor: '#1d4ed8', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '12px' }}>1</div>
                      <div style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.45 }}>
                        Type a player and hit <strong>Submit Guess</strong>.
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <div style={{ width: '22px', height: '22px', borderRadius: '8px', backgroundColor: '#7c3aed', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '12px' }}>2</div>
                      <div style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.45 }}>
                        Use the <strong>breakdown</strong> to see what made them similar.
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <div style={{ width: '22px', height: '22px', borderRadius: '8px', backgroundColor: '#059669', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '12px' }}>3</div>
                      <div style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.45 }}>
                        Adjust your next guess. <strong>Higher score = closer</strong>.
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: '10px', color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.45 }}>
                    Exact scoring is intentionally a bit hidden—think of it as <strong>clues</strong>, not a formula.
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: '1px solid #334155',
                    background: 'rgba(15, 23, 42, 0.35)',
                  }}
                >
                  <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '0.95rem', marginBottom: '10px' }}>🕹️ Modes</div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ color: '#e9d5ff', fontWeight: 700 }}>📅 Daily</span>
                      <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>One puzzle/day • Reveal anytime</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ color: '#fef3c7', fontWeight: 700 }}>🧠 Hardcore Daily</span>
                      <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Harder list • One puzzle/day</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ color: '#bbf7d0', fontWeight: 700 }}>😊 All Stars 1986+</span>
                      <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>All-Star players only</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ color: '#bfdbfe', fontWeight: 700 }}>🏆 Classic</span>
                      <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Modern (2011+) • 6+ seasons</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ color: '#fde68a', fontWeight: 700 }}>🌟 All Players</span>
                      <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Full database</span>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: '1px solid #334155',
                    background: 'rgba(15, 23, 42, 0.35)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' }}>
                    <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '0.95rem' }}>🧩 Breakdown clues</div>
                    <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>More overlap → higher score</div>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: '8px',
                    }}
                  >
                    {[
                      ['Same team (seasons)', 'Shared-team seasons: 0–50 (more seasons on the same team = higher).'],
                      ['Shared teammates', 'Shared teammate overlap: 0–5 (more shared teammates = higher).'],
                      ['Shared franchises', 'Shared franchise overlap: 0–10 (same orgs = higher).'],
                      ['Position', 'Position similarity: 0–10 (closer roles on the court = higher).'],
                      ['Era', 'Start year overlap: 0–10 (closer start years = higher).'],
                      ['Career length', 'Career-length similarity: 0–6 (closer career span = higher).'],
                      ['Accolades', 'Awards/recognition overlap: All-Star / All-NBA / All-Defense / All-Rookie (and similar). Higher = more shared honors.'],
                    ].map(([title, desc]) => (
                      <div
                        key={title}
                        style={{
                          padding: '10px 10px',
                          borderRadius: '10px',
                          backgroundColor: 'rgba(30, 41, 59, 0.55)',
                          border: '1px solid rgba(51, 65, 85, 0.9)',
                        }}
                      >
                        <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '0.9rem', marginBottom: '4px' }}>
                          {title}
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.35 }}>
                          {desc}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '10px', color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.45 }}>
                    Tip: start broad (same era / same position), then use team + teammate overlap to zoom in.
                  </div>
                  <div style={{ marginTop: '6px', color: '#94a3b8', fontSize: '0.85rem' }}>
                    You can always press <strong>Reveal</strong> to see the answer and the top 5 closest players.
                  </div>
                </div>
              </div>

              <div style={{ position: 'sticky', bottom: 0, marginTop: '12px' }}>
                <button
                  onClick={() => setShowHowToPlay(false)}
                  style={{
                    width: '100%',
                    padding: '10px 18px',
                    borderRadius: '10px',
                    border: 'none',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                  }}
                >
                  Got it, let&apos;s play
                </button>
              </div>
            </div>
          </div>
        )}

        {showFavorites && (
          <div
            onClick={() => setShowFavorites(false)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(15,23,42,0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 55,
              padding: '16px'
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Favorite players"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: '520px',
                maxHeight: '85vh',
                overflow: 'auto',
                background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                borderRadius: '16px',
                padding: '20px',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                border: '1px solid rgba(251, 191, 36, 0.35)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#fde68a' }}>⭐ Favorites</h2>
                  <div style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '4px' }}>
                    {favoritePlayerKeySet.size} saved
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFavorites(false)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#9ca3af',
                    cursor: 'pointer',
                    fontSize: '20px',
                    padding: '4px 8px',
                    borderRadius: '4px'
                  }}
                  aria-label="Close favorites"
                >
                  ×
                </button>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setFavoritePlayerKeys([])}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '12px',
                    border: '1px solid rgba(248, 113, 113, 0.35)',
                    backgroundColor: 'rgba(127, 29, 29, 0.25)',
                    color: '#fecaca',
                    fontWeight: 900,
                    cursor: 'pointer',
                    font: 'inherit'
                  }}
                  title="Remove all favorites"
                >
                  🧹 Clear all
                </button>
              </div>

              {(() => {
                const favorites = allPlayers.filter((name) => favoritePlayerKeySet.has(normalizePlayerName(name)));
                if (!favorites.length) {
                  return (
                    <div style={{ color: '#94a3b8', textAlign: 'center', padding: '28px 10px' }}>
                      <div style={{ fontSize: '2.2rem', marginBottom: '6px' }}>⭐</div>
                      <div>No favorites yet. Star a player in Guess History.</div>
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {favorites.map((name) => (
                      <div
                        key={name}
                        style={{
                          backgroundColor: '#0f172a',
                          border: '1px solid rgba(51, 65, 85, 0.85)',
                          borderRadius: '12px',
                          padding: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px'
                        }}
                      >
                        {renderPlayerAvatar(name, { size: 40, radius: 8 })}
                        <div style={{ fontWeight: 900, color: '#f1f5f9', flex: 1, minWidth: 0 }}>{name}</div>
                        <button
                          type="button"
                          onClick={() => toggleFavoritePlayer(name)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#fbbf24',
                            cursor: 'pointer',
                            fontSize: '18px',
                            padding: 0,
                            fontWeight: 900
                          }}
                          aria-label={`Remove ${name} from favorites`}
                          title="Unfavorite"
                        >
                          ★
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* More games / About modal */}
        {showMoreGames && (
          <div
            onClick={() => setShowMoreGames(false)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(15,23,42,0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: '16px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: '480px',
                background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.75)',
                border: '1px solid #334155',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '1.3rem', margin: 0, color: '#e5e7eb' }}>More / About</h2>
                <button
                  onClick={() => setShowMoreGames(false)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#9ca3af',
                    cursor: 'pointer',
                    fontSize: '18px',
                    padding: '4px 8px',
                    borderRadius: '999px',
                  }}
                >
                  ×
                </button>
              </div>

              <div
                style={{
                  padding: '14px 14px',
                  borderRadius: '14px',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(15, 23, 42, 0.35))',
                  marginBottom: '14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '8px' }}>
                  <div style={{ color: '#e5e7eb', fontWeight: 800, fontSize: '1rem' }}>👋 About the creator</div>
                  <div style={{ color: '#93c5fd', fontWeight: 700, fontSize: '0.85rem' }}>Beta</div>
                </div>
                <div style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.5 }}>
                  Hey, I&apos;m <strong>Josh</strong> — an undergrad at Northeastern studying <strong>Data Science</strong>. I built NBA Mantle because I love the NBA and stats.
                </div>
                <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                  <a
                    href="https://instagram.com/joshuam0y"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 12px',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(236, 72, 153, 0.16)',
                      border: '1px solid rgba(236, 72, 153, 0.35)',
                      color: '#fce7f3',
                      textDecoration: 'none',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                    }}
                  >
                    <span>📷</span>
                    Instagram @joshuam0y
                  </a>
                  <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                    Questions or bugs? DM me. Also—share it with friends.
                  </div>
                </div>
              </div>

              <p style={{ color: '#9ca3af', fontSize: '0.95rem', marginBottom: '12px', lineHeight: 1.5 }}>
                If you like NBA Mantle, try this other hoops project.
              </p>
              <a
                href="https://nba-budget-ball.vercel.app/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 20px',
                  borderRadius: '10px',
                  backgroundColor: '#22c55e',
                  color: 'white',
                  fontWeight: 'bold',
                  textDecoration: 'none',
                  fontSize: '1rem',
                  transition: 'opacity 0.2s',
                }}
                onMouseOver={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                onMouseOut={(e) => { e.currentTarget.style.opacity = '1'; }}
              >
                <span>🏀</span>
                NBA Budget Ball – Build a champion on a budget
              </a>
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '10px', marginBottom: 0 }}>
                Salary cap roster builder and season sim · React, Supabase, Vercel
              </p>
            </div>
          </div>
        )}

        <div className="main-layout">
          {/* Left Panel */}
          <div>
            {/* Input Section */}
            <div style={{ 
              background: 'linear-gradient(135deg, #1e293b, #334155)',
              borderRadius: '16px',
              padding: '24px',
              marginBottom: '24px',
              border: '1px solid #334155'
            }}>
              <h3 style={{ fontSize: '1.3rem', marginBottom: '16px', color: '#f1f5f9' }}>🔍 Make Your Guess</h3>
              
              {(() => {
                const end = getEndScreenModel();
                if (!end) return null;

                const isHardcore = gameMode === 'ballKnowledgeDaily';
                const completion = getActiveCompletionEntry();
                const dateStr = typeof completion === 'object' && completion != null ? completion?.date ?? '' : '';
                let displayDate = dateStr;
                try {
                  const d = new Date((dateStr ?? '') + 'T12:00:00');
                  if (!isNaN(d.getTime())) displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                } catch {}

                const accentBorder = end.state === 'won'
                  ? '1px solid rgba(34, 197, 94, 0.35)'
                  : isHardcore
                  ? '1px solid rgba(217, 119, 6, 0.35)'
                  : '1px solid rgba(139, 92, 246, 0.35)';

                const accentBg = end.state === 'won'
                  ? 'rgba(34, 197, 94, 0.18)'
                  : isHardcore
                  ? 'rgba(217, 119, 6, 0.15)'
                  : 'rgba(139, 92, 246, 0.15)';

                return (
                  <div style={{ padding: '16px', borderRadius: '12px', backgroundColor: accentBg, border: accentBorder }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '8px' }}>{end.state === 'won' ? '🎉' : '🎯'}</div>
                      <div style={{ marginBottom: '8px' }}>{renderPlayerAvatar(end.answer, { size: 64, radius: 12 })}</div>
                      {end.state === 'won' ? (
                        <p style={{ margin: 0, fontSize: '1.05rem', color: 'white' }}>
                          {gameMode === 'daily' ? 'Daily' : gameMode === 'ballKnowledgeDaily' ? 'Hardcore Daily' : 'Game'} #{activeDailyNumber}{displayDate ? ` (${displayDate})` : ''} — you got it in <strong>{end.guesses ?? '?'}</strong> guesses! The answer was <strong>{end.answer}</strong>.
                        </p>
                      ) : (
                        <p style={{ margin: 0, fontSize: '1.05rem', color: 'white' }}>
                          The answer was <strong>{end.answer}</strong>
                        </p>
                      )}

                      {(gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && end.state === 'won' && (
                        <div style={{ marginTop: '10px', fontSize: '0.95rem', opacity: 0.95, color: 'white' }}>
                          {postWinGlobalDailyAverageLoading ? (
                            <span>Fetching global daily average…</span>
                          ) : postWinGlobalDailyAverage?.avg != null ? (
                            <span>
                              Global daily average: <strong>{Number(postWinGlobalDailyAverage.avg).toFixed(2)}</strong> guesses
                              {postWinGlobalDailyAverage?.wins != null ? (
                                <span style={{ opacity: 0.9 }}> ({postWinGlobalDailyAverage.wins} win{postWinGlobalDailyAverage.wins === 1 ? '' : 's'})</span>
                              ) : null}
                            </span>
                          ) : (
                            <span style={{ opacity: 0.9 }}>Global daily average: —</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px', justifyContent: 'center' }}>
                      {(gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && (
                        <button
                          type="button"
                          onClick={() => {
                            if (gameMode === 'daily') setSelectedDailyDetail(String(activeDailyNumber));
                            else setSelectedBallKnowledgeDetail(String(activeDailyNumber));
                          }}
                          style={{
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: 'none',
                            backgroundColor: isHardcore ? '#d97706' : '#7c3aed',
                            color: 'white',
                            fontWeight: '800',
                            cursor: 'pointer',
                            fontSize: '0.9rem'
                          }}
                        >
                          View your guesses
                        </button>
                      )}
                      {end.canShare && (
                        <button
                          type="button"
                          onClick={() =>
                            handleShare({
                              mode: gameMode === 'ballKnowledgeDaily' ? 'hardcore' : gameMode,
                              dailyNumber: activeDailyNumber,
                              answer: end.answer,
                              guesses: end.guesses ?? guessCount,
                            })
                          }
                          style={{
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: 'none',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            fontWeight: '800',
                            cursor: 'pointer',
                            fontSize: '0.9rem'
                          }}
                        >
                          📤 Share
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
              
              {!gameWon && !showAnswer && !dailyAlreadyPlayed && !ballKnowledgeDailyAlreadyPlayed && (
                <div>
                  <div style={{ position: 'relative', marginBottom: '16px' }}>
                    <input
                      type="text"
                      id="player-guess-input"
                      role="combobox"
                      aria-label="Player name"
                      aria-autocomplete="list"
                      aria-expanded={showSuggestions}
                      aria-controls="player-suggestions-list"
                      aria-activedescendant={
                        selectedSuggestionIndex >= 0 ? `player-suggestions-option-${selectedSuggestionIndex}` : undefined
                      }
                      className={shakeInput ? 'nm-shake' : ''}
                      value={guess}
                      onChange={(e) => {
                        const value = e.target.value;
                        setGuess(value);
                        setSelectedSuggestionIndex(-1);
                        
                        if (value.length > 0) {
                          const normQuery = normalizePlayerName(value);
                          const filtered = allPlayers.filter(name =>
                            !name.includes('?') &&
                            normalizePlayerName(name).includes(normQuery)
                          ).slice(0, 8);
                          const sorted = [...filtered].sort(
                            (a, b) => Number(isFavoritePlayer(b)) - Number(isFavoritePlayer(a))
                          );
                          setSuggestions(sorted);
                          setShowSuggestions(true);
                        } else {
                          setSuggestions([]);
                          setShowSuggestions(false);
                        }
                        
                        if (error) setError('');
                      }}
                      onKeyDown={(e) => {
                        if (showSuggestions && suggestions.length > 0) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setSelectedSuggestionIndex(prev => 
                              prev < suggestions.length - 1 ? prev + 1 : 0
                            );
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSelectedSuggestionIndex(prev => 
                              prev > 0 ? prev - 1 : suggestions.length - 1
                            );
                          } else if (e.key === 'Enter') {
                            e.preventDefault();
                            if (selectedSuggestionIndex >= 0) {
                              handleSuggestionSelect(suggestions[selectedSuggestionIndex]);
                            } else {
                              makeGuess();
                            }
                          } else if (e.key === 'Escape') {
                            setShowSuggestions(false);
                            setSuggestions([]);
                            setSelectedSuggestionIndex(-1);
                          }
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          makeGuess();
                        }
                      }}
                      onBlur={() => {
                        setTimeout(() => {
                          setShowSuggestions(false);
                          setSuggestions([]);
                          setSelectedSuggestionIndex(-1);
                        }, 150);
                      }}
                      placeholder="Enter NBA player name..."
                      disabled={loading}
                      autoComplete="off"
                      spellCheck={false}
                      style={{
                        width: '100%',
                        padding: '12px 16px',
                        borderRadius: '8px',
                        border: '2px solid #475569',
                        backgroundColor: '#0f172a',
                        color: 'white',
                        fontSize: '16px'
                      }}
                    />
                    
                    {showSuggestions && suggestions.length > 0 && (
                      <ul
                        id="player-suggestions-list"
                        role="listbox"
                        aria-label="Player suggestions"
                        style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        backgroundColor: '#1e293b',
                        border: '1px solid #475569',
                        borderRadius: '8px',
                        maxHeight: '200px',
                        overflowY: 'auto',
                        zIndex: 1000,
                        listStyle: 'none',
                        padding: 0,
                        margin: 0
                      }}
                      >
                        {suggestions.map((suggestion, index) => (
                          <li
                            key={index}
                            id={`player-suggestions-option-${index}`}
                            role="option"
                            aria-selected={index === selectedSuggestionIndex}
                            style={{
                              padding: '12px 16px',
                              cursor: 'pointer',
                              backgroundColor: index === selectedSuggestionIndex ? '#334155' : 'transparent',
                              borderBottom: index < suggestions.length - 1 ? '1px solid #334155' : 'none'
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSuggestionSelect(suggestion);
                            }}
                            onMouseEnter={() => setSelectedSuggestionIndex(index)}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{ flexShrink: 0 }}>{renderPlayerAvatar(suggestion, { size: 28, radius: 6 })}</div>
                              <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {renderHighlightedName(suggestion, guess)}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  
                  <button
                    onClick={makeGuess}
                    disabled={loading || !guess.trim() || !targetPlayer}
                    style={{
                      width: '100%',
                      padding: '12px 24px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: loading || !guess.trim() || !targetPlayer ? '#475569' : '#3b82f6',
                      color: 'white',
                      fontWeight: 'bold',
                      cursor: loading || !guess.trim() || !targetPlayer ? 'not-allowed' : 'pointer',
                      fontSize: '16px'
                    }}
                  >
                    {loading ? 'Searching...' : 'Submit Guess'}
                  </button>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  aria-live="polite"
                  style={{ 
                  backgroundColor: '#fecaca', 
                  color: '#dc2626', 
                  padding: '12px', 
                  borderRadius: '8px', 
                  marginTop: '16px' 
                }}
                >
                  {error}
                </div>
              )}

              {/* Universal end screen handles win/reveal/already-played */}

              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                {!dailyAlreadyPlayed && !ballKnowledgeDailyAlreadyPlayed && (
                  <button 
                    onClick={startNewGame}
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: '#10b981',
                      color: 'white',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      fontSize: '16px'
                    }}
                  >
                    🔄 New Game
                  </button>
                )}
                
                {!gameWon && !showAnswer && !dailyAlreadyPlayed && !ballKnowledgeDailyAlreadyPlayed && (
                  <button 
                    onClick={revealAnswer}
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: '#f59e0b',
                      color: 'white',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      fontSize: '16px'
                    }}
                  >
                    👁️ Reveal
                  </button>
                )}
              </div>
            </div>

            {/* Top 5 Similar Players */}
            {top5Players.length > 0 && (
              <div style={{ 
                background: 'linear-gradient(135deg, #1e293b, #334155)',
                borderRadius: '16px',
                padding: '24px',
                border: '1px solid #334155'
              }}>
                <h3 style={{ fontSize: '1.3rem', marginBottom: '16px', color: '#f1f5f9' }}>📈 Top 5 Most Similar</h3>
                <div>
                  {top5Players.map(([name, score], index) => (
                    <div key={name} style={{ marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <span style={{ 
                          backgroundColor: '#3b82f6', 
                          color: 'white', 
                          width: '24px', 
                          height: '24px', 
                          borderRadius: '50%', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          fontSize: '12px', 
                          fontWeight: 'bold' 
                        }}>
                          {index + 1}
                        </span>
                        <div style={{ flexShrink: 0 }}>{renderPlayerAvatar(name, { size: 36, radius: 8 })}</div>
                        <span style={{ fontWeight: 'bold', color: '#f1f5f9' }}>{name}</span>
                      </div>
                      <ScoreBar score={score} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top 5 placeholder while backend warms / prefetch runs */}
            {top5Players.length === 0 && (gameWon || showAnswer || dailyAlreadyPlayed || ballKnowledgeDailyAlreadyPlayed) && prefetchedTargetTop5Loading && (
              <div style={{
                background: 'linear-gradient(135deg, #1e293b, #334155)',
                borderRadius: '16px',
                padding: '24px',
                border: '1px solid #334155'
              }}>
                <h3 style={{ fontSize: '1.3rem', marginBottom: '10px', color: '#f1f5f9' }}>📈 Top 5 Most Similar</h3>
                <div style={{ color: '#cbd5e1', fontSize: '0.95rem', marginBottom: '14px' }}>
                  Generating closest guesses… (server may be warming up)
                </div>
                <div style={{ display: 'grid', gap: '12px' }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        backgroundColor: '#0f172a',
                        border: '1px solid rgba(51,65,85,0.9)',
                        borderRadius: '12px',
                        padding: '14px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <div className="nm-skeleton" style={{ width: 24, height: 24, borderRadius: '999px' }} />
                        <div className="nm-skeleton" style={{ width: 36, height: 36, borderRadius: 8 }} />
                        <div className="nm-skeleton" style={{ flex: 1, height: 12, borderRadius: 8 }} />
                      </div>
                      <div className="nm-skeleton" style={{ width: '100%', height: 24, borderRadius: 12 }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - Guess History */}
          <div style={{ 
            background: 'linear-gradient(135deg, #1e293b, #334155)',
            borderRadius: '16px',
            padding: '24px',
            border: '1px solid #334155'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: '1.3rem', margin: 0, color: '#f1f5f9' }}>👥 Guess History ({guessHistory.length})</h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setGuessHistorySort('score')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '999px',
                    border: '1px solid rgba(59,130,246,0.35)',
                    backgroundColor: guessHistorySort === 'score' ? 'rgba(59,130,246,0.18)' : 'rgba(15,23,42,0.35)',
                    color: guessHistorySort === 'score' ? '#93c5fd' : '#94a3b8',
                    cursor: 'pointer',
                    fontWeight: 900,
                    font: 'inherit',
                    fontSize: '12px'
                  }}
                  title="Show highest scores first"
                >
                  Score
                </button>
                <button
                  type="button"
                  onClick={() => setGuessHistorySort('chronological')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '999px',
                    border: '1px solid rgba(52,211,153,0.35)',
                    backgroundColor: guessHistorySort === 'chronological' ? 'rgba(52,211,153,0.16)' : 'rgba(15,23,42,0.35)',
                    color: guessHistorySort === 'chronological' ? '#6ee7b7' : '#94a3b8',
                    cursor: 'pointer',
                    fontWeight: 900,
                    font: 'inherit',
                    fontSize: '12px'
                  }}
                  title="Show guesses in the order you made them"
                >
                  Chronological
                </button>
              </div>
            </div>
            
            {guessHistory.length === 0 ? (
              loading ? (
                <div style={{ padding: '12px 0' }}>
                  <div style={{ marginBottom: '12px', backgroundColor: '#0f172a', borderRadius: 12, border: '1px solid #334155', padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <div className="nm-skeleton" style={{ width: 40, height: 40, borderRadius: 8 }} />
                      <div className="nm-skeleton" style={{ flex: 1, height: 16, borderRadius: 8 }} />
                    </div>
                    <div className="nm-skeleton" style={{ width: '100%', height: 24, borderRadius: 12 }} />
                    <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                      <div className="nm-skeleton" style={{ width: '80%', height: 12, borderRadius: 8 }} />
                      <div className="nm-skeleton" style={{ width: '65%', height: 12, borderRadius: 8 }} />
                      <div className="nm-skeleton" style={{ width: '90%', height: 12, borderRadius: 8 }} />
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 20px' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🔍</div>
                  <p>No guesses yet. Start by entering a player name!</p>
                </div>
              )
            ) : (
              <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                {(guessHistorySort === 'chronological' ? guessHistory : guessHistory.slice().sort((a, b) => b.score - a.score)).map((item, index) => (
                  <div
                    key={index}
                    className={[
                      'nm-guess-card',
                      item.name === pulseGuessName ? 'nm-pulse' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ 
                    backgroundColor: '#0f172a', 
                    borderRadius: '12px', 
                    padding: '16px', 
                    marginBottom: '12px',
                    border: '1px solid #334155'
                  }}>
                    <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {renderPlayerAvatar(item.name, { size: 40, radius: 8 })}
                      <h4 style={{ margin: 0, color: '#f1f5f9', fontSize: '1.1rem' }}>{item.name}</h4>
                      <button
                        type="button"
                        onClick={() => toggleFavoritePlayer(item.name)}
                        style={{
                          marginLeft: 'auto',
                          border: 'none',
                          background: 'transparent',
                          color: isFavoritePlayer(item.name) ? '#fbbf24' : '#334155',
                          cursor: 'pointer',
                          fontSize: '18px',
                          lineHeight: 1,
                          padding: 0
                        }}
                        aria-label={isFavoritePlayer(item.name) ? 'Unfavorite player' : 'Favorite player'}
                      >
                        {isFavoritePlayer(item.name) ? '★' : '☆'}
                      </button>
                    </div>
                    
                    <ScoreBar score={item.score} animate={item.name === pulseGuessName} />
                    
                    {item.breakdown && Object.keys(item.breakdown).length > 0 && (
                      <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {(() => {
                          const entries = Object.entries(item.breakdown).filter(
                            ([key, value]) =>
                              key !== 'total' &&
                              key !== 'shared_seasons_detail' &&
                              typeof value === 'number' &&
                              value > 0
                          );
                          if (!entries.length) return null;
                          const maxVal = Math.max(...entries.map(([, v]) => v));
                          return entries.map(([key, value]) => {
                            const isMax = value === maxVal;
                            return (
                              <div
                                key={key}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                  fontSize: '12px',
                                  color: isMax ? '#e0f2fe' : '#cbd5e1',
                                  padding: '6px 10px',
                                  borderRadius: '999px',
                                  border: isMax ? '1px solid rgba(56,189,248,0.45)' : '1px solid rgba(148,163,184,0.20)',
                                  backgroundColor: isMax ? 'rgba(56,189,248,0.18)' : 'rgba(148,163,184,0.10)',
                                  maxWidth: '100%'
                                }}
                              >
                                <span style={{ fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {formatBreakdownKey(key)}
                                </span>
                                <span style={{ color: '#10b981', fontWeight: 'bold', marginLeft: 'auto', flex: '0 0 auto' }}>
                                  +{value}
                                </span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

  );
};

export default NBAGuessGame;