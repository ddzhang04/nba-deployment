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
  const [gameMode, setGameMode] = useState('all-time');
  const [playersLoading, setPlayersLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState('checking'); // 'checking', 'connected', 'failed'

  // API base URL
  const API_BASE = 'https://nba-mantle-6-5.onrender.com/api';

  // Fallback players (only used if API completely fails)
  const fallbackPlayers = [
    'LeBron James', 'Stephen Curry', 'Kevin Durant', 'Giannis Antetokounmpo',
    'Luka Dončić', 'Jayson Tatum', 'Joel Embiid', 'Nikola Jokić', 'Damian Lillard',
    'Jimmy Butler', 'Kawhi Leonard', 'Anthony Davis', 'Russell Westbrook',
    'James Harden', 'Chris Paul', 'Klay Thompson', 'Draymond Green',
    'Paul George', 'Kyrie Irving', 'Bradley Beal', 'Devin Booker',
    'Donovan Mitchell', 'Ja Morant', 'Trae Young', 'Zion Williamson',
    'Pascal Siakam', 'Bam Adebayo', 'Jaylen Brown', 'Tyler Herro',
    'Karl-Anthony Towns', 'Rudy Gobert', 'Ben Simmons', 'CJ McCollum'
  ];

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

  // Test API connection
  const testApiConnection = async () => {
    try {
      setApiStatus('checking');
      const response = await fetch(`${API_BASE}/health`, {
        method: 'GET',
        timeout: 10000, // 10 second timeout
      });
      
      if (response.ok) {
        setApiStatus('connected');
        return true;
      } else {
        throw new Error(`API responded with status: ${response.status}`);
      }
    } catch (error) {
      console.error('API connection test failed:', error);
      setApiStatus('failed');
      return false;
    }
  };

  // Load players for current game mode from backend
  const loadPlayersForMode = async (mode) => {
    setPlayersLoading(true);
    
    try {
      console.log(`Loading players for mode: ${mode}`);
      
      const response = await fetch(`${API_BASE}/player_names`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: mode }),
        timeout: 15000, // 15 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('API response:', data);
      
      let playerNames = [];
      
      // Handle different possible response formats
      if (Array.isArray(data)) {
        playerNames = data;
      } else if (data.players && Array.isArray(data.players)) {
        playerNames = data.players;
      } else if (data.player_names && Array.isArray(data.player_names)) {
        playerNames = data.player_names;
      } else {
        throw new Error('Invalid response format - no player array found');
      }

      if (playerNames.length === 0) {
        throw new Error('No players returned from API');
      }

      // Filter out any invalid entries and sort
      const validPlayers = playerNames
        .filter(name => name && typeof name === 'string' && name.trim().length > 0)
        .map(name => name.trim())
        .sort();

      if (validPlayers.length === 0) {
        throw new Error('No valid players after filtering');
      }

      setAllPlayers(validPlayers);
      console.log(`Successfully loaded ${validPlayers.length} players for ${mode} mode`);
      return validPlayers;

    } catch (error) {
      console.error('Failed to load players from API:', error);
      setError(`Failed to load players: ${error.message}`);
      
      // Use fallback players
      console.log('Using fallback players');
      setAllPlayers(fallbackPlayers);
      return fallbackPlayers;
      
    } finally {
      setPlayersLoading(false);
    }
  };

  // Get random player from backend for current mode
  const getRandomPlayer = async (mode) => {
    try {
      console.log(`Getting random player for mode: ${mode}`);
      
      const response = await fetch(`${API_BASE}/random_player`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: mode }),
        timeout: 10000,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Random player API response:', result);
      
      let randomPlayer = '';
      
      // Handle different possible response formats
      if (typeof result === 'string') {
        randomPlayer = result;
      } else if (result.player) {
        randomPlayer = result.player;
      } else if (result.name) {
        randomPlayer = result.name;
      } else {
        throw new Error('Invalid response format - no player name found');
      }

      if (!randomPlayer || randomPlayer.trim().length === 0) {
        throw new Error('Empty player name returned');
      }

      console.log(`Got random player: ${randomPlayer}`);
      return randomPlayer.trim();

    } catch (error) {
      console.error('Failed to get random player from API:', error);
      
      // Use fallback from loaded players
      const availablePlayers = allPlayers.length > 0 ? allPlayers : fallbackPlayers;
      const randomPlayer = availablePlayers[Math.floor(Math.random() * availablePlayers.length)];
      
      console.log(`Using fallback random player: ${randomPlayer}`);
      return randomPlayer;
    }
  };

  const startNewGame = async () => {
    resetGameState();
    
    // Load players for current mode and get random target
    const players = await loadPlayersForMode(gameMode);
    const randomPlayer = await getRandomPlayer(gameMode);
    
    setTargetPlayer(randomPlayer);
    console.log('New game started - Target:', randomPlayer, 'Mode:', gameMode, 'Total players:', players.length);
  };

  const switchGameMode = async (newMode) => {
    if (newMode === gameMode) return;
    
    setGameMode(newMode);
    resetGameState();
    
    // Load players for new mode
    const players = await loadPlayersForMode(newMode);
    const randomPlayer = await getRandomPlayer(newMode);
    
    setTargetPlayer(randomPlayer);
    console.log('Game mode switched to:', newMode, 'New target:', randomPlayer, 'Total players:', players.length);
  };

  // Initial load
  useEffect(() => {
    const initializeGame = async () => {
      // Test API connection first
      const apiConnected = await testApiConnection();
      
      if (!apiConnected) {
        setError('Warning: API connection failed. Using limited player set.');
      }
      
      // Load players and start game
      const players = await loadPlayersForMode(gameMode);
      const randomPlayer = await getRandomPlayer(gameMode);
      setTargetPlayer(randomPlayer);
      
      console.log('Game initialized - Target:', randomPlayer, 'Total players:', players.length);
    };

    initializeGame();
  }, []);

  const makeGuess = async () => {
    if (!guess.trim()) return;
    
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(-1);
    setLoading(true);
    setError('');

    try {
      console.log('Making guess:', guess.trim(), 'Target:', targetPlayer, 'Mode:', gameMode);
      
      const response = await fetch(`${API_BASE}/guess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          guess: guess.trim(),
          target: targetPlayer,
          mode: gameMode
        }),
        timeout: 15000,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log('Guess API response:', result);
      
      const { score, matched_name, breakdown, top_5 } = result;

      const newGuess = {
        name: matched_name || guess.trim(),
        score: score || 0,
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

    } catch (err) {
      console.error('Guess API Error:', err);
      setError(`Error making guess: ${err.message}`);
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
          mode: gameMode
        }),
        timeout: 10000,
      });

      if (response.ok) {
        const result = await response.json();
        setTop5Players(result.top_5 || []);
      } else {
        console.warn('Could not fetch top 5 players for reveal');
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
      <div className="flex items-center gap-2 w-full">
        <div className="flex-1 relative bg-gray-200 rounded-full h-6 overflow-hidden">
          <div 
            className="h-full rounded-full transition-all duration-300 ease-out relative"
            style={{
              width: `${percentage}%`,
              background: `linear-gradient(90deg, ${color}dd, ${color})`,
              boxShadow: `0 0 10px ${color}40`
            }}
          >
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
        </div>
        <div 
          className="text-sm font-semibold min-w-[50px] text-right"
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
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6 border border-white/20">
          <div className="text-center mb-4">
            <div className="flex items-center justify-center gap-4 mb-2">
              <span className="text-4xl">🏀</span>
              <h1 className="text-4xl font-bold text-white">NBA-MANTLE</h1>
              <span className="text-4xl">🎯</span>
            </div>
            <p className="text-white/80 text-lg">
              Guess the mystery NBA player by finding similar players!
            </p>
          </div>

          {/* API Status */}
          <div className="text-center mb-4">
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
              apiStatus === 'connected' ? 'bg-green-500/20 text-green-300' :
              apiStatus === 'failed' ? 'bg-red-500/20 text-red-300' :
              'bg-yellow-500/20 text-yellow-300'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                apiStatus === 'connected' ? 'bg-green-400' :
                apiStatus === 'failed' ? 'bg-red-400' :
                'bg-yellow-400 animate-pulse'
              }`}></div>
              API: {apiStatus === 'connected' ? 'Connected' : apiStatus === 'failed' ? 'Offline' : 'Checking...'}
            </div>
          </div>

          {/* Game Mode Selector */}
          <div className="flex justify-center gap-4 mb-4">
            <button 
              className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                gameMode === 'all-time' 
                  ? 'bg-white text-purple-900 shadow-lg' 
                  : 'bg-white/20 text-white hover:bg-white/30'
              }`}
              onClick={() => switchGameMode('all-time')}
              disabled={playersLoading}
            >
              🏆 All Time
            </button>
            <button 
              className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                gameMode === 'classic' 
                  ? 'bg-white text-purple-900 shadow-lg' 
                  : 'bg-white/20 text-white hover:bg-white/30'
              }`}
              onClick={() => switchGameMode('classic')}
              disabled={playersLoading}
            >
              ⭐ Classic (2011+)
            </button>
          </div>
          
          <div className="flex justify-center gap-8 text-white/80 text-sm">
            <span>⚡ Attempt #{guessCount}</span>
            <span>
              Mode: {gameMode === 'all-time' ? 'All Time' : 'Classic (2011+, 5+ seasons)'} 
              {playersLoading ? ' (Loading...)' : ` (${allPlayers.length} players)`}
            </span>
            {!gameWon && !showAnswer && (
              <span>Mystery Player: ???</span>
            )}
            {(gameWon || showAnswer) && (
              <span className="text-yellow-300">Answer: {targetPlayer}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel */}
          <div className="lg:col-span-1 space-y-6">
            {/* Input Section */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                🔍 Make Your Guess
              </h3>
              
              {!gameWon && !showAnswer && (
                <div className="space-y-4">
                  <div className="relative">
                    <input
                      type="text"
                      className="w-full p-4 rounded-xl bg-white/20 border border-white/30 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/50"
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
                      placeholder={playersLoading ? "Loading players..." : "Enter NBA player name..."}
                      disabled={loading || playersLoading}
                    />
                    
                    {showSuggestions && suggestions.length > 0 && (
                      <ul className="absolute top-full left-0 right-0 bg-white/95 backdrop-blur-lg border border-white/30 rounded-xl mt-1 max-h-48 overflow-y-auto z-50">
                        {suggestions.map((suggestion, index) => (
                          <li
                            key={index}
                            className={`p-3 cursor-pointer transition-colors ${
                              index === selectedSuggestionIndex 
                                ? 'bg-purple-600 text-white' 
                                : 'text-gray-800 hover:bg-purple-100'
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
                    disabled={loading || !guess.trim() || playersLoading}
                    className={`w-full p-4 rounded-xl font-semibold transition-all ${
                      loading || !guess.trim() || playersLoading
                        ? 'bg-gray-500/50 text-gray-300 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:shadow-lg hover:scale-105'
                    }`}
                  >
                    {loading ? 'Searching...' : playersLoading ? 'Loading...' : 'Submit Guess'}
                  </button>
                </div>
              )}

              {error && (
                <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 text-red-300 mt-4">
                  {error}
                </div>
              )}

              {gameWon && (
                <div className="bg-green-500/20 border border-green-500/50 rounded-xl p-6 text-center">
                  <div className="text-4xl mb-2">🎉</div>
                  <p className="text-green-300 text-lg">
                    Congratulations! You found {targetPlayer} in {guessCount} guesses!
                  </p>
                </div>
              )}

              {showAnswer && !gameWon && (
                <div className="bg-blue-500/20 border border-blue-500/50 rounded-xl p-6 text-center">
                  <div className="text-4xl mb-2">🎯</div>
                  <p className="text-blue-300 text-lg">
                    The answer was {targetPlayer}
                  </p>
                </div>
              )}

              <div className="flex gap-4 mt-6">
                <button 
                  className="flex-1 p-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={startNewGame}
                  disabled={playersLoading}
                >
                  🔄 New Game
                </button>
                
                {!gameWon && !showAnswer && (
                  <button 
                    className="flex-1 p-3 bg-yellow-600 text-white rounded-xl font-semibold hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={revealAnswer}
                    disabled={playersLoading}
                  >
                    👁️ Reveal
                  </button>
                )}
              </div>
            </div>

            {/* Top 5 Similar Players */}
            {top5Players.length > 0 && (
              <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  📈 Top 5 Most Similar
                </h3>
                <div className="space-y-4">
                  {top5Players.map(([name, score], index) => (
                    <div key={name} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="bg-white/20 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm">
                            {index + 1}
                          </span>
                          <span className="text-white font-medium">{name}</span>
                        </div>
                      </div>
                      <ScoreBar score={score} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - Guess History */}
          <div className="lg:col-span-2">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 h-full">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                👥 Guess History ({guessHistory.length})
              </h3>
              
              {guessHistory.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">🔍</div>
                  <p className="text-white/60 text-lg">No guesses yet. Start by entering a player name!</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {guessHistory.map((item, index) => (
                    <div key={index} className="bg-white/10 rounded-xl p-4 border border-white/20">
                      <div className="mb-3">
                        <h4 className="text-white font-semibold text-lg">{item.name}</h4>
                      </div>
                      
                      <div className="mb-3">
                        <ScoreBar score={item.score} />
                      </div>
                      
                      {item.breakdown && Object.keys(item.breakdown).length > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(item.breakdown)
                            .filter(([key, value]) => 
                              key !== 'total' && 
                              key !== 'shared_seasons_detail' && 
                              value > 0
                            )
                            .map(([key, value]) => (
                              <div key={key} className="flex justify-between items-center text-sm">
                                <span className="text-white/70">
                                  {formatBreakdownKey(key)}
                                </span>
                                <span className="text-green-400 font-semibold">
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