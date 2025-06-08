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
  const [gameMode, setGameMode] = useState('all-time'); // 'all-time' or 'classic'
  const [allPlayersData, setAllPlayersData] = useState([]);

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

  const getFilteredPlayers = (mode = gameMode) => {
    if (allPlayersData.length === 0) {
      return modernPlayers;
    }

    if (mode === 'classic') {
      // Filter for players who started in 2011+ with 5+ seasons
      return allPlayersData
        .filter(player => player.start_year >= 2011 && player.career_length >= 5)
        .map(player => player.name);
    }

    // All time mode - return all players
    return allPlayersData.map(player => player.name);
  };

  const resetGameState = () => {
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

  const selectRandomPlayer = (playersArray) => {
    if (playersArray.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * playersArray.length);
    return playersArray[randomIndex];
  };

  const startNewGame = async () => {
    try {
      // Get a random player from the backend for the current game mode
      const response = await fetch(`${API_BASE}/random_player`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: gameMode
        })
      });

      if (response.ok) {
        const result = await response.json();
        setTargetPlayer(result.player);
        console.log('New game started with:', result.player, 'Mode:', gameMode);
        resetGameState();
      } else {
        // Fallback to local selection
        const playersToUse = getFilteredPlayers();
        const randomPlayer = selectRandomPlayer(playersToUse);
        if (randomPlayer) {
          setTargetPlayer(randomPlayer);
          resetGameState();
          console.log('Fallback: New game started with:', randomPlayer, 'Mode:', gameMode);
        }
      }
    } catch (error) {
      console.error('Error starting new game:', error);
      // Fallback to local selection
      const playersToUse = getFilteredPlayers();
      const randomPlayer = selectRandomPlayer(playersToUse);
      if (randomPlayer) {
        setTargetPlayer(randomPlayer);
        resetGameState();
        console.log('Error fallback: New game started with:', randomPlayer, 'Mode:', gameMode);
      }
    }
  };

  const switchGameMode = async (newMode) => {
    if (newMode === gameMode) return; // Don't switch if it's the same mode
    
    setGameMode(newMode);
    
    try {
      // Get a random player from the backend for the new game mode
      const response = await fetch(`${API_BASE}/random_player`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: newMode
        })
      });

      if (response.ok) {
        const result = await response.json();
        setTargetPlayer(result.player);
        
        // Update the available players list for the new mode
        const playersToUse = getFilteredPlayers(newMode);
        setAllPlayers(playersToUse);
        
        resetGameState();
        console.log('Game mode switched to:', newMode, 'New target:', result.player);
      } else {
        // Fallback to local selection
        const playersToUse = getFilteredPlayers(newMode);
        const randomPlayer = selectRandomPlayer(playersToUse);
        setTargetPlayer(randomPlayer);
        setAllPlayers(playersToUse);
        resetGameState();
        console.log('Fallback mode switch to:', newMode, 'New target:', randomPlayer);
      }
    } catch (error) {
      console.error('Error switching game mode:', error);
      // Fallback to local selection
      const playersToUse = getFilteredPlayers(newMode);
      const randomPlayer = selectRandomPlayer(playersToUse);
      setTargetPlayer(randomPlayer);
      setAllPlayers(playersToUse);
      resetGameState();
      console.log('Error fallback mode switch to:', newMode, 'New target:', randomPlayer);
    }
  };

  // Load initial player data
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
          const playersData = await response.json();
          
          // Check if the data is an array of objects with the expected format
          if (Array.isArray(playersData) && playersData.length > 0 && typeof playersData[0] === 'object') {
            setAllPlayersData(playersData);
            
            // Filter players based on current mode
            const filteredPlayers = getFilteredPlayers(gameMode);
            const playerNames = filteredPlayers.sort();
            setAllPlayers(playerNames);
            
            if (playerNames.length > 0) {
              // Use the backend to get a random player
              const randomResponse = await fetch(`${API_BASE}/random_player`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  mode: gameMode
                })
              });

              if (randomResponse.ok) {
                const randomResult = await randomResponse.json();
                setTargetPlayer(randomResult.player);
                console.log('Loaded', playerNames.length, 'players from API for', gameMode, 'mode');
                console.log('Initial random player:', randomResult.player);
              } else {
                // Fallback to local random selection
                const randomPlayer = selectRandomPlayer(playerNames);
                setTargetPlayer(randomPlayer);
                console.log('Fallback initial random player:', randomPlayer);
              }
            }
          } else {
            // Fallback if data format is different (array of strings)
            const sortedPlayers = Array.isArray(playersData) ? playersData.sort() : [];
            setAllPlayers(sortedPlayers);
            if (sortedPlayers.length > 0) {
              const randomPlayer = selectRandomPlayer(sortedPlayers);
              setTargetPlayer(randomPlayer);
            }
          }
        } else {
          throw new Error('Failed to fetch players');
        }
      } catch (error) {
        console.error('Could not load players from API, using fallback:', error);
        const fallback = modernPlayers;
        setAllPlayers(fallback);
        const randomPlayer = selectRandomPlayer(fallback);
        setTargetPlayer(randomPlayer);
      }

      resetGameState();
    };

    loadPlayerNames();
  }, []); // Only run once on mount

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
          target: targetPlayer,
          mode: gameMode // Include game mode in the request
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
          target: targetPlayer,
          mode: gameMode // Include game mode in the request
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
      <div className="score-bar-container">
        <div className="score-bar-track">
          <div 
            className="score-bar-fill"
            style={{
              width: `${percentage}%`,
              background: `linear-gradient(90deg, ${color}dd, ${color})`,
              boxShadow: `0 0 10px ${color}40`
            }}
          />
          {showLabel && (
            <div 
              className="score-bar-label"
              style={{
                color: percentage > 30 ? 'white' : color,
                textShadow: percentage > 30 ? '0 1px 2px rgba(0,0,0,0.8)' : 'none'
              }}
            >
              {score}
            </div>
          )}
        </div>
        <div 
          className="score-bar-value"
          style={{ color: color }}
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

  return (
    <div className="game-container">
      <div className="game-content">
        {/* Header */}
        <div className="header panel">
          <div className="title-section">
            <span>🏀</span>
            <h1>NBA-MANTLE</h1>
            <span>🎯</span>
          </div>
          
          <p className="subtitle">
            Guess the mystery NBA player by finding similar players!
          </p>

          {/* Game Mode Selector */}
          <div className="game-mode-selector">
            <button 
              className={`mode-btn ${gameMode === 'all-time' ? 'active' : ''}`}
              onClick={() => switchGameMode('all-time')}
            >
              🏆 All Time
            </button>
            <button 
              className={`mode-btn ${gameMode === 'classic' ? 'active' : ''}`}
              onClick={() => switchGameMode('classic')}
            >
              ⭐ Classic (2011+)
            </button>
          </div>
          
          <div className="stats">
            <span>⚡ Attempt #{guessCount}</span>
            <span className="mode-indicator">
              Mode: {gameMode === 'all-time' ? 'All Time' : 'Classic (2011+, 5+ seasons)'}
            </span>
            {!gameWon && !showAnswer && (
              <span className="mystery">Mystery Player: ???</span>
            )}
            {(gameWon || showAnswer) && (
              <span className="answer">Answer: {targetPlayer}</span>
            )}
          </div>
        </div>

        <div className="main-layout">
          {/* Left Panel */}
          <div className="left-panel">
            {/* Input Section */}
            <div className="panel">
              <h3>🔍 Make Your Guess</h3>
              
              {!gameWon && !showAnswer && (
                <div className="input-section">
                  <div className="input-container">
                    <input
                      type="text"
                      className="player-input"
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
                    />
                    
                    {showSuggestions && suggestions.length > 0 && (
                      <ul className="suggestions">
                        {suggestions.map((suggestion, index) => (
                          <li
                            key={index}
                            className={`suggestion-item ${index === selectedSuggestionIndex ? 'selected' : ''}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSuggestionSelect(suggestion);
                            }}
                            onMouseEnter={() => setSelectedSuggestionIndex(index)}
                            dangerouslySetInnerHTML={{ __html: suggestion }}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                  
                  <button
                    onClick={makeGuess}
                    disabled={loading || !guess.trim()}
                    className={`submit-btn ${loading || !guess.trim() ? 'disabled' : ''}`}
                  >
                    {loading ? 'Searching...' : 'Submit Guess'}
                  </button>
                </div>
              )}

              {error && (
                <div className="error">
                  {error}
                </div>
              )}

              {gameWon && (
                <div className="win-message panel">
                  <div className="emoji">🎉</div>
                  <p>
                    Congratulations! You found {targetPlayer} in {guessCount} guesses!
                  </p>
                </div>
              )}

              {showAnswer && !gameWon && (
                <div className="reveal-message panel">
                  <div className="emoji">🎯</div>
                  <p>
                    The answer was {targetPlayer}
                  </p>
                </div>
              )}

              <div className="button-group">
                <button className="new-game-btn" onClick={startNewGame}>
                  🔄 New Game
                </button>
                
                {!gameWon && !showAnswer && (
                  <button className="reveal-btn" onClick={revealAnswer}>
                    👁️ Reveal
                  </button>
                )}
              </div>
            </div>

            {/* Top 5 Similar Players */}
            {top5Players.length > 0 && (
              <div className="panel">
                <h3>📈 Top 5 Most Similar</h3>
                <div className="top5-list">
                  {top5Players.map(([name, score], index) => (
                    <div key={name} className="top5-item">
                      <div className="top5-header">
                        <span className="rank">{index + 1}</span>
                        <span className="name">{name}</span>
                      </div>
                      <ScoreBar score={score} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - Guess History */}
          <div className="panel right-panel">
            <h3>👥 Guess History ({guessHistory.length})</h3>
            
            {guessHistory.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <p>No guesses yet. Start by entering a player name!</p>
              </div>
            ) : (
              <div className="guess-list">
                {guessHistory.map((item, index) => (
                  <div key={index} className="guess-item">
                    <div className="guess-header">
                      <h4>{item.name}</h4>
                    </div>
                    
                    <div className="guess-score">
                      <ScoreBar score={item.score} />
                    </div>
                    
                    {item.breakdown && Object.keys(item.breakdown).length > 0 && (
                      <div className="breakdown">
                        {Object.entries(item.breakdown)
                          .filter(([key, value]) => 
                            key !== 'total' && 
                            key !== 'shared_seasons_detail' && 
                            value > 0
                          )
                          .map(([key, value]) => (
                            <div key={key} className="breakdown-item">
                              <span className="breakdown-label">
                                {formatBreakdownKey(key)}
                              </span>
                              <span className="breakdown-value">
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