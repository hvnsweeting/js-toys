import {simulate, checkWin} from './sim.js';
import {solveLevel} from './solver.js';

export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = Math.imul(value ^ value >>> 15, value | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

export function generateRushLevel(seed, depth = 0) {
  const random = mulberry32((seed >>> 0) ^ Math.imul(depth + 1, 0x9E3779B9));
  const width = Math.min(15, 7 + 2 * Math.floor(depth / 3));
  const height = Math.min(16, 7 + Math.floor(depth / 2));
  const pieceCount = Math.min(4, 1 + Math.floor(depth / 4));
  for (let attempt = 0; attempt < 80; attempt++) {
    const source = Math.floor(width / 2);
    const rows = Array.from({length: height}, () => Array(width).fill('.'));
    rows[0][source] = 'S';
    const fixedCount = Math.min(5, Math.floor(depth / 3));
    // Draw again when a cell already holds a splitter, so the board gets all fixedCount of them.
    let placedFixed = 0;
    for (let draws = 0; placedFixed < fixedCount && draws < 100; draws++) {
      const row = 2 + Math.floor(random() * (height - 3));
      const col = 1 + Math.floor(random() * (width - 2));
      if (rows[row][col] !== '.') continue;
      rows[row][col] = '^';
      placedFixed++;
    }
    const grid = rows.map(row => row.join(''));
    const level = {
      id: `rush-${seed}-${depth}`,
      name: `Cascade ${depth + 1}`,
      hint: 'Shape the hidden route.',
      grid,
      detectors: '.'.repeat(width),
      quotas: {},
      inventory: {splitter: pieceCount, block: 0},
      par: pieceCount
    };
    const solution = [];
    for (let index = 0; index < pieceCount; index++) {
      const state = simulate(level, solution);
      const start = Math.max(2, Math.floor((index + 1) * (height - 2) / (pieceCount + 1)));
      const choices = [];
      for (let row = start; row < height - 1; row++) {
        for (let col = 1; col < width - 1; col++) {
          if (grid[row][col] === '.' && state.beamRows[row - 1][col] &&
              !solution.some(piece => piece.row === row && piece.col === col))
            choices.push({row, col, kind: 'splitter'});
        }
      }
      if (!choices.length) break;
      solution.push(choices[Math.floor(random() * choices.length)]);
    }
    if (solution.length !== pieceCount) continue;
    const baseline = simulate(level);
    const solved = simulate(level, solution);
    const detector = Array(width).fill('.');
    let allPiecesMatter = true;
    for (let omitted = 0; omitted < solution.length; omitted++) {
      const without = simulate(level, solution.filter((_, index) => index !== omitted));
      const candidates =
          solved.detectorCounts
              .map((count, col) => ({count, col, without: without.detectorCounts[col]}))
              .filter(item => item.count !== item.without);
      if (!candidates.length) {
        allPiecesMatter = false;
        break;
      }
      const preferred = candidates.filter(item => item.count > 0 && item.without === 0);
      const choice =
          (preferred.length ?
               preferred :
               candidates)[Math.floor(random() * (preferred.length || candidates.length))];
      if (choice.count === 0)
        detector[choice.col] = 'V';
      else {
        detector[choice.col] = 'T';
        if (choice.without > 0 || depth >= 3) level.quotas[choice.col] = choice.count;
      }
    }
    if (!allPiecesMatter) continue;
    if (!detector.includes('T')) {
      const target = solved.detectorCounts.findIndex(
          (count, col) => count > 0 && count !== baseline.detectorCounts[col]);
      if (target < 0) continue;
      detector[target] = 'T';
      level.quotas[target] = solved.detectorCounts[target];
    }
    if (!detector.includes('V')) {
      const unreached = solved.detectorCounts
          .map((count, col) => ({count, col}))
          .filter(item => item.count === 0 && detector[item.col] === '.');
      if (!unreached.length) continue;
      const voidColumn = unreached[Math.floor(random() * unreached.length)].col;
      detector[voidColumn] = 'V';
    }
    level.detectors = detector.join('');
    level.bonus = solved.totalTimelines;
    level.solution = solution;
    const piecesRequired = solution.every(
        (_, index) =>
            !checkWin(level, simulate(level, solution.filter((_, other) => index !== other))).won);
    if (piecesRequired && !checkWin(level, simulate(level)).won &&
        checkWin(level, simulate(level, solution)).won) {
      level.par = solveLevel(level, {maxPieces: solution.length}).length;
      return level;
    }
  }
  throw new Error(`Could not generate rush level ${seed}:${depth}`);
}
