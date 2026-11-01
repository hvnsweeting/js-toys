import test from 'node:test';
import assert from 'node:assert/strict';
import {AOC_EXAMPLE, checkWin, simulate} from '../src/sim.js';
import {part2Levels} from '../src/part2-levels.js';
import {solveLevel} from '../src/solver.js';
import {validateProfile} from '../src/storage.js';

test('part 2 levels use the original manifold and require placed crystals', () => {
  assert.deepEqual(part2Levels.map(level => level.timelineGoal), [2, 4, 8, 13, 20, 40]);
  assert.deepEqual(part2Levels.map(level => level.grid[0].length), [5, 7, 9, 11, 13, 15]);
  assert.deepEqual(part2Levels.map(level => level.par), [1, 1, 2, 2, 2, 2]);
  for (const level of part2Levels) {
    const left = (AOC_EXAMPLE[0].length - level.grid[0].length) / 2;
    const completeGrid = AOC_EXAMPLE.slice(0, level.grid.length)
        .map(row => row.slice(left, left + level.grid[0].length));
    const complete = simulate({grid: completeGrid});
    const initial = simulate(level);
    const solved = simulate(level, level.solution);
    assert.equal(level.timelineGoal, complete.totalTimelines, level.id);
    assert.equal(checkWin(level, initial).won, false, `${level.id} starts solved`);
    assert.equal(checkWin(level, solved).won, true, `${level.id} reference fails`);
    assert.deepEqual(solved.beamRows, complete.beamRows, `${level.id} does not restore the manifold`);
    assert.equal(solveLevel(level, {maxPieces: level.par - 1}), null,
        `${level.id} can be solved with fewer pieces`);
  }
});

test('part 2 counts paths that meet and reports the exit goal', () => {
  const level = part2Levels[2];
  const result = simulate(level, level.solution);
  assert.equal(result.beamRows[4][4], 2);
  assert.equal(result.totalTimelines, 8);
  const failure = checkWin(level, simulate(level));
  assert.match(failure.reason, /you need exactly 8/);
  assert.deepEqual(failure.failures, []);
});

test('part 2 stars remain in the saved profile', () => {
  const {profile} = validateProfile({stars: {t1: 3, t6: 1, t7: 2}, bonusReached: {t1: true}});
  assert.deepEqual(profile.stars, {t1: 3, t6: 1});
  assert.deepEqual(profile.bonusReached, {t1: true});
});
