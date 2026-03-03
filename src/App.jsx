import React, { useState, useEffect } from 'react';
import './NBAGuessGame.css'; // Import the CSS file

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
  const [gameMode, setGameMode] = useState('classic');
  const [filteredPlayers, setFilteredPlayers] = useState([]);
  const [playersData, setPlayersData] = useState({});
  const [showHowToPlay, setShowHowToPlay] = useState(false);

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

  const filterPlayersForMode = (players, playerData, mode) => {
    if (mode === 'all') {
      return players;
    }
    
    // Classic mode: 2011+ debut with 5+ seasons
    if (mode === 'classic') {
      console.log('Filtering for classic mode...');
      return players.filter(playerName => {
        const player = playerData[playerName];
        if (!player) {
          console.log(`No data for player: ${playerName}`);
          return false;
        }
        
        const startYear = player.start_year || 0;
        // Prefer actual seasons played; fall back to career_length if needed
        const seasonsCount = player.seasons_count || player.career_length || 0;
        
        const isValid = startYear >= 2011 && seasonsCount >= 5;
        if (isValid) {
          console.log(`Including ${playerName}: startYear=${startYear}, seasons=${seasonsCount}`);
        }
        
        return isValid;
      });
    }
    
    return players;
  };
  const startNewGame = () => {
    const playersToUse = filteredPlayers.length > 0 ? filteredPlayers : modernPlayers;
    const randomPlayer = playersToUse[Math.floor(Math.random() * playersToUse.length)];
    
    setTargetPlayer(randomPlayer);
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
    
    console.log('New game started with:', randomPlayer, 'Mode:', gameMode);
  };

  const handleModeChange = (newMode) => {
    setGameMode(newMode);
    
    // Filter players based on new mode
    const filtered = filterPlayersForMode(allPlayers, playersData, newMode);
    setFilteredPlayers(filtered);
    
    // Start a new game with the new mode
    if (filtered.length > 0) {
      const randomPlayer = filtered[Math.floor(Math.random() * filtered.length)];
      setTargetPlayer(randomPlayer);
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
            // Add a version param to bust any stale caching on the backend route
            const fullDataResponse = await fetch(`${API_BASE}/players_data?v=2`);
            if (fullDataResponse.ok) {
              const fullData = await fullDataResponse.json();
              setPlayersData(fullData);
              
              // Filter players based on current mode
              const filtered = filterPlayersForMode(sortedPlayers, fullData, gameMode);
              setFilteredPlayers(filtered);
              
              if (filtered.length > 0) {
                const randomPlayer = filtered[Math.floor(Math.random() * filtered.length)];
                setTargetPlayer(randomPlayer);
              }
              console.log('Loaded', sortedPlayers.length, 'total players,', filtered.length, 'for', gameMode, 'mode');
            } else {
              // Fallback: use all players if we can't get detailed data
              setFilteredPlayers(sortedPlayers);
              const randomPlayer = sortedPlayers[Math.floor(Math.random() * sortedPlayers.length)];
              setTargetPlayer(randomPlayer);
              console.log('Using all players (no filtering data available)');
            }
          } catch (err) {
            // Fallback: use all players
            setFilteredPlayers(sortedPlayers);
            const randomPlayer = sortedPlayers[Math.floor(Math.random() * sortedPlayers.length)];
            setTargetPlayer(randomPlayer);
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
        const randomPlayer = fallback[Math.floor(Math.random() * fallback.length)];
        setTargetPlayer(randomPlayer);
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

  const makeGuess = async () => {
    if (!guess.trim()) return;
    
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

          setGuessCount(prev => prev + 1);

          if (score === 100) {
            setGameWon(true);
            setTop5Players(top_5 || []);
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
    setLoading(false);
  };

  const handleSuggestionSelect = (selectedName) => {
    setGuess(selectedName);
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
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
      teammate_years: 'Years as Teammates',
      shared_teams: 'Shared Franchises',
      position_match: 'Position Similarity',
      era_similarity: 'Era Overlap',
      career_length_similarity: 'Career Length Similarity',
      all_star_overlap: 'All-Star Overlap',
      all_team_overlap: 'All-NBA / All-Defense Overlap',
      award_overlap: 'Award Overlap',
      // Legacy keys kept for backwards compatibility
      shared_streak_bonus: 'Consecutive Seasons Bonus',
      team_tenure: 'Tenure Bonus',
      start_year_diff: 'Draft Era',
      shared_all_star: 'All-Star',
      shared_all_team: 'All-Team',
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
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
        {/* Header */}
        <div style={{ 
          background: 'linear-gradient(135deg, #1e293b, #334155)',
          borderRadius: '16px',
          padding: '24px',
          marginBottom: '24px',
          textAlign: 'center',
          border: '1px solid #334155',
          position: 'relative'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
            <span style={{ fontSize: '32px' }}>🏀</span>
            <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', margin: 0, background: 'linear-gradient(45deg, #f59e0b, #ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>NBA-MANTLE</h1>
            <span style={{ fontSize: '32px' }}>🎯</span>
          </div>
          
          <button
            onClick={() => setShowHowToPlay(true)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
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

          <p style={{ color: '#94a3b8', marginBottom: '20px', fontSize: '1.1rem' }}>
            Guess the mystery NBA player by finding similar players!
          </p>

          {/* Game Mode Selection */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
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
            <div style={{ marginTop: '8px', fontSize: '14px', color: '#94a3b8' }}>
              {gameMode === 'classic' ? 
                `Classic: Modern era players (2011+) with 5+ seasons (${filteredPlayers.length} players)` : 
                `All Players: Complete database (${filteredPlayers.length} players)`
              }
            </div>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'center', gap: '32px', flexWrap: 'wrap', fontSize: '1.1rem' }}>
            <span style={{ color: '#fbbf24' }}>⚡ Attempt #{guessCount}</span>
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
              backgroundColor: 'rgba(15,23,42,0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: '540px',
                background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.75)',
                border: '1px solid #334155',
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
                    <span style={{ fontWeight: 'bold' }}>Classic</span>: Modern era players (2011+) with at least 5 seasons.
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
                <li><span style={{ fontWeight: 'bold' }}>Years as Teammates</span>: total seasons they were teammates (including multiple teams or stints).</li>
                <li><span style={{ fontWeight: 'bold' }}>Shared Franchises</span>: if they both played for the same organizations.</li>
                <li><span style={{ fontWeight: 'bold' }}>Position Similarity</span>: whether they play the same or similar position.</li>
                <li><span style={{ fontWeight: 'bold' }}>Era Overlap</span>: how close their <span style={{ fontWeight: 'bold' }}>start year</span> is (earliest unique season in the league).</li>
                <li><span style={{ fontWeight: 'bold' }}>Career Length Similarity</span>: similar number of seasons in the league.</li>
                <li><span style={{ fontWeight: 'bold' }}>All-Star / All-NBA / Awards</span>: overlap in star-level honors.</li>
              </ul>

              <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '16px' }}>
                You can also reveal the answer at any time with the <span style={{ fontWeight: 'bold' }}>Reveal</span> button, and see the top 5 most similar players to the mystery player.
              </p>

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
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
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
              
              {!gameWon && !showAnswer && (
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
                          const filtered = allPlayers.filter(name =>
                            name.toLowerCase().includes(value.toLowerCase()) &&
                            !name.includes('?')
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
                    disabled={loading || !guess.trim()}
                    style={{
                      width: '100%',
                      padding: '12px 24px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: loading || !guess.trim() ? '#475569' : '#3b82f6',
                      color: 'white',
                      fontWeight: 'bold',
                      cursor: loading || !guess.trim() ? 'not-allowed' : 'pointer',
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

              {gameWon && (
                <div style={{ 
                  textAlign: 'center', 
                  backgroundColor: '#22c55e', 
                  color: 'white', 
                  padding: '20px', 
                  borderRadius: '12px', 
                  margin: '16px 0' 
                }}>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🎉</div>
                  <p style={{ margin: 0, fontSize: '1.1rem' }}>
                    Congratulations! You found {targetPlayer} in {guessCount} guesses!
                  </p>
                </div>
              )}

              {showAnswer && !gameWon && (
                <div style={{ 
                  textAlign: 'center', 
                  backgroundColor: '#f59e0b', 
                  color: 'white', 
                  padding: '20px', 
                  borderRadius: '12px', 
                  margin: '16px 0' 
                }}>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🎯</div>
                  <p style={{ margin: 0, fontSize: '1.1rem' }}>
                    The answer was {targetPlayer}
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
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
                
                {!gameWon && !showAnswer && (
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
                    <div style={{ marginBottom: '12px' }}>
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