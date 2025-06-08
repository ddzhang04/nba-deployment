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
      return players.filter(playerName => {
        const player = playerData[playerName];
        if (!player) return false;
        
        const startYear = player.start_year || 0;
        const seasonsCount = player.career_length || 0; // Changed from seasons.length
        
        return startYear >= 2011 && seasonsCount >= 5;
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
            const fullDataResponse = await fetch(`${API_BASE}/players_data`);
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
      shared_seasons: 'Shared Seasons',
      shared_streak_bonus: 'Streak Bonus',
      teammate_years: 'Teammate Years',
      shared_teams: 'Team Overlap',
      team_tenure: 'Tenure Bonus',
      position_match: 'Position',
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
          border: '1px solid #334155'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
            <span style={{ fontSize: '32px' }}>🏀</span>
            <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', margin: 0, background: 'linear-gradient(45deg, #f59e0b, #ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>NBA-MANTLE</h1>
            <span style={{ fontSize: '32px' }}>🎯</span>
          </div>
          
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