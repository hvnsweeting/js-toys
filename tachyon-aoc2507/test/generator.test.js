import test from 'node:test';
import assert from 'node:assert/strict';
import {generateRushLevel} from '../src/generator.js';
import {simulate, checkWin} from '../src/sim.js';
import {solveLevel} from '../src/solver.js';
import {assertNoWinBelowPar} from './brute-force.js';

test('twelve Rush seeds have no shorter legal placement by brute force', () => {
  for (let seed = 0; seed < 12; seed++) {
    const level = generateRushLevel(seed, seed);
    assert.ok(assertNoWinBelowPar(level) > 0, level.id);
  }
});

test('200 seeded levels are repeatable and solve through their hidden route', () => {
  for (let seed = 0; seed < 200; seed++) {
    const depth = seed % 12;
    const level = generateRushLevel(seed, depth);
    const {solution, ...puzzle} = level;
    assert.deepEqual(level, generateRushLevel(seed, depth));
    const fixedSplitters = level.grid.join('').split('^').length - 1;
    assert.equal(fixedSplitters, Math.min(5, Math.floor(depth / 3)), `${seed} fixed splitter count`);
    assert.ok(level.detectors.includes('V'), `${seed} has no void detector`);
    assert.ok(level.detectors.includes('T'), `${seed} has no target detector`);
    assert.equal(checkWin(puzzle, simulate(puzzle)).won, false, `${seed} starts solved`);
    const answer = solveLevel(puzzle);
    assert.ok(answer, `${seed} lacks answer`);
    assert.equal(level.par, answer.length, `${seed} has a nonminimum par`);
    assert.equal(solveLevel(puzzle, {maxPieces: level.par - 1}), null,
        `${seed} has a shorter solution`);
    assert.equal(checkWin(puzzle, simulate(puzzle, answer)).won, true);
    assert.equal(checkWin(puzzle, simulate(puzzle, solution)).won, true);
    for (let omitted = 0; omitted < solution.length; omitted++) {
      const partial = solution.filter((_, index) => index !== omitted);
      assert.equal(
          checkWin(puzzle, simulate(puzzle, partial)).won, false,
          `${seed} has an unused hidden piece`);
    }
  }
});

test('seed 31 at depth 7 has a one-piece par', () => {
  assert.equal(generateRushLevel(31, 7).par, 1);
});
