import {checkWin, computeStars, simulate} from './sim.js';

function placementKey(placements) {
  return placements.map(({row, col, kind}) => `${row},${col},${kind}`).sort().join(';');
}

function candidateCells(level, result, placements) {
  const occupied = new Set(placements.map(piece => `${piece.row},${piece.col}`));
  const source = level.grid[0].indexOf('S');
  const cells = [];

  for (let row = 1; row < level.grid.length; row++) {
    for (let col = 0; col < level.grid[0].length; col++) {
      const receivesBeam = result.beamRows[row - 1][col] > 0;
      const receivesSideBeam = [col - 1, col + 1].some(side =>
        side >= 0 && side < level.grid[0].length &&
        result.beamRows[row - 1][side] > 0 && result.grid[row][side] === '^');
      const canPlace = level.grid[row][col] === '.' && !occupied.has(`${row},${col}`);
      const protectedSource = row === 1 && col === source;
      if ((receivesBeam || receivesSideBeam) && canPlace && !protectedSource)
        cells.push({row, col});
    }
  }

  // Later rows often resolve detector goals directly. Row-ordered recursion
  // still visits every effective placement set after reversing this list.
  return cells.reverse();
}

// A piece only changes the simulation when it receives a vertical beam or
// blocks a side beam from a splitter in that row. Searching those cells still
// finds every effective placement set, while avoiding empty-board combinations.
export function solveLevel(level, options = {}) {
  const maxPieces = options.maxPieces ?? level.inventory.splitter + level.inventory.block;
  const requireBonus = options.requireBonus ?? false;
  const initialResult = simulate(level);
  const initialWin = checkWin(level, initialResult).won;
  if (initialWin && (!requireBonus || computeStars(level, initialResult, 0)[2])) return [];

  for (let limit = 1; limit <= maxPieces; limit++) {
    const seen = new Set();

    function search(placements, result, splitters, blocks, earliestRow) {
      if (placements.length === limit) return null;

      for (const cell of candidateCells(level, result, placements)) {
        if (cell.row < earliestRow) continue;
        for (const kind of ['splitter', 'block']) {
          if (kind === 'splitter' && splitters >= level.inventory.splitter) continue;
          if (kind === 'block' && blocks >= level.inventory.block) continue;

          const next = [...placements, {...cell, kind}];
          const key = placementKey(next);
          if (seen.has(key)) continue;
          seen.add(key);

          const nextResult = simulate(level, next);
          if (nextResult.beamRows.every((row, index) =>
              row.every((count, col) => count === result.beamRows[index][col]))) {
            continue;
          }
          const won = checkWin(level, nextResult).won;
          const bonus = !requireBonus || computeStars(level, nextResult, next.length)[2];
          if (won && bonus) return next;

          const found = search(
              next,
              nextResult,
              splitters + Number(kind === 'splitter'),
              blocks + Number(kind === 'block'),
              cell.row,
          );
          if (found) return found;
        }
      }

      return null;
    }

    const answer = search([], initialResult, 0, 0, 1);
    if (answer) return answer;
  }

  return null;
}
