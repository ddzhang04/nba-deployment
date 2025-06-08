# NBA-MANTLE Frontend 🏀

A React-based guessing game where players try to identify a mystery NBA player by finding similar players. Similar to Wordle, but for basketball fans!

## 🎮 How to Play

1. **Mystery Player**: Each game features a randomly selected NBA player
2. **Make Guesses**: Type in NBA player names to see how similar they are to the mystery player
3. **Similarity Scoring**: Each guess receives a score from 0-100 based on various factors
4. **Win Condition**: Score 100 points by guessing the exact mystery player
5. **Learn**: View the breakdown of similarity factors and discover connections between players

## 🎯 Similarity Factors

The game calculates similarity based on multiple factors:

- **Shared Seasons** (up to 50 pts): Played in the same seasons
- **Streak Bonus** (up to 10 pts): Consecutive seasons together
- **Teammate Years** (up to 15 pts): Actual teammates
- **Team Overlap** (2 pts per shared team): Played for same franchises
- **Tenure Bonus** (up to 3 pts per team): Overlapping years on same teams
- **Position Match** (8 pts exact, 2 pts similar): Playing position
- **Draft Era** (4 pts close, 2 pts same decade): When they entered the league
- **All-Star** (2 pts): Selected in same All-Star games
- **All-Team** (2 pts): Made All-NBA/All-Defense/All-Rookie same year
- **Awards** (1 pt): Won same awards

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Backend API running (see backend README)

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd nba-mantle-frontend
```

2. Install dependencies
```bash
npm install
# or
yarn install
```

3. Update API configuration
```javascript
// In App.jsx, update the API_BASE constant
const API_BASE = 'http://localhost:5000/api'; // For local development
// or
const API_BASE = 'https://your-backend-url.com/api'; // For production
```

4. Start the development server
```bash
npm start
# or
yarn start
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## 🏗️ Building for Production

```bash
npm run build
# or
yarn build
```

This creates a `build` folder with optimized production files.

## 🎨 Features

### Core Gameplay
- **Smart Search**: Autocomplete suggestions as you type player names
- **Guess History**: Track all your guesses with scores and breakdowns
- **Top 5 Similar**: See the most similar players when you win or reveal
- **Score Visualization**: Color-coded progress bars for easy score reading

### User Experience
- **Responsive Design**: Works on desktop and mobile devices
- **Keyboard Navigation**: Arrow keys and Enter for autocomplete
- **Error Handling**: Graceful fallbacks and user-friendly error messages
- **Loading States**: Visual feedback during API calls

### Game Features
- **New Game**: Start fresh with a new mystery player
- **Reveal Answer**: Give up and see the answer with top similar players
- **Guess Validation**: Prevents duplicate guesses
- **Fallback Mode**: Works offline with a curated list of modern players

## 🔧 Configuration

### API Endpoints

The frontend expects these backend endpoints:

- `GET /api/players` - Get list of all players
- `GET /api/player_awards` - Alternative endpoint for player list
- `POST /api/guess` - Submit a guess and get similarity score
- `GET /api/health` - Health check

### Fallback Players

If the API is unavailable, the game uses a curated list of modern NBA stars:

```javascript
const modernPlayers = [
  'LeBron James', 'Stephen Curry', 'Kevin Durant', 
  'Giannis Antetokounmpo', 'Luka Dončić', 'Jayson Tatum',
  // ... more players
];
```

## 📱 Responsive Design

The game is fully responsive and works on:
- Desktop browsers (Chrome, Firefox, Safari, Edge)
- Tablets (iPad, Android tablets)
- Mobile phones (iOS Safari, Android Chrome)

## 🎨 Styling

The game uses custom CSS with:
- CSS Grid and Flexbox for layout
- CSS custom properties for theming
- Smooth animations and transitions
- Dark theme optimized for long gaming sessions

## 🔍 Component Structure

```
App.jsx (Main game component)
├── Header (Title, subtitle, game stats)
├── Left Panel
│   ├── Input Section (Search, autocomplete, submit)
│   ├── Game Messages (Win/reveal messages)
│   ├── Control Buttons (New game, reveal)
│   └── Top 5 Similar (Shown after win/reveal)
└── Right Panel
    └── Guess History (All guesses with scores and breakdowns)
```

## 🐛 Troubleshooting

### Common Issues

**Players not loading**
- Check if backend is running
- Verify API_BASE URL is correct
- Check browser console for network errors

**Autocomplete not working**
- Ensure player data loaded successfully
- Check for JavaScript errors in console

**Scores not calculating**
- Verify backend /api/guess endpoint is working
- Check request/response format in Network tab

### Development Tips

1. **Enable browser developer tools** for debugging
2. **Check console logs** for helpful game state information
3. **Use network tab** to inspect API calls
4. **Test offline mode** by stopping the backend

## 🚀 Deployment

### Netlify/Vercel
1. Build the project: `npm run build`
2. Deploy the `build` folder
3. Update API_BASE to production backend URL

### Docker
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## 📄 License

This project is licensed under the MIT License.

## 🎯 Future Enhancements

- [ ] Player statistics comparison
- [ ] Historical eras filtering
- [ ] Multiplayer mode
- [ ] Daily challenges
- [ ] Achievement system
- [ ] Player images and photos
- [ ] Advanced filtering options
- [ ] Game statistics tracking

---

**Enjoy playing NBA-MANTLE! 🏀🎯**
