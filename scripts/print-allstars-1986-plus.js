/**
 * Print the current non-excluded All-Star list (1986 or later) to the Node console.
 *
 * Run:
 *   node scripts/print-allstars-1986-plus.js
 *
 * This uses the same list the app uses for easy mode:
 *   NBA_ALL_STAR_NAMES from src/data/allStarPlayers.js
 */

import { NBA_ALL_STAR_NAMES } from '../src/data/allStarPlayers.js';

console.log('All-Star names used for "All Stars 1986 or Later" (easy mode).');
console.log('Count:', NBA_ALL_STAR_NAMES.length);
console.log('----------------------------------------------');

NBA_ALL_STAR_NAMES.forEach((name, idx) => {
  console.log(String(idx + 1).padStart(3, ' '), '-', name);
});

