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
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);

  // API base URL
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

  const startNewGame = () => {
    const playersToUse = allPlayers.length > 0 ? allPlayers : modernPlayers;
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
    
    console.log('New game started with:', randomPlayer);
  };

  useEffect(() => {
    const loadPlayerNames = async () => {
      try {
        const response = await fetch(`${API_BASE}/players`);
        if (response.ok) {
          const playerNames = await response.json();
          const sortedPlayers = playerNames.sort();
          setAllPlayers(sortedPlayers);
          const randomPlayer = sortedPlayers[Math.floor(Math.random() * sortedPlayers.length)];
          setTargetPlayer(randomPlayer);
          console.log('Loaded', sortedPlayers.length, 'players from API');
        } else {
          throw new Error('Failed to fetch players');
        }
      } catch (error) {
        console.error('Could not load players from API, using fallback:', error);
        const fallback = modernPlayers;
        setAllPlayers(fallback);
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
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%'
      }}>
        <div style={{
          position: 'relative',
          flex: 1,
          height: '24px',
          backgroundColor: '#1f2937',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid #374151'
        }}>
          <div 
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${percentage}%`,
              background: `linear-gradient(90deg, ${color}dd, ${color})`,
              borderRadius: '12px',
              transition: 'width 0.3s ease',
              boxShadow: `0 0 10px ${color}40`
            }}
          />
          {showLabel && (
            <div style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              color: percentage > 30 ? 'white' : color,
              fontSize: '12px',
              fontWeight: 'bold',
              textShadow: percentage > 30 ? '0 1px 2px rgba(0,0,0,0.8)' : 'none'
            }}>
              {score}
            </div>
          )}
        </div>
        <div style={{
          color: color,
          fontSize: '12px',
          fontWeight: 'bold',
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
      franchise_overlap: 'Team Overlap',
      franchise_tenure_bonus: 'Tenure Bonus',
      archetype: 'Archetype',
      position: 'Position',
      draft_diff: 'Draft Era',
      era_diff: 'Career Era',
      career_end_proximity: 'Career End',
      career_length: 'Career Length'
    };
    return labels[key] || key;
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1e3a8a 0%, #3730a3 50%, #581c87 100%)',
      color: 'white',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'
    }}>
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: '20px'
      }}>
        {/* Header */}
        <div style={{
          textAlign: 'center',
          marginBottom: '30px',
          background: 'rgba(255,255,255,0.1)',
          backdropFilter: 'blur(10px)',
          borderRadius: '20px',
          padding: '30px',
          border: '1px solid rgba(255,255,255,0.2)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '15px',
            marginBottom: '15px'
          }}>
            <span style={{ fontSize: '2.5rem' }}>🏀</span>
            <h1 style={{
              fontSize: '3rem',
              fontWeight: 'bold',
              background: 'linear-gradient(45deg, #fbbf24, #f59e0b)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              margin: 0
            }}>NBA-MANTLE</h1>
            <span style={{ fontSize: '2.5rem' }}>🎯</span>
          </div>
          
          <p style={{
            fontSize: '1.2rem',
            marginBottom: '20px',
            opacity: 0.9
          }}>
            Guess the mystery NBA player by finding similar players!
          </p>
          
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '30px',
            fontSize: '1.1rem'
          }}>
            <span>⚡ Attempt #{guessCount}</span>
            {!gameWon && !showAnswer && (
              <span style={{ 
                background: 'rgba(255,255,255,0.2)',
                padding: '5px 15px',
                borderRadius: '15px'
              }}>Mystery Player: ???</span>
            )}
            {(gameWon || showAnswer) && (
              <span style={{ 
                background: 'rgba(34,197,94,0.3)',
                padding: '5px 15px',
                borderRadius: '15px'
              }}>Answer: {targetPlayer}</span>
            )}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '30px',
          alignItems: 'start'
        }}>
          {/* Left Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Input Section */}
            <div style={{
              background: 'rgba(255,255,255,0.1)',
              backdropFilter: 'blur(10px)',
              borderRadius: '20px',
              padding: '25px',
              border: '1px solid rgba(255,255,255,0.2)'
            }}>
              <h3 style={{ 
                fontSize: '1.3rem', 
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                🔍 Make Your Guess
              </h3>
              
              {!gameWon && !showAnswer && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div style={{ position: 'relative' }}>
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
                      style={{
                        width: '100%',
                        padding: '15px',
                        fontSize: '1rem',
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderRadius: '12px',
                        background: 'rgba(255,255,255,0.1)',
                        color: 'white',
                        outline: 'none'
                      }}
                      disabled={loading}
                    />
                    
                    {showSuggestions && suggestions.length > 0 && (
                      <ul style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'rgba(17, 24, 39, 0.95)',
                        backdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '12px',
                        marginTop: '5px',
                        padding: 0,
                        listStyle: 'none',
                        zIndex: 1000,
                        maxHeight: '200px',
                        overflowY: 'auto'
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
                              padding: '12px 15px',
                              cursor: 'pointer',
                              backgroundColor: index === selectedSuggestionIndex ? 'rgba(59, 130, 246, 0.5)' : 'transparent',
                              borderBottom: index < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none'
                            }}
                            dangerouslySetInnerHTML={{ __html: suggestion }}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                  
                  <button
                    onClick={makeGuess}
                    disabled={loading || !guess.trim()}
                    style={{
                      padding: '15px 30px',
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      border: 'none',
                      borderRadius: '12px',
                      background: loading || !guess.trim() 
                        ? 'rgba(107, 114, 128, 0.5)' 
                        : 'linear-gradient(45deg, #3b82f6, #1d4ed8)',
                      color: 'white',
                      cursor: loading || !guess.trim() ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {loading ? 'Searching...' : 'Submit Guess'}
                  </button>
                </div>
              )}

              {error && (
                <div style={{
                  padding: '15px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  borderRadius: '12px',
                  color: '#fca5a5',
                  marginTop: '15px'
                }}>
                  {error}
                </div>
              )}

              {gameWon && (
                <div style={{
                  textAlign: 'center',
                  padding: '20px',
                  background: 'rgba(34, 197, 94, 0.2)',
                  border: '1px solid rgba(34, 197, 94, 0.5)',
                  borderRadius: '12px',
                  marginTop: '15px'
                }}>
                  <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🎉</div>
                  <p style={{ fontSize: '1.1rem', margin: 0 }}>
                    Congratulations! You found {targetPlayer} in {guessCount} guesses!
                  </p>
                </div>
              )}

              {showAnswer && !gameWon && (
                <div style={{
                  textAlign: 'center',
                  padding: '20px',
                  background: 'rgba(249, 115, 22, 0.2)',
                  border: '1px solid rgba(249, 115, 22, 0.5)',
                  borderRadius: '12px',
                  marginTop: '15px'
                }}>
                  <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🎯</div>
                  <p style={{ fontSize: '1.1rem', margin: 0 }}>
                    The answer was {targetPlayer}
                  </p>
                </div>
              )}

              <div style={{
                display: 'flex',
                gap: '15px',
                marginTop: '20px'
              }}>
                <button 
                  onClick={startNewGame} 
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    border: 'none',
                    borderRadius: '12px',
                    background: 'linear-gradient(45deg, #10b981, #059669)',
                    color: 'white',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
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
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      border: 'none',
                      borderRadius: '12px',
                      background: 'linear-gradient(45deg, #f59e0b, #d97706)',
                      color: 'white',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
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
                background: 'rgba(255,255,255,0.1)',
                backdropFilter: 'blur(10px)',
                borderRadius: '20px',
                padding: '25px',
                border: '1px solid rgba(255,255,255,0.2)'
              }}>
                <h3 style={{ 
                  fontSize: '1.3rem', 
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  📈 Top 5 Most Similar
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  {top5Players.map(([name, score], index) => (
                    <div key={name} style={{
                      background: 'rgba(255,255,255,0.05)',
                      padding: '15px',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.1)'
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '10px'
                      }}>
                        <span style={{
                          background: 'linear-gradient(45deg, #fbbf24, #f59e0b)',
                          color: 'white',
                          padding: '5px 10px',
                          borderRadius: '8px',
                          fontSize: '0.9rem',
                          fontWeight: 'bold',
                          minWidth: '25px',
                          textAlign: 'center'
                        }}>
                          {index + 1}
                        </span>
                        <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>
                          {name}
                        </span>
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
            background: 'rgba(255,255,255,0.1)',
            backdropFilter: 'blur(10px)',
            borderRadius: '20px',
            padding: '25px',
            border: '1px solid rgba(255,255,255,0.2)',
            maxHeight: '80vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <h3 style={{ 
              fontSize: '1.3rem', 
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              👥 Guess History ({guessHistory.length})
            </h3>
            
            {guessHistory.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '40px 20px',
                opacity: 0.7
              }}>
                <div style={{ fontSize: '3rem', marginBottom: '15px' }}>🔍</div>
                <p>No guesses yet. Start by entering a player name!</p>
              </div>
            ) : (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '15px',
                overflowY: 'auto',
                flex: 1,
                paddingRight: '10px'
              }}>
                {guessHistory.map((item, index) => (
                  <div key={index} style={{
                    background: 'rgba(255,255,255,0.1)',
                    padding: '20px',
                    borderRadius: '15px',
                    border: '1px solid rgba(255,255,255,0.2)'
                  }}>
                    <div style={{ marginBottom: '15px' }}>
                      <h4 style={{ 
                        fontSize: '1.1rem', 
                        fontWeight: 'bold',
                        margin: '0 0 10px 0'
                      }}>
                        {item.name}
                      </h4>
                    </div>
                    
                    <div style={{ marginBottom: '15px' }}>
                      <ScoreBar score={item.score} />
                    </div>
                    
                    {item.breakdown && Object.keys(item.breakdown).length > 0 && (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '8px',
                        fontSize: '0.85rem'
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
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '5px 10px',
                              background: 'rgba(255,255,255,0.1)',
                              borderRadius: '8px'
                            }}>
                              <span style={{ opacity: 0.8 }}>
                                {formatBreakdownKey(key)}
                              </span>
                              <span style={{ 
                                fontWeight: 'bold',
                                color: '#10b981'
                              }}>
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