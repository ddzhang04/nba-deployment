import React, { useState, useEffect } from 'react';
import './NBAGuessGame.css'; // You'll need to create this CSS file

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

  // Fallback modern NBA players (only used if JSON loading fails)
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
        const response = await fetch('/players_cleaned.json');
        const text = await response.text();
        const data = JSON.parse(text);
        const playerNames = Object.keys(data).sort();
        setAllPlayers(playerNames);
        const randomPlayer = playerNames[Math.floor(Math.random() * playerNames.length)];
        setTargetPlayer(randomPlayer);
      } catch (error) {
        console.error('Could not load players_cleaned.json', error);
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
      const response = await fetch('http://127.0.0.1:5000/guess', {
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
      setError('Connection error. Make sure the Flask server is running on port 5000');
    }

    setLoading(false);
  };

  const revealAnswer = async () => {
    if (!targetPlayer) return;
    
    setLoading(true);
    try {
      const response = await fetch('http://127.0.0.1:5000/guess', {
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
        <div className="score-bar-value" style={{ color: color }}>
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
    <div className="game-container">
      <div className="game-content">
        {/* Header */}
        <div className="header">
          <div className="title-section">
            <span>🏀</span>
            <h1>NBA-MANTLE</h1>
            <span>🎯</span>
          </div>
          
          <p className="subtitle">
            Guess the mystery NBA player by finding similar players!
          </p>
          
          <div className="stats">
            <span>⚡ Attempt #{guessCount}</span>
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
                      className="player-input"
                      disabled={loading}
                    />
                    
                    {showSuggestions && suggestions.length > 0 && (
                      <ul className="suggestions">
                        {suggestions.map((suggestion, index) => (
                          <li
                            key={index}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSuggestionSelect(suggestion);
                            }}
                            onMouseEnter={() => setSelectedSuggestionIndex(index)}
                            className={`suggestion-item ${
                              index === selectedSuggestionIndex ? 'selected' : ''
                            }`}
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
                <div className="win-message">
                  <div className="emoji">🎉</div>
                  <p>Congratulations! You found {targetPlayer} in {guessCount} guesses!</p>
                </div>
              )}

              {showAnswer && !gameWon && (
                <div className="reveal-message">
                  <div className="emoji">🎯</div>
                  <p>The answer was {targetPlayer}</p>
                </div>
              )}

              <div className="button-group">
                <button onClick={startNewGame} className="new-game-btn">
                  🔄 New Game
                </button>
                
                {!gameWon && !showAnswer && (
                  <button onClick={revealAnswer} className="reveal-btn">
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
          <div className="right-panel">
            <div className="panel">
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
    </div>
  );
};

export default NBAGuessGame;