import assert from 'node:assert/strict';
import {checkWin, simulate} from '../src/sim.js';

export function assertNoWinBelowPar(level) {
  const source = level.grid[0].indexOf('S');
  const cells = [];
  for (let row = 1; row < level.grid.length; row++) {
    for (let col = 0; col < level.grid[0].length; col++) {
      if (level.grid[row][col] === '.' && !(row === 1 && col === source))
        cells.push({row, col});
    }
  }

  let checked = 0;
  function visit(start, remaining, placements, splitters, blocks) {
    if (remaining === 0) {
      checked++;
      assert.equal(
          checkWin(level, simulate(level, placements)).won, false,
          `${level.id} wins below par with ${JSON.stringify(placements)}`);
      return;
    }
    for (let index = start; index <= cells.length - remaining; index++) {
      const cell = cells[index];
      if (splitters < level.inventory.splitter)
        visit(index + 1, remaining - 1, [...placements, {...cell, kind: 'splitter'}],
            splitters + 1, blocks);
      if (blocks < level.inventory.block)
        visit(index + 1, remaining - 1, [...placements, {...cell, kind: 'block'}],
            splitters, blocks + 1);
    }
  }

  for (let pieces = 0; pieces < level.par; pieces++) visit(0, pieces, [], 0, 0);
  return checked;
}
