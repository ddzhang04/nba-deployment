import React, { useState, useEffect } from 'react';
import './NBAGuessGame.css'; // Import the CSS file
import { isAllStarPlayerName, normalizePlayerName } from './data/allStarPlayers';

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

  // API base URL - updated to match your backend
  const API_BASE = 'https://nba-mantle-6-5.onrender.com/api';

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

  // Daily mode: one puzzle per day, 8 guesses max. First daily = LeBron James.
  const DAILY_PUZZLE_EPOCH = '2025-03-13';
  const DAILY_PLAYERS = ['Jabari Smith Jr.'];
  const getDailyPuzzleIndex = () => {
    const epoch = new Date(DAILY_PUZZLE_EPOCH).setHours(0, 0, 0, 0);
    const now = new Date().setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((now - epoch) / 86400000));
  };
  const getDailyPlayerForIndex = (index) =>
    DAILY_PLAYERS[index % DAILY_PLAYERS.length] ?? DAILY_PLAYERS[0];
  const getDailyNumber = () => getDailyPuzzleIndex() + 1;

  // Past daily mantles: keyed by daily number, value = { date, guesses, guessHistory, won }
  // Once you play a daily (win or lose), you can't play it again.
  const DAILY_COMPLETIONS_KEY = 'nba-mantle-daily-completions-v9';
  const CURRENT_DAILY_NUM = 1;
  const getDailyCompletionsFromStorage = () => {
    try {
      const raw = localStorage.getItem(DAILY_COMPLETIONS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const out = {};
      for (const [num, val] of Object.entries(parsed)) {
        if (typeof val === 'string') {
          out[num] = { date: val, guesses: null, guessHistory: [], won: true, answer: '' };
        } else {
          const arr = Array.isArray(val?.guessHistory) ? val.guessHistory : [];
          out[num] = { date: val?.date ?? '', guesses: val?.guesses ?? null, guessHistory: arr, won: val?.won !== false, answer: val?.answer ?? '' };
        }
      }
      return out;
    } catch {
      return {};
    }
  };
  const saveDailyCompletionToStorage = (dailyNumber, dateStr, guesses = null, guessHistory = [], won = true, answer = '') => {
    const prev = getDailyCompletionsFromStorage();
    const next = { ...prev, [String(dailyNumber)]: { date: dateStr, guesses, guessHistory, won, answer } };
    try {
      localStorage.setItem(DAILY_COMPLETIONS_KEY, JSON.stringify(next));
    } catch {}
    return next;
  };

  const [dailyCompletions, setDailyCompletions] = useState({});
  const [selectedDailyDetail, setSelectedDailyDetail] = useState(null);
  const dailyAlreadyPlayed = gameMode === 'daily' && dailyCompletions[String(CURRENT_DAILY_NUM)] != null;
  useEffect(() => {
    setDailyCompletions(getDailyCompletionsFromStorage());
  }, []);

  const filterPlayersForMode = (players, playerData, mode) => {
    if (mode === 'all' || mode === 'daily') {
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
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/guess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          guess: playerName,
          target: playerName
        })
      });

      if (response.ok) {
        const result = await response.json();
        const top5 = result.top_5 || [];
        if (Array.isArray(top5) && top5.length > 0) {
          const [, score] = top5[0];
          setTargetMaxSimilar(typeof score === 'number' ? score : null);
        } else {
          setTargetMaxSimilar(null);
        }
      } else {
        setTargetMaxSimilar(null);
      }
    } catch (e) {
      setTargetMaxSimilar(null);
    }
  };

  const startNewGame = () => {
    let chosenPlayer;
    if (gameMode === 'daily') {
      chosenPlayer = getDailyPlayerForIndex(0);
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
          ? getDailyPlayerForIndex(0)
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
      try {
        // Load player names
        let response = await fetch(`${API_BASE}/players`);
        if (!response.ok) {
          response = await fetch(`${API_BASE}/player_awards`);
        }
        
        if (response.ok) {
          const playerNames = await response.json();
          const sortedPlayers = playerNames.sort();
          setAllPlayers(sortedPlayers);
          
          // Try to load full player data for filtering
          try {
            const fullDataResponse = await fetch(`${API_BASE}/players_data?v=2`);
            if (fullDataResponse.ok) {
              const fullData = await fullDataResponse.json();
              setPlayersData(fullData);
              
              const filtered = filterPlayersForMode(sortedPlayers, fullData, gameMode);
              setFilteredPlayers(filtered);
              
              if (filtered.length > 0) {
                const target = gameMode === 'daily' ? getDailyPlayerForIndex(0) : filtered[Math.floor(Math.random() * filtered.length)];
                setTargetPlayer(target);
                fetchTargetMaxSimilarity(target);
              } else {
                setTargetMaxSimilar(null);
              }
              console.log('Loaded', sortedPlayers.length, 'total players,', filtered.length, 'for', gameMode, 'mode');
            } else {
              // No players_data: no filtering (classic/easy need players_data)
              setFilteredPlayers(sortedPlayers);
              const target = gameMode === 'daily' ? getDailyPlayerForIndex(0) : sortedPlayers[Math.floor(Math.random() * sortedPlayers.length)];
              setTargetPlayer(target);
              fetchTargetMaxSimilarity(target);
              console.log('Using all players (no players_data available)');
            }
          } catch (err) {
            // Fallback: use all players
            setFilteredPlayers(sortedPlayers);
            const target = gameMode === 'daily' ? getDailyPlayerForIndex(0) : sortedPlayers[Math.floor(Math.random() * sortedPlayers.length)];
            setTargetPlayer(target);
            fetchTargetMaxSimilarity(target);
            console.log('Using all players (filtering failed)');
          }
        } else {
          throw new Error('Failed to fetch players');
        }
      } catch (error) {
        console.error('Could not load players from API, using fallback:', error);
        const fallback = modernPlayers;
        setAllPlayers(fallback);
        setFilteredPlayers(fallback);
        const target = gameMode === 'daily' ? getDailyPlayerForIndex(0) : fallback[Math.floor(Math.random() * fallback.length)];
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

  const makeGuess = async () => {
    if (!guess.trim()) return;
    if (gameMode === 'daily' && guessCount >= 8 && !gameWon) {
      setError('No guesses left! Daily puzzle limit is 8 guesses.');
      return;
    }
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(-1);
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/guess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          guess: guess.trim(),
          target: targetPlayer
        })
      });

      if (response.ok) {
        const result = await response.json();
        const { score, matched_name, breakdown, top_5 } = result;

        const newGuess = {
          name: matched_name || guess.trim(),
          score: score,
          breakdown: breakdown || {}
        };

        const alreadyGuessed = guessHistory.some(g => g.name === newGuess.name);
        
        if (!alreadyGuessed) {
          setGuessHistory(prev => {
            const updated = [...prev, newGuess];
            return updated.sort((a, b) => b.score - a.score).slice(0, 15);
          });

          const newCount = guessCount + 1;
          setGuessCount(prev => prev + 1);

          if (score === 100) {
            setGameWon(true);
            setTop5Players(top_5 || []);
            if (gameMode === 'daily') {
              const dateStr = new Date().toISOString().slice(0, 10);
              const fullHistory = [...guessHistory, newGuess].map((g) => ({ name: g.name, score: g.score }));
              const next = saveDailyCompletionToStorage(CURRENT_DAILY_NUM, dateStr, newCount, fullHistory, true, targetPlayer);
              setDailyCompletions(next);
            }
          } else if (gameMode === 'daily' && newCount >= 8) {
            setShowAnswer(true);
            const dateStr = new Date().toISOString().slice(0, 10);
            const fullHistory = [...guessHistory, newGuess].map((g) => ({ name: g.name, score: g.score }));
            const next = saveDailyCompletionToStorage(CURRENT_DAILY_NUM, dateStr, 8, fullHistory, false, targetPlayer);
            setDailyCompletions(next);
            fetch(`${API_BASE}/guess`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
              body: JSON.stringify({ guess: targetPlayer, target: targetPlayer })
            })
              .then(r => r.ok ? r.json() : null)
              .then(result => { if (result?.top_5) setTop5Players(result.top_5); })
              .catch(() => {});
          }
        } else {
          setError('You have already guessed this player!');
        }

        setGuess('');
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Unknown error occurred');
      }
    } catch (err) {
      setError('Connection error. Please check your internet connection and try again.');
      console.error('API Error:', err);
    }

    setLoading(false);
  };

  const revealAnswer = async () => {
    if (!targetPlayer) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/guess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          guess: targetPlayer,
          target: targetPlayer
        })
      });

      if (response.ok) {
        const result = await response.json();
        setTop5Players(result.top_5 || []);
      }
    } catch (err) {
      console.error('Error fetching top 5:', err);
    }
    
    setShowAnswer(true);
    if (gameMode === 'daily') {
      const dateStr = new Date().toISOString().slice(0, 10);
      const history = guessHistory.map((g) => ({ name: g.name, score: g.score }));
      const next = saveDailyCompletionToStorage(CURRENT_DAILY_NUM, dateStr, guessCount, history, false, targetPlayer);
      setDailyCompletions(next);
    }
    setLoading(false);
  };

  const handleSuggestionSelect = (selectedName) => {
    setGuess(selectedName);
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
  };

  const handleShare = () => {
    if (!targetPlayer || !gameWon) return;

    const shareText =
      gameMode === 'daily'
        ? `🏀 I got the daily NBA Mantle #1 in ${guessCount} guesses! Show me what you got 👉 https://nba-deployment.vercel.app/`
        : (() => {
            const modeLabel =
              gameMode === 'classic'
                ? 'Classic'
                : gameMode === 'easy'
                ? 'All Stars 1986 or Later'
                : 'All Players';
            return `🏀 I guessed ${targetPlayer} in ${guessCount} guesses on NBA-MANTLE (${modeLabel} mode)! Think you know ball? Try it here 👉 https://nba-deployment.vercel.app/`;
          })();

    const copyPromise =
      navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(shareText)
        : Promise.resolve();

    copyPromise.finally(() => {
      setShowCopyToast(true);
      setTimeout(() => setShowCopyToast(false), 2500);
    });
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
        <div style={{ 
          position: 'relative',
          width: '100%',
          height: '24px',
          backgroundColor: '#f3f4f6',
          borderRadius: '12px',
          overflow: 'hidden'
        }}>
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
        <div style={{ 
          color: color, 
          fontWeight: 'bold', 
          fontSize: '12px',
          minWidth: '40px'
        }}>
          {score}/100
        </div>
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
      backgroundColor: '#0f172a', 
      color: 'white', 
      fontFamily: 'system-ui, -apple-system, sans-serif' 
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

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
        {/* Header */}
        <div className="game-header" style={{ 
          background: 'linear-gradient(135deg, #1e293b, #334155)',
          borderRadius: '16px',
          padding: '24px',
          marginBottom: '24px',
          textAlign: 'center',
          border: '1px solid #334155'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
            <span style={{ fontSize: '32px' }}>🏀</span>
            <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', margin: 0, background: 'linear-gradient(45deg, #f59e0b, #ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>NBA-MANTLE</h1>
            <span style={{ fontSize: '32px' }}>🎯</span>
          </div>
          
          <div className="header-buttons">
            <button
              onClick={() => setShowHowToPlay(true)}
              className="how-to-play-btn"
              style={{
                padding: '8px 14px',
                borderRadius: '999px',
                border: '1px solid #4b5563',
                backgroundColor: '#111827',
                color: '#e5e7eb',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>❓</span>
              <span>How to Play</span>
            </button>
            <button
              onClick={() => setShowMoreGames(true)}
              style={{
                padding: '8px 14px',
                borderRadius: '999px',
                border: '1px solid #4b5563',
                backgroundColor: '#111827',
                color: '#e5e7eb',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>🎮</span>
              <span>More games</span>
            </button>
          </div>

          <p style={{ color: '#94a3b8', marginBottom: targetMaxSimilar != null ? '8px' : '20px', fontSize: '1.1rem' }}>
            Guess the mystery NBA player by finding similar players!
          </p>

          {targetMaxSimilar != null && (
            <p style={{ color: '#f97316', marginBottom: '20px', fontSize: '0.95rem' }}>
              The closest any other player gets to this mystery player is about{' '}
              <span style={{ fontWeight: 'bold' }}>{targetMaxSimilar}/100</span>.
            </p>
          )}

          {/* Game Mode Selection */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleModeChange('easy')}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
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
                  borderRadius: '8px',
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
                  borderRadius: '8px',
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
            <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={() => handleModeChange('daily')}
                style={{
                  padding: '14px 32px',
                  borderRadius: '12px',
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
                📅 Daily #1
              </button>
            </div>
            <div style={{ marginTop: '8px', fontSize: '14px', color: '#94a3b8' }}>
              {gameMode === 'daily' &&
                `Daily #1 — 8 guesses • Same puzzle for everyone`}
              {gameMode === 'easy' &&
                `All Stars 1986 or Later (${filteredPlayers.length} players)`}
              {gameMode === 'classic' && 
                `Classic: Modern era players (2011+) with 6+ seasons (${filteredPlayers.length} players)`}
              {gameMode === 'all' && 
                `All Players: Complete database (${filteredPlayers.length} players)`}
            </div>
            {Object.keys(dailyCompletions).length > 0 && (
              <div style={{
                marginTop: '14px',
                padding: '14px 16px',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(139, 92, 246, 0.06))',
                borderRadius: '12px',
                border: '1px solid rgba(139, 92, 246, 0.35)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}>
                <div style={{
                  fontSize: '13px',
                  color: '#c4b5fd',
                  fontWeight: '600',
                  marginBottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <span style={{ opacity: 0.9 }}>🏆</span>
                  Your daily mantles
                  <span style={{ color: '#94a3b8', fontWeight: '500', fontSize: '12px' }}>
                    ({Object.keys(dailyCompletions).length} played)
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
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
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'center', gap: '32px', flexWrap: 'wrap', fontSize: '1.1rem', alignItems: 'center' }}>
            {gameMode === 'daily' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ color: '#94a3b8', fontSize: '0.95rem' }}>Guesses</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
                    const used = n <= guessCount;
                    const isWinGuess = gameWon && n === guessCount;
                    return (
                      <div
                        key={n}
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          backgroundColor: used ? (isWinGuess ? '#10b981' : '#8b5cf6') : 'transparent',
                          border: `2px solid ${used ? (isWinGuess ? '#10b981' : '#8b5cf6') : '#475569'}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          color: '#fff'
                        }}
                      >
                        {isWinGuess ? '✓' : ''}
                      </div>
                    );
                  })}
                </div>
                <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{guessCount}/8</span>
              </div>
            )}
            {gameMode !== 'daily' && (
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
                <h2 style={{ fontSize: '1.4rem', margin: 0, color: '#e5e7eb' }}>How to Play NBA‑MANTLE</h2>
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

              <p style={{ color: '#9ca3af', marginBottom: '12px', fontSize: '0.95rem' }}>
                There is a secret NBA player. Your goal is to find them by guessing other players and using the similarity scores as hints.
              </p>

              <ol style={{ paddingLeft: '20px', color: '#e5e7eb', fontSize: '0.95rem', marginBottom: '14px' }}>
                <li style={{ marginBottom: '6px' }}>
                  Type any NBA player&apos;s name in the box and press <span style={{ fontWeight: 'bold' }}>Submit Guess</span>.
                </li>
                <li style={{ marginBottom: '6px' }}>
                  Each guess gets a score from <span style={{ fontWeight: 'bold' }}>0–100</span>. Higher scores mean the player is more similar to the mystery player.
                </li>
                <li style={{ marginBottom: '6px' }}>
                  Check the <span style={{ fontWeight: 'bold' }}>breakdown tags</span> (team overlap, era, awards, etc.) to see why a guess was close.
                </li>
                <li style={{ marginBottom: '6px' }}>
                  Use those clues to adjust your next guess and climb toward a score of <span style={{ fontWeight: 'bold' }}>100</span>.
                </li>
              </ol>

              <div style={{ marginBottom: '12px', color: '#9ca3af', fontSize: '0.9rem' }}>
                <p style={{ marginBottom: '4px' }}>
                  <span style={{ fontWeight: 'bold', color: '#e5e7eb' }}>Modes:</span>
                </p>
                <ul style={{ paddingLeft: '20px', margin: 0 }}>
                  <li style={{ marginBottom: '4px' }}>
                    <span style={{ fontWeight: 'bold' }}>Daily</span>: One shared puzzle per day. All players in the database. You get 8 guesses — same puzzle for everyone!
                  </li>
                  <li style={{ marginBottom: '4px' }}>
                    <span style={{ fontWeight: 'bold' }}>All Stars 1986 or Later</span>: Players who have made at least one All-Star team (1986 or later).
                  </li>
                  <li style={{ marginBottom: '4px' }}>
                    <span style={{ fontWeight: 'bold' }}>Classic</span>: Modern era players (2011+) with at least 6 seasons.
                  </li>
                  <li>
                    <span style={{ fontWeight: 'bold' }}>All Players</span>: Any player in the full database.
                  </li>
                </ul>
              </div>

              <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '8px' }}>
                After each guess, you&apos;ll see a breakdown explaining why that player was similar:
              </p>
              <ul style={{ paddingLeft: '20px', marginTop: 0, marginBottom: '16px', color: '#d1d5db', fontSize: '0.9rem' }}>
                <li><span style={{ fontWeight: 'bold' }}>Shared Seasons on Same Team</span>: specific seasons they were on the exact same roster.</li>
                <li><span style={{ fontWeight: 'bold' }}>Shared Teammates</span>: how many other players they&apos;ve both played with.</li>
                <li><span style={{ fontWeight: 'bold' }}>Shared Franchises</span>: if they both played for the same organizations.</li>
                <li><span style={{ fontWeight: 'bold' }}>Position Similarity</span>: whether they play the same or an adjacent position.</li>
                <li><span style={{ fontWeight: 'bold' }}>Era Overlap</span>: how close their <span style={{ fontWeight: 'bold' }}>start year</span> is (earliest unique season in the league).</li>
                <li><span style={{ fontWeight: 'bold' }}>Career Length Similarity</span>: similar number of seasons in the league.</li>
                <li><span style={{ fontWeight: 'bold' }}>All-Star Overlap</span>: same All-Star games.</li>
                <li><span style={{ fontWeight: 'bold' }}>All-NBA Overlap</span>: same All-NBA teams in the same season.</li>
                <li><span style={{ fontWeight: 'bold' }}>All-Defense Overlap</span>: same All-Defensive teams in the same season.</li>
                <li><span style={{ fontWeight: 'bold' }}>All-Rookie Overlap</span>: same All-Rookie team in the same season.</li>
                <li><span style={{ fontWeight: 'bold' }}>Awards</span>: overlap in other major awards.</li>
              </ul>

              <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '16px' }}>
                You can also reveal the answer at any time with the <span style={{ fontWeight: 'bold' }}>Reveal</span> button, and see the top 5 most similar players to the mystery player.
              </p>

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
                <h2 style={{ fontSize: '1.3rem', margin: 0, color: '#e5e7eb' }}>More basketball games</h2>
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
              <p style={{ color: '#9ca3af', fontSize: '0.95rem', marginBottom: '16px', lineHeight: 1.5 }}>
                If you like NBA‑MANTLE, try this other hoops project: build a roster under the salary cap and run a full season simulation.
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
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '12px', marginBottom: 0 }}>
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
              
              {dailyAlreadyPlayed && (() => {
                const entry = dailyCompletions[String(CURRENT_DAILY_NUM)];
                let displayDate = entry?.date ?? '';
                try {
                  const d = new Date((entry?.date ?? '') + 'T12:00:00');
                  if (!isNaN(d.getTime())) displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                } catch {}
                return (
                  <div style={{ padding: '16px', borderRadius: '12px', backgroundColor: 'rgba(139, 92, 246, 0.15)', border: '1px solid rgba(139, 92, 246, 0.35)' }}>
                    <p style={{ margin: '0 0 12px', color: '#e9d5ff', fontSize: '0.95rem' }}>
                      You already played Daily #{CURRENT_DAILY_NUM} on {displayDate}.
                      {entry?.won ? ` You got it in ${entry?.guesses ?? '?'} guess${entry?.guesses !== 1 ? 'es' : ''}!` : " You didn't get it."}
                    </p>
                    {!entry?.won && targetPlayer && (
                      <p style={{ margin: '0 0 12px', color: '#fbbf24', fontSize: '0.95rem' }}>
                        The answer was <strong>{targetPlayer}</strong>.
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedDailyDetail(String(CURRENT_DAILY_NUM))}
                        style={{
                          padding: '10px 16px',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: '#8b5cf6',
                          color: 'white',
                          fontWeight: '600',
                          cursor: 'pointer',
                          fontSize: '0.9rem'
                        }}
                      >
                        View your guesses
                      </button>
                      {entry?.won && (
                        <button
                          type="button"
                          onClick={() => {
                            const shareText = `🏀 I got the daily NBA Mantle #${CURRENT_DAILY_NUM} in ${entry?.guesses ?? '?'} guesses! Show me what you got 👉 https://nba-deployment.vercel.app/`;
                            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(shareText);
                            setShowCopyToast(true);
                            setTimeout(() => setShowCopyToast(false), 2500);
                          }}
                          style={{
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: 'none',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            fontWeight: '600',
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
              
              {!gameWon && !showAnswer && !(gameMode === 'daily' && guessCount >= 8) && !dailyAlreadyPlayed && (
                <div>
                  <div style={{ position: 'relative', marginBottom: '16px' }}>
                    <input
                      type="text"
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
                          setSuggestions(filtered);
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
                      <ul style={{
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
                      }}>
                        {suggestions.map((suggestion, index) => (
                          <li
                            key={index}
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
                            {suggestion}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  
                  <button
                    onClick={makeGuess}
                    disabled={loading || !guess.trim() || !targetPlayer || (gameMode === 'daily' && guessCount >= 8)}
                    style={{
                      width: '100%',
                      padding: '12px 24px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: loading || !guess.trim() || !targetPlayer || (gameMode === 'daily' && guessCount >= 8) ? '#475569' : '#3b82f6',
                      color: 'white',
                      fontWeight: 'bold',
                      cursor: loading || !guess.trim() || !targetPlayer || (gameMode === 'daily' && guessCount >= 8) ? 'not-allowed' : 'pointer',
                      fontSize: '16px'
                    }}
                  >
                    {loading ? 'Searching...' : 'Submit Guess'}
                  </button>
                </div>
              )}

              {error && (
                <div style={{ 
                  backgroundColor: '#fecaca', 
                  color: '#dc2626', 
                  padding: '12px', 
                  borderRadius: '8px', 
                  marginTop: '16px' 
                }}>
                  {error}
                </div>
              )}

              {gameWon && !dailyAlreadyPlayed && (
                <div style={{ 
                  textAlign: 'center', 
                  backgroundColor: '#22c55e', 
                  color: 'white', 
                  padding: '20px', 
                  borderRadius: '12px', 
                  margin: '16px 0' 
                }}>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🎉</div>
                  {getPlayerImage(targetPlayer) && (
                    <img src={getPlayerImage(targetPlayer)} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', marginBottom: '8px' }} />
                  )}
                  <p style={{ margin: 0, fontSize: '1.1rem' }}>
                    Congratulations! You found {targetPlayer} in {guessCount} guesses!
                  </p>
                </div>
              )}

              {showAnswer && !gameWon && !dailyAlreadyPlayed && (
                <div style={{
                  textAlign: 'center',
                  backgroundColor: '#f59e0b',
                  color: 'white',
                  padding: '20px',
                  borderRadius: '12px',
                  margin: '16px 0'
                }}>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🎯</div>
                  {getPlayerImage(targetPlayer) && (
                    <img src={getPlayerImage(targetPlayer)} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', marginBottom: '8px' }} />
                  )}
                  <p style={{ margin: 0, fontSize: '1.1rem' }}>
                    {gameMode === 'daily' && guessCount >= 8 ? 'Out of guesses! ' : ''}The answer was {targetPlayer}
                  </p>
                </div>
              )}

              {gameWon && targetPlayer && !dailyAlreadyPlayed && (
                <button
                  onClick={handleShare}
                  style={{
                    marginTop: '8px',
                    width: '100%',
                    padding: '10px 18px',
                    borderRadius: '10px',
                    border: '1px solid #4b5563',
                    background: 'linear-gradient(135deg, #0ea5e9, #3b82f6)',
                    color: 'white',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                  }}
                >
                  📤 Share your result
                </button>
              )}

              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                {!dailyAlreadyPlayed && (
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
                
                {!gameWon && !showAnswer && !dailyAlreadyPlayed && (
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
                        {getPlayerImage(name) && (
                          <img
                            src={getPlayerImage(name)}
                            alt=""
                            style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                          />
                        )}
                        <span style={{ fontWeight: 'bold', color: '#f1f5f9' }}>{name}</span>
                      </div>
                      <ScoreBar score={score} />
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
            <h3 style={{ fontSize: '1.3rem', marginBottom: '16px', color: '#f1f5f9' }}>👥 Guess History ({guessHistory.length})</h3>
            
            {guessHistory.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 20px' }}>
                <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🔍</div>
                <p>No guesses yet. Start by entering a player name!</p>
              </div>
            ) : (
              <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                {guessHistory.map((item, index) => (
                  <div key={index} style={{ 
                    backgroundColor: '#0f172a', 
                    borderRadius: '12px', 
                    padding: '16px', 
                    marginBottom: '12px',
                    border: '1px solid #334155'
                  }}>
                    <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {getPlayerImage(item.name) && (
                        <img
                          src={getPlayerImage(item.name)}
                          alt=""
                          style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                        />
                      )}
                      <h4 style={{ margin: 0, color: '#f1f5f9', fontSize: '1.1rem' }}>{item.name}</h4>
                    </div>
                    
                    <ScoreBar score={item.score} />
                    
                    {item.breakdown && Object.keys(item.breakdown).length > 0 && (
                      <div style={{ marginTop: '12px' }}>
                        {Object.entries(item.breakdown)
                          .filter(([key, value]) => 
                            key !== 'total' && 
                            key !== 'shared_seasons_detail' && 
                            value > 0
                          )
                          .map(([key, value]) => (
                            <div key={key} style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              fontSize: '12px', 
                              color: '#94a3b8', 
                              marginBottom: '4px' 
                            }}>
                              <span>{formatBreakdownKey(key)}</span>
                              <span style={{ color: '#10b981', fontWeight: 'bold' }}>+{value}</span>
                            </div>
                          ))}
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