import test from 'node:test';
import assert from 'node:assert/strict';
import {generateRushLevel} from '../src/generator.js';
import {solveLevel} from '../src/solver.js';
import {simulate, checkWin} from '../src/sim.js';
import {rushWinScore, rushTimeAfterElapsed} from '../src/rush.js';

test('Rush gives a higher score for a one-piece win than a two-piece win', () => {
  const level = generateRushLevel(31, 7);
  const onePiece = solveLevel(level, {maxPieces: 1});
  assert.equal(onePiece.length, 1);
  assert.equal(level.solution.length, 2);
  assert.equal(checkWin(level, simulate(level, onePiece)).won, true);
  assert.equal(checkWin(level, simulate(level, level.solution)).won, true);
  assert.equal(rushWinScore(level, 1) - rushWinScore(level, 2), 35);
  const narrow = {grid: Array(8).fill('.'.repeat(7)), inventory: {splitter: 1, block: 0}};
  const wide = {grid: Array(8).fill('.'.repeat(9)), inventory: {splitter: 1, block: 0}};
  assert.equal(rushWinScore(narrow, 1), 184);
  assert.equal(rushWinScore(wide, 1), 208);
});

test('Rush expiry decision uses elapsed wall time before a win can score', () => {
  assert.deepEqual(rushTimeAfterElapsed(0.1, 5000, 0), {time: 0, expired: true});
  assert.deepEqual(rushTimeAfterElapsed(5, 1000, 0), {time: 4, expired: false});
  assert.deepEqual(rushTimeAfterElapsed(0, 1000, 1000), {time: 0, expired: true});
});
