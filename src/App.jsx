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
  const [gameMode, setGameMode] = useState('all'); // 'all' or 'classic'
  const [filteredPlayers, setFilteredPlayers] = useState([]);

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

  const filterPlayersByMode = async (players, mode) => {
    if (mode === 'all') {
      return players;
    }
    
    // For classic mode, we need to filter players by start_year >= 2011 and career_length >= 5
    try {
      const response = await fetch(`${API_BASE}/player_details`);
      if (response.ok) {
        const playerDetails = await response.json();
        
        const classicPlayers = players.filter(playerName => {
          const playerData = playerDetails[playerName];
          if (!playerData) return false;
          
          return playerData.start_year >= 2011 && playerData.career_length >= 5;
        });
        
        return classicPlayers;
      }
    } catch (error) {
      console.error('Could not fetch player details for filtering:', error);
    }
    
    // Fallback to modern players if API call fails
    return modernPlayers;
  };

  const startNewGame = async () => {
    const playersToUse = allPlayers.length > 0 ? allPlayers : modernPlayers;
    const modeFilteredPlayers = await filterPlayersByMode(playersToUse, gameMode);
    setFilteredPlayers(modeFilteredPlayers);
    
    const randomPlayer = modeFilteredPlayers[Math.floor(Math.random() * modeFilteredPlayers.length)];
    
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
    
    console.log(`New ${gameMode} game started with:`, randomPlayer);
  };

  const switchMode = async (newMode) => {
    setGameMode(newMode);
    
    // Reset game state
    setTargetPlayer('');
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
    
    // Filter players and start new game with new mode
    const playersToUse = allPlayers.length > 0 ? allPlayers : modernPlayers;
    const modeFilteredPlayers = await filterPlayersByMode(playersToUse, newMode);
    setFilteredPlayers(modeFilteredPlayers);
    
    const randomPlayer = modeFilteredPlayers[Math.floor(Math.random() * modeFilteredPlayers.length)];
    setTargetPlayer(randomPlayer);
    
    console.log(`Switched to ${newMode} mode with:`, randomPlayer);
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
          
          // Filter players based on current mode and set initial target
          const modeFilteredPlayers = await filterPlayersByMode(sortedPlayers, gameMode);
          setFilteredPlayers(modeFilteredPlayers);
          
          const randomPlayer = modeFilteredPlayers[Math.floor(Math.random() * modeFilteredPlayers.length)];
          setTargetPlayer(randomPlayer);
          console.log('Loaded', sortedPlayers.length, 'players from API');
          console.log(`${gameMode} mode has`, modeFilteredPlayers.length, 'players');
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
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '4px'
      }}>
        <div style={{
          position: 'relative',
          flex: 1,
          height: '24px',
          backgroundColor: '#374151',
          borderRadius: '12px',
          overflow: 'hidden'
        }}>
          <div 
            style={{
              width: `${percentage}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${color}dd, ${color})`,
              boxShadow: `0 0 10px ${color}40`,
              transition: 'width 0.5s ease'
            }}
          />
          {showLabel && (
            <div 
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: '12px',
                fontWeight: 'bold',
                color: percentage > 30 ? 'white' : color,
                textShadow: percentage > 30 ? '0 1px 2px rgba(0,0,0,0.8)' : 'none'
              }}
            >
              {score}
            </div>
          )}
        </div>
        <div 
          style={{
            fontSize: '14px',
            fontWeight: 'bold',
            color: color,
            minWidth: '50px'
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

  const gameStyles = {
    container: {
      minHeight: '100vh',
      backgroundColor: '#0f172a',
      color: 'white',
      fontFamily: 'system-ui, sans-serif'
    },
    content: {
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '20px'
    },
    panel: {
      backgroundColor: '#1e293b',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '20px',
      border: '1px solid #334155'
    },
    header: {
      textAlign: 'center',
      marginBottom: '30px'
    },
    title: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      margin: '0 0 12px 0',
      fontSize: '2.5rem',
      fontWeight: 'bold',
      background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent'
    },
    subtitle: {
      color: '#94a3b8',
      fontSize: '1.1rem',
      margin: '0 0 20px 0'
    },
    stats: {
      display: 'flex',
      justifyContent: 'center',
      gap: '30px',
      fontSize: '1rem',
      fontWeight: '500'
    },
    modeSelector: {
      display: 'flex',
      justifyContent: 'center',
      gap: '12px',
      marginBottom: '20px'
    },
    modeButton: {
      padding: '10px 20px',
      borderRadius: '8px',
      border: 'none',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.2s ease'
    },
    modeButtonActive: {
      backgroundColor: '#3b82f6',
      color: 'white'
    },
    modeButtonInactive: {
      backgroundColor: '#374151',
      color: '#9ca3af'
    },
    layout: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '20px'
    },
    leftPanel: {
      display: 'flex',
      flexDirection: 'column',
      gap: '20px'
    },
    inputSection: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    },
    inputContainer: {
      position: 'relative'
    },
    input: {
      width: '100%',
      padding: '12px 16px',
      borderRadius: '8px',
      border: '1px solid #475569',
      backgroundColor: '#334155',
      color: 'white',
      fontSize: '16px',
      outline: 'none',
      transition: 'border-color 0.2s ease'
    },
    suggestions: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      backgroundColor: '#334155',
      border: '1px solid #475569',
      borderTop: 'none',
      borderRadius: '0 0 8px 8px',
      maxHeight: '200px',
      overflowY: 'auto',
      zIndex: 1000,
      listStyle: 'none',
      margin: 0,
      padding: 0
    },
    suggestionItem: {
      padding: '8px 16px',
      cursor: 'pointer',
      borderBottom: '1px solid #475569'
    },
    button: {
      padding: '12px 24px',
      borderRadius: '8px',
      border: 'none',
      fontSize: '16px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.2s ease'
    },
    submitButton: {
      backgroundColor: '#3b82f6',
      color: 'white'
    },
    buttonGroup: {
      display: 'flex',
      gap: '12px'
    },
    newGameButton: {
      backgroundColor: '#10b981',
      color: 'white'
    },
    revealButton: {
      backgroundColor: '#6b7280',
      color: 'white'
    },
    error: {
      backgroundColor: '#dc2626',
      color: 'white',
      padding: '12px',
      borderRadius: '8px',
      marginTop: '12px'
    },
    winMessage: {
      backgroundColor: '#059669',
      textAlign: 'center',
      padding: '20px'
    },
    revealMessage: {
      backgroundColor: '#0891b2',
      textAlign: 'center',
      padding: '20px'
    },
    emoji: {
      fontSize: '2rem',
      marginBottom: '12px'
    },
    top5List: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    },
    top5Item: {
      backgroundColor: '#374151',
      padding: '12px',
      borderRadius: '8px'
    },
    top5Header: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '8px'
    },
    rank: {
      backgroundColor: '#f59e0b',
      color: 'white',
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '12px',
      fontWeight: 'bold'
    },
    guessList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      maxHeight: '600px',
      overflowY: 'auto'
    },
    guessItem: {
      backgroundColor: '#374151',
      padding: '16px',
      borderRadius: '8px'
    },
    guessHeader: {
      marginBottom: '8px'
    },
    breakdown: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '4px',
      marginTop: '12px',
      fontSize: '12px'
    },
    breakdownItem: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '2px 8px',
      backgroundColor: '#1e293b',
      borderRadius: '4px'
    },
    breakdownValue: {
      color: '#10b981',
      fontWeight: 'bold'
    },
    emptyState: {
      textAlign: 'center',
      padding: '40px 20px',
      color: '#64748b'
    },
    emptyIcon: {
      fontSize: '3rem',
      marginBottom: '16px'
    }
  };

  return (
    <div style={gameStyles.container}>
      <div style={gameStyles.content}>
        {/* Header */}
        <div style={{...gameStyles.panel, ...gameStyles.header}}>
          <div style={gameStyles.title}>
            <span>🏀</span>
            <h1 style={{margin: 0}}>NBA-MANTLE</h1>
            <span>🎯</span>
          </div>
          
          <p style={gameStyles.subtitle}>
            Guess the mystery NBA player by finding similar players!
          </p>
          
          {/* Game Mode Selector */}
          <div style={gameStyles.modeSelector}>
            <button
              style={{
                ...gameStyles.modeButton,
                ...(gameMode === 'all' ? gameStyles.modeButtonActive : gameStyles.modeButtonInactive)
              }}
              onClick={() => switchMode('all')}
            >
              🌟 All Time Mode
            </button>
            <button
              style={{
                ...gameStyles.modeButton,
                ...(gameMode === 'classic' ? gameStyles.modeButtonActive : gameStyles.modeButtonInactive)
              }}
              onClick={() => switchMode('classic')}
            >
              🏆 Classic Mode (2011+)
            </button>
          </div>
          
          <div style={gameStyles.stats}>
            <span>⚡ Attempt #{guessCount}</span>
            <span>🎮 {gameMode === 'all' ? 'All Time' : 'Classic'} Mode</span>
            {!gameWon && !showAnswer && (
              <span style={{color: '#94a3b8'}}>Mystery Player: ???</span>
            )}
            {(gameWon || showAnswer) && (
              <span style={{color: '#10b981'}}>Answer: {targetPlayer}</span>
            )}
          </div>
        </div>

        <div style={gameStyles.layout}>
          {/* Left Panel */}
          <div style={gameStyles.leftPanel}>
            {/* Input Section */}
            <div style={gameStyles.panel}>
              <h3 style={{margin: '0 0 16px 0'}}>🔍 Make Your Guess</h3>
              
              {!gameWon && !showAnswer && (
                <div style={gameStyles.inputSection}>
                  <div style={gameStyles.inputContainer}>
                    <input
                      type="text"
                      style={gameStyles.input}
                      value={guess}
                      onChange={(e) => {
                        const value = e.target.value;
                        setGuess(value);
                        setSelectedSuggestionIndex(-1);
                        
                        if (value.length > 0) {
                          const playersToSearch = filteredPlayers.length > 0 ? filteredPlayers : allPlayers;
                          const filtered = playersToSearch.filter(name =>
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
                    />
                    
                    {showSuggestions && suggestions.length > 0 && (
                      <ul style={gameStyles.suggestions}>
                        {suggestions.map((suggestion, index) => (
                          <li
                            key={index}
                            style={{
                              ...gameStyles.suggestionItem,
                              backgroundColor: index === selectedSuggestionIndex ? '#475569' : 'transparent'
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
                      ...gameStyles.button,
                      ...gameStyles.submitButton,
                      opacity: loading || !guess.trim() ? 0.5 : 1,
                      cursor: loading || !guess.trim() ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {loading ? 'Searching...' : 'Submit Guess'}
                  </button>
                </div>
              )}

              {error && (
                <div style={gameStyles.error}>
                  {error}
                </div>
              )}

              {gameWon && (
                <div style={{...gameStyles.panel, ...gameStyles.winMessage}}>
                  <div style={gameStyles.emoji}>🎉</div>
                  <p style={{margin: 0}}>
                    Congratulations! You found {targetPlayer} in {guessCount} guesses!
                  </p>
                </div>
              )}

              {showAnswer && !gameWon && (
                <div style={{...gameStyles.panel, ...gameStyles.revealMessage}}>
                  <div style={gameStyles.emoji}>🎯</div>
                  <p style={{margin: 0}}>
                    The answer was {targetPlayer}
                  </p>
                </div>
              )}

              <div style={gameStyles.buttonGroup}>
                <button 
                  style={{...gameStyles.button, ...gameStyles.newGameButton}}
                  onClick={startNewGame}
                >
                  🔄 New Game
                </button>
                
                {!gameWon && !showAnswer && (
                  <button 
                    style={{...gameStyles.button, ...gameStyles.revealButton}}
                    onClick={revealAnswer}
                  >
                    👁️ Reveal
                  </button>
                )}
              </div>
            </div>

            {/* Top 5 Similar Players */}
            {top5Players.length > 0 && (
              <div style={gameStyles.panel}>
                <h3 style={{margin: '0 0 16px 0'}}>📈 Top 5 Most Similar</h3>
                <div style={gameStyles.top5List}>
                  {top5Players.map(([name, score], index) => (
                    <div key={name} style={gameStyles.top5Item}>
                      <div style={gameStyles.top5Header}>
                        <span style={gameStyles.rank}>{index + 1}</span>
                        <span style={{fontWeight: 'bold'}}>{name}</span>
                      </div>
                      <ScoreBar score={score} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - Guess History */}
          <div style={gameStyles.panel}>
            <h3 style={{margin: '0 0 16px 0'}}>👥 Guess History ({guessHistory.length})</h3>
            
            {guessHistory.length === 0 ? (
              <div style={gameStyles.emptyState}>
                <div style={gameStyles.emptyIcon}>🔍</div>
                <p style={{margin: 0}}>No guesses yet. Start by entering a player name!</p>
              </div>
            ) : (
              <div style={gameStyles.guessList}>
                {guessHistory.map((item, index) => (
                  <div key={index} style={gameStyles.guessItem}>
                    <div style={gameStyles.guessHeader}>
                      <h4 style={{margin: '0 0 8px 0'}}>{item.name}</h4>
                    </div>
                    
                    <ScoreBar score={item.score} />
                    
                    {item.breakdown && Object.keys(item.breakdown).length > 0 && (
                      <div style={gameStyles.breakdown}>
                        {Object.entries(item.breakdown)
                          .filter(([key, value]) => 
                            key !== 'total' && 
                            key !== 'shared_seasons_detail' && 
                            value > 0
                          )
                          .map(([key, value]) => (
                            <div key={key} style={gameStyles.breakdownItem}>
                              <span>
                                {formatBreakdownKey(key)}
                              </span>
                              <span style={gameStyles.breakdownValue}>
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