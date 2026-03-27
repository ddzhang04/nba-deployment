import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './NBAGuessGame.css'; // Import the CSS file
import { isAllStarPlayerName, normalizePlayerName } from './data/allStarPlayers';
import { DAILY_PLAYERS, getISODateForDailyIndexFromEpoch, getDailyPuzzleDayIndex } from './data/dailyPlayers';
import { BALL_KNOWLEDGE_DAILY_PLAYERS } from './data/ballKnowledgeDailyPlayers';
import { supabase } from './lib/supabaseClient';

/** Bump to wipe versioned localStorage keys (daily progress, caches, etc.). */
const STORAGE_RESET_VERSION = 'v14';
const mantleStorageKey = (k) => `${k}-${STORAGE_RESET_VERSION}`;

/** Return URL Supabase may send in the password-reset email (must be allowlisted in Supabase Auth). */
const getRedirectToWithSid = (baseRedirectTo) => {
  try {
    if (typeof window === 'undefined') return baseRedirectTo;
    if (typeof baseRedirectTo !== 'string') return baseRedirectTo;

    const trimmed = baseRedirectTo.trim();
    if (!trimmed) return baseRedirectTo;

    // Normalize to avoid "almost identical" redirect URLs.
    const normalized = trimmed.endsWith('/') && trimmed.length > 1 ? trimmed.slice(0, -1) : trimmed;

    // Prefer anon id already present in current URL (if any), otherwise use the current device's local anon id.
    let sid = '';
    try {
      const qs = new URLSearchParams(window.location.search);
      sid = qs.get('sid') || '';
    } catch {}
    if (!sid) {
      try {
        sid = localStorage.getItem(mantleStorageKey('nba-mantle-analytics-id')) || '';
      } catch {}
    }

    if (!sid) return normalized;

    const url = new URL(normalized, window.location.origin);
    url.searchParams.set('sid', sid);
    return url.toString();
  } catch {
    return baseRedirectTo;
  }
};

const getPasswordRecoveryRedirectTo = () => {
  const fromEnv = import.meta.env.VITE_SUPABASE_PASSWORD_REDIRECT_TO || import.meta.env.VITE_SUPABASE_OAUTH_REDIRECT_TO;
  if (typeof fromEnv === 'string') {
    const trimmed = fromEnv.trim();
    if (trimmed) return trimmed.endsWith('/') && trimmed.length > 1 ? trimmed.slice(0, -1) : trimmed;
  }
  if (typeof window === 'undefined') return undefined;
  const { origin, pathname } = window.location;
  const path = pathname.split('?')[0].split('#')[0] || '/';
  if (path === '/' || path === '') return origin.endsWith('/') ? origin.slice(0, -1) : origin;
  const base = `${origin}${path}`;
  return getRedirectToWithSid(base);
};

const parseCompletionMapFromStorageRaw = (raw) => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out = {};
    for (const [num, val] of Object.entries(parsed)) {
      const canonicalDate = (() => {
        const n = Number(num);
        if (!Number.isFinite(n) || n < 1) return '';
        return getISODateForDailyIndexFromEpoch(n - 1);
      })();
      if (typeof val === 'string') {
        out[num] = { date: canonicalDate || val, completedAt: '', guesses: null, guessHistory: [], won: true, answer: '', top5: [] };
      } else {
        const arr = Array.isArray(val?.guessHistory) ? val.guessHistory : [];
        const top5 = Array.isArray(val?.top5) ? val.top5 : [];
        out[num] = {
          date: canonicalDate || (val?.date ?? ''),
          completedAt: val?.completedAt ?? '',
          guesses: val?.guesses ?? null,
          guessHistory: arr,
          won: val?.won !== false,
          answer: val?.answer ?? '',
          top5,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
};

const readCompletionMapFromLocalStorageKey = (storageKey) => {
  try {
    return parseCompletionMapFromStorageRaw(localStorage.getItem(storageKey));
  } catch {
    return {};
  }
};

const readDailyCompletionsFromLocalStorage = (storageKey) => readCompletionMapFromLocalStorageKey(storageKey);

const readBallKnowledgeDailyFromLocalStorage = (storageKey) => {
  try {
    return parseCompletionMapFromStorageRaw(localStorage.getItem(storageKey));
  } catch {
    return {};
  }
};

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
  const [showStats, setShowStats] = useState(false);
  const [showSecondaryPanel, setShowSecondaryPanel] = useState(false);
  const [showLeaderboards, setShowLeaderboards] = useState(false);
  const [leaderboardMode, setLeaderboardMode] = useState('daily'); // 'daily' | 'hardcore'
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState('');
  const [showMoreGames, setShowMoreGames] = useState(false);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [playerImagesMap, setPlayerImagesMap] = useState({}); // normalized key -> { id, imageUrl }
  const [targetMaxSimilar, setTargetMaxSimilar] = useState(null);
  const [prefetchedTargetTop5, setPrefetchedTargetTop5] = useState([]); // top_5 for current target (prefetched)
  const [prefetchedTargetTop5Loading, setPrefetchedTargetTop5Loading] = useState(false);
  const [prefetchedTargetTop5For, setPrefetchedTargetTop5For] = useState(null); // playerName the prefetched top5 belongs to
  const [confirmAction, setConfirmAction] = useState(null); // 'reveal' | 'newGame' | null

  const key = mantleStorageKey;
  // Completion keys (legacy). We no longer persist completions, but we still clear these on sign-out/reset
  // to avoid any stale local data from older versions.
  const DAILY_COMPLETIONS_KEY = key('nba-mantle-daily-completions');
  const BALL_KNOWLEDGE_DAILY_KEY = key('nba-mantle-ball-knowledge-daily');

  const bestPrevRef = useRef(null);
  const guessSectionRef = useRef(null);
  const guessInputRef = useRef(null);
  const guessHistoryEndRef = useRef(null);
  const pulseGuessCardRef = useRef(null);
  const [bestSoFar, setBestSoFar] = useState(null);
  const [bestDelta, setBestDelta] = useState(null);

  const [nextDailyCountdown, setNextDailyCountdown] = useState(null);
  // Forces periodic re-renders so daily # updates promptly at the rollover moment
  // (even if no other state changes happen right at midnight).
  const [nowTs, setNowTs] = useState(() => Date.now());

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
  const postWinGlobalAvgReqIdRef = useRef(0);
  const postWinGlobalAvgInFlightRef = useRef(false);
  const [supabaseDebug, setSupabaseDebug] = useState({ lastSubmitOk: null, lastError: '' });
  const [backendWarming, setBackendWarming] = useState(false);
  const backendWarmPromiseRef = useRef(null);
  const backendLastWarmTsRef = useRef(0);
  const [shakeInput, setShakeInput] = useState(false);
  const [pulseGuessName, setPulseGuessName] = useState(null);
  const [confettiBurstId, setConfettiBurstId] = useState(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [guessHistorySort, setGuessHistorySort] = useState('score'); // 'score' | 'chronological'
  const [restoringTop5, setRestoringTop5] = useState(false);
  const [identityInitialized, setIdentityInitialized] = useState(false);
  const [anonId, setAnonId] = useState('');
  const anonIdFallbackRef = useRef(null);
  const sessionAnonIdRef = useRef('');
  // (leaderboard/profile modal removed)
  const [authSession, setAuthSession] = useState(null);
  /** True only while the first `getSession()` runs on app load. */
  const [authLoading, setAuthLoading] = useState(false);
  /** Which email-auth action is in flight (keeps form visible; null = idle). */
  const [emailAuthAction, setEmailAuthAction] = useState(null); // 'signin' | 'signup' | 'google' | 'resend' | 'reset' | null
  const [authError, setAuthError] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const accountSyncHardTimeoutRef = useRef({ key: '', timer: null });
  const accountSavingStartedAtRef = useRef(0);
  /** Used to prevent a race: hydrate-from-cloud can run before anon_links upsert finishes on mobile. */
  const [anonLinksLinkedForDevice, setAnonLinksLinkedForDevice] = useState(false);
  useEffect(() => {
    // Component unmount safety: clear any pending unblock timer.
    return () => {
      try {
        if (accountSyncHardTimeoutRef.current?.timer) clearTimeout(accountSyncHardTimeoutRef.current.timer);
      } catch {}
    };
  }, []);

  // Watchdog: if something goes wrong and `accountSaving` never clears, force it.
  useEffect(() => {
    const id = setInterval(() => {
      if (!accountSaving) return;
      const startedAt = accountSavingStartedAtRef.current;
      if (!startedAt) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed > 10000) {
        try {
          setAccountSaving(false);
          setAnonLinksLinkedForDevice(true);
          setAccountDisplayName((d) => (d ? d : ''));
          setAccountAvatarUrl((v) => v || '');
          setAccountIsVerified(false);
        } catch {}
      }
    }, 650);
    return () => clearInterval(id);
  }, [accountSaving]);
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState(false);
  const [newRecoveryPassword, setNewRecoveryPassword] = useState('');
  const [newRecoveryPassword2, setNewRecoveryPassword2] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [accountDisplayName, setAccountDisplayName] = useState('');
  const [accountAvatarUrl, setAccountAvatarUrl] = useState('');
  const [accountIsVerified, setAccountIsVerified] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const safeAccountDisplayName = typeof accountDisplayName === 'string' ? accountDisplayName : '';
  const [mantleRunsDetailsSupported, setMantleRunsDetailsSupported] = useState(null); // null | boolean
  const accountBackfillMarkerRef = useRef('');
  const accountDetailsSyncMarkerRef = useRef('');
  const cloudHydrateInFlightRef = useRef(false);
  const cloudHydrateLastTsRef = useRef(0);
  /** idle | saving | saved — drives Save name button + inline confirmation */
  const [profileSaveUi, setProfileSaveUi] = useState('idle');
  const [accountActivityToast, setAccountActivityToast] = useState(null); // { variant, message } | null
  const accountActivityToastTimerRef = useRef(null);

  const showAccountActivityToast = useCallback((message, variant = 'success') => {
    setAccountActivityToast({ message, variant });
    if (accountActivityToastTimerRef.current) clearTimeout(accountActivityToastTimerRef.current);
    accountActivityToastTimerRef.current = setTimeout(() => {
      setAccountActivityToast(null);
      accountActivityToastTimerRef.current = null;
    }, 3800);
  }, []);

  useEffect(() => {
    setProfileSaveUi('idle');
  }, [authSession?.user?.id]);

  // Detect whether mantle_runs supports storing details like guess_history/top5.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      try {
        const { error } = await supabase.from('mantle_runs').select('guess_history,top5').limit(1);
        if (cancelled) return;
        setMantleRunsDetailsSupported(!error);
      } catch {
        if (!cancelled) setMantleRunsDetailsSupported(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // API base URL - updated to match your backend
  const API_BASE = 'https://nba-mantle-6-5.onrender.com/api';
  // Same-origin /api — only daily/hardcore guess + reveal + ceiling (answers stay off the client).
  const SECURE_API_BASE = useMemo(() => {
    try {
      const fromEnv = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_ORIGIN;
      if (fromEnv) return `${String(fromEnv).replace(/\/$/, '')}/api`;
      if (typeof window !== 'undefined' && window.location?.origin) {
        return `${window.location.origin}/api`;
      }
    } catch {}
    return '/api';
  }, []);

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
        if (!res.ok) {
          let detail = '';
          try {
            const body = await res.json();
            const err = body?.error ? String(body.error) : '';
            const det = body?.details ? String(body.details) : '';
            const hint = body?.hint ? String(body.hint) : '';
            detail = [err, det && det !== err ? det : '', hint].filter(Boolean).join(' · ');
          } catch {
            try {
              detail = await res.text();
            } catch {}
          }
          throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
        }
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
  const leaderboardLoadInFlightRef = useRef(false);
  const loadLeaderboards = useCallback(async (modeInput, { force = false } = {}) => {
    const mode = modeInput === 'hardcore' ? 'hardcore' : 'daily';
    if (!force && leaderboardLoadInFlightRef.current) return;
    leaderboardLoadInFlightRef.current = true;
    setLeaderboardLoading(true);
    setLeaderboardError('');
    try {
      if (!supabase) throw new Error('Supabase is not configured');
      const limit = 20;
      const lookbackDays = 60;
      const todayDailyNumber = getDailyPuzzleDayIndex(new Date(), -1) + 1;
      const firstDailyNumber = Math.max(1, todayDailyNumber - lookbackDays + 1);

      const { data: rows, error: rpcErr } = await supabase.rpc('get_leaderboard_snapshot', {
        p_mode: mode,
        p_first_daily: firstDailyNumber,
        p_last_daily: todayDailyNumber,
      });
      if (rpcErr) throw rpcErr;

      const entries = (Array.isArray(rows) ? rows : [])
        .map((r) => {
          const user = String(r?.display_name || '').trim();
          if (!user) return null;
          const completions = Number(r?.completions) || 0;
          const wins = Number(r?.wins) || 0;
          const totalGuessesWins = Number(r?.total_guesses) || 0;
          const totalGuessesAll = Number(r?.total_guesses_all) || totalGuessesWins;
          return {
            userId: String(r?.user_id || '').trim(),
            user,
            completions,
            wins,
            totalGuessesWins,
            totalGuessesAll,
            currentStreak: Number(r?.current_live_streak) || 0,
            maxStreak: Number(r?.max_live_streak) || 0,
          };
        })
        .filter(Boolean);

      // One signed-in person can have multiple historical anon_ids.
      // Collapse by account so leaderboards show one row per real user.
      const byUser = new Map();
      for (const e of entries) {
        const key = e.userId || e.user.toLowerCase();
        const prev = byUser.get(key);
        if (!prev) {
          byUser.set(key, { ...e });
          continue;
        }
        prev.completions += e.completions;
        prev.wins += e.wins;
        prev.totalGuessesWins += e.totalGuessesWins;
        prev.totalGuessesAll += e.totalGuessesAll;
        if (e.maxStreak > prev.maxStreak) prev.maxStreak = e.maxStreak;
        if (e.currentStreak > prev.currentStreak) prev.currentStreak = e.currentStreak;
      }
      const mergedEntries = Array.from(byUser.values()).map((e) => {
        const avgGuesses = e.wins > 0 ? e.totalGuessesWins / e.wins : null;
        return {
          ...e,
          avgGuesses: avgGuesses == null ? null : Number(avgGuesses.toFixed(2)),
        };
      });

      const wins = mergedEntries
        .filter((e) => e.wins > 0)
        .sort((a, b) => {
          if (a.wins !== b.wins) return b.wins - a.wins;
          const aa = Number.isFinite(a.avgGuesses) ? a.avgGuesses : Infinity;
          const bb = Number.isFinite(b.avgGuesses) ? b.avgGuesses : Infinity;
          if (aa !== bb) return aa - bb;
          return b.maxStreak - a.maxStreak;
        })
        .slice(0, limit);

      const streaks = mergedEntries
        .sort((a, b) => {
          if (a.maxStreak !== b.maxStreak) return b.maxStreak - a.maxStreak;
          if (a.currentStreak !== b.currentStreak) return b.currentStreak - a.currentStreak;
          return b.wins - a.wins;
        })
        .slice(0, limit);

      const guesses = mergedEntries
        .filter((e) => e.totalGuessesAll > 0)
        .sort((a, b) => {
          if (a.totalGuessesAll !== b.totalGuessesAll) return b.totalGuessesAll - a.totalGuessesAll;
          return b.completions - a.completions;
        })
        .slice(0, limit);

      setLeaderboardData({
        mode,
        todayDailyNumber,
        lookbackDays,
        updatedAt: new Date().toISOString(),
        wins,
        streaks,
        guesses,
      });
    } catch (e) {
      setLeaderboardError(e?.message || 'Could not load leaderboards');
    } finally {
      leaderboardLoadInFlightRef.current = false;
      setLeaderboardLoading(false);
    }
  }, [supabase]);
  const warmBackend = async ({ force = false, background = false } = {}) => {
    const now = Date.now();
    if (!force && now - backendLastWarmTsRef.current < 1000 * 60 * 5) return true;
    if (backendWarmPromiseRef.current) return backendWarmPromiseRef.current;

    const run = (async () => {
      if (!background) setBackendWarming(true);
      try {
        await fetchJsonWithRetry(
          `${API_BASE}/players`,
          {},
          { timeoutMs: 20000, retries: 2, retryDelayMs: 1200 }
        );
        backendLastWarmTsRef.current = Date.now();
        return true;
      } catch {
        return false;
      } finally {
        if (!background) setBackendWarming(false);
        backendWarmPromiseRef.current = null;
      }
    })();

    backendWarmPromiseRef.current = run;
    return run;
  };

  const getOrCreateAnalyticsId = () => {
    try {
      // New anonymous identity for each page load (no storage persistence).
      if (sessionAnonIdRef.current) return sessionAnonIdRef.current;

      const id =
        (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
          ? globalThis.crypto.randomUUID()
          : `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      sessionAnonIdRef.current = id;
      return id;
    } catch {
      // If storage APIs themselves are blocked, still ensure we return a stable id.
      if (anonIdFallbackRef.current) return anonIdFallbackRef.current;
      const id =
        (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
          ? globalThis.crypto.randomUUID()
          : `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      anonIdFallbackRef.current = id;
      return id;
    }
  };

  // Generate a fresh anonymous identity on each page load.
  useEffect(() => {
    try {
      const id = getOrCreateAnalyticsId();
      setAnonId(id);
    } catch {
      setAnonId('');
    } finally {
      setIdentityInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auth: load current session + listen for changes.
  useEffect(() => {
    if (!supabase) return;
    let unsub = null;
    setAuthLoading(true);
    // Subscribe first so we don't miss one-time events triggered during getSession().
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Avoid "phantom sign-outs" caused by transient null sessions during init/refresh.
      // Only clear session when Supabase explicitly says it's signed out / deleted.
      const explicitSignOut = !session && (event === 'SIGNED_OUT' || event === 'USER_DELETED');
      if (session || explicitSignOut) setAuthSession(session ?? null);
      if (event === 'PASSWORD_RECOVERY' && session) {
        setPasswordRecoveryMode(true);
        setShowAccountModal(true);
        setAuthError('');
        setAuthNotice('You opened a password reset link. Choose a new password below.');
      }
      // Only clear account-local UI state on an explicit sign-out-like event.
      // Supabase can emit transient null sessions during init/refresh; clearing here would
      // incorrectly wipe local history when simply navigating/switching UI modes.
      const shouldClear =
        !session && (event === 'SIGNED_OUT' || event === 'USER_DELETED');
      if (shouldClear) {
        setAnonLinksLinkedForDevice(false);
        setPasswordRecoveryMode(false);
        setNewRecoveryPassword('');
        setNewRecoveryPassword2('');
        try { localStorage.removeItem(DAILY_COMPLETIONS_KEY); } catch {}
        try { localStorage.removeItem(BALL_KNOWLEDGE_DAILY_KEY); } catch {}
        setDailyCompletions({});
        setBallKnowledgeDailyCompletions({});
        setSelectedDailyDetail(null);
        setSelectedBallKnowledgeDetail(null);
        setAccountDisplayName('');
        setAccountAvatarUrl('');
        setAccountIsVerified(false);
        setAuthNotice('');
      }
    });
    unsub = data?.subscription || null;

    const timeoutMs = 5000;
    const withTimeout = (promise, label) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(label)), timeoutMs)),
      ]);

    withTimeout(supabase.auth.getSession(), 'Supabase getSession timeout')
      .then(({ data }) => {
        setAuthSession(data.session ?? null);
      })
      .catch((err) => {
        // Important: do NOT clear auth session on timeout/network errors.
        // That would look like a random sign-out on mobile.
        console.warn('Supabase getSession error/timeout:', err?.message || err);
      })
      .finally(() => setAuthLoading(false));

    return () => {
      try {
        unsub?.unsubscribe?.();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getDefaultDisplayNameForUser = (user) => {
    const md = user?.user_metadata || {};
    return (
      String(md?.name || md?.full_name || user?.email?.split('@')?.[0] || 'Player').trim() || 'Player'
    );
  };

  const getDefaultAvatarForUser = (user) => {
    const md = user?.user_metadata || {};
    return String(md?.picture || md?.avatar_url || '').trim();
  };

  const isLikelyGmailAddress = (emailRaw) => {
    const email = String(emailRaw || '').trim().toLowerCase();
    return email.endsWith('@gmail.com') || email.endsWith('@googlemail.com');
  };

  // After login, link this device's anon_id to the user, then load their profile.
  // Important: do NOT overwrite an existing display_name every login.
  useEffect(() => {
    if (!supabase) return;
    if (!authSession?.user) return;
    if (!identityInitialized) return;
    if (!anonId) return;

    const userId = authSession.user.id;
    const syncKey = `${userId}:${anonId}`;
    // Prevent "Syncing..." from re-triggering endlessly during mobile token refreshes.
    if (accountDetailsSyncMarkerRef.current === syncKey && anonLinksLinkedForDevice) {
      // If we already linked and still show "Syncing...", it means we got stuck mid-flight.
      // Force-unblock the UI rather than re-running the sync.
      setAccountSaving(false);
      return;
    }
    accountDetailsSyncMarkerRef.current = syncKey;

    // Reset the gate each time we sign into a (potentially new) user or device anon_id.
    setAnonLinksLinkedForDevice(false);

    const fallbackDisplayName = getDefaultDisplayNameForUser(authSession.user);
    const fallbackAvatarUrl = getDefaultAvatarForUser(authSession.user);

    let cancelled = false;
    setAccountSaving(true);
    accountSavingStartedAtRef.current = Date.now();
    setAuthError('');

    // Safety: if any of the network/auth calls hang, the UI must not stay in "Syncing…" forever.
    // Use a ref-backed timer so it isn't cancelled/restarted by effect re-runs.
    const accountSyncKey = `${userId}:${anonId}`;
    if (accountSyncHardTimeoutRef.current.key !== accountSyncKey) {
      try {
        if (accountSyncHardTimeoutRef.current.timer) clearTimeout(accountSyncHardTimeoutRef.current.timer);
      } catch {}
      accountSyncHardTimeoutRef.current.key = accountSyncKey;
      const unblockMs = 7000;
      accountSyncHardTimeoutRef.current.timer = setTimeout(() => {
        try {
          setAccountSaving(false);
          setAnonLinksLinkedForDevice(true);
          // Show something immediately; profile will update when/if it finishes.
          setAccountDisplayName(fallbackDisplayName);
          setAccountAvatarUrl(fallbackAvatarUrl || '');
          setAccountIsVerified(false);
        } catch {}
      }, unblockMs);
    }

    (async () => {
      const timeoutMs = 5000;
      const withTimeout = (promise, label) =>
        Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error(label)), timeoutMs)),
        ]);

      try {
        // Ensure the Supabase client has this JWT before RLS-checked writes.
        // React state can update before the client's auth store does → requests look like `anon` → 403 on anon_links.
        if (authSession?.access_token && authSession?.refresh_token) {
          try {
            await withTimeout(
              supabase.auth.setSession({
                access_token: authSession.access_token,
                refresh_token: authSession.refresh_token,
              }),
              'Supabase setSession timeout'
            );
          } catch (e) {
            // If setSession hangs/fails, we still attempt anon_links/profile writes below.
            console.warn('Supabase setSession failed/timeout:', e?.message || e);
          }
        }

        // 1) Link this device's anon_id to the signed-in user.
        try {
          const { error: linkErr } = await withTimeout(
            supabase
              .from('anon_links')
              .upsert(
                { anon_id: anonId, user_id: userId, created_at: new Date().toISOString() },
                { onConflict: 'anon_id' }
              ),
            'anon_links upsert timeout'
          );
          if (linkErr) console.warn('anon_links upsert:', linkErr.message || linkErr);
        } catch (e) {
          console.warn('anon_links upsert failed:', e?.message || e);
        }

        // Important: unblock cloud hydration after anon_links is at least attempted.
        // Even if linking fails, we don't want hydration stuck waiting forever.
        if (!cancelled) setAnonLinksLinkedForDevice(true);

        // Unblock UI fast. Profiles load in the background; cloud hydration depends only on anon_links.
        if (!cancelled) {
          setAccountSaving(false);
          setAccountDisplayName(fallbackDisplayName);
          setAccountAvatarUrl(fallbackAvatarUrl || '');
          setAccountIsVerified(false);
        }

        // 2) Load profile if it exists.
        let profile = null;
        try {
          const { data } = await withTimeout(
            supabase
              .from('profiles')
              .select('display_name, avatar_url, is_verified')
              .eq('user_id', userId)
              .maybeSingle(),
            'profiles select timeout'
          );
          profile = data ?? null;
        } catch {}

        // 3) If no profile yet, create one using OAuth metadata defaults.
        if (!profile) {
          try {
            await withTimeout(
              supabase
                .from('profiles')
                .upsert(
                  {
                    user_id: userId,
                    display_name: fallbackDisplayName,
                    avatar_url: fallbackAvatarUrl || null,
                    is_verified: false,
                    updated_at: new Date().toISOString(),
                  },
                  { onConflict: 'user_id' }
                ),
              'profiles upsert timeout'
            );
            profile = { display_name: fallbackDisplayName, avatar_url: fallbackAvatarUrl || null, is_verified: false };
          } catch {}
        }

        if (cancelled) return;
        const dn = typeof profile?.display_name === 'string' ? profile.display_name : fallbackDisplayName;
        const av = typeof profile?.avatar_url === 'string' ? profile.avatar_url : (fallbackAvatarUrl || '');
        const ver = !!profile?.is_verified;
        setAccountDisplayName(dn);
        setAccountAvatarUrl(av || '');
        setAccountIsVerified(ver);
      } catch (e) {
        // If network/auth calls hang, we still want to unblock the UI.
        console.warn('Account sync timeout/error:', e?.message || e);
        setAuthError(e?.message ? `Account sync failed: ${e.message}` : 'Account sync failed');
      } finally {
        if (!cancelled) setAccountSaving(false);
      }
    })();

    return () => {
      cancelled = true;
      // If this run is superseded or unmounted before the async work finishes, `finally`
      // skips clearing — without this, accountSaving stays true and Save / Sign out stay disabled.
      setAccountSaving(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authSession?.user?.id, identityInitialized, anonId]);

  const handleSignInWithEmail = async () => {
    if (!supabase) return;
    setEmailAuthAction('signin');
    setAuthError('');
    setAuthNotice('');
    try {
      const timeoutMs = 12000;
      const res = await Promise.race([
        supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Sign in timed out. Try again.')), timeoutMs)),
      ]);
      if (res.error) throw res.error;
      setAuthSession(res.data.session ?? null);
      setShowAccountModal(false);
      showAccountActivityToast('Signed in.', 'success');
    } catch (e) {
      const msg = e?.message || 'Sign in failed';
      const lower = String(msg).toLowerCase();
      if (
        isLikelyGmailAddress(authEmail) &&
        (lower.includes('invalid login credentials') ||
          lower.includes('email not confirmed') ||
          lower.includes('invalid email or password'))
      ) {
        setAuthError(
          `${msg} If this Gmail was created with Google OAuth, use "Continue with Google" instead of email/password.`
        );
      } else {
        setAuthError(msg);
      }
    } finally {
      setEmailAuthAction(null);
    }
  };

  const handleAuthFieldKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    if (emailAuthAction !== null) return;
    e.preventDefault();
    void handleSignInWithEmail();
  };

  const handleSignUpWithEmail = async () => {
    if (!supabase) return;
    setEmailAuthAction('signup');
    setAuthError('');
    setAuthNotice('');
    try {
      const email = authEmail.trim();
      const password = authPassword;
      if (!email) throw new Error('Please enter your email.');
      if (!password) throw new Error('Please enter your password.');

      // Only provide emailRedirectTo when explicitly configured.
      // Otherwise Supabase will use its configured Site URL.
      const configuredEmailRedirectTo = import.meta.env.VITE_SUPABASE_OAUTH_REDIRECT_TO || '';
      const payload = {
        email,
        password,
      };
      if (configuredEmailRedirectTo) {
        payload.options = { emailRedirectTo: getRedirectToWithSid(configuredEmailRedirectTo) };
      }

      const res = await supabase.auth.signUp(payload);
      if (res.error) throw res.error;

      const nextSession = res.data?.session ?? null;
      setAuthSession(nextSession);
      setShowAccountModal(false);
      if (nextSession) {
        showAccountActivityToast('Account created — you are signed in.', 'success');
      } else {
        const gmailHint = isLikelyGmailAddress(email)
          ? ' If this Gmail is meant for Google OAuth, use "Continue with Google" (no confirmation email in that flow).'
          : '';
        showAccountActivityToast(
          `Check your email to confirm your account, then use Sign in here.${gmailHint}`,
          'success'
        );
      }
    } catch (e) {
      const msg = e?.message || 'Sign up failed';
      const lower = String(msg).toLowerCase();
      if (
        isLikelyGmailAddress(authEmail) &&
        (lower.includes('already') ||
          lower.includes('registered') ||
          lower.includes('exists') ||
          lower.includes('identity'))
      ) {
        setAuthError(`${msg} If this Gmail already uses Google sign-in, click "Continue with Google".`);
      } else {
        setAuthError(msg);
      }
    } finally {
      setEmailAuthAction(null);
    }
  };

  const handleResendSignupConfirmation = async () => {
    if (!supabase) return;
    const email = authEmail.trim();
    if (!email) return;
    setEmailAuthAction('resend');
    setAuthError('');
    setAuthNotice('');
    if (isLikelyGmailAddress(email)) {
      setAuthNotice(
        'Using Gmail with Google OAuth does not use verification emails. If this account is Google-based, click "Continue with Google".'
      );
    }
    try {
      const configuredEmailRedirectTo = import.meta.env.VITE_SUPABASE_OAUTH_REDIRECT_TO || '';
      const payload = {
        type: 'signup',
        email,
      };
      if (configuredEmailRedirectTo) {
        payload.options = { emailRedirectTo: getRedirectToWithSid(configuredEmailRedirectTo) };
      }

      const res = await supabase.auth.resend(payload);
      if (res.error) throw res.error;
      setAuthNotice('If the email is deliverable, you should receive another confirmation shortly.');
      showAccountActivityToast('If that address is registered, a confirmation email is on the way.', 'success');
    } catch (e) {
      setAuthError(e?.message || 'Could not resend confirmation email');
    } finally {
      setEmailAuthAction(null);
    }
  };

  const handleSignInWithGoogle = async () => {
    if (!supabase) return;
    setEmailAuthAction('google');
    setAuthError('');
    setAuthNotice('');
    try {
      // Supabase will use its configured Site URL / redirect rules.
      // Only provide redirectTo when explicitly configured to avoid
      // "redirect_to parameter is not allowed" failures.
      const configuredRedirectTo = import.meta.env.VITE_SUPABASE_OAUTH_REDIRECT_TO || '';
      const payload = {
        provider: 'google',
      };
      if (configuredRedirectTo) {
        payload.options = { redirectTo: getRedirectToWithSid(configuredRedirectTo) };
      }

      const timeoutMs = 12000;
      const res = await Promise.race([
        supabase.auth.signInWithOAuth(payload),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Google sign-in timed out. Try again.')), timeoutMs)),
      ]);
      if (res.error) throw res.error;
    } catch (e) {
      console.error('Google sign-in error:', e);
      setAuthError(e?.message || 'Google sign-in failed');
      setEmailAuthAction(null);
    }
  };

  const handleResetPassword = async () => {
    if (!supabase) return;
    const email = authEmail.trim();
    if (!email) {
      setAuthError('Enter the email you used to sign up.');
      return;
    }
    setEmailAuthAction('reset');
    setAuthError('');
    setAuthNotice('');
    try {
      const redirectTo = getPasswordRecoveryRedirectTo();
      const timeoutMs = 12000;
      const resetPromise = redirectTo
        ? supabase.auth.resetPasswordForEmail(email, { redirectTo })
        : supabase.auth.resetPasswordForEmail(email);
      const res = await Promise.race([
        resetPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Reset request timed out. Try again.')), timeoutMs)),
      ]);
      if (res.error) throw res.error;
      setAuthNotice(
        'If that address has an account, we sent a reset link. Check your inbox and spam folder. The link opens this site so you can pick a new password.'
      );
      setShowForgotPassword(false);
      showAccountActivityToast('If that email is registered, we sent a reset link.', 'success');
    } catch (e) {
      setAuthError(e?.message || 'Reset failed');
    } finally {
      setEmailAuthAction(null);
    }
  };

  const handleRecoverySetPassword = async () => {
    if (!supabase) return;
    const p1 = newRecoveryPassword;
    const p2 = newRecoveryPassword2;
    if (p1.length < 6) {
      setAuthError('Use at least 6 characters.');
      return;
    }
    if (p1 !== p2) {
      setAuthError('Passwords do not match.');
      return;
    }
    setRecoveryBusy(true);
    setAuthError('');
    try {
      const timeoutMs = 12000;
      const res = await Promise.race([
        supabase.auth.updateUser({ password: p1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Save password timed out. Try again.')), timeoutMs)),
      ]);
      const { error } = res ?? {};
      if (error) throw error;
      setPasswordRecoveryMode(false);
      setNewRecoveryPassword('');
      setNewRecoveryPassword2('');
      setAuthNotice('Password updated. You are signed in.');
      setShowAccountModal(false);
    } catch (e) {
      setAuthError(e?.message || 'Could not update password');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleSignOut = () => {
    if (!supabase) return;
    setShowAccountModal(false);
    setAuthError('');
    setAuthNotice('');
    setAnonLinksLinkedForDevice(false);
    accountDetailsSyncMarkerRef.current = '';
    setPasswordRecoveryMode(false);
    setNewRecoveryPassword('');
    setNewRecoveryPassword2('');
    setShowForgotPassword(false);
    setProfileSaveUi('idle');
    setAuthSession(null);
    try { localStorage.removeItem(DAILY_COMPLETIONS_KEY); } catch {}
    try { localStorage.removeItem(BALL_KNOWLEDGE_DAILY_KEY); } catch {}
    setDailyCompletions({});
    setBallKnowledgeDailyCompletions({});
    setSelectedDailyDetail(null);
    setSelectedBallKnowledgeDetail(null);
    resetPuzzleState();
    setAccountDisplayName('');
    setAccountAvatarUrl('');
    setAccountIsVerified(false);
    setAuthEmail('');
    setAuthPassword('');
    try { localStorage.removeItem(key('nba-mantle-cloud-user-id')); } catch {}
    void (async () => {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.warn('signOut:', error.message || error);
        showAccountActivityToast(
          "Couldn't finish signing out with the server. Refresh the page if your account still looks signed in.",
          'error'
        );
        return;
      }
      showAccountActivityToast('Signed out. Guest mode on this device — sign in anytime to sync again.', 'success');
    })();
  };

  const handleSaveDisplayName = (overrideDisplayName) => {
    if (!supabase) return;
    if (!authSession?.user) return;
    if (profileSaveUi === 'saving') return;
    // If this handler is accidentally used directly as an `onClick` handler,
    // React will pass the click event as the first argument. Guard against that.
    const candidate =
      typeof overrideDisplayName === 'string' ? overrideDisplayName : undefined;
    const displayName = String(candidate ?? accountDisplayName).trim();
    if (!displayName) {
      setAuthError('Enter a display name.');
      showAccountActivityToast('Enter a display name to save.', 'error');
      return;
    }
    const avatarUrl = accountAvatarUrl.trim() || null;
    const userId = authSession.user.id;

    setAuthError('');
    setProfileSaveUi('saving');

    void supabase
      .from('profiles')
      .update({ display_name: displayName, avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .then(async ({ error }) => {
        if (error) {
          const msg = error.message || 'Could not save profile';
          setAuthError(msg);
          showAccountActivityToast(msg, 'error');
          setProfileSaveUi('idle');
          try {
            const { data } = await supabase
              .from('profiles')
              .select('display_name, avatar_url, is_verified')
              .eq('user_id', userId)
              .maybeSingle();
            if (data) {
              setAccountDisplayName(typeof data.display_name === 'string' ? data.display_name : '');
              setAccountAvatarUrl(typeof data.avatar_url === 'string' ? data.avatar_url : '');
              setAccountIsVerified(!!data.is_verified);
            }
          } catch {
            // ignore
          }
          return;
        }
        setAccountDisplayName(displayName);
        setProfileSaveUi('saved');
        showAccountActivityToast('Display name saved. Leaderboards will use this name.', 'success');
        window.setTimeout(() => {
          setProfileSaveUi((s) => (s === 'saved' ? 'idle' : s));
        }, 2800);
      })
      .catch((e) => {
        const msg = e?.message || 'Could not save profile';
        setAuthError(msg);
        showAccountActivityToast(msg, 'error');
        setProfileSaveUi('idle');
      });
  };

  const submitCompletionToCloud = async (
    { mode, dailyNumber, date, answer, guesses, won, guessHistory = [], top5 = [] },
    { uiNotify = false } = {}
  ) => {
    try {
      let user_id = authSession?.user?.id || null;
      // Auth state can lag right after sign-in on some devices/browsers.
      // Pull from Supabase session as fallback so signed-in saves keep user_id.
      if (!user_id && supabase) {
        try {
          const { data } = await supabase.auth.getSession();
          user_id = data?.session?.user?.id || null;
        } catch {}
      }
      const deviceAnonId = getOrCreateAnalyticsId();
      // Table uniqueness is keyed by anon_id+mode+daily_number.
      // Use a per-account key when signed in so different accounts on one device do not collide.
      const anon_id = user_id ? `user:${user_id}` : deviceAnonId;
      // Treat "unknown" as supported so we don't drop guess history on first save.
      const detailsOk = mantleRunsDetailsSupported !== false;

      if (!supabase) {
        setSupabaseDebug({ lastSubmitOk: false, lastError: 'Supabase not configured (missing VITE env vars)' });
        if (uiNotify) showAccountActivityToast('Cloud save unavailable (Supabase not configured).', 'error');
        return;
      }

      const payload = {
        anon_id,
        user_id,
        mode,
        daily_number: dailyNumber,
        date,
        answer,
        guesses,
        won,
        ...(detailsOk ? { guess_history: guessHistory, top5 } : {}),
      };

      // One row per (anon_id, mode, daily_number) — DB enforces uniqueness (e.g. mantle_runs_unique).
      // Upsert so replays / retries update instead of violating the constraint.
      try {
        const ins = await supabase.from('mantle_runs').upsert(payload, {
          onConflict: 'anon_id,mode,daily_number',
        });
        if (ins?.error) throw ins.error;
      } catch (e) {
        // Fallback for older DBs that don't have detail columns yet.
        if (detailsOk) {
          const retryPayload = {
            anon_id,
            user_id,
            mode,
            daily_number: dailyNumber,
            date,
            answer,
            guesses,
            won,
          };
          try {
            const retry = await supabase.from('mantle_runs').upsert(retryPayload, {
              onConflict: 'anon_id,mode,daily_number',
            });
            if (!retry?.error) {
              setMantleRunsDetailsSupported(false);
            } else {
              throw retry.error;
            }
          } catch (retryErr) {
            const msg = retryErr?.message || 'Save failed';
            console.error('Supabase mantle_runs insert error:', retryErr);
            setSupabaseDebug({ lastSubmitOk: false, lastError: msg });
            if (uiNotify) showAccountActivityToast(`Cloud save failed: ${msg}`, 'error');
            return;
          }
        } else {
        const msg = e?.message || 'Save failed';
        console.error('Supabase mantle_runs insert error:', e);
        setSupabaseDebug({ lastSubmitOk: false, lastError: msg });
        if (uiNotify) showAccountActivityToast(`Cloud save failed: ${msg}`, 'error');
        return;
        }
      }

      setSupabaseDebug({ lastSubmitOk: true, lastError: '' });
      if (uiNotify) showAccountActivityToast('Saved to cloud.', 'success');

      // After a successful write, refresh cloud completions so stats/past games update immediately.
      try {
        cloudHydrateLastTsRef.current = 0;
      } catch {}

      // Bust global-average cache and refetch so win count / avg update immediately (not stuck on 1 win / 12h cache).
      try {
        const m = mode === 'hardcore' ? 'hardcore' : 'daily';
        const cacheKey = key(`nba-mantle-global-daily-avg-v2-${m}-${dailyNumber}`);
        localStorage.removeItem(cacheKey);
      } catch {}
      void (async () => {
        try {
          const m = mode === 'hardcore' ? 'hardcore' : 'daily';
          const next = await fetchGlobalDailyAverage({ mode: m, dailyNumber, forceRefresh: true });
          setPostWinGlobalDailyAverage(next);
        } catch {}
      })();
    } catch {
      // ignore
    }
  };

  const hydrateCompletionsFromCloud = useCallback(async ({ force = false } = {}) => {
    if (!supabase) return false;
    if (!authSession?.user?.id) return false;
    if (!identityInitialized) return false;
    if (!anonId) return false;

    const now = Date.now();
    if (!force && now - cloudHydrateLastTsRef.current < 2500) return true;
    if (cloudHydrateInFlightRef.current) return true;
    cloudHydrateInFlightRef.current = true;
    cloudHydrateLastTsRef.current = now;

    try {
      const userId = authSession.user.id;
      const detailsOk = mantleRunsDetailsSupported === true;
      let mergedRows = [];

      const { data: rpcRows, error: rpcErr } = await supabase.rpc('get_my_mantle_runs');
      if (!rpcErr && Array.isArray(rpcRows)) {
        mergedRows = rpcRows;
      } else {
          const columns = detailsOk
          ? 'anon_id,mode,daily_number,date,answer,guesses,won,created_at,guess_history,top5'
          : 'anon_id,mode,daily_number,date,answer,guesses,won,created_at';
        const userQuery = supabase.from('mantle_runs').select(columns).eq('user_id', userId).limit(5000);
        let anonQuery = Promise.resolve({ data: [], error: null });
        if (anonLinksLinkedForDevice) {
          anonQuery = (async () => {
            try {
              const { data: links, error: linksErr } = await supabase
                .from('anon_links')
                .select('anon_id')
                .eq('user_id', userId)
                .limit(200);
              if (linksErr) return { data: [], error: linksErr };
              const anonIds = Array.from(
                new Set((links || []).map((r) => String(r?.anon_id || '').trim()).filter(Boolean))
              );
              if (!anonIds.length) return { data: [], error: null };
              return supabase.from('mantle_runs').select(columns).in('anon_id', anonIds).limit(5000);
            } catch (e) {
              return { data: [], error: e };
            }
          })();
        }

        const [byUserRes, byAnonRes] = await Promise.all([userQuery, anonQuery]);
        mergedRows = [
          ...(Array.isArray(byUserRes?.data) ? byUserRes.data : []),
          ...(Array.isArray(byAnonRes?.data) ? byAnonRes.data : []),
        ];
      }

      const rowMap = new Map();
      const rowScore = (row) => {
        const gh = Array.isArray(row?.guess_history) ? row.guess_history.length : 0;
        const t5 = Array.isArray(row?.top5) ? row.top5.length : 0;
        const ca = typeof row?.created_at === 'string' ? row.created_at : '';
        return { n: gh + t5, ca };
      };
      for (const r of mergedRows) {
        const m = String(r?.mode || '');
        const normalizedMode = m === 'hardcore' ? 'hardcore' : 'daily';
        const dn = Number(r?.daily_number);
        if (!Number.isFinite(dn) || dn < 1) continue;
        const logicalKey = `${normalizedMode}|${dn}`;
        const prev = rowMap.get(logicalKey);
        if (!prev) {
          rowMap.set(logicalKey, r);
          continue;
        }
        const a = rowScore(prev);
        const b = rowScore(r);
        if (b.n > a.n || (b.n === a.n && b.ca > a.ca)) rowMap.set(logicalKey, r);
      }
      const rows = Array.from(rowMap.values());

      const toCompletionMap = (modeKey) => {
        const out = {};
        for (const r of rows) {
          const m = String(r?.mode || '');
          const normalizedMode = m === 'hardcore' ? 'hardcore' : 'daily';
          if (normalizedMode !== modeKey) continue;

          const n = Number(r?.daily_number);
          if (!Number.isFinite(n) || n < 1) continue;
          const keyNum = String(n);

          const dateStr = typeof r?.date === 'string' ? r.date : '';
          const completedAt = typeof r?.created_at === 'string' ? r.created_at : '';
          const guesses = typeof r?.guesses === 'number' ? r.guesses : null;
          const won = r?.won !== false;
          const answer = typeof r?.answer === 'string' ? r.answer : '';
          const guessHistory = Array.isArray(r?.guess_history) ? r.guess_history : [];
          const top5 = Array.isArray(r?.top5) ? r.top5 : [];

          const prev = out[keyNum];
          if (!prev || (completedAt && prev.completedAt && completedAt > prev.completedAt) || (!prev.completedAt && completedAt)) {
            out[keyNum] = { date: dateStr, completedAt, guesses, guessHistory, won, answer, top5 };
          }
        }
        return out;
      };

      const dailyFromCloud = toCompletionMap('daily');
      const hardcoreFromCloud = toCompletionMap('hardcore');

      const merge = (local, cloud) => {
        const next = { ...(local || {}) };
        for (const [k, v] of Object.entries(cloud || {})) {
          if (!next[k]) {
            next[k] = v;
            continue;
          }
          const localEntry = next[k];
          const hasLocalDetails =
            Array.isArray(localEntry?.guessHistory) && localEntry.guessHistory.length > 0
              ? true
              : Array.isArray(localEntry?.top5) && localEntry.top5.length > 0;
          next[k] = hasLocalDetails ? { ...v, ...localEntry } : { ...localEntry, ...v };
        }
        return next;
      };

      // Signed-in cloud sync is the source of truth, but preserve richer local in-memory
      // details (guessHistory/top5) when cloud rows are missing detail columns.
      setDailyCompletions((prev) => merge(prev, dailyFromCloud || {}));
      setBallKnowledgeDailyCompletions((prev) => merge(prev, hardcoreFromCloud || {}));
      return true;
    } catch (e) {
      console.warn('Cloud hydrate failed:', e?.message || e);
      return false;
    } finally {
      cloudHydrateInFlightRef.current = false;
    }
  }, [
    anonId,
    anonLinksLinkedForDevice,
    authSession?.access_token,
    authSession?.refresh_token,
    authSession?.user?.id,
    identityInitialized,
    mantleRunsDetailsSupported,
  ]);

  const handleForceRefreshCloud = useCallback(() => {
    void hydrateCompletionsFromCloud({ force: true }).then((ok) => {
      if (ok) showAccountActivityToast('Cloud stats refreshed.', 'success');
      else showAccountActivityToast('Could not refresh cloud stats yet.', 'error');
    });
  }, [hydrateCompletionsFromCloud, showAccountActivityToast]);

  const resetAllLocalDataNow = () => {
    try {
      // Remove all keys we own, across versions, plus the reset marker.
      const markerKey = 'nba-mantle-storage-reset-marker';
      const testerKey = 'nba-mantle-tester';
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k) continue;
        // Preserve tester flag so you can repeatedly reset while staying in tester mode.
        if (k === markerKey || (k.startsWith('nba-mantle-') && k !== testerKey)) {
          localStorage.removeItem(k);
        }
      }
    } catch {}
    try { sessionStorage.clear(); } catch {}
    // Hard reload so React state can't keep stale data
    try { window.location.reload(); } catch {}
  };

  // (intentionally no public "test write" in production UI)

  // v2 key: older builds cached 12h from RPC that read mantle_run_attempts → stuck at "1 win".
  const GLOBAL_AVG_CACHE_TTL_MS = 1000 * 90; // 90s — stats should feel live; bust on each cloud save too.
  const readCachedGlobalDailyAverage = ({ mode, dailyNumber }) => {
    const m = mode === 'hardcore' ? 'hardcore' : 'daily';
    const n = Number(dailyNumber);
    if (!Number.isFinite(n) || n < 1) return null;
    const cacheKey = key(`nba-mantle-global-daily-avg-v2-${m}-${n}`);
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.ts || typeof parsed.ts !== 'number') return null;
      if (Date.now() - parsed.ts > GLOBAL_AVG_CACHE_TTL_MS) return null;
      return parsed?.value ?? null;
    } catch {
      return null;
    }
  };

  const fetchGlobalDailyAverage = async ({ mode, dailyNumber, forceRefresh = false }) => {
    // mode: 'daily' | 'hardcore'
    const m = mode === 'hardcore' ? 'hardcore' : 'daily';
    const n = Number(dailyNumber);
    if (!Number.isFinite(n) || n < 1) return null;

    const cacheKey = key(`nba-mantle-global-daily-avg-v2-${m}-${n}`);
    if (!forceRefresh) {
      const cached = readCachedGlobalDailyAverage({ mode: m, dailyNumber: n });
      if (cached != null) return cached;
    }

    // Global averages: Supabase RPC aggregates mantle_runs in SQL (see setup.sql).
    // Keep this fast: if Supabase is slow/unreachable, return quickly (UI treats it as optional).
    const RPC_TIMEOUT_MS = 4000;
    const withRpcTimeout = (promise) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), RPC_TIMEOUT_MS)),
      ]);

    // Preferred: single-daily RPC (AVG + COUNT in Postgres).
    if (supabase) {
      try {
        const { data: rpcData, error: rpcErr } = await withRpcTimeout(supabase.rpc(
          'get_mantle_answer_averages_for_daily',
          { p_mode: m, p_daily_number: n }
        ));
        if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
          const row = rpcData[0] ?? {};
          const avg = row?.avg == null ? null : Number(row.avg);
          const wins = row?.wins == null ? null : Number(row.wins);
          if (avg == null) {
            const value = { avg: null, wins: Number.isFinite(wins) ? wins : null };
            try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), value })); } catch {}
            return value;
          }
          if (Number.isFinite(avg)) {
            const value = { avg, wins: Number.isFinite(wins) ? wins : null };
            try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), value })); } catch {}
            return value;
          }
        }
      } catch {
        // RPC missing, slow, or old — fall back below.
      }

      // Fallback: compute from mantle_runs rows if RPC is unavailable.
      // This keeps the UI working even when the optional RPC hasn't been deployed yet.
      try {
        const { data: rows, error: rowsErr } = await withRpcTimeout(
          supabase
            .from('mantle_runs')
            .select('guesses')
            .eq('mode', m)
            .eq('daily_number', n)
            .eq('won', true)
            .limit(50000)
        );
        if (!rowsErr && Array.isArray(rows)) {
          const wins = rows.length;
          if (wins === 0) {
            const value = { avg: null, wins: 0 };
            try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), value })); } catch {}
            return value;
          }
          let total = 0;
          for (const r of rows) {
            const g = Number(r?.guesses);
            if (Number.isFinite(g)) total += g;
          }
          const avg = total / Math.max(1, wins);
          if (Number.isFinite(avg)) {
            const value = { avg, wins };
            try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), value })); } catch {}
            return value;
          }
        }
      } catch {}
    }

    return null;
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

  // Daily # uses the shared calendar timezone (America/New_York),
  // so rollover happens at midnight in Boston/ET.
  // Offset so today's daily numbering matches the expected live rollout.
  // If you see "Daily #2" before midnight for your timezone, this is the knob.
  const DAILY_PUZZLE_INDEX_OFFSET = -1;
  const getDailyPuzzleIndex = () => getDailyPuzzleDayIndex(new Date(), DAILY_PUZZLE_INDEX_OFFSET);
  const getDailyPlayerForIndex = (index) =>
    DAILY_PLAYERS[index % DAILY_PLAYERS.length] ?? DAILY_PLAYERS[0];
  const getBallKnowledgeDailyPlayer = (index) =>
    BALL_KNOWLEDGE_DAILY_PLAYERS[index % BALL_KNOWLEDGE_DAILY_PLAYERS.length] ?? BALL_KNOWLEDGE_DAILY_PLAYERS[0];

  // Allow playing a past daily by selecting a specific day index.
  // This affects Daily + Hardcore Daily (same calendar).
  const [selectedDailyIndexOverride, setSelectedDailyIndexOverride] = useState(null); // number | null
  const [showPastDailyPicker, setShowPastDailyPicker] = useState(false);
  const todayDailyIndex = getDailyPuzzleDayIndex(new Date(nowTs), DAILY_PUZZLE_INDEX_OFFSET);
  const getYmdInTimeZone = (date, timeZone) => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const y = parts.find((p) => p.type === 'year')?.value;
      const m = parts.find((p) => p.type === 'month')?.value;
      const d = parts.find((p) => p.type === 'day')?.value;
      if (!y || !m || !d) return '';
      return `${y}-${m}-${d}`;
    } catch {
      return '';
    }
  };
  const todayYmdNY = getYmdInTimeZone(new Date(nowTs), 'America/New_York');
  const lastTodayYmdNYRef = useRef(null);
  useEffect(() => {
    if (!todayYmdNY) return;
    const prev = lastTodayYmdNYRef.current;
    lastTodayYmdNYRef.current = todayYmdNY;
    // If user had selected a past day, clear it when the live rollover day changes.
    // This prevents "Daily #2" sticking after midnight.
    if (prev && prev !== todayYmdNY && selectedDailyIndexOverride != null) {
      setSelectedDailyIndexOverride(null);
      setShowPastDailyPicker(false);
    }
  }, [todayYmdNY, selectedDailyIndexOverride]);
  const activeDailyIndex =
    (gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && selectedDailyIndexOverride != null
      ? selectedDailyIndexOverride
      : todayDailyIndex;
  const activeDailyNumber = activeDailyIndex + 1;
  const isPastDailySelected = activeDailyIndex !== todayDailyIndex;

  // (leaderboard/profile modal removed)

  const formatHMS = useCallback((ms) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }, []);

  const getISODateForDailyIndex = (index) => getISODateForDailyIndexFromEpoch(index);

  const computeDailyStats = (completions, todayIdx) => {
    const entries = Object.entries(completions || {});
    const totalPlayed = entries.length;

    const wonEntries = entries
      .map(([num, entry]) => ({ num: Number(num), entry }))
      .filter(({ num }) => Number.isFinite(num) && num > 0)
      .filter(({ entry }) => typeof entry === 'object' && entry != null && entry?.won !== false && entry?.guesses != null);

    const wins = wonEntries.length;
    const avgGuesses =
      wins > 0
        ? wonEntries.reduce((sum, { entry }) => sum + (Number(entry.guesses) || 0), 0) / wins
        : null;

    const reveals = entries.filter(([, entry]) => typeof entry === 'object' && entry != null && entry?.won === false).length;

    const isLiveWin = (num, entry) => {
      if (!Number.isFinite(num) || num <= 0) return false;
      if (!(typeof entry === 'object' && entry != null && entry?.won !== false)) return false;
      const completedAt = entry?.completedAt ?? '';
      if (typeof completedAt !== 'string' || !completedAt) return false;
      // IMPORTANT: compare using the puzzle timezone (ET), not UTC.
      // ISO timestamps are stored in UTC (`Z`), so slicing YYYY-MM-DD can incorrectly
      // shift late-evening ET solves into the next day and break streaks.
      const completedDate = getYmdInTimeZone(new Date(completedAt), 'America/New_York');
      if (!completedDate) return false;

      // Compare against the *live puzzle calendar day*, not the displayed/stored date.
      // If dailyNumber = num corresponds to dayIndex = num-1, then live day for that index is:
      // liveDayIndex = (num - 1) - DAILY_PUZZLE_INDEX_OFFSET
      const liveDayIndex = (num - 1) - DAILY_PUZZLE_INDEX_OFFSET;
      const liveDate = getISODateForDailyIndex(liveDayIndex);
      return completedDate === liveDate;
    };

    const hasLiveWonToday = (() => {
      const num = todayIdx + 1;
      const e = completions?.[String(num)];
      return isLiveWin(num, e);
    })();

    const streakStartIdx = hasLiveWonToday ? todayIdx : todayIdx - 1;
    let currentStreak = 0;
    for (let idx = streakStartIdx; idx >= 0; idx--) {
      const num = idx + 1;
      const e = completions?.[String(num)];
      if (!isLiveWin(num, e)) break;
      currentStreak++;
    }

    let maxStreak = 0;
    let run = 0;
    for (let idx = 0; idx <= todayIdx; idx++) {
      const num = idx + 1;
      const e = completions?.[String(num)];
      if (isLiveWin(num, e)) {
        run++;
        if (run > maxStreak) maxStreak = run;
      } else {
        run = 0;
      }
    }

    const recent = [];
    const start = Math.max(0, todayIdx - 9);
    for (let idx = start; idx <= todayIdx; idx++) {
      const num = idx + 1;
      const e = completions?.[String(num)];
      const guesses = typeof e === 'object' && e != null && e?.won !== false ? Number(e?.guesses) : null;
      recent.push({ num, guesses: Number.isFinite(guesses) ? guesses : null });
    }

    return { totalPlayed, wins, reveals, avgGuesses, currentStreak, maxStreak, recent };
  };

  const getWinsCount = (completions) =>
    Object.values(completions || {}).filter((e) => typeof e === 'object' && e != null && e?.won !== false).length;

  // Next daily puzzle time (ET midnight rollover based on the same daily-number logic).
  const nextDailyRolloverTsRef = useRef(null);
  useEffect(() => {
    const isDailyMode = gameMode === 'daily' || gameMode === 'ballKnowledgeDaily';
    if (!isDailyMode) {
      nextDailyRolloverTsRef.current = null;
      setNextDailyCountdown(null);
      return;
    }

    const computeNextRolloverTs = () => {
      const startMs = Date.now();
      const currentIdx = getDailyPuzzleDayIndex(new Date(startMs), DAILY_PUZZLE_INDEX_OFFSET);

      let low = startMs;
      let high = startMs + 36 * 60 * 60 * 1000; // 36h upper bound

      // If we're somehow very close to a boundary and `high` still matches, extend a bit.
      let safety = 0;
      while (
        safety < 12 &&
        getDailyPuzzleDayIndex(new Date(high), DAILY_PUZZLE_INDEX_OFFSET) === currentIdx
      ) {
        high += 3 * 60 * 60 * 1000; // +3h
        safety++;
      }

      if (getDailyPuzzleDayIndex(new Date(high), DAILY_PUZZLE_INDEX_OFFSET) === currentIdx) return null;

      // Binary search for first moment when the day index changes.
      for (let i = 0; i < 32; i++) {
        const mid = (low + high) / 2;
        const midIdx = getDailyPuzzleDayIndex(new Date(mid), DAILY_PUZZLE_INDEX_OFFSET);
        if (midIdx === currentIdx) low = mid;
        else high = mid;
      }
      return high;
    };

    nextDailyRolloverTsRef.current = computeNextRolloverTs();

    const tick = () => {
      const ts = nextDailyRolloverTsRef.current;
      if (!ts) {
        setNextDailyCountdown(null);
        return;
      }
      const diff = ts - Date.now();
      if (diff <= 0) {
        nextDailyRolloverTsRef.current = computeNextRolloverTs();
        const ts2 = nextDailyRolloverTsRef.current;
        setNextDailyCountdown(ts2 ? formatHMS(ts2 - Date.now()) : null);
        return;
      }
      setNextDailyCountdown(formatHMS(diff));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [gameMode, formatHMS, todayDailyIndex]);

  // Tick a lightweight clock while playing daily puzzles so the daily # changes even
  // if the page is left open across midnight.
  useEffect(() => {
    const isDailyMode = gameMode === 'daily' || gameMode === 'ballKnowledgeDaily';
    if (!isDailyMode) return;
    const id = setInterval(() => setNowTs(Date.now()), 15000);
    return () => clearInterval(id);
  }, [gameMode]);

  // Past daily mantles: keyed by daily number, value = { date, completedAt, guesses, guessHistory, won, answer, top5 }
  // Once you play a daily (win or lose), you can't play it again.
  const getDailyCompletionsFromStorage = () => (dailyCompletions || {});
  const saveDailyCompletionToStorage = (dailyNumber, dateStr, guesses = null, guessHistory = [], won = true, answer = '', top5 = []) => {
    const prev = getDailyCompletionsFromStorage();
    const next = { ...prev, [String(dailyNumber)]: { date: dateStr, completedAt: new Date().toISOString(), guesses, guessHistory, won, answer, top5 } };
    return next;
  };

  const [dailyCompletions, setDailyCompletions] = useState(() => ({}));
  const [selectedDailyDetail, setSelectedDailyDetail] = useState(null);
  const [selectedDailyHistoryNum, setSelectedDailyHistoryNum] = useState('');
  // Lock out replaying any daily that already has a saved completion (today or past).
  const dailyAlreadyPlayed = gameMode === 'daily' && dailyCompletions[String(activeDailyNumber)] != null;

  const getBallKnowledgeDailyFromStorage = () => (ballKnowledgeDailyCompletions || {});
  const saveBallKnowledgeDailyToStorage = (dailyNumber, dateStr, guesses = null, guessHistory = [], won = true, answer = '', top5 = []) => {
    const prev = getBallKnowledgeDailyFromStorage();
    const next = { ...prev, [String(dailyNumber)]: { date: dateStr, completedAt: new Date().toISOString(), guesses, guessHistory, won, answer, top5 } };
    return next;
  };
  const [ballKnowledgeDailyCompletions, setBallKnowledgeDailyCompletions] = useState(() => ({}));
  const [selectedBallKnowledgeDetail, setSelectedBallKnowledgeDetail] = useState(null);
  const [selectedHardcoreHistoryNum, setSelectedHardcoreHistoryNum] = useState('');
  // Lock out replaying any hardcore daily that already has a saved completion (today or past).
  const ballKnowledgeDailyAlreadyPlayed = gameMode === 'ballKnowledgeDaily' && ballKnowledgeDailyCompletions[String(activeDailyNumber)] != null;
  const hasExtraPanels = Object.keys(dailyCompletions).length > 0 || Object.keys(ballKnowledgeDailyCompletions).length > 0;
  const isPostGameView = gameWon || showAnswer || dailyAlreadyPlayed || ballKnowledgeDailyAlreadyPlayed;

  // When signed in, hydrate local daily completions from all devices linked to this account.
  useEffect(() => {
    void hydrateCompletionsFromCloud({ force: true });
  }, [hydrateCompletionsFromCloud]);

  // While signed in, periodically refresh so other-device progress shows without reload.
  useEffect(() => {
    if (!authSession?.user?.id) return;
    if (!identityInitialized) return;
    if (!anonId) return;
    const id = setInterval(() => {
      void hydrateCompletionsFromCloud();
    }, 12000);
    return () => clearInterval(id);
  }, [authSession?.user?.id, identityInitialized, anonId, hydrateCompletionsFromCloud]);

  // If a user solved Daily/Hardcore while signed out, those completions exist only locally.
  // On sign-in, push local history once so it becomes available on other devices.
  useEffect(() => {
    if (!authSession?.user?.id) return;
    if (!supabase) return;
    if (!identityInitialized) return;
    if (!anonId) return;

    const marker = `${authSession.user.id}:${anonId}`;
    if (accountBackfillMarkerRef.current === marker) return;
    accountBackfillMarkerRef.current = marker;

    void (async () => {
      try {
        // Same race as hydration: ensure the client is authenticated before writing.
        if (authSession?.access_token && authSession?.refresh_token) {
          await supabase.auth.setSession({
            access_token: authSession.access_token,
            refresh_token: authSession.refresh_token,
          });
        }
      } catch {
        // Best-effort: even if setSession fails, writes may still go through.
      }

      const dailyLocal = getDailyCompletionsFromStorage();
      const hardcoreLocal = getBallKnowledgeDailyFromStorage();

      const jobs = [];
      for (const [numStr, entry] of Object.entries(dailyLocal || {})) {
        const n = Number(numStr);
        if (!Number.isFinite(n) || n < 1) continue;
        jobs.push(
          submitCompletionToCloud({
            mode: 'daily',
            dailyNumber: n,
            date: typeof entry?.date === 'string' ? entry.date : '',
            answer: typeof entry?.answer === 'string' ? entry.answer : '',
            guesses: Number.isFinite(Number(entry?.guesses)) ? Number(entry.guesses) : 0,
            won: entry?.won !== false,
            guessHistory: Array.isArray(entry?.guessHistory) ? entry.guessHistory : [],
            top5: Array.isArray(entry?.top5) ? entry.top5 : [],
          })
        );
      }
      for (const [numStr, entry] of Object.entries(hardcoreLocal || {})) {
        const n = Number(numStr);
        if (!Number.isFinite(n) || n < 1) continue;
        jobs.push(
          submitCompletionToCloud({
            mode: 'hardcore',
            dailyNumber: n,
            date: typeof entry?.date === 'string' ? entry.date : '',
            answer: typeof entry?.answer === 'string' ? entry.answer : '',
            guesses: Number.isFinite(Number(entry?.guesses)) ? Number(entry.guesses) : 0,
            won: entry?.won !== false,
            guessHistory: Array.isArray(entry?.guessHistory) ? entry.guessHistory : [],
            top5: Array.isArray(entry?.top5) ? entry.top5 : [],
          })
        );
      }

      if (jobs.length) {
        Promise.allSettled(jobs).catch(() => {});
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authSession, identityInitialized, anonId]);
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
          'nba-mantle-daily-completions-v13',
          'nba-mantle-ball-knowledge-daily-v1',
          'nba-mantle-ball-knowledge-daily-v13',
          'nba-mantle-favorites-v13',
          'nba-mantle-favorites-v14',
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
    setDailyCompletions({});
    setBallKnowledgeDailyCompletions({});
  }, []);

  // Guests: re-read local progress after identity init so we never stay on empty state if the first
  // paint ran before localStorage was ready (Safari private / strict modes).
  useEffect(() => {
    if (!identityInitialized) return;
    if (authSession?.user?.id) return;
    // Guest mode: session-only. We do not persist completions across refresh.
    setDailyCompletions({});
    setBallKnowledgeDailyCompletions({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityInitialized, authSession?.user?.id]);

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
    // Keep daily/hardcore answers server-side (prevents casual console peeking).
    setTargetPlayer('');
    resetPuzzleState();
    fetchDailyCeiling();
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
    const answerMissing = !completion?.answer;
    const top5Missing = top5.length === 0;
    if (!answerMissing) setTargetPlayer(completion.answer);
    if (!top5Missing) setTop5Players(top5);
    if (!answerMissing && !top5Missing) return;

    // Fallback: if older saves don't have answer/top5, re-fetch from the server rotation.
    const modeKey = gameMode === 'ballKnowledgeDaily' ? 'hardcore' : 'daily';
    setRestoringTop5(true);
    // Important: protect against async responses from the *previous* daily mode/daily.
    // This prevents showing Daily Top 5 on Hardcore Daily after a quick switch.
    let cancelled = false;
    const modeAtStart = gameMode;
    const activeDailyNumberAtStart = activeDailyNumber;
    (async () => {
      try {
        const result = await fetchJsonWithRetry(
          `${SECURE_API_BASE}/reveal`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ mode: modeKey, dailyNumber: activeDailyNumberAtStart }),
          },
          { timeoutMs: 25000, retries: 1, retryDelayMs: 800 }
        );
        const fetchedTop5 = Array.isArray(result?.top_5) ? result.top_5 : [];
        const fetchedAnswer = typeof result?.answer === 'string' ? result.answer : '';
        if (cancelled) return;
        if (modeAtStart !== gameMode) return;
        if (activeDailyNumberAtStart !== activeDailyNumber) return;
        if (fetchedTop5.length) setTop5Players(fetchedTop5);
        if (fetchedAnswer) setTargetPlayer(fetchedAnswer);

        // Patch missing fields into local history so refreshes always show them.
        if (gameMode === 'daily') {
          setDailyCompletions((prev) => {
            const next = { ...(prev || {}) };
            const cur = next[String(activeDailyNumberAtStart)];
            if (typeof cur === 'object' && cur != null) {
              next[String(activeDailyNumberAtStart)] = {
                ...cur,
                answer: cur.answer || fetchedAnswer || '',
                top5: (Array.isArray(cur.top5) && cur.top5.length) ? cur.top5 : fetchedTop5,
              };
              try { localStorage.setItem(DAILY_COMPLETIONS_KEY, JSON.stringify(next)); } catch {}
            }
            return next;
          });
        } else if (gameMode === 'ballKnowledgeDaily') {
          setBallKnowledgeDailyCompletions((prev) => {
            const next = { ...(prev || {}) };
            const cur = next[String(activeDailyNumberAtStart)];
            if (typeof cur === 'object' && cur != null) {
              next[String(activeDailyNumberAtStart)] = {
                ...cur,
                answer: cur.answer || fetchedAnswer || '',
                top5: (Array.isArray(cur.top5) && cur.top5.length) ? cur.top5 : fetchedTop5,
              };
              try { localStorage.setItem(BALL_KNOWLEDGE_DAILY_KEY, JSON.stringify(next)); } catch {}
            }
            return next;
          });
        }
      } catch {}
      finally {
        if (!cancelled) setRestoringTop5(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameMode, activeDailyNumber, dailyAlreadyPlayed, ballKnowledgeDailyAlreadyPlayed]);

  // After a win (or when viewing a completed daily), show global average guesses for this daily (if available).
  // Do not gate on targetPlayer — desktop often hydrates completion state before the answer string is restored.
  useEffect(() => {
    if (gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily') return;
    if (!gameWon && !showAnswer && !dailyAlreadyPlayed && !ballKnowledgeDailyAlreadyPlayed) return;
    let cancelled = false;
    let intervalId = null;
    const modeKey = gameMode === 'ballKnowledgeDaily' ? 'hardcore' : 'daily';

    const fetchAndApply = async ({ forceRefresh, withLoading }) => {
      if (cancelled) return;
      // Allow forced refreshes (poll / post-save) to run even if a soft refresh is in flight.
      if (postWinGlobalAvgInFlightRef.current && !forceRefresh) return;

      const reqId = ++postWinGlobalAvgReqIdRef.current;
      postWinGlobalAvgInFlightRef.current = true;
      if (withLoading) setPostWinGlobalDailyAverageLoading(true);

      try {
        const result = await fetchGlobalDailyAverage({
          mode: modeKey,
          dailyNumber: activeDailyNumber,
          forceRefresh,
        });
        if (cancelled) return;
        // Ignore late/stale results when active daily changes.
        if (reqId !== postWinGlobalAvgReqIdRef.current) return;
        setPostWinGlobalDailyAverage(result);
      } catch {
        if (cancelled) return;
        if (reqId !== postWinGlobalAvgReqIdRef.current) return;
        setPostWinGlobalDailyAverage(null);
      } finally {
        postWinGlobalAvgInFlightRef.current = false;
        if (!cancelled && withLoading) setPostWinGlobalDailyAverageLoading(false);
      }
    };

    // Apply cached value synchronously so the UI updates immediately.
    const cached = readCachedGlobalDailyAverage({ mode: modeKey, dailyNumber: activeDailyNumber });
    if (cached != null) {
      setPostWinGlobalDailyAverage(cached);
      setPostWinGlobalDailyAverageLoading(false);
      void fetchAndApply({ forceRefresh: true, withLoading: false });
    } else {
      // No cache: fetch now with loading state.
      void fetchAndApply({ forceRefresh: false, withLoading: true });
    }

    // Poll occasionally while the user is on the end screen.
    // Slower polling + single-flight makes it much less likely to feel "messed up".
    intervalId = setInterval(() => {
      void fetchAndApply({ forceRefresh: true, withLoading: false });
    }, 45 * 1000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameWon, showAnswer, dailyAlreadyPlayed, ballKnowledgeDailyAlreadyPlayed, gameMode, activeDailyNumber]);

  // Prefetch global average for the active daily so end-screen can render instantly.
  useEffect(() => {
    if (gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily') return;
    const modeKey = gameMode === 'ballKnowledgeDaily' ? 'hardcore' : 'daily';
    void fetchGlobalDailyAverage({ mode: modeKey, dailyNumber: activeDailyNumber, forceRefresh: false });
  }, [gameMode, activeDailyNumber]);

  useEffect(() => {
    if (!showLeaderboards) return;
    void loadLeaderboards(leaderboardMode, { force: true });
  }, [showLeaderboards, leaderboardMode, loadLeaderboards]);

  // Auto-dismiss confetti after a win.
  useEffect(() => {
    if (!confettiBurstId) return;
    const id = setTimeout(() => setConfettiBurstId(null), 3600);
    return () => clearTimeout(id);
  }, [confettiBurstId]);

  // If a completed Daily was restored without local Top 5, use the already-prefetched Top 5.
  useEffect(() => {
    if (top5Players.length > 0) return;
    if (gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily') return;
    if (!(gameWon || showAnswer || dailyAlreadyPlayed || ballKnowledgeDailyAlreadyPlayed)) return;
    const canUsePrefetched =
      prefetchedTargetTop5For === targetPlayer && Array.isArray(prefetchedTargetTop5) && prefetchedTargetTop5.length > 0;
    if (canUsePrefetched) setTop5Players(prefetchedTargetTop5);
  }, [
    top5Players.length,
    gameMode,
    gameWon,
    showAnswer,
    dailyAlreadyPlayed,
    ballKnowledgeDailyAlreadyPlayed,
    prefetchedTargetTop5For,
    prefetchedTargetTop5,
    targetPlayer,
  ]);

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
    const reqId = (fetchTargetMaxSimilarity._reqId = (fetchTargetMaxSimilarity._reqId || 0) + 1);
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

      // Ignore stale responses (e.g., mode switched to Daily/Hardcore).
      if (reqId !== fetchTargetMaxSimilarity._reqId) return;

      const top5 = result?.top_5 || [];
      setPrefetchedTargetTop5(Array.isArray(top5) ? top5 : []);
      if (Array.isArray(top5) && top5.length > 0) {
        const [, score] = top5[0];
        setTargetMaxSimilar(typeof score === 'number' ? score : null);
      } else {
        setTargetMaxSimilar(null);
      }
    } catch (e) {
      if (reqId !== fetchTargetMaxSimilarity._reqId) return;
      setTargetMaxSimilar(null);
      setPrefetchedTargetTop5([]);
      setPrefetchedTargetTop5For(null);
    } finally {
      if (reqId !== fetchTargetMaxSimilarity._reqId) return;
      setPrefetchedTargetTop5Loading(false);
    }
  };

  const startNewGame = () => {
    let chosenPlayer;
    if (gameMode === 'daily') {
      // Daily answer is server-side.
      setTargetPlayer('');
      setTargetMaxSimilar(null);
      fetchDailyCeiling();
    } else if (gameMode === 'ballKnowledgeDaily') {
      // Hardcore answer is server-side.
      setTargetPlayer('');
      setTargetMaxSimilar(null);
      fetchDailyCeiling();
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
  };

  const maybeScrollAfterGuess = () => {
    const cardEl = pulseGuessCardRef.current;
    const historyEl = guessHistoryEndRef.current;
    const inputEl = guessSectionRef.current;
    if (!inputEl || (!historyEl && !cardEl)) return;

    // 1) Take them to the new guess result.
    try {
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        historyEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    } catch {}

    // 2) Then bring them back up to keep guessing.
    setTimeout(() => {
      try {
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {}
    }, 850);
  };

  const confirmNow = async () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;

    if (action === 'reveal') {
      await revealAnswer();
    } else if (action === 'newGame') {
      startNewGame();
    }
  };

  const handleModeChange = (newMode) => {
    setGameMode(newMode);
    
    // Filter players based on new mode
    const filtered = filterPlayersForMode(allPlayers, playersData, newMode);
    setFilteredPlayers(filtered);
    
    // Start a new game with the new mode (or clear target if no players for this mode)
    if (filtered.length > 0) {
      if (newMode === 'daily' || newMode === 'ballKnowledgeDaily') {
        setTargetPlayer('');
        setTargetMaxSimilar(null);
      } else {
        const target = filtered[Math.floor(Math.random() * filtered.length)];
        setTargetPlayer(target);
        fetchTargetMaxSimilarity(target);
      }
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
    
  };

  useEffect(() => {
    const loadPlayerNames = async () => {
      // 1) Render instantly from cache (if present), then refresh from API.
      const cached = readPlayersCache();
      const sortedCached = cached?.length ? [...cached].sort() : [];
      if (cached?.length) {
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

      // Fast path: if both caches are warm, render instantly.
      // Then do a silent background refresh (stale-while-revalidate).
      const hasWarmCache = sortedCached.length && cachedPlayersData;
      if (hasWarmCache) {
        const filtered = filterPlayersForMode(sortedCached, cachedPlayersData, gameMode);
        const pool = filtered.length ? filtered : sortedCached;
        setFilteredPlayers(pool);
        if (gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') {
          setTargetPlayer('');
          // Do not clear targetMaxSimilar here: fetchDailyCeiling (daily sync effect) may already
          // have set it from cache; clearing would blank the "closest" / ceiling until mode toggle.
        } else {
          setTargetPlayer((prev) => (pool.includes(prev) ? prev : pool[Math.floor(Math.random() * pool.length)]));
        }
        setBackendWarming(false);
      }

      try {
        // 2) Load player names (fast endpoint) and update UI immediately.
        // Only show warming indicator when we don't already have a warm cache render.
        if (!hasWarmCache) setBackendWarming(true);
        let playerNames = null;
        try {
          playerNames = await fetchJsonWithRetry(`${API_BASE}/players`, {}, { timeoutMs: 9000, retries: 1, retryDelayMs: 700 });
          backendLastWarmTsRef.current = Date.now();
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
        if (gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') {
          setTargetPlayer('');
          // Same as warm-cache path: keep ceiling from fetchDailyCeiling; do not null it here.
        } else {
          const initialTarget = sortedPlayers[Math.floor(Math.random() * sortedPlayers.length)];
          setTargetPlayer(initialTarget);
          fetchTargetMaxSimilarity(initialTarget);
        }

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
        if (gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') {
          setTargetPlayer('');
          // Same: preserve daily ceiling if already fetched.
        } else {
          const target = fallback[Math.floor(Math.random() * fallback.length)];
          setTargetPlayer(target);
          fetchTargetMaxSimilarity(target);
        }
      }
    };

    loadPlayerNames();
  }, []);

  useEffect(() => {
    warmBackend({ background: true }).catch(() => {});
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      warmBackend({ force: true, background: true }).catch(() => {});
    }, 1000 * 60 * 4);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          fontWeight: 700,
          fontSize: Math.max(11, Math.round(size * 0.28)),
          textTransform: 'uppercase'
        }}
      >
        {getPlayerInitials(name)}
      </div>
    );
  };

  const triggerInputShake = () => {
    setShakeInput(true);
    setTimeout(() => setShakeInput(false), 440);
  };

  const fetchDailyCeiling = async () => {
    if (gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily') return;
    // Invalidate any in-flight non-daily ceiling prefetches.
    fetchTargetMaxSimilarity._reqId = (fetchTargetMaxSimilarity._reqId || 0) + 1;
    const modeKey = gameMode === 'ballKnowledgeDaily' ? 'hardcore' : 'daily';
    const ceilingCacheKey = key(`nba-mantle-daily-ceiling-${modeKey}-${activeDailyNumber}`);
    let cachedCeiling = null;
    // Daily answers are deterministic, so cached ceilings are safe to reuse.
    try {
      const raw = localStorage.getItem(ceilingCacheKey);
      if (raw != null) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.ceiling === 'number') {
          cachedCeiling = parsed.ceiling;
          setTargetMaxSimilar(parsed.ceiling);
        } else {
          setTargetMaxSimilar(null);
        }
      } else {
        setTargetMaxSimilar(null);
      }
    } catch {
      setTargetMaxSimilar(null);
    }

    // If we already have a deterministic cached ceiling for this day+mode,
    // avoid re-requesting a flaky upstream and keep startup instant.
    if (typeof cachedCeiling === 'number') return;

    try {
      await warmBackend({ background: true });
      const r = await fetchJsonWithRetry(
        `${SECURE_API_BASE}/ceiling`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ mode: modeKey, dailyNumber: activeDailyNumber }),
        },
        { timeoutMs: 20000, retries: 1, retryDelayMs: 700 }
      );
      const ceiling = typeof r?.ceiling === 'number' ? r.ceiling : null;
      setTargetMaxSimilar(ceiling);
      try { localStorage.setItem(ceilingCacheKey, JSON.stringify({ ceiling })); } catch {}
    } catch {
      // Keep showing cached value when upstream is flaky.
      if (typeof cachedCeiling === 'number') {
        setTargetMaxSimilar(cachedCeiling);
      } else {
        setTargetMaxSimilar(null);
      }
    }
  };

  const makeGuess = async () => {
    if (!guess.trim()) return;
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(-1);
    setLoading(true);
    setError('');

    try {
      const isDailyLike = gameMode === 'daily' || gameMode === 'ballKnowledgeDaily';
      await warmBackend();
      const result = await fetchJsonWithRetry(
        isDailyLike ? `${SECURE_API_BASE}/guess` : `${API_BASE}/guess`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify(
            isDailyLike
              ? { guess: guess.trim(), mode: gameMode === 'ballKnowledgeDaily' ? 'hardcore' : 'daily', dailyNumber: activeDailyNumber }
              : { guess: guess.trim(), target: targetPlayer }
          ),
        },
        { timeoutMs: 25000, retries: 1, retryDelayMs: 800 }
      );

      const { score, matched_name, breakdown, top_5 } = result;
      const resolvedAnswerFromResult = typeof result?.answer === 'string' ? result.answer : '';
      const resolvedAnswer = score === 100 && resolvedAnswerFromResult ? resolvedAnswerFromResult : targetPlayer;
      if (score === 100 && resolvedAnswerFromResult) setTargetPlayer(resolvedAnswerFromResult);

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
              const dateStr = isPastDailySelected
                ? getISODateForDailyIndex(activeDailyIndex)
                : (todayYmdNY || getISODateForDailyIndex(activeDailyIndex));
              const fullHistory = [...guessHistory, newGuess].map((g) => ({ name: g.name, score: g.score }));
              if (!isPastDailySelected || dailyCompletions[String(activeDailyNumber)] == null) {
                const top5ToStore = (top_5 && top_5.length) ? top_5 : (canUsePrefetchedTop5 ? prefetchedTargetTop5 : []);
                const answerToStore = resolvedAnswer || targetPlayer;
                const next = saveDailyCompletionToStorage(activeDailyNumber, dateStr, newCount, fullHistory, true, answerToStore, top5ToStore);
                setDailyCompletions(next);
                submitCompletionToCloud(
                  { mode: 'daily', dailyNumber: activeDailyNumber, date: dateStr, answer: answerToStore, guesses: newCount, won: true, guessHistory: fullHistory, top5: top5ToStore },
                  { uiNotify: true }
                );
              }
            } else if (gameMode === 'ballKnowledgeDaily') {
              const dateStr = isPastDailySelected
                ? getISODateForDailyIndex(activeDailyIndex)
                : (todayYmdNY || getISODateForDailyIndex(activeDailyIndex));
              const fullHistory = [...guessHistory, newGuess].map((g) => ({ name: g.name, score: g.score }));
              if (!isPastDailySelected || ballKnowledgeDailyCompletions[String(activeDailyNumber)] == null) {
                const top5ToStore = (top_5 && top_5.length) ? top_5 : (canUsePrefetchedTop5 ? prefetchedTargetTop5 : []);
                const answerToStore = resolvedAnswer || targetPlayer;
                const next = saveBallKnowledgeDailyToStorage(activeDailyNumber, dateStr, newCount, fullHistory, true, answerToStore, top5ToStore);
                setBallKnowledgeDailyCompletions(next);
                submitCompletionToCloud(
                  { mode: 'hardcore', dailyNumber: activeDailyNumber, date: dateStr, answer: answerToStore, guesses: newCount, won: true, guessHistory: fullHistory, top5: top5ToStore },
                  { uiNotify: true }
                );
              }
            }
          }
        } else {
          setError('You have already guessed this player!');
          setPulseGuessName(newGuess.name);
          setTimeout(() => setPulseGuessName(null), 900);
          triggerInputShake();
          // Scroll to the existing card and highlight it.
          setTimeout(() => {
            try {
              pulseGuessCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch {}
          }, 50);
        }

        setGuess('');
        if (!alreadyGuessed && score !== 100) {
          // On mobile: show the new guess card, then scroll back to the input.
          setTimeout(() => maybeScrollAfterGuess(), 250);
        }
    } catch (err) {
      setError(backendWarming ? 'Waking up the server… try again in a moment.' : 'Connection error. Please check your internet connection and try again.');
      console.error('API Error:', err);
    }

    setLoading(false);
  };

  const revealAnswer = async () => {
    const isDailyLike = gameMode === 'daily' || gameMode === 'ballKnowledgeDaily';
    if (!isDailyLike && !targetPlayer) return;
    
    setLoading(true);
    let top5Now = [];
    let revealedAnswer = '';
    try {
      await warmBackend({ background: true });
      if (!isDailyLike && prefetchedTargetTop5For === targetPlayer && Array.isArray(prefetchedTargetTop5) && prefetchedTargetTop5.length > 0) {
        top5Now = prefetchedTargetTop5;
      } else if (isDailyLike) {
        const r = await fetchJsonWithRetry(
          `${SECURE_API_BASE}/reveal`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ mode: gameMode === 'ballKnowledgeDaily' ? 'hardcore' : 'daily', dailyNumber: activeDailyNumber }),
          },
          { timeoutMs: 25000, retries: 1, retryDelayMs: 800 }
        );
        revealedAnswer = typeof r?.answer === 'string' ? r.answer : '';
        if (revealedAnswer) setTargetPlayer(revealedAnswer);
        top5Now = Array.isArray(r?.top_5) ? r.top_5 : [];
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
      const dateStr = isPastDailySelected
        ? getISODateForDailyIndex(activeDailyIndex)
        : (todayYmdNY || getISODateForDailyIndex(activeDailyIndex));
      const history = guessHistory.map((g) => ({ name: g.name, score: g.score }));
      if (!isPastDailySelected || dailyCompletions[String(activeDailyNumber)] == null) {
        const answerToStore = isDailyLike ? (revealedAnswer || targetPlayer) : targetPlayer;
        const next = saveDailyCompletionToStorage(activeDailyNumber, dateStr, guessCount, history, false, answerToStore, top5Now || []);
        setDailyCompletions(next);
        submitCompletionToCloud(
          { mode: 'daily', dailyNumber: activeDailyNumber, date: dateStr, answer: answerToStore, guesses: guessCount, won: false, guessHistory: history, top5: top5Now || [] },
          { uiNotify: true }
        );
      }
    } else if (gameMode === 'ballKnowledgeDaily') {
      const dateStr = isPastDailySelected
        ? getISODateForDailyIndex(activeDailyIndex)
        : (todayYmdNY || getISODateForDailyIndex(activeDailyIndex));
      const history = guessHistory.map((g) => ({ name: g.name, score: g.score }));
      if (!isPastDailySelected || ballKnowledgeDailyCompletions[String(activeDailyNumber)] == null) {
        const answerToStore = isDailyLike ? (revealedAnswer || targetPlayer) : targetPlayer;
        const next = saveBallKnowledgeDailyToStorage(activeDailyNumber, dateStr, guessCount, history, false, answerToStore, top5Now || []);
        setBallKnowledgeDailyCompletions(next);
        submitCompletionToCloud(
          { mode: 'hardcore', dailyNumber: activeDailyNumber, date: dateStr, answer: answerToStore, guesses: guessCount, won: false, guessHistory: history, top5: top5Now || [] },
          { uiNotify: true }
        );
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

  const ScoreBar = ({ score, showLabel = true }) => {
    const percentage = Math.max(0, Math.min(100, score));
    const color = getScoreColor(score);
    
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '24px',
            backgroundColor: '#f3f4f6',
            borderRadius: '12px',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              width: `${percentage}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${color}dd, ${color})`,
              boxShadow: `0 0 10px ${color}40`,
              transition: 'width 0.3s ease'
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
        <span key={`${part}-${idx}`} style={{ color: '#93c5fd', fontWeight: 700 }}>
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
      era_similarity: 'Start Year Similarity',
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
            bottom: accountActivityToast ? '76px' : '20px',
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
            maxWidth: 'min(420px, calc(100vw - 32px))',
            textAlign: 'center',
          }}
        >
          ✅ Share message copied to clipboard
        </div>
      )}

      {accountActivityToast ? (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: accountActivityToast.variant === 'success' ? '#15803d' : '#b91c1c',
            color: 'white',
            padding: '12px 20px',
            borderRadius: '14px',
            boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
            fontSize: '0.92rem',
            fontWeight: 700,
            zIndex: 61,
            maxWidth: 'min(420px, calc(100vw - 32px))',
            textAlign: 'center',
            lineHeight: 1.35,
          }}
        >
          {accountActivityToast.variant === 'success' ? '✓ ' : '⚠ '}
          {accountActivityToast.message}
        </div>
      ) : null}

      {confettiBurstId && <ConfettiBurst key={confettiBurstId} burstId={confettiBurstId} />}

      {confirmAction && (
        <div
          onClick={() => setConfirmAction(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15,23,42,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 80,
            padding: '16px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '480px',
              background: 'linear-gradient(135deg, #0f172a, #1e293b)',
              borderRadius: '16px',
              padding: '18px',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.75)',
              border: '1px solid #334155'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
              <div style={{ color: '#e5e7eb', fontWeight: 800, fontSize: '1.1rem' }}>Are you sure?</div>
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '18px',
                  padding: '4px 8px',
                  borderRadius: '999px'
                }}
                aria-label="Close confirmation"
              >
                ×
              </button>
            </div>

            {confirmAction === 'reveal' ? (
              <div style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.5, marginBottom: '16px' }}>
                Revealing will show the answer for this puzzle. Do you want to continue?
              </div>
            ) : (
              <div style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.5, marginBottom: '16px' }}>
                Start a new puzzle? Your current progress will be cleared.
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid #334155',
                  backgroundColor: 'rgba(15,23,42,0.55)',
                  color: '#cbd5e1',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={confirmNow}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: confirmAction === 'reveal' ? '#f59e0b' : '#10b981',
                  color: 'white',
                  fontWeight: 800,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.8 : 1
                }}
              >
                {confirmAction === 'reveal' ? 'Reveal' : 'New Game'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="game-content-wrapper" style={{ maxWidth: '1200px', margin: '0 auto', padding: '14px' }}>
        {/* Header */}
        <div className="game-header" style={{ 
          background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.82), rgba(30, 41, 59, 0.72))',
          borderRadius: '12px',
          padding: '12px',
          paddingTop: '12px',
          marginBottom: '12px',
          textAlign: 'center',
          border: '1px solid rgba(255, 255, 255, 0.10)',
          backdropFilter: 'blur(6px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '10px' }}>
            <span style={{ fontSize: '25px' }}>🏀</span>
            <h1 style={{ fontSize: '2rem', fontWeight: 700, margin: 0, letterSpacing: '0.2px', background: 'linear-gradient(45deg, #fbbf24, #fb7185)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>NBA Mantle</h1>
            <span style={{ fontSize: '25px' }}>🎯</span>
          </div>

          <div style={{ margin: '0 auto 10px', maxWidth: '64ch' }}>
            <p style={{ color: '#dbeafe', margin: '0 0 6px', fontSize: '1rem', lineHeight: 1.28, fontWeight: 700 }}>
              Guess the mystery NBA player - each guess shows your similarity score.
            </p>
            <div style={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.88rem', margin: '0 0 6px', lineHeight: 1.3 }}>
              Data through the <strong>2024-2025</strong> NBA season (no current season info yet).
            </div>
            <p style={{ color: '#fbbf24', margin: 0, fontSize: '0.95rem', opacity: targetMaxSimilar != null ? 1 : 0.65, fontWeight: 700 }}>
              {targetMaxSimilar != null ? (
                <>
                  Closest player is about <span style={{ fontWeight: 900 }}>{targetMaxSimilar}/100</span>.
                </>
              ) : (
                <>Finding today&apos;s closest player range...</>
              )}
            </p>
          </div>

          <div className="header-buttons" style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '2px', marginBottom: '2px' }}>
            <button
              type="button"
              className={`nm-header-account-btn${authSession?.user ? ' nm-header-account-btn--signed-in' : ''}`}
              onClick={() => setShowAccountModal(true)}
              title={authSession?.user ? 'Account & sign out' : 'Sign in (optional) — saves progress across devices'}
            >
              <span className="nm-header-account-btn__icon">{authSession?.user ? '✓' : '🔐'}</span>
              <span className="nm-header-account-btn__label">{authSession?.user ? 'Account' : 'Sign in'}</span>
            </button>

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

            {(gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && (
              <button
                onClick={() => setShowStats(true)}
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
                  gap: '6px'
                }}
              >
                <span>📊</span>
                <span>Stats</span>
              </button>
            )}
            {hasExtraPanels && (
              <button
                type="button"
                onClick={() => setShowSecondaryPanel((v) => !v)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '10px',
                  border: '1px solid #4b5563',
                  backgroundColor: showSecondaryPanel ? 'rgba(59, 130, 246, 0.18)' : '#111827',
                  color: showSecondaryPanel ? '#93c5fd' : '#94a3b8',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="Toggle history panels"
              >
                <span>🧾</span>
                <span>{showSecondaryPanel ? 'Hide history panels' : 'Show history panels'}</span>
              </button>
            )}
            {(gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && (
              <button
                onClick={() => {
                  setLeaderboardMode(gameMode === 'ballKnowledgeDaily' ? 'hardcore' : 'daily');
                  setShowLeaderboards(true);
                }}
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
                  gap: '6px'
                }}
              >
                <span>🏆</span>
                <span>Leaderboards</span>
              </button>
            )}

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
                  fontWeight: 700,
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
          <div style={{ marginBottom: '10px' }}>
            <div
              style={{
                maxWidth: '560px',
                margin: '0 auto',
                padding: '6px',
                borderRadius: '12px',
                border: '1px solid rgba(71, 85, 105, 0.7)',
                backgroundColor: 'rgba(15, 23, 42, 0.68)',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
                {[
                  { id: 'daily', icon: '📅', label: `Daily #${todayDailyIndex + 1}`, isActive: gameMode === 'daily', onClick: () => handleModeChange('daily') },
                  { id: 'hardcore', icon: '🧠', label: `Hardcore #${todayDailyIndex + 1}`, isActive: gameMode === 'ballKnowledgeDaily', onClick: () => handleModeChange('ballKnowledgeDaily') },
                  { id: 'freeplay', icon: '🎮', label: 'Free Play', isActive: gameMode === 'easy' || gameMode === 'classic' || gameMode === 'all', onClick: () => handleModeChange(gameMode === 'easy' || gameMode === 'classic' || gameMode === 'all' ? gameMode : 'easy') },
                ].map((pill) => (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={pill.onClick}
                    style={{
                      minHeight: '38px',
                      borderRadius: '9px',
                      border: pill.isActive ? '1px solid rgba(125, 211, 252, 0.6)' : '1px solid rgba(71, 85, 105, 0.85)',
                      background: pill.isActive ? 'linear-gradient(135deg, rgba(30, 64, 175, 0.52), rgba(124, 58, 237, 0.45))' : 'rgba(15, 23, 42, 0.6)',
                      color: pill.isActive ? '#dbeafe' : '#94a3b8',
                      fontWeight: 800,
                      fontSize: '12px',
                      letterSpacing: '0.01em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                      padding: '6px 8px',
                    }}
                  >
                    <span>{pill.icon}</span>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pill.label}</span>
                  </button>
                ))}
              </div>
              {(gameMode === 'easy' || gameMode === 'classic' || gameMode === 'all') && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px', marginTop: '6px' }}>
                  {[
                    { id: 'easy', icon: '😊', label: 'All Stars', active: gameMode === 'easy' },
                    { id: 'classic', icon: '🏆', label: 'Classic', active: gameMode === 'classic' },
                    { id: 'all', icon: '🌟', label: 'All Players', active: gameMode === 'all' },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => handleModeChange(mode.id)}
                      style={{
                        minHeight: '34px',
                        borderRadius: '8px',
                        border: mode.active ? '1px solid rgba(52, 211, 153, 0.55)' : '1px solid rgba(71, 85, 105, 0.85)',
                        backgroundColor: mode.active ? 'rgba(16, 185, 129, 0.22)' : 'rgba(15, 23, 42, 0.45)',
                        color: mode.active ? '#d1fae5' : '#94a3b8',
                        fontWeight: 700,
                        fontSize: '11px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        padding: '5px 6px',
                      }}
                    >
                      <span>{mode.icon}</span>
                      <span>{mode.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#94a3b8' }}>
              {gameMode === 'daily' &&
                `Daily #${activeDailyNumber}${isPastDailySelected ? ' (Past)' : ''}`}
              {gameMode === 'ballKnowledgeDaily' &&
                `Hardcore Daily #${activeDailyNumber}${isPastDailySelected ? ' (Past)' : ''}`}
              {gameMode === 'easy' &&
                `All Stars 1986 or Later (${filteredPlayers.length} players)`}
              {gameMode === 'classic' && 
                `Classic: Modern era players (2011+) with 6+ seasons (${filteredPlayers.length} players)`}
              {gameMode === 'all' && 
                `All Players: Complete database (${filteredPlayers.length} players)`}
            </div>

            {(gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && (
              <div style={{ marginTop: '4px', fontSize: '11px', color: '#64748b', textAlign: 'center' }}>
                Rollover date (ET): {todayYmdNY || '—'}
              </div>
            )}

            {(gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') && (
              <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
                      <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '1.05rem' }}>
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
                        fontWeight: 700,
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
                            <div style={{ fontWeight: 700 }}>Daily #{num}</div>
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

            {showSecondaryPanel && Object.keys(dailyCompletions).length > 0 && (
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
                      <div style={{ color: '#e9d5ff', fontWeight: 700, fontSize: '14px', lineHeight: 1.2 }}>
                        Your daily mantles
                        <span style={{ color: '#94a3b8', fontWeight: 600, fontSize: '12px', marginLeft: '8px' }}>
                          {Object.keys(dailyCompletions).length} played
                        </span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '3px' }}>
                        {showDailyHistoryPanel ? 'Expanded' : 'Collapsed'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' }}>
                    <span style={{ color: '#c4b5fd', fontWeight: 700, fontSize: '12px' }}>
                      {showDailyHistoryPanel ? 'Hide' : 'Show'}
                    </span>
                    <div style={{ color: '#c4b5fd', fontWeight: 700, fontSize: '18px', lineHeight: 1 }}>
                      {showDailyHistoryPanel ? '▾' : '▸'}
                    </div>
                  </div>
                </button>
                {showDailyHistoryPanel && (() => {
                  const items = Object.entries(dailyCompletions).sort(([a], [b]) => Number(a) - Number(b));
                  const selected = selectedDailyHistoryNum && dailyCompletions[selectedDailyHistoryNum]
                    ? selectedDailyHistoryNum
                    : (items.length ? String(items[items.length - 1][0]) : '');
                  return (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <select
                        value={selected}
                        onChange={(e) => setSelectedDailyHistoryNum(e.target.value)}
                        style={{
                          flex: '1 1 240px',
                          minWidth: '220px',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(15, 23, 42, 0.65)',
                          border: '1px solid rgba(139, 92, 246, 0.45)',
                          color: '#e9d5ff',
                          fontSize: '13px'
                        }}
                      >
                        {items.map(([num, entry]) => {
                          const guesses = typeof entry === 'object' && entry != null ? entry.guesses : null;
                          const answer = typeof entry === 'object' && entry != null ? String(entry?.answer || '').trim() : '';
                          const won = !(typeof entry === 'object' && entry != null && entry?.won === false);
                          return (
                            <option key={num} value={num} style={{ color: '#0f172a' }}>
                              {`Daily #${num} • ${won ? 'win' : 'reveal'}${guesses != null ? ` • ${guesses} guesses` : ''}${answer ? ` • ${answer}` : ''}`}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="button"
                        onClick={() => selected && setSelectedDailyDetail(selected)}
                        disabled={!selected}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid rgba(139, 92, 246, 0.45)',
                          backgroundColor: selected ? 'rgba(139, 92, 246, 0.22)' : 'rgba(51, 65, 85, 0.35)',
                          color: selected ? '#e9d5ff' : '#94a3b8',
                          fontWeight: 700,
                          cursor: selected ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Open
                      </button>
                    </div>
                  );
                })()}
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

            {/* Past Hardcore Dailies */}
            {showSecondaryPanel && Object.keys(ballKnowledgeDailyCompletions).length > 0 && (
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
                      <div style={{ color: '#fef3c7', fontWeight: 700, fontSize: '14px', lineHeight: 1.2 }}>
                        Your hardcore dailies
                        <span style={{ color: '#94a3b8', fontWeight: 600, fontSize: '12px', marginLeft: '8px' }}>
                          {Object.keys(ballKnowledgeDailyCompletions).length} played
                        </span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '3px' }}>
                        {showHardcoreHistoryPanel ? 'Expanded' : 'Collapsed'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' }}>
                    <span style={{ color: '#fcd34d', fontWeight: 700, fontSize: '12px' }}>
                      {showHardcoreHistoryPanel ? 'Hide' : 'Show'}
                    </span>
                    <div style={{ color: '#fcd34d', fontWeight: 700, fontSize: '18px', lineHeight: 1 }}>
                      {showHardcoreHistoryPanel ? '▾' : '▸'}
                    </div>
                  </div>
                </button>
                {showHardcoreHistoryPanel && (() => {
                  const items = Object.entries(ballKnowledgeDailyCompletions).sort(([a], [b]) => Number(a) - Number(b));
                  const selected = selectedHardcoreHistoryNum && ballKnowledgeDailyCompletions[selectedHardcoreHistoryNum]
                    ? selectedHardcoreHistoryNum
                    : (items.length ? String(items[items.length - 1][0]) : '');
                  return (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <select
                        value={selected}
                        onChange={(e) => setSelectedHardcoreHistoryNum(e.target.value)}
                        style={{
                          flex: '1 1 240px',
                          minWidth: '220px',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(15, 23, 42, 0.65)',
                          border: '1px solid rgba(217, 119, 6, 0.45)',
                          color: '#fef3c7',
                          fontSize: '13px'
                        }}
                      >
                        {items.map(([num, entry]) => {
                          const guesses = typeof entry === 'object' && entry != null ? entry.guesses : null;
                          const answer = typeof entry === 'object' && entry != null ? String(entry?.answer || '').trim() : '';
                          const won = !(typeof entry === 'object' && entry != null && entry?.won === false);
                          return (
                            <option key={num} value={num} style={{ color: '#0f172a' }}>
                              {`Hardcore #${num} • ${won ? 'win' : 'reveal'}${guesses != null ? ` • ${guesses} guesses` : ''}${answer ? ` • ${answer}` : ''}`}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="button"
                        onClick={() => selected && setSelectedBallKnowledgeDetail(selected)}
                        disabled={!selected}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid rgba(217, 119, 6, 0.45)',
                          backgroundColor: selected ? 'rgba(217, 119, 6, 0.22)' : 'rgba(51, 65, 85, 0.35)',
                          color: selected ? '#fef3c7' : '#94a3b8',
                          fontWeight: 700,
                          cursor: selected ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Open
                      </button>
                    </div>
                  );
                })()}
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
                Next in {nextDailyCountdown} ET
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
                      <div style={{ width: '22px', height: '22px', borderRadius: '8px', backgroundColor: '#1d4ed8', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>1</div>
                      <div style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.45 }}>
                        Type a player and hit <strong>Submit Guess</strong>.
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <div style={{ width: '22px', height: '22px', borderRadius: '8px', backgroundColor: '#7c3aed', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>2</div>
                      <div style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.45 }}>
                        Use the <strong>breakdown</strong> to see what made them similar.
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <div style={{ width: '22px', height: '22px', borderRadius: '8px', backgroundColor: '#059669', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>3</div>
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
                      <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>One puzzle/day • one saved completion/day</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ color: '#fef3c7', fontWeight: 700 }}>🧠 Hardcore Daily</span>
                      <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Harder list • one saved completion/day</span>
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
                  <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '0.95rem', marginBottom: '8px' }}>☁️ Cloud, streaks, leaderboards</div>
                  <div style={{ display: 'grid', gap: '6px', color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.45 }}>
                    <div>Sign in to sync Daily + Hardcore progress across devices.</div>
                    <div>Live streaks only count if you solve on that puzzle&apos;s scheduled ET day.</div>
                    <div>Use <strong>Stats</strong> for your personal numbers and <strong>Leaderboards</strong> for global rankings.</div>
                  </div>
                  <div style={{ marginTop: '6px', color: '#94a3b8', fontSize: '0.82rem' }}>
                    Gmail note: if your account was made with Google OAuth, use <strong>Continue with Google</strong> (not email/password).
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
                    <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Closer match → higher score</div>
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
                      ['Start year', 'Start-year similarity: 0–10 (closer start years = higher).'],
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
                    Tip: start broad (similar start year / similar position), then use team + teammate overlap to zoom in.
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

        {/* Stats Modal */}
        {showStats && (
          <div
            onClick={() => setShowStats(false)}
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
                <h2 style={{ fontSize: '1.4rem', margin: 0, color: '#e5e7eb' }}>Stats</h2>
                <button
                  onClick={() => setShowStats(false)}
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

              {(() => {
                const dailyStats = computeDailyStats(dailyCompletions, todayDailyIndex);
                const bkdStats = computeDailyStats(ballKnowledgeDailyCompletions, todayDailyIndex);
                const dailyWins = getWinsCount(dailyCompletions);
                const bkdWins = getWinsCount(ballKnowledgeDailyCompletions);

                const pill = (label, value, tint, subLabel = '') => (
                  <div
                    key={`${label}-${subLabel}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '12px',
                      border: `1px solid ${tint.border}`,
                      backgroundColor: tint.bg,
                      color: tint.fg,
                      fontSize: '13px',
                      fontWeight: 800,
                      lineHeight: 1.2,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ opacity: 0.95, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                      {subLabel ? (
                        <div style={{ marginTop: '2px', opacity: 0.75, fontSize: '12px', fontWeight: 700 }}>
                          {subLabel}
                        </div>
                      ) : null}
                    </div>
                    <span style={{ color: 'white' }}>{value}</span>
                  </div>
                );

                const dailyTint = { bg: 'rgba(139, 92, 246, 0.14)', border: 'rgba(139, 92, 246, 0.40)', fg: '#e9d5ff' };
                const bkdTint = { bg: 'rgba(217, 119, 6, 0.12)', border: 'rgba(217, 119, 6, 0.34)', fg: '#fef3c7' };
                const renderRecentGuesses = (label, stats, tint) => (
                  <div
                    style={{
                      borderRadius: '12px',
                      border: `1px solid ${tint.border}`,
                      backgroundColor: tint.bg,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ color: tint.fg, fontSize: '12px', fontWeight: 800, marginBottom: '8px' }}>
                      {label} recent guesses
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {(Array.isArray(stats?.recent) ? stats.recent : []).map((r) => (
                        <span
                          key={`recent-${r?.num ?? 'x'}`}
                          title={`Daily #${r?.num ?? '—'}`}
                          style={{
                            borderRadius: '999px',
                            border: '1px solid rgba(148, 163, 184, 0.45)',
                            padding: '4px 8px',
                            color: '#e2e8f0',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: 'rgba(15, 23, 42, 0.55)',
                          }}
                        >
                          #{r?.num ?? '—'}: {r?.guesses == null ? '—' : r.guesses}
                        </span>
                      ))}
                    </div>
                  </div>
                );

                return (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
                      {pill('Daily', dailyWins, dailyTint, 'Wins')}
                      {pill('Hardcore', bkdWins, bkdTint, 'Wins')}
                      {pill('Daily', dailyStats.currentStreak, dailyTint, 'Live streak')}
                      {pill('Hardcore', bkdStats.currentStreak, bkdTint, 'Live streak')}
                      {pill('Daily', dailyStats.maxStreak, dailyTint, 'Best live streak')}
                      {pill('Hardcore', bkdStats.maxStreak, bkdTint, 'Best live streak')}
                    </div>
                    <div style={{ marginTop: '10px', color: '#94a3b8', fontSize: '12px', lineHeight: 1.35 }}>
                      Streaks only count when you solve on the scheduled day. Solving past days won’t change streaks.
                    </div>
                    <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
                      {renderRecentGuesses('Daily', dailyStats, dailyTint)}
                      {renderRecentGuesses('Hardcore', bkdStats, bkdTint)}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Leaderboards Modal */}
        {showLeaderboards && (
          <div
            onClick={() => setShowLeaderboards(false)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(15,23,42,0.88)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 52,
              padding: '16px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: '700px',
                maxHeight: '90vh',
                background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                borderRadius: '16px',
                padding: '18px',
                border: '1px solid #334155',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.75)',
                overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ fontSize: '1.35rem', margin: 0, color: '#e5e7eb' }}>Leaderboards</h2>
                <button
                  onClick={() => setShowLeaderboards(false)}
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

              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                {[
                  { id: 'daily', label: 'Daily' },
                  { id: 'hardcore', label: 'Hardcore' },
                ].map((opt) => {
                  const active = leaderboardMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setLeaderboardMode(opt.id)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '10px',
                        border: active ? '1px solid #7c3aed' : '1px solid #4b5563',
                        backgroundColor: active ? 'rgba(124, 58, 237, 0.2)' : '#111827',
                        color: active ? '#ede9fe' : '#9ca3af',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                <button
                  onClick={() => void loadLeaderboards(leaderboardMode, { force: true })}
                  style={{
                    marginLeft: 'auto',
                    padding: '8px 12px',
                    borderRadius: '10px',
                    border: '1px solid #4b5563',
                    backgroundColor: '#111827',
                    color: '#cbd5e1',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Refresh
                </button>
              </div>

              {leaderboardLoading && !leaderboardData ? (
                <div style={{ color: '#cbd5e1', fontSize: '0.95rem', padding: '6px 2px' }}>Loading leaderboards…</div>
              ) : leaderboardError ? (
                <div style={{ color: '#fca5a5', fontSize: '0.95rem', padding: '6px 2px' }}>{leaderboardError}</div>
              ) : (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {[
                    {
                      id: 'wins',
                      title: 'Most Wins',
                      subtitle: 'Top by wins',
                      rows: Array.isArray(leaderboardData?.wins) ? leaderboardData.wins : [],
                      metric: (e) => `${e?.wins ?? 0} wins`,
                      extra: (e) => (Number.isFinite(Number(e?.avgGuesses)) ? `${Number(e.avgGuesses).toFixed(2)} avg` : '—'),
                    },
                    {
                      id: 'streaks',
                      title: 'Longest Streak',
                      subtitle: 'Best + current',
                      rows: Array.isArray(leaderboardData?.streaks) ? leaderboardData.streaks : [],
                      metric: (e) => `${e?.maxStreak ?? 0} best`,
                      extra: (e) => `${e?.currentStreak ?? 0} current`,
                    },
                    {
                      id: 'guesses',
                      title: 'Most Guesses',
                      subtitle: 'Top by volume',
                      rows: Array.isArray(leaderboardData?.guesses) ? leaderboardData.guesses : [],
                      metric: (e) => `${e?.totalGuessesAll ?? 0} guesses`,
                      extra: (e) => `${e?.completions ?? 0} completed`,
                    },
                  ].map((section) => (
                    <div
                      key={section.id}
                      style={{
                        borderRadius: '12px',
                        border: '1px solid #334155',
                        backgroundColor: 'rgba(15, 23, 42, 0.45)',
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(51, 65, 85, 0.7)' }}>
                        <div style={{ color: '#e5e7eb', fontWeight: 800, fontSize: '0.95rem' }}>{section.title}</div>
                        <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '2px' }}>{section.subtitle}</div>
                      </div>
                      {section.rows.length ? (
                        <div>
                          {section.rows.slice(0, 10).map((entry, idx) => (
                            <div
                              key={`${section.id}-${entry?.user || idx}`}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '40px minmax(0,1fr) auto',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '10px 12px',
                                borderTop: idx === 0 ? 'none' : '1px solid rgba(51, 65, 85, 0.55)',
                              }}
                            >
                              <div style={{ color: '#93c5fd', fontWeight: 800 }}>#{idx + 1}</div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ color: '#e5e7eb', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {entry?.verified ? '✓ ' : ''}{entry?.user || 'Player'}
                                </div>
                                <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{section.extra(entry)}</div>
                              </div>
                              <div style={{ color: '#f8fafc', fontWeight: 800, fontSize: '0.9rem' }}>{section.metric(entry)}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ padding: '12px', color: '#94a3b8', fontSize: '0.9rem' }}>No entries yet.</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: '10px', color: '#64748b', fontSize: '0.78rem' }}>
                Last {leaderboardData?.lookbackDays ?? 60} dailies
              </div>
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
              overflowY: 'auto',
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
                maxHeight: '85vh',
                overflowY: 'auto',
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
                  <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '1rem' }}>👋 About the creator</div>
                  <div style={{ color: '#93c5fd', fontWeight: 700, fontSize: '0.85rem' }}>Beta</div>
                </div>
                <div style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.5 }}>
                  Hey, I&apos;m <strong>Josh</strong> — an undergrad at Northeastern studying <strong>Data Science</strong>. I built NBA Mantle because I love the NBA and stats.
                </div>
                <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                  <a
                    href="https://instagram.com/jomohoops"
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
                    Instagram @jomohoops
                  </a>
                  <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                    Questions or bugs? DM me or email jmoy2077@gmail.com. Also—share it with friends.
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

        {showAccountModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Account"
            onClick={() => {
              setShowForgotPassword(false);
              setShowAccountModal(false);
            }}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(15,23,42,0.88)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 55,
              padding: '16px',
              overflowY: 'auto',
            }}
          >
            <div
              className="nm-account-modal"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: '420px',
                maxHeight: '90vh',
                overflowY: 'auto',
                background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                borderRadius: '16px',
                padding: '22px',
                // Give extra room for the soft keyboard / safe-area inset.
                paddingBottom: 'max(22px, env(safe-area-inset-bottom))',
                border: '1px solid #334155',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.75)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '12px',
                  marginBottom: '18px',
                }}
              >
                <div>
                  <h2 className="nm-account-modal__title">
                    {passwordRecoveryMode && authSession?.user
                      ? 'Set a new password'
                      : authSession?.user
                        ? 'Your account'
                        : 'Sign in'}
                  </h2>
                  <div style={{ color: '#94a3b8', fontWeight: 700, fontSize: '0.8rem', marginTop: '4px' }}>
                    {passwordRecoveryMode && authSession?.user
                      ? 'Reset link'
                      : authSession?.user
                        ? 'Signed in'
                        : 'Optional — play as guest anytime'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setShowAccountModal(false);
                  }}
                  style={{
                    border: 'none',
                    background: 'rgba(15,23,42,0.65)',
                    color: '#9ca3af',
                    cursor: 'pointer',
                    fontSize: '22px',
                    lineHeight: 1,
                    padding: '2px 10px',
                    borderRadius: '999px',
                  }}
                  aria-label="Close account dialog"
                >
                  ×
                </button>
              </div>

              {passwordRecoveryMode && authSession?.user ? (
                <div style={{ display: 'grid', gap: '14px' }}>
                  <p className="nm-account-modal__lede" style={{ marginBottom: 0 }}>
                    Pick a new password for <strong style={{ color: '#e2e8f0' }}>{authSession.user.email}</strong>.
                  </p>
                  <div className="nm-account-modal__field">
                    <label className="nm-account-modal__label" htmlFor="nm-recovery-pw1">
                      New password
                    </label>
                    <input
                      id="nm-recovery-pw1"
                      className="nm-account-modal__input"
                      value={newRecoveryPassword}
                      onChange={(e) => setNewRecoveryPassword(e.target.value)}
                      type="password"
                      autoComplete="new-password"
                      placeholder="At least 6 characters"
                    />
                  </div>
                  <div className="nm-account-modal__field">
                    <label className="nm-account-modal__label" htmlFor="nm-recovery-pw2">
                      Confirm password
                    </label>
                    <input
                      id="nm-recovery-pw2"
                      className="nm-account-modal__input"
                      value={newRecoveryPassword2}
                      onChange={(e) => setNewRecoveryPassword2(e.target.value)}
                      type="password"
                      autoComplete="new-password"
                      placeholder="Repeat password"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleRecoverySetPassword}
                    disabled={recoveryBusy}
                    style={{
                      padding: '12px 16px',
                      borderRadius: '12px',
                      border: 'none',
                      backgroundColor: '#22c55e',
                      color: 'white',
                      fontWeight: 900,
                      cursor: recoveryBusy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {recoveryBusy ? 'Saving…' : 'Save new password'}
                  </button>
                  <button type="button" className="nm-account-modal__link-btn" onClick={handleSignOut}>
                    Cancel and sign out
                  </button>
                  {authError ? <div style={{ color: '#fecaca', fontSize: '0.9rem' }}>{authError}</div> : null}
                  {authNotice && !authError ? (
                    <div style={{ color: '#bbf7d0', fontSize: '0.9rem' }}>{authNotice}</div>
                  ) : null}
                </div>
              ) : authLoading ? (
                <div style={{ color: '#94a3b8', fontSize: '0.95rem' }}>One moment…</div>
              ) : authSession?.user ? (
                <div style={{ display: 'grid', gap: '14px' }}>
                  <p className="nm-account-modal__lede" style={{ marginBottom: 0 }}>
                    <strong style={{ color: '#bbf7d0' }}>{safeAccountDisplayName || authSession.user.email}</strong>
                    <span style={{ color: '#64748b' }}> · </span>
                    <span style={{ color: '#94a3b8' }}>{authSession.user.email}</span>
                  </p>

                  <div className="nm-account-modal__field">
                    <div className="nm-account-modal__section-title">Display name</div>
                    <input
                      className="nm-account-modal__input"
                      value={safeAccountDisplayName}
                      onChange={(e) => {
                        setProfileSaveUi((u) => (u === 'saved' ? 'idle' : u));
                        setAccountDisplayName(e.target.value);
                      }}
                      placeholder="How you appear on leaderboards"
                    />
                    <p className="nm-account-modal__muted" style={{ marginTop: '6px' }}>
                      Saved to your account in the cloud. Use a name you are okay showing on public leaderboards.
                    </p>
                  </div>

                  {accountSaving ? (
                    <p className="nm-account-modal__muted" style={{ marginTop: '-6px' }}>
                      Syncing account details...
                    </p>
                  ) : null}

                  <p className="nm-account-modal__muted" style={{ marginTop: accountSaving ? 0 : '-6px' }}>
                    Cloud saves happen when you finish a <strong>Daily</strong> or <strong>Hardcore Daily</strong> (win or reveal).
                    Other modes are local-only.
                  </p>

                  {supabaseDebug?.lastSubmitOk === false ? (
                    <div className="nm-account-modal__notice nm-account-modal__notice--error">
                      Cloud save failed: {supabaseDebug?.lastError || 'Unknown error'}
                    </div>
                  ) : null}

                  <div className="nm-account-modal__row">
                    <button
                      type="button"
                      onClick={handleForceRefreshCloud}
                      disabled={accountSaving}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '12px',
                        border: '1px solid rgba(148, 163, 184, 0.55)',
                        backgroundColor: 'rgba(148, 163, 184, 0.10)',
                        color: '#e2e8f0',
                        fontWeight: 900,
                        cursor: accountSaving ? 'not-allowed' : 'pointer',
                      }}
                      title="Force refresh cloud stats (mantle_runs)"
                    >
                      Refresh cloud stats
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveDisplayName}
                      disabled={accountSaving || profileSaveUi === 'saving'}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '12px',
                        border: 'none',
                        backgroundColor: profileSaveUi === 'saved' ? '#15803d' : '#3b82f6',
                        color: 'white',
                        fontWeight: 900,
                        cursor: accountSaving || profileSaveUi === 'saving' ? 'not-allowed' : 'pointer',
                      }}
                      title="Save your display name to the server"
                    >
                      {profileSaveUi === 'saving'
                        ? 'Saving…'
                        : profileSaveUi === 'saved'
                          ? 'Saved ✓'
                          : 'Save name'}
                    </button>

                    <button
                      type="button"
                      onClick={handleSignOut}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '12px',
                        border: '1px solid rgba(248, 113, 113, 0.55)',
                        backgroundColor: 'rgba(127, 29, 29, 0.22)',
                        color: '#fecaca',
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                      title="Sign out and use guest mode on this device"
                    >
                      Sign out
                    </button>
                  </div>

                  {profileSaveUi === 'saved' ? (
                    <p style={{ color: '#86efac', fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>
                      Saved — leaderboards will show this name.
                    </p>
                  ) : null}
                  {authError ? <div className="nm-account-modal__notice nm-account-modal__notice--error">{authError}</div> : null}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '4px' }}>
                  <p className="nm-account-modal__lede">
                    Save your daily progress in the cloud so you can pick up on another browser or device.
                  </p>

                  <div className="nm-account-modal__field">
                    <label className="nm-account-modal__label" htmlFor="nm-auth-email">
                      Email
                    </label>
                    <input
                      id="nm-auth-email"
                      className="nm-account-modal__input"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      onKeyDown={handleAuthFieldKeyDown}
                      placeholder="you@example.com"
                      type="email"
                      autoComplete="email"
                    />
                  </div>

                  <div className="nm-account-modal__field">
                    <label className="nm-account-modal__label" htmlFor="nm-auth-password">
                      Password
                    </label>
                    <input
                      id="nm-auth-password"
                      className="nm-account-modal__input"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      onKeyDown={handleAuthFieldKeyDown}
                      placeholder="Your password"
                      type="password"
                      autoComplete="current-password"
                    />
                  </div>

                  <div className="nm-account-modal__row" style={{ marginTop: '6px' }}>
                    <button
                      type="button"
                      onClick={handleSignInWithEmail}
                      disabled={emailAuthAction !== null}
                      style={{
                        padding: '12px 18px',
                        borderRadius: '12px',
                        border: 'none',
                        backgroundColor: '#22c55e',
                        color: 'white',
                        fontWeight: 900,
                        cursor: emailAuthAction !== null ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {emailAuthAction === 'signin' ? 'Signing in…' : 'Sign in'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSignUpWithEmail}
                      disabled={emailAuthAction !== null}
                      style={{
                        padding: '12px 18px',
                        borderRadius: '12px',
                        border: '1px solid rgba(167, 139, 250, 0.55)',
                        backgroundColor: 'rgba(167, 139, 250, 0.12)',
                        color: '#ddd6fe',
                        fontWeight: 900,
                        cursor: emailAuthAction !== null ? 'not-allowed' : 'pointer',
                      }}
                      title="Create an account using email + password"
                    >
                      {emailAuthAction === 'signup' ? 'Creating account…' : 'Create account'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleSignInWithGoogle}
                    disabled={emailAuthAction !== null}
                    style={{
                      width: '100%',
                      marginTop: '6px',
                      padding: '12px 16px',
                      borderRadius: '12px',
                      border: '1px solid rgba(148, 163, 184, 0.55)',
                      backgroundColor: 'rgba(148, 163, 184, 0.10)',
                      color: '#e2e8f0',
                      fontWeight: 900,
                      cursor: emailAuthAction !== null ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {emailAuthAction === 'google' ? 'Opening Google…' : 'Continue with Google'}
                  </button>
                  {isLikelyGmailAddress(authEmail) ? (
                    <div style={{ color: '#93c5fd', fontSize: '0.8rem', marginTop: '6px' }}>
                      Gmail tip: if you originally used Google sign-in, use this button (email verification is not sent for OAuth sign-ins).
                    </div>
                  ) : null}

                  <div className="nm-account-modal__divider" />

                  <button
                    type="button"
                    className="nm-account-modal__link-btn"
                    style={{ justifySelf: 'start', marginBottom: showForgotPassword ? 8 : 0 }}
                    onClick={() => setShowForgotPassword((v) => !v)}
                  >
                    {showForgotPassword ? 'Hide' : 'Forgot password?'}
                  </button>
                  {showForgotPassword ? (
                    <div
                      style={{
                        padding: '12px 14px',
                        borderRadius: '12px',
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid rgba(51, 65, 85, 0.75)',
                      }}
                    >
                      <p className="nm-account-modal__muted" style={{ marginTop: 0 }}>
                        We will email a link to the address above. Open it on this site to choose a new password. Add this URL in
                        Supabase → Authentication → URL configuration → Redirect URLs if the email link fails.
                      </p>
                      <button
                        type="button"
                        onClick={handleResetPassword}
                        disabled={emailAuthAction !== null || !authEmail.trim()}
                        style={{
                          marginTop: '10px',
                          padding: '10px 16px',
                          borderRadius: '12px',
                          border: '1px solid rgba(59, 130, 246, 0.55)',
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#dbeafe',
                          fontWeight: 900,
                          cursor: emailAuthAction !== null || !authEmail.trim() ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {emailAuthAction === 'reset' ? 'Sending…' : 'Email me a reset link'}
                      </button>
                    </div>
                  ) : null}

                  <p className="nm-account-modal__muted">
                    <button
                      type="button"
                      className="nm-account-modal__link-btn"
                      onClick={handleResendSignupConfirmation}
                      disabled={emailAuthAction !== null || !authEmail.trim()}
                    >
                      {emailAuthAction === 'resend' ? 'Sending…' : 'Resend signup confirmation'}
                    </button>
                    <span style={{ color: '#475569' }}> · </span>
                    <span>if you did not get the first email.</span>
                  </p>

                  {authError ? (
                    <div className="nm-account-modal__notice nm-account-modal__notice--error">{authError}</div>
                  ) : authNotice ? (
                    <div className="nm-account-modal__notice nm-account-modal__notice--success">{authNotice}</div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="main-layout main-layout--with-history">
          <div className="play-stage">
            {/* Input Section */}
            <div style={{ 
              background: 'linear-gradient(135deg, #1e293b, #334155)',
              borderRadius: '16px',
              padding: '16px',
              border: '1px solid #334155',
              textAlign: 'center',
            }} ref={guessSectionRef}>
              <h3 style={{ fontSize: '1.15rem', marginBottom: '12px', color: '#f1f5f9', fontWeight: 800 }}>Guess a player</h3>
              
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

                      {(gameMode === 'daily' || gameMode === 'ballKnowledgeDaily') &&
                        (end.state === 'won' || end.state === 'revealed') && (
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
                <div style={{ width: '100%', maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto' }}>
                  <div style={{ position: 'relative', marginBottom: '16px', width: '100%' }}>
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
                      ref={guessInputRef}
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
                          const sorted = [...filtered].sort((a, b) => a.localeCompare(b));
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
                        margin: 0,
                        textAlign: 'left',
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
                    disabled={loading || !guess.trim() || ((gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily') && !targetPlayer)}
                    style={{
                      width: '100%',
                      padding: '12px 24px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: loading || !guess.trim() || ((gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily') && !targetPlayer) ? '#475569' : '#3b82f6',
                      color: 'white',
                      fontWeight: 'bold',
                      cursor: loading || !guess.trim() || ((gameMode !== 'daily' && gameMode !== 'ballKnowledgeDaily') && !targetPlayer) ? 'not-allowed' : 'pointer',
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
                  marginTop: '16px',
                  textAlign: 'left',
                  maxWidth: '400px',
                  marginLeft: 'auto',
                  marginRight: 'auto',
                }}
                >
                  {error}
                </div>
              )}

              {/* Universal end screen handles win/reveal/already-played */}

              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                {!dailyAlreadyPlayed && !ballKnowledgeDailyAlreadyPlayed && (
                  <button 
                    onClick={() => setConfirmAction('newGame')}
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
                    onClick={() => setConfirmAction('reveal')}
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

            {/* Top 5 Similar Players (stacked in main column during active play only) */}
            {!isPostGameView && top5Players.length > 0 && (
              <div style={{ 
                background: 'linear-gradient(135deg, #1e293b, #334155)',
                borderRadius: '16px',
                padding: '14px',
                border: '1px solid #334155'
              }}>
                <h3 style={{ fontSize: '1.05rem', marginBottom: '10px', color: '#f1f5f9' }}>📈 Top 5 Most Similar</h3>
                <div>
                  {top5Players.map(([name, score], index) => (
                    <div key={name} style={{ marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
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
            {!isPostGameView && top5Players.length === 0 && (prefetchedTargetTop5Loading || restoringTop5) && (
              <div style={{
                background: 'linear-gradient(135deg, #1e293b, #334155)',
                borderRadius: '16px',
                padding: '14px',
                border: '1px solid #334155'
              }}>
                <h3 style={{ fontSize: '1.3rem', marginBottom: '10px', color: '#f1f5f9' }}>📈 Top 5 Most Similar</h3>
                <div style={{ color: '#cbd5e1', fontSize: '0.95rem', marginBottom: '14px' }}>
                  {restoringTop5 ? 'Loading this daily’s Top 5 Most Similar…' : 'Generating closest guesses… (server may be warming up)'}
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

          {/* Guess history — always visible so new guesses appear immediately */}
          <div className="guess-history-aside">
            <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: '1rem', margin: 0, color: '#cbd5e1', fontWeight: 800, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                    Guesses ({guessHistory.length})
                  </h3>
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
                        fontWeight: 700,
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
                        fontWeight: 700,
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
                    <div style={{ textAlign: 'center', color: '#64748b', padding: '20px 12px', fontSize: '0.92rem' }}>
                      <div style={{ fontSize: '1.9rem', marginBottom: '8px', opacity: 0.85 }}>🔍</div>
                      <p style={{ margin: 0 }}>No guesses yet.</p>
                    </div>
                  )
                ) : (
                  <div
                    className="nm-guess-history-scroll"
                    style={isPostGameView ? { maxHeight: 'clamp(150px, 30vh, 260px)', overflowY: 'auto' } : undefined}
                  >
                    {(guessHistorySort === 'chronological' ? guessHistory : guessHistory.slice().sort((a, b) => b.score - a.score)).map((item, index) => (
                      <div
                        key={index}
                        ref={item.name === pulseGuessName ? pulseGuessCardRef : null}
                        className={[
                          'nm-guess-card',
                          item.name === pulseGuessName ? 'nm-pulse' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{
                        backgroundColor: 'rgba(15, 23, 42, 0.65)',
                        borderRadius: '10px',
                        padding: '13px',
                        marginBottom: '9px',
                        border: '1px solid rgba(51, 65, 85, 0.75)',
                        textAlign: 'left',
                      }}>
                        <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {renderPlayerAvatar(item.name, { size: 36, radius: 8 })}
                          <h4 style={{ margin: 0, color: '#e2e8f0', fontSize: '1rem', fontWeight: 800, flex: 1, minWidth: 0 }}>{item.name}</h4>
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
                                    <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                    <div ref={guessHistoryEndRef} />
                  </div>
                )}
                {isPostGameView && (
                  <div style={{ marginTop: '12px', borderTop: '1px solid rgba(71, 85, 105, 0.55)', paddingTop: '10px' }}>
                    <h3 style={{ fontSize: '1rem', margin: '0 0 10px', color: '#e2e8f0', fontWeight: 800 }}>📈 Top 5 Most Similar</h3>
                    <div className="nm-guess-history-scroll" style={{ maxHeight: 'clamp(150px, 30vh, 260px)', overflowY: 'auto' }}>
                      {top5Players.length > 0 ? (
                        <div>
                          {top5Players.map(([name, score], index) => (
                            <div key={name} style={{ marginBottom: '11px', backgroundColor: 'rgba(15, 23, 42, 0.55)', border: '1px solid rgba(71,85,105,0.6)', borderRadius: '10px', padding: '10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '7px' }}>
                                <span
                                  style={{
                                    backgroundColor: '#3b82f6',
                                    color: 'white',
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    flex: '0 0 auto',
                                  }}
                                >
                                  {index + 1}
                                </span>
                                <div style={{ flexShrink: 0 }}>{renderPlayerAvatar(name, { size: 34, radius: 8 })}</div>
                                <span style={{ fontWeight: 'bold', color: '#f1f5f9', fontSize: '0.98rem', lineHeight: 1.2 }}>{name}</span>
                              </div>
                              <ScoreBar score={score} />
                            </div>
                          ))}
                        </div>
                      ) : (prefetchedTargetTop5Loading || restoringTop5) ? (
                        <div style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
                          {restoringTop5 ? 'Loading this daily Top 5...' : 'Generating closest guesses...'}
                        </div>
                      ) : (
                        <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Top 5 will appear after this game.</div>
                      )}
                    </div>
                  </div>
                )}
              </>
          </div>
        </div>
      </div>
    </div>

  );
};

export default NBAGuessGame;