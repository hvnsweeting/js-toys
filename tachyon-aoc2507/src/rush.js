import {wallSeconds} from './runtime.js';

// Larger boards (by cell count, so a wider board counts as well as a taller one) and fewer pieces
// both score more.
export function rushWinScore(level, piecesUsed) {
  const availablePieces = level.inventory.splitter + level.inventory.block;
  const cells = level.grid.length * level.grid[0].length;
  return 100 + Math.round(cells * 1.5) + (availablePieces - piecesUsed) * 35;
}

export function rushTimeAfterElapsed(remaining, now, previous) {
  const time = Math.max(0, remaining - wallSeconds(now, previous));
  return {time, expired: time === 0};
}
