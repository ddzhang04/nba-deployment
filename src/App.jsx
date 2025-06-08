import React, { useState, useEffect } from 'react';
import './NBAGuessGame.css'; // Import the CSS file

const NBAGuessGame = () => {
  const [targetPlayer, setTargetPlayer] = useState('');
  const [guess, setGuess] = useState('');
  const [guessHistory, setGuessHistory] = useState([]);
  const [gameWon, setGameWon] = useState(false);
  const [guessCount, setGuessCount] = useState(s0);
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
  const [gameStats, setGameStats] = useState({ total_players: 0, games_played: 0 });

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
        
        // Use start_year or draft_year for debut year
        const startYear = player.start_year || player.draft_year || 0;
        // Use career_length for number of seasons
        const careerLength = player.career_length || 0;
        
        return startYear >= 2011 && careerLength >= 5;
      });
    }
    
    return players;
  };

  const loadGameStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/stats`);
      if (response.ok) {
        const stats = await response.json();
        setGameStats(stats);
      }
    } catch (error) {
      console.log('Could not load game stats:', error);
    }
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
    
    // Load fresh stats after starting new game
    setTimeout(loadGameStats, 500);
    
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

  const checkServerHealth = async () => {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) {
        const health = await response.json();
        console.log('Server health:', health);
        return true;
      }
    } catch (error) {
      console.log('Server health check failed:', error);
    }
    return false;
  };

  useEffect(() => {
    const loadPlayerNames = async () => {
      console.log('Loading players from API...');
      
      // Check server health first
      const serverHealthy = await checkServerHealth();
      if (!serverHealthy) {
        console.log('Server not responding, using fallback players');
        setAllPlayers(modernPlayers);
        setFilteredPlayers(modernPlayers);
        const randomPlayer = modernPlayers[Math.floor(Math.random() * modernPlayers.length)];
        setTargetPlayer(randomPlayer);
        return;
      }

      try {
        // Load player names
        let response = await fetch(`${API_BASE}/players`);
        if (!response.ok) {
          // Fallback to player_awards endpoint
          response = await fetch(`${API_BASE}/player_awards`);
        }
        
        if (response.ok) {
          const playerNames = await response.json();
          const sortedPlayers = playerNames.sort();
          setAllPlayers(sortedPlayers);
          console.log('Loaded', sortedPlayers.length, 'player names');
          
          // Try to load full player data for filtering
          try {
            const fullDataResponse = await fetch(`${API_BASE}/players_data`);
            if (fullDataResponse.ok) {
              const fullData = await fullDataResponse.json();
              setPlayersData(fullData);
              console.log('Loaded detailed data for', Object.keys(fullData).length, 'players');
              
              // Filter players based on current mode
              const filtered = filterPlayersForMode(sortedPlayers, fullData, gameMode);
              setFilteredPlayers(filtered);
              
              if (filtered.length > 0) {
                const randomPlayer = filtered[Math.floor(Math.random() * filtered.length)];
                setTargetPlayer(randomPlayer);
              }
              console.log('Filtered to', filtered.length, 'players for', gameMode, 'mode');
            } else {
              console.log('Could not load detailed player data, using all players');
              // Fallback: use all players if we can't get detailed data
              setFilteredPlayers(sortedPlayers);
              const randomPlayer = sortedPlayers[Math.floor(Math.random() * sortedPlayers.length)];
              setTargetPlayer(randomPlayer);
            }
          } catch (err) {
            console.log('Error loading detailed player data:', err);
            // Fallback: use all players
            setFilteredPlayers(sortedPlayers);
            const randomPlayer = sortedPlayers[Math.floor(Math.random() * sortedPlayers.length)];
            setTargetPlayer(randomPlayer);
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

      // Load game stats
      loadGameStats();
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
            // Refresh stats after win
            setTimeout(loadGameStats, 500);
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

  const getPlayerDetails = async (playerName) => {
    try {
      const response = await fetch(`${API_BASE}/player/${encodeURIComponent(playerName)}`);
      if (response.ok) {
        const result = await response.json();
        return result.data;
      }
    } catch (error) {
      console.log('Could not fetch player details:', error);
    }
    return null;
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
      <div className="flex items-center gap-2 mt-1">
        <div className="relative w-full h-6 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className="h-full transition-all duration-300 ease-out"
            style={{
              width: `${percentage}%`,
              background: `linear-gradient(90deg, ${color}dd, ${color})`,
              boxShadow: `0 0 10px ${color}40`
            }}
          />
          {showLabel && (
            <div 
              className="absolute inset-0 flex items-center justify-center text-xs font-bold"
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
          className="text-xs font-bold min-w-[40px]"
          style={{ color }}
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
    <div className="min-h-screen bg-slate-900 text-white font-sans">
      <div className="max-w-6xl mx-auto p-5">
        {/* Header */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-700 rounded-2xl p-6 mb-6 text-center border border-slate-600">
          <div className="flex items-center justify-center gap-3 mb-4">
            <span className="text-3xl">🏀</span>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-amber-400 to-red-500 bg-clip-text text-transparent">
              NBA-MANTLE
            </h1>
            <span className="text-3xl">🎯</span>
          </div>
          
          <p className="text-slate-400 mb-5 text-lg">
            Guess the mystery NBA player by finding similar players!
          </p>

          {/* Game Mode Selection */}
          <div className="mb-5">
            <div className="flex justify-center gap-3 flex-wrap">
              <button
                onClick={() => handleModeChange('classic')}
                className={`px-5 py-2.5 rounded-lg font-bold cursor-pointer transition-all duration-200 ${
                  gameMode === 'classic' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-slate-600 text-white hover:bg-slate-500'
                }`}
              >
                🏆 Classic Mode
              </button>
              <button
                onClick={() => handleModeChange('all')}
                className={`px-5 py-2.5 rounded-lg font-bold cursor-pointer transition-all duration-200 ${
                  gameMode === 'all' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-slate-600 text-white hover:bg-slate-500'
                }`}
              >
                🌟 All Players
              </button>
            </div>
            <div className="mt-2 text-sm text-slate-400">
              {gameMode === 'classic' ? 
                `Classic: Modern era players (2011+) with 5+ seasons (${filteredPlayers.length} players)` : 
                `All Players: Complete database (${filteredPlayers.length} players)`
              }
            </div>
          </div>
          
          <div className="flex justify-center gap-8 flex-wrap text-lg">
            <span className="text-amber-400">⚡ Attempt #{guessCount}</span>
            {!gameWon && !showAnswer && (
              <span className="text-slate-400">Mystery Player: ???</span>
            )}
            {(gameWon || showAnswer) && (
              <span className="text-emerald-400">Answer: {targetPlayer}</span>
            )}
            {gameStats.total_players > 0 && (
              <span className="text-blue-400">📊 {gameStats.games_played} games played</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Panel */}
          <div>
            {/* Input Section */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-700 rounded-2xl p-6 mb-6 border border-slate-600">
              <h3 className="text-xl mb-4 text-slate-100">🔍 Make Your Guess</h3>
              
              {!gameWon && !showAnswer && (
                <div>
                  <div className="relative mb-4">
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
                      className="w-full p-3 rounded-lg border-2 border-slate-600 bg-slate-900 text-white text-base focus:border-blue-500 focus:outline-none"
                    />
                    
                    {showSuggestions && suggestions.length > 0 && (
                      <ul className="absolute top-full left-0 right-0 bg-slate-800 border border-slate-600 rounded-lg max-h-48 overflow-y-auto z-50 mt-1">
                        {suggestions.map((suggestion, index) => (
                          <li
                            key={index}
                            className={`p-3 cursor-pointer border-b border-slate-700 last:border-b-0 ${
                              index === selectedSuggestionIndex ? 'bg-slate-700' : 'hover:bg-slate-700'
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
                    disabled={loading || !guess.trim()}
                    className={`w-full p-3 rounded-lg font-bold text-base transition-all duration-200 ${
                      loading || !guess.trim()
                        ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                    }`}
                  >
                    {loading ? 'Searching...' : 'Submit Guess'}
                  </button>
                </div>
              )}

              {error && (
                <div className="bg-red-100 text-red-700 p-3 rounded-lg mt-4">
                  {error}
                </div>
              )}

              {gameWon && (
                <div className="text-center bg-emerald-500 text-white p-5 rounded-xl my-4">
                  <div className="text-3xl mb-2">🎉</div>
                  <p className="text-lg font-medium">
                    Congratulations! You found {targetPlayer} in {guessCount} guesses!
                  </p>
                </div>
              )}

              {showAnswer && !gameWon && (
                <div className="text-center bg-amber-500 text-white p-5 rounded-xl my-4">
                  <div className="text-3xl mb-2">🎯</div>
                  <p className="text-lg font-medium">
                    The answer was {targetPlayer}
                  </p>
                </div>
              )}

              <div className="flex gap-3 mt-4">
                <button 
                  onClick={startNewGame}
                  className="flex-1 p-3 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer hover:bg-emerald-700 transition-colors duration-200"
                >
                  🔄 New Game
                </button>
                
                {!gameWon && !showAnswer && (
                  <button 
                    onClick={revealAnswer}
                    className="flex-1 p-3 rounded-lg bg-amber-600 text-white font-bold cursor-pointer hover:bg-amber-700 transition-colors duration-200"
                  >
                    👁️ Reveal
                  </button>
                )}
              </div>
            </div>

            {/* Top 5 Similar Players */}
            {top5Players.length > 0 && (
              <div className="bg-gradient-to-br from-slate-800 to-slate-700 rounded-2xl p-6 border border-slate-600">
                <h3 className="text-xl mb-4 text-slate-100">📈 Top 5 Most Similar</h3>
                <div className="space-y-4">
                  {top5Players.map(([name, score], index) => (
                    <div key={name} className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">
                          {index + 1}
                        </span>
                        <span className="font-bold text-slate-100">{name}</span>
                      </div>
                      <ScoreBar score={score} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - Guess History */}
          <div className="bg-gradient-to-br from-slate-800 to-slate-700 rounded-2xl p-6 border border-slate-600">
            <h3 className="text-xl mb-4 text-slate-100">👥 Guess History ({guessHistory.length})</h3>
            
            {guessHistory.length === 0 ? (
              <div className="text-center text-slate-400 py-10">
                <div className="text-5xl mb-4">🔍</div>
                <p>No guesses yet. Start by entering a player name!</p>
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-3">
                {guessHistory.map((item, index) => (
                  <div key={index} className="bg-slate-900 rounded-xl p-4 border border-slate-700">
                    <div className="mb-3">
                      <h4 className="text-lg font-semibold text-slate-100">{item.name}</h4>
                    </div>
                    
                    <ScoreBar score={item.score} />
                    
                    {item.breakdown && Object.keys(item.breakdown).length > 0 && (
                      <div className="mt-3 space-y-1">
                        {Object.entries(item.breakdown)
                          .filter(([key, value]) => 
                            key !== 'total' && 
                            key !== 'shared_seasons_detail' && 
                            value > 0
                          )
                          .map(([key, value]) => (
                            <div key={key} className="flex justify-between text-xs text-slate-400">
                              <span>{formatBreakdownKey(key)}</span>
                              <span className="text-emerald-400 font-bold">+{value}</span>
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