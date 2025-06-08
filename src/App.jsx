import React, { useState, useEffect } from 'react';

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
  const [modernPlayers, setModernPlayers] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [gameMode, setGameMode] = useState('modern'); // 'all' or 'modern'
  const [showModeSelector, setShowModeSelector] = useState(true);

  // API base URL - updated to match your backend
  const API_BASE = 'https://nba-mantle-6-5.onrender.com/api';

  // Fallback modern NBA players (only used if API loading fails)
  const fallbackModernPlayers = [
    'LeBron James', 'Stephen Curry', 'Kevin Durant', 'Giannis Antetokounmpo',
    'Luka Dončić', 'Jayson Tatum', 'Joel Embiid', 'Nikola Jokić', 'Damian Lillard',
    'Jimmy Butler', 'Kawhi Leonard', 'Anthony Davis', 'Russell Westbrook',
    'James Harden', 'Chris Paul', 'Klay Thompson', 'Draymond Green',
    'Paul George', 'Kyrie Irving', 'Bradley Beal', 'Devin Booker',
    'Donovan Mitchell', 'Ja Morant', 'Trae Young', 'Zion Williamson',
    'Pascal Siakam', 'Bam Adebayo', 'Jaylen Brown', 'Tyler Herro'
  ];

  const getCurrentPlayerSet = () => {
    if (gameMode === 'modern') {
      return modernPlayers.length > 0 ? modernPlayers : fallbackModernPlayers;
    } else {
      return allPlayers.length > 0 ? allPlayers : fallbackModernPlayers;
    }
  };

  const startNewGame = () => {
    const playersToUse = getCurrentPlayerSet();
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
    setShowModeSelector(false);
    
    console.log('New game started with:', randomPlayer, 'Mode:', gameMode);
  };

  const changeGameMode = (newMode) => {
    setGameMode(newMode);
    setShowModeSelector(false);
    
    // Start a new game with the selected mode
    const playersToUse = newMode === 'modern' ? 
      (modernPlayers.length > 0 ? modernPlayers : fallbackModernPlayers) :
      (allPlayers.length > 0 ? allPlayers : fallbackModernPlayers);
    
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
    
    console.log('Game mode changed to:', newMode, 'New player:', randomPlayer);
  };

  const showModeSelection = () => {
    setShowModeSelector(true);
  };

  useEffect(() => {
    const loadPlayerNames = async () => {
      try {
        // Try the correct endpoint first
        let response = await fetch(`${API_BASE}/players`);
        if (!response.ok) {
          // Fallback to the other endpoint name
          response = await fetch(`${API_BASE}/player_awards`);
        }
        
        if (response.ok) {
          const playerNames = await response.json();
          const sortedPlayers = playerNames.sort();
          setAllPlayers(sortedPlayers);
          
          // Filter modern players (you might need to adjust this logic based on your API data structure)
          // For now, using the fallback list, but you could filter by debut year if that data is available
          setModernPlayers(fallbackModernPlayers.filter(player => 
            sortedPlayers.includes(player)
          ));
          
          console.log('Loaded', sortedPlayers.length, 'total players from API');
        } else {
          throw new Error('Failed to fetch players');
        }
      } catch (error) {
        console.error('Could not load players from API, using fallback:', error);
        setAllPlayers(fallbackModernPlayers);
        setModernPlayers(fallbackModernPlayers);
      }
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
        <div style={{ 
          position: 'relative',
          flex: 1,
          height: '24px',
          backgroundColor: '#374151',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid #4b5563'
        }}>
          <div 
            style={{
              width: `${percentage}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${color}dd, ${color})`,
              borderRadius: '12px',
              transition: 'width 0.5s ease',
              boxShadow: `0 0 10px ${color}40`
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
                fontSize: '12px',
                fontWeight: 'bold',
                textShadow: percentage > 30 ? '0 1px 2px rgba(0,0,0,0.8)' : 'none'
              }}
            >
              {score}
            </div>
          )}
        </div>
        <div 
          style={{ 
            color: color,
            fontSize: '14px',
            fontWeight: 'bold',
            minWidth: '45px'
          }}
        >
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

  // Game Mode Selection Screen
  if (showModeSelector) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1e40af 0%, #7c3aed 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{
          backgroundColor: '#1f2937',
          borderRadius: '20px',
          padding: '40px',
          maxWidth: '500px',
          width: '100%',
          textAlign: 'center',
          border: '2px solid #374151',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }}>
          <div style={{ marginBottom: '30px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏀</div>
            <h1 style={{ 
              color: 'white', 
              fontSize: '32px', 
              fontWeight: 'bold',
              marginBottom: '8px'
            }}>
              NBA-MANTLE
            </h1>
            <p style={{ color: '#9ca3af', fontSize: '16px' }}>
              Choose your game mode
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <button
              onClick={() => changeGameMode('modern')}
              style={{
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '20px',
                fontSize: '18px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px'
              }}
              onMouseOver={(e) => {
                e.target.style.backgroundColor = '#2563eb';
                e.target.style.transform = 'translateY(-2px)';
              }}
              onMouseOut={(e) => {
                e.target.style.backgroundColor = '#3b82f6';
                e.target.style.transform = 'translateY(0)';
              }}
            >
              <span>⚡</span>
              <div>
                <div>Modern Era (2011+)</div>
                <div style={{ fontSize: '14px', opacity: '0.8' }}>
                  Focus on current and recent players
                </div>
              </div>
            </button>

            <button
              onClick={() => changeGameMode('all')}
              style={{
                backgroundColor: '#7c3aed',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '20px',
                fontSize: '18px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px'
              }}
              onMouseOver={(e) => {
                e.target.style.backgroundColor = '#6d28d9';
                e.target.style.transform = 'translateY(-2px)';
              }}
              onMouseOut={(e) => {
                e.target.style.backgroundColor = '#7c3aed';
                e.target.style.transform = 'translateY(0)';
              }}
            >
              <span>🏆</span>
              <div>
                <div>All Time Greats</div>
                <div style={{ fontSize: '14px', opacity: '0.8' }}>
                  Including legends from all eras
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1e40af 0%, #7c3aed 100%)',
      padding: '20px'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        {/* Header */}
        <div style={{
          backgroundColor: '#1f2937',
          borderRadius: '16px',
          padding: '24px',
          textAlign: 'center',
          border: '2px solid #374151',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            marginBottom: '12px'
          }}>
            <span style={{ fontSize: '32px' }}>🏀</span>
            <h1 style={{ 
              color: 'white', 
              fontSize: '32px', 
              fontWeight: 'bold',
              margin: 0
            }}>
              NBA-MANTLE
            </h1>
            <span style={{ fontSize: '32px' }}>🎯</span>
          </div>
          
          <p style={{ color: '#9ca3af', margin: '0 0 16px 0' }}>
            Guess the mystery NBA player by finding similar players!
          </p>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '24px',
            fontSize: '14px',
            color: '#d1d5db'
          }}>
            <span style={{
              backgroundColor: gameMode === 'modern' ? '#3b82f6' : '#7c3aed',
              padding: '4px 12px',
              borderRadius: '12px',
              fontWeight: 'bold'
            }}>
              {gameMode === 'modern' ? '⚡ Modern Era' : '🏆 All Time'}
            </span>
            <span>⚡ Attempt #{guessCount}</span>
            {!gameWon && !showAnswer && (
              <span>Mystery Player: ???</span>
            )}
            {(gameWon || showAnswer) && (
              <span style={{ color: '#10b981' }}>Answer: {targetPlayer}</span>
            )}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '20px',
          alignItems: 'start'
        }}>
          {/* Left Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Input Section */}
            <div style={{
              backgroundColor: '#1f2937',
              borderRadius: '16px',
              padding: '24px',
              border: '2px solid #374151',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)'
            }}>
              <h3 style={{ color: 'white', marginBottom: '16px', fontSize: '18px' }}>
                🔍 Make Your Guess
              </h3>
              
              {!gameWon && !showAnswer && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ position: 'relative', marginBottom: '12px' }}>
                    <input
                      type="text"
                      value={guess}
                      onChange={(e) => {
                        const value = e.target.value;
                        setGuess(value);
                        setSelectedSuggestionIndex(-1);
                        
                        if (value.length > 0) {
                          const currentPlayerSet = getCurrentPlayerSet();
                          const filtered = currentPlayerSet.filter(name =>
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
                        border: '2px solid #4b5563',
                        backgroundColor: '#374151',
                        color: 'white',
                        fontSize: '16px',
                        outline: 'none'
                      }}
                    />
                    
                    {showSuggestions && suggestions.length > 0 && (
                      <ul style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        backgroundColor: '#374151',
                        border: '2px solid #4b5563',
                        borderTop: 'none',
                        borderRadius: '0 0 8px 8px',
                        zIndex: 10,
                        maxHeight: '200px',
                        overflowY: 'auto',
                        margin: 0,
                        padding: 0,
                        listStyle: 'none'
                      }}>
                        {suggestions.map((suggestion, index) => (
                          <li
                            key={index}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSuggestionSelect(suggestion);
                            }}
                            onMouseEnter={() => setSelectedSuggestionIndex(index)}
                            style={{
                              padding: '8px 16px',
                              cursor: 'pointer',
                              backgroundColor: index === selectedSuggestionIndex ? '#4b5563' : 'transparent',
                              color: 'white'
                            }}
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
                      padding: '12px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: loading || !guess.trim() ? '#6b7280' : '#3b82f6',
                      color: 'white',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      cursor: loading || !guess.trim() ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                  >
                    {loading ? 'Searching...' : 'Submit Guess'}
                  </button>
                </div>
              )}

              {error && (
                <div style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#dc2626',
                  padding: '12px',
                  borderRadius: '8px',
                  marginBottom: '16px'
                }}>
                  {error}
                </div>
              )}

              {gameWon && (
                <div style={{
                  backgroundColor: '#f0fdf4',
                  border: '2px solid #bbf7d0',
                  borderRadius: '12px',
                  padding: '20px',
                  textAlign: 'center',
                  marginBottom: '16px'
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎉</div>
                  <p style={{ color: '#166534', margin: 0, fontWeight: 'bold' }}>
                    Congratulations! You found {targetPlayer} in {guessCount} guesses!
                  </p>
                </div>
              )}

              {showAnswer && !gameWon && (
                <div style={{
                  backgroundColor: '#fef3c7',
                  border: '2px solid #fde68a',
                  borderRadius: '12px',
                  padding: '20px',
                  textAlign: 'center',
                  marginBottom: '16px'
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎯</div>
                  <p style={{ color: '#92400e', margin: 0, fontWeight: 'bold' }}>
                    The answer was {targetPlayer}
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  onClick={startNewGame}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#10b981',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  🔄 New Game
                </button>
                
                <button 
                  onClick={showModeSelection}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#6b7280',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  🎮 Change Mode
                </button>
                
                {!gameWon && !showAnswer && (
                  <button 
                    onClick={revealAnswer}
                    style={{
                      flex: 1,
                      padding: '12px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: '#f59e0b',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
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
                backgroundColor: '#1f2937',
                borderRadius: '16px',
                padding: '24px',
                border: '2px solid #374151',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)'
              }}>
                <h3 style={{ color: 'white', marginBottom: '16px', fontSize: '18px' }}>
                  📈 Top 5 Most Similar
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {top5Players.map(([name, score], index) => (
                    <div key={name} style={{
                      padding: '12px',
                      backgroundColor: '#374151',
                      borderRadius: '8px',
                      border: '1px solid #4b5563'
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginBottom: '8px'
                      }}>
                        <span style={{
                          backgroundColor: '#4b5563',
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
                        <span style={{ color: 'white', fontWeight: 'bold' }}>{name}</span>
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
            backgroundColor: '#1f2937',
            borderRadius: '16px',
            padding: '24px',
            border: '2px solid #374151',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
            height: 'fit-content'
          }}>
            <h3 style={{ color: 'white', marginBottom: '16px', fontSize: '18px' }}>
              👥 Guess History ({guessHistory.length})
            </h3>
            
            {guessHistory.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: '#9ca3af'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
                <p>No guesses yet. Start by entering a player name!</p>
              </div>
            ) : (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxHeight: '600px',
                overflowY: 'auto'
              }}>
                {guessHistory.map((item, index) => (
                  <div key={index} style={{
                    padding: '16px',
                    backgroundColor: '#374151',
                    borderRadius: '12px',
                    border: '1px solid #4b5563'
                  }}>
                    <h4 style={{
                      color: 'white',
                      margin: '0 0 12px 0',
                      fontSize: '16px',
                      fontWeight: 'bold'
                    }}>
                      {item.name}
                    </h4>
                    
                    <div style={{ marginBottom: '12px' }}>
                      <ScoreBar score={item.score} />
                    </div>
                    
                    {item.breakdown && Object.keys(item.breakdown).length > 0 && (
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px'
                      }}>
                        {Object.entries(item.breakdown)
                          .filter(([key, value]) => 
                            key !== 'total' && 
                            key !== 'shared_seasons_detail' && 
                            value > 0
                          )
                          .map(([key, value]) => (
                            <div key={key} style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              backgroundColor: '#4b5563',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              fontSize: '12px'
                            }}>
                              <span style={{ color: '#d1d5db', marginRight: '8px' }}>
                                {formatBreakdownKey(key)}
                              </span>
                              <span style={{ color: '#10b981', fontWeight: 'bold' }}>
                                +{value}
                              </span>
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