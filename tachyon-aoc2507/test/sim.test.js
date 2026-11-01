import test from 'node:test';
import assert from 'node:assert/strict';
import {AOC_EXAMPLE, simulate, checkWin, computeStars} from '../src/sim.js';

function level(grid, detectors) {
  return {grid, detectors, inventory: {splitter: 2, block: 1}, par: 1};
}
test('Advent of Code example produces 21 splits and 40 timelines', () => {
  const result = simulate(level(AOC_EXAMPLE, '.'.repeat(15)));
  assert.equal(result.splitCount, 21);
  assert.equal(result.totalTimelines, 40);
  assert.deepEqual(result.splitEvents.slice(0, 3), [
    {row: 2, col: 7, timelines: 1},
    {row: 4, col: 6, timelines: 1},
    {row: 4, col: 8, timelines: 1},
  ]);
  assert.equal(result.beamRows.length, 16);
  assert.equal(result.detectorCounts.reduce((sum, count) => sum + count, 0), 40);
});
test('adjacent splitters stop a side beam', () => {
  const result = simulate(level(['..S..', '.....', '..^^.', '.....'], '.....'));
  assert.equal(result.splitCount, 1);
  assert.deepEqual(result.detectorCounts, [0, 1, 0, 0, 0]);
});
test('edge loss and blocks remove paths', () => {
  const edge = simulate(level(['S..', '...', '^..', '...'], '...'));
  assert.equal(edge.totalTimelines, 1);
  const blocked = simulate(level(['.S.', '...', '.^#', '...'], '...'));
  assert.deepEqual(blocked.detectorCounts, [1, 0, 0]);
});
test('separate histories merge timeline counts', () => {
  const result = simulate(level(['..S..', '.....', '..^..', '.....', '.^.^.', '.....'], '.....'));
  assert.equal(result.detectorCounts[2], 2);
  assert.equal(result.totalTimelines, 4);
  assert.equal(result.beamRows[4][2], 2);
  assert.deepEqual(result.splitEvents.map(event => event.timelines), [1, 1, 1]);
});
test('win reason and stars report quota and void failures', () => {
  const puzzle = {...level(['.S.', '...', '.^.', '...'], 'TVT'), quotas: {0: 2}, bonus: 2};
  const result = simulate(puzzle);
  assert.match(checkWin(puzzle, result).reason, /needs 2 timelines/);
  assert.deepEqual(computeStars(puzzle, result, 0), [false, false, false]);
});
test('every failing detector is reported, and the reason names no column', () => {
  const puzzle = level(['.S.', '...', '...'], 'TVT');
  const outcome = checkWin(puzzle, simulate(puzzle));
  assert.equal(outcome.won, false);
  assert.deepEqual(outcome.failures.map(failure => [failure.col, failure.kind]),
      [[0, 'dark'], [1, 'void'], [2, 'dark']]);
  assert.equal(outcome.reason,
      'Try again: The beam hit a red void. Keep light off the highlighted red marker. ' +
      '2 other detectors highlighted.');
  const quotaOnly = {...level(['.S.', '...', '.^.', '...'], 'TVT'), quotas: {0: 2}};
  const quotaOutcome = checkWin(quotaOnly, simulate(quotaOnly));
  assert.deepEqual(quotaOutcome.failures, [{col: 0, kind: 'quota', count: 1, quota: 2}]);
  assert.equal(quotaOutcome.reason,
      'Try again: A gold target needs 2 timelines, but has 1. Adjust the paths reaching it.');
  assert.doesNotMatch(outcome.reason + quotaOutcome.reason, /column/i);
});
test('placement protects the source and fixed crystals', () => {
  const puzzle = level(['.S.', '...', '.^.', '...'], '...');
  // Row 1 under the source is empty, so only the source guard can refuse this placement.
  assert.throws(() => simulate(puzzle, [{row: 1, col: 1, kind: 'block'}]), /Invalid placement/);
  assert.throws(() => simulate(puzzle, [{row: 2, col: 1, kind: 'block'}]), /Invalid placement/);
  assert.doesNotThrow(() => simulate(puzzle, [{row: 1, col: 0, kind: 'block'}]));
  assert.throws(() => simulate(puzzle, [{row: 3, col: 1, kind: 'mirror'}]), /Unknown piece/);
});
