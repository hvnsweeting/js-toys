import test from 'node:test';
import assert from 'node:assert/strict';
import {levels} from '../src/levels.js';
import {checkWin, computeStars, simulate} from '../src/sim.js';
import {solveLevel} from '../src/solver.js';
import {assertNoWinBelowPar} from './brute-force.js';

test('all campaign levels with par at most three have no shorter legal placement', () => {
  const covered = levels.filter(level => level.par <= 3);
  assert.deepEqual(covered.map(level => level.id),
      ['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3']);
  for (const level of covered) assert.ok(assertNoWinBelowPar(level) > 0, level.id);
});

test('15 authored levels require their par, and each bonus is reachable', () => {
  assert.equal(levels.length, 15);
  const laterPars = {b3: 3, b4: 4, b5: 5, c2: 3, c3: 3, c4: 4, c5: 5};
  let firstGuessFailures = 0;

  for (const level of levels) {
    const {solution: reference, ...puzzle} = level;
    assert.equal(level.grid[0].length, level.detectors.length, `${level.id} detector width`);
    assert.equal(checkWin(puzzle, simulate(puzzle)).won, false, `${level.id} starts solved`);
    assert.equal(
        solveLevel(puzzle, {maxPieces: level.par - 1}),
        null,
        `${level.id} can be solved below par`,
    );

    const solution = solveLevel(puzzle, {maxPieces: level.par});
    assert.ok(solution, `${level.id} has no solution within par`);
    assert.equal(solution.length, level.par, `${level.id} minimum differs from par`);
    assert.equal(checkWin(puzzle, simulate(puzzle, solution)).won, true, `${level.id} fails`);
    assert.equal(checkWin(puzzle, simulate(puzzle, reference)).won, true, `${level.id} reference fails`);

    const solvedStars = computeStars(puzzle, simulate(puzzle, solution), solution.length);
    const bonusSolution = solvedStars[2] ? solution :
        solveLevel(puzzle, {requireBonus: true, maxPieces: level.par});
    assert.ok(bonusSolution, `${level.id} bonus is unreachable`);
    assert.deepEqual(
        computeStars(puzzle, simulate(puzzle, bonusSolution), bonusSolution.length),
        [true, true, true],
        `${level.id} bonus`,
    );

    if (Object.hasOwn(laterPars, level.id)) {
      assert.equal(level.par, laterPars[level.id], `${level.id} difficulty`);
      assert.ok(level.inventory.splitter > 0, `${level.id} has no player splitter`);
      assert.ok(level.inventory.block > 0, `${level.id} has no player block`);
      const firstPlacement = [reference[0]];
      const firstOutcome = checkWin(puzzle, simulate(puzzle, firstPlacement));
      assert.equal(firstOutcome.won, false, `${level.id} first placement already wins`);
      assert.match(firstOutcome.reason, /^A (red void|gold target) /, `${level.id} feedback`);
      assert.ok(firstOutcome.failures.length > 0, `${level.id} highlights no detector`);
    }

    const source = level.grid[0].indexOf('S');
    const row = level.grid[2][source] === '.' ? 2 : 3;
    const firstGuess = {row, col: source, kind: level.inventory.splitter ? 'splitter' : 'block'};
    if (level.grid[row][source] === '.' &&
        !checkWin(puzzle, simulate(puzzle, [firstGuess])).won) {
      firstGuessFailures++;
    }
  }

  assert.ok(firstGuessFailures >= 10, `${firstGuessFailures} first guesses failed`);
});

test('solver can place a side blocker in a row with no incoming vertical beam', () => {
  const puzzle = {
    grid: ['..S..', '.....', '..^..'],
    detectors: '.T.V.',
    inventory: {splitter: 0, block: 1},
    par: 1,
  };
  const answer = solveLevel(puzzle);
  assert.deepEqual(answer, [{row: 2, col: 3, kind: 'block'}]);
  assert.equal(checkWin(puzzle, simulate(puzzle, answer)).won, true);
});
