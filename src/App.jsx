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
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(true);

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

  const getFilteredPlayers = (mode = gameMode, playersData = allPlayersData) => {
    if (playersData.length === 0) {
      return modernPlayers;
    }

    if (mode === 'classic') {
      // Filter for players who started in 2011+ with 5+ seasons
      return playersData
        .filter(player => player.start_year >= 2011 && player.career_length >= 5)
        .map(player => player.name);
    }

    // All time mode - return all players
    return playersData.map(player => player.name);
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

  const startNewGame = () => {
    const playersToUse = getFilteredPlayers();
    const randomPlayer = playersToUse[Math.floor(Math.random() * playersToUse.length)];
    
    setTargetPlayer(randomPlayer);
    resetGameState();
    
    console.log('New game started with:', randomPlayer, 'Mode:', gameMode);
  };

  const switchGameMode = (newMode) => {
    console.log('Switching to mode:', newMode);
    setGameMode(newMode);
    resetGameState();
    
    // Immediately filter players with new mode
    const playersToUse = getFilteredPlayers(newMode, allPlayersData);
    setAllPlayers(playersToUse);
    
    if (playersToUse.length === 0) {
      // Fallback if no players match criteria
      const fallbackPlayers = modernPlayers;
      const randomPlayer = fallbackPlayers[Math.floor(Math.random() * fallbackPlayers.length)];
      setTargetPlayer(randomPlayer);
      setAllPlayers(fallbackPlayers);
    } else {
      const randomPlayer = playersToUse[Math.floor(Math.random() * playersToUse.length)];
      setTargetPlayer(randomPlayer);
    }
    
    console.log('Switched to mode:', newMode, 'with', playersToUse.length, 'players available');
  };

  // Load initial player data
  useEffect(() => {
    const loadPlayerNames = async () => {
      console.log('Loading initial player data...');
      setIsLoadingPlayers(true);
      
      try {
        // Try the correct endpoint first
        let response = await fetch(`${API_BASE}/players`);
        if (!response.ok) {
          // Fallback to the other endpoint name
          response = await fetch(`${API_BASE}/player_awards`);
        }
        
        if (response.ok) {
          const playersData = await response.json();
          console.log('Raw API response:', playersData);
          
          // Check if the data is an array of objects with the expected format
          if (Array.isArray(playersData) && playersData.length > 0 && typeof playersData[0] === 'object') {
            setAllPlayersData(playersData);
            console.log('Loaded player data objects:', playersData.length);
            
            // Filter players based on current mode
            const filteredPlayers = getFilteredPlayers(gameMode, playersData);
            setAllPlayers(filteredPlayers);
            
            console.log(`Filtered ${filteredPlayers.length} players for ${gameMode} mode`);
            
            if (filteredPlayers.length > 0) {
              const randomPlayer = filteredPlayers[Math.floor(Math.random() * filteredPlayers.length)];
              setTargetPlayer(randomPlayer);
              console.log('Selected random target:', randomPlayer);
            } else {
              console.warn('No players match the criteria, using fallback');
              const fallback = modernPlayers;
              setAllPlayers(fallback);
              const randomPlayer = fallback[Math.floor(Math.random() * fallback.length)];
              setTargetPlayer(randomPlayer);
            }
          } else {
            // Fallback if data format is different (array of strings)
            console.log('Using fallback format for API data');
            const sortedPlayers = Array.isArray(playersData) ? playersData.sort() : [];
            setAllPlayers(sortedPlayers);
            if (sortedPlayers.length > 0) {
              const randomPlayer = sortedPlayers[Math.floor(Math.random() * sortedPlayers.length)];
              setTargetPlayer(randomPlayer);
            }
          }
        } else {
          throw new Error(`API returned status: ${response.status}`);
        }
      } catch (error) {
        console.error('Could not load players from API, using fallback:', error);
        const fallback = modernPlayers;
        setAllPlayers(fallback);
        const randomPlayer = fallback[Math.floor(Math.random() * fallback.length)];
        setTargetPlayer(randomPlayer);
      }

      setIsLoadingPlayers(false);
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
      <div className="flex items-center gap-2">
        <div className="relative flex-1 h-6 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${percentage}%`,
              background: `linear-gradient(90deg, ${color}dd, ${color})`,
              boxShadow: `0 0 10px ${color}40`
            }}
          />
          {showLabel && (
            <div 
              className="absolute inset-0 flex items-center justify-center text-sm font-bold"
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
          className="text-sm font-semibold min-w-12"
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
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-red-900 text-white p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 mb-6 border border-white/20">
          <div className="text-center mb-4">
            <div className="flex items-center justify-center gap-2 text-4xl font-bold mb-2">
              <span>🏀</span>
              <h1>NBA-MANTLE</h1>
              <span>🎯</span>
            </div>
            
            <p className="text-blue-200 text-lg">
              Guess the mystery NBA player by finding similar players!
            </p>
          </div>

          {/* Game Mode Selector */}
          <div className="flex justify-center gap-4 mb-4">
            <button 
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                gameMode === 'all-time' 
                  ? 'bg-yellow-500 text-black shadow-lg' 
                  : 'bg-white/20 hover:bg-white/30'
              }`}
              onClick={() => switchGameMode('all-time')}
              disabled={isLoadingPlayers}
            >
              🏆 All Time
            </button>
            <button 
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                gameMode === 'classic' 
                  ? 'bg-yellow-500 text-black shadow-lg' 
                  : 'bg-white/20 hover:bg-white/30'
              }`}
              onClick={() => switchGameMode('classic')}
              disabled={isLoadingPlayers}
            >
              ⭐ Classic (2011+)
            </button>
          </div>
          
          <div className="flex justify-center gap-6 text-sm">
            <span className="bg-blue-500/30 px-3 py-1 rounded">⚡ Attempt #{guessCount}</span>
            <span className="bg-purple-500/30 px-3 py-1 rounded">
              Mode: {gameMode === 'all-time' ? 'All Time' : 'Classic (2011+, 5+ seasons)'}
            </span>
            {!gameWon && !showAnswer && (
              <span className="bg-red-500/30 px-3 py-1 rounded">Mystery Player: ???</span>
            )}
            {(gameWon || showAnswer) && (
              <span className="bg-green-500/30 px-3 py-1 rounded">Answer: {targetPlayer}</span>
            )}
          </div>

          {/* Debug Info */}
          <div className="text-xs text-center mt-2 text-blue-300">
            Players available: {allPlayers.length} | Backend data: {allPlayersData.length > 0 ? 'Connected' : 'Fallback'} | Loading: {isLoadingPlayers ? 'Yes' : 'No'}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Panel */}
          <div className="space-y-6">
            {/* Input Section */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                🔍 Make Your Guess
              </h3>
              
              {!gameWon && !showAnswer && (
                <div className="space-y-4">
                  <div className="relative">
                    <input
                      type="text"
                      className="w-full p-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400"
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
                      disabled={loading || isLoadingPlayers}
                    />
                    
                    {showSuggestions && suggestions.length > 0 && (
                      <ul className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg max-h-48 overflow-y-auto">
                        {suggestions.map((suggestion, index) => (
                          <li
                            key={index}
                            className={`px-3 py-2 cursor-pointer hover:bg-gray-700 ${
                              index === selectedSuggestionIndex ? 'bg-blue-600' : ''
                            }`}
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
                    disabled={loading || !guess.trim() || isLoadingPlayers}
                    className={`w-full py-3 rounded-lg font-semibold transition-all ${
                      loading || !guess.trim() || isLoadingPlayers
                        ? 'bg-gray-600 cursor-not-allowed' 
                        : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
                    }`}
                  >
                    {loading ? 'Searching...' : isLoadingPlayers ? 'Loading Players...' : 'Submit Guess'}
                  </button>
                </div>
              )}

              {error && (
                <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 text-red-200">
                  {error}
                </div>
              )}

              {gameWon && (
                <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-4 text-center">
                  <div className="text-4xl mb-2">🎉</div>
                  <p className="text-green-200">
                    Congratulations! You found {targetPlayer} in {guessCount} guesses!
                  </p>
                </div>
              )}

              {showAnswer && !gameWon && (
                <div className="bg-blue-500/20 border border-blue-500/50 rounded-lg p-4 text-center">
                  <div className="text-4xl mb-2">🎯</div>
                  <p className="text-blue-200">
                    The answer was {targetPlayer}
                  </p>
                </div>
              )}

              <div className="flex gap-3 mt-4">
                <button 
                  className="flex-1 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-all active:scale-95" 
                  onClick={startNewGame}
                  disabled={isLoadingPlayers}
                >
                  🔄 New Game
                </button>
                
                {!gameWon && !showAnswer && (
                  <button 
                    className="flex-1 py-3 bg-orange-600 hover:bg-orange-700 rounded-lg font-semibold transition-all active:scale-95" 
                    onClick={revealAnswer}
                    disabled={isLoadingPlayers}
                  >
                    👁️ Reveal
                  </button>
                )}
              </div>
            </div>

            {/* Top 5 Similar Players */}
            {top5Players.length > 0 && (
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20">
                <h3 className="text-xl font-bold mb-4">📈 Top 5 Most Similar</h3>
                <div className="space-y-3">
                  {top5Players.map(([name, score], index) => (
                    <div key={name} className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 bg-yellow-500 text-black rounded-full flex items-center justify-center font-bold text-sm">
                          {index + 1}
                        </span>
                        <span className="font-semibold">{name}</span>
                      </div>
                      <ScoreBar score={score} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - Guess History */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20">
            <h3 className="text-xl font-bold mb-4">👥 Guess History ({guessHistory.length})</h3>
            
            {guessHistory.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-6xl mb-4">🔍</div>
                <p className="text-gray-300">No guesses yet. Start by entering a player name!</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {guessHistory.map((item, index) => (
                  <div key={index} className="bg-white/5 rounded-lg p-4 border border-white/10">
                    <div className="mb-3">
                      <h4 className="font-bold text-lg">{item.name}</h4>
                    </div>
                    
                    <div className="mb-3">
                      <ScoreBar score={item.score} />
                    </div>
                    
                    {item.breakdown && Object.keys(item.breakdown).length > 0 && (
                      <div className="space-y-1 text-sm">
                        {Object.entries(item.breakdown)
                          .filter(([key, value]) => 
                            key !== 'total' && 
                            key !== 'shared_seasons_detail' && 
                            value > 0
                          )
                          .map(([key, value]) => (
                            <div key={key} className="flex justify-between items-center text-gray-300">
                              <span>{formatBreakdownKey(key)}</span>
                              <span className="text-green-400 font-semibold">+{value}</span>
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