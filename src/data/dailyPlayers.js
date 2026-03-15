/**
 * DAILY PUZZLE PLAYERS — Edit this file to change which player is used each day.
 *
 * How it works:
 * - The app uses your device's calendar date. Everyone gets the same puzzle on the same day.
 * - Day 0 = first day (epoch date below), Day 1 = next day, etc.
 * - Each day maps to the player at that index in the array below.
 * - To add more dailies: add names to the DAILY_PLAYERS array. Order matters:
 *   Index 0 = Day 0, Index 1 = Day 1, Index 2 = Day 2, ...
 * - If there are more days than players, the list cycles (e.g. after the last name it wraps to the first).
 *
 * To change the "start" of the calendar: change DAILY_PUZZLE_EPOCH to the date you want to be Day 0 (Daily #1).
 */

export const DAILY_PUZZLE_EPOCH = '2026-03-15';

export const DAILY_PLAYERS = [
  'Bam Adebayo',   // Day 0 = Daily #1
  'Kevin Durant',        // Day 1 = Daily #2
  'James Harden',       // Day 2 = Daily #3
  'Jayson Tatum',       // Day 3 = Daily #4
  'Dwyane Wade',        // Day 4 = Daily #5
  'Kevin Garnett',      // Day 5 = Daily #6
  'Paul Pierce',        // Day 6 = Daily #7
  'Tim Duncan',         // Day 7 = Daily #8
  'Cade Cunningham',    // Day 8 = Daily #9
  'Stephen Curry',      // Day 9 = Daily #10
  'Klay Thompson',      // Day 10 = Daily #11
  'Kyrie Irving',       // Day 11 = Daily #12
  'Kevin Love',         // Day 12 = Daily #13
  'Kemba Walker',       // Day 13 = Daily #14
  'Hassan Whiteside',   // Day 14 = Daily #15

// WHEN I LAUNCH THE APP ILL RESTART AT THE TOP OF THE LIST
// 3/31/26 ? Also need current season data

  // Add more names here for future days. Example:
  // 'LeBron James',
  // 'Anthony Davis',
];
