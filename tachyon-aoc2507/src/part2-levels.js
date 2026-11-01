import {AOC_EXAMPLE, simulate} from './sim.js';

const designs = [
  ['t1', 'First Fork', 3, 5, [[2, 7]], 'One crystal turns one path into two.'],
  ['t2', 'Second Branch', 5, 7, [[4, 6]], 'Split a branch to make four exit timelines.'],
  ['t3', 'Meeting Point', 7, 9, [[4, 6], [6, 7]], 'Paths that meet still count separately.'],
  ['t4', 'Uneven Paths', 9, 11, [[4, 8], [6, 9]], 'A crystal can split several timelines at once.'],
  ['t5', 'Shared Signal', 11, 13, [[6, 7], [8, 6]], 'Follow the counts where the beams meet.'],
  ['t6', 'Forty Timelines', 16, 15, [[8, 4], [14, 7]], 'Complete the original manifold with forty exit timelines.'],
];

export const part2Levels = designs.map(([id, name, rows, width, missing, hint]) => {
  const left = (AOC_EXAMPLE[0].length - width) / 2;
  const completeGrid = AOC_EXAMPLE.slice(0, rows).map(row => row.slice(left, left + width));
  const grid = completeGrid.map(row => [...row]);
  for (const [row, col] of missing) grid[row][col - left] = '.';
  const solution = missing.map(([row, col]) => ({row, col: col - left, kind: 'splitter'}));
  const timelineGoal = simulate({grid: completeGrid}).totalTimelines;
  return {
    id,
    name,
    hint: `Make exactly ${timelineGoal} exit timelines. ${hint}`,
    grid: grid.map(row => row.join('')),
    detectors: '.'.repeat(width),
    timelineGoal,
    inventory: {splitter: solution.length, block: 0},
    par: solution.length,
    solution,
    sector: 'T',
  };
});

export const part2ById = Object.fromEntries(part2Levels.map(level => [level.id, level]));
