import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePair, createRound, registerClick, isComplete, scoreAfter, POINTS_FOUND, POINTS_MISS, trunkOffset, trunkReach, CROWN_GAP, LEAF_BLADE_REACH } from '../src/game.js';
import { DIFFERENCES, planDifferences } from '../src/differences.js';
import { TRAIT_KEYS, randomGenes } from '../src/traits.js';
import { mulberry32 } from '../src/random.js';

const seeds = (start = 100) => {
  let next = start;
  return () => next++;
};

test('a pair has one seed, one set of traits and three differences', () => {
  const rng = mulberry32(1);
  const makeSeed = seeds();
  for (let i = 0; i < 100; i++) {
    const pair = makePair(rng, makeSeed);
    assert.equal(pair.differences.length, DIFFERENCES);
    assert.ok(Number.isInteger(pair.seed));
    for (const key of TRAIT_KEYS) assert.ok(pair.genes[key] >= 0 && pair.genes[key] <= 1, key);
  }
});

test('a pair is made again from a new seed when the first tree has no room for the differences', () => {
  // Seeds that cannot hold three differences exist (about 1 in 200); the game never sees them.
  // With every trait at 0, seed 35 is one of them and seed 1 is not.
  const allZero = () => 0;
  assert.throws(() => planDifferences(35, randomGenes(allZero)), /no room/);
  const offered = [35, 1];
  const drawn = [];
  const pair = makePair(allZero, () => {
    drawn.push(offered[drawn.length]);
    return drawn.at(-1);
  });
  assert.deepEqual(drawn, [35, 1], 'seed 35 was turned down and the next seed drawn');
  assert.equal(pair.seed, 1);
  assert.equal(pair.differences.length, DIFFERENCES);
});

test('a round counts finds once, and misses every time', () => {
  const round = createRound({ differences: [{}, {}, {}] });
  assert.equal(registerClick(round, null), 'miss');
  assert.equal(registerClick(round, null), 'miss');
  assert.equal(round.misses, 2);
  assert.equal(registerClick(round, 1), 'found');
  assert.equal(registerClick(round, 1), 'again');
  assert.deepEqual(round.found, [1]);
  assert.equal(round.misses, 2, 'finding again is not a miss');
  assert.equal(isComplete(round), false);
  assert.equal(registerClick(round, 0), 'found');
  assert.equal(registerClick(round, 2), 'found');
  assert.equal(isComplete(round), true);
  // Indices outside the pair throw, and leave the round as it was.
  const fresh = createRound({ differences: [{}, {}, {}] });
  for (const bad of [3, -1, 1.5, '0', undefined]) assert.throws(() => registerClick(fresh, bad), RangeError, String(bad));
  assert.deepEqual([fresh.found, fresh.misses], [[], 0]);
});

test('a find gains 100 points, a miss costs 20 but never takes the score below 0, a repeat find changes nothing', () => {
  assert.deepEqual([POINTS_FOUND, POINTS_MISS], [100, -20]);
  assert.equal(scoreAfter(0, 'found'), 100);
  assert.equal(scoreAfter(100, 'miss'), 80);
  assert.equal(scoreAfter(30, 'miss'), 10);
  assert.equal(scoreAfter(10, 'miss'), 0);
  assert.equal(scoreAfter(0, 'miss'), 0);
  assert.equal(scoreAfter(240, 'again'), 240);
  // A whole round: miss, find, miss, find, find.
  let score = 0;
  for (const outcome of ['miss', 'found', 'miss', 'found', 'found']) score = scoreAfter(score, outcome);
  assert.equal(score, 280);
});

test('the trees stand as close as their crowns allow, with a gap of 0.4 between the crowns', () => {
  assert.equal(CROWN_GAP, 0.4);
  // Crowns reaching 2 and 3 toward each other: trunks 5.4 apart, 2.7 each side of the middle.
  assert.ok(Math.abs(trunkOffset(2, 3) - 2.7) < 1e-9);
  // Whatever the reaches, the crowns' facing edges end up exactly the gap apart.
  for (const [left, right] of [[1.3, 1.3], [2.8, 2.1], [5, 0.9]]) {
    const offset = trunkOffset(left, right);
    const gap = offset - left - (-offset + right);
    assert.ok(Math.abs(gap - CROWN_GAP) < 1e-9, `${left}, ${right}: gap ${gap}`);
  }
});

test('a tree reaches toward the other by its branches and leaf blades, or further by an object on that side', () => {
  const bounds = { minX: -1.5, maxX: 2 };
  // Branches alone: the left tree reaches right to 2 + 0.24, the right tree left to 1.5 + 0.24.
  assert.equal(trunkReach(bounds, [], 'left'), 2 + LEAF_BLADE_REACH);
  assert.equal(trunkReach(bounds, [], 'right'), 1.5 + LEAF_BLADE_REACH);
  // A bird on the left tree at x 2.1 with a click radius of 0.5 reaches 2.6, past the leaves.
  const bird = { tree: 'left', attach: {}, position: [2.1, 3, 0], radius: 0.5 };
  assert.ok(Math.abs(trunkReach(bounds, [bird], 'left') - 2.6) < 1e-9);
  // The same bird does not change the right tree, and an object on the far side does not count.
  assert.equal(trunkReach(bounds, [bird], 'right'), 1.5 + LEAF_BLADE_REACH);
  const farSide = { tree: 'left', attach: {}, position: [-1.4, 3, 0], radius: 0.5 };
  assert.equal(trunkReach(bounds, [farSide], 'left'), 2 + LEAF_BLADE_REACH);
  // On the right tree, an object at x -1.6 (toward the left tree) reaches 1.6 + 0.45.
  const nest = { tree: 'right', attach: {}, position: [-1.6, 3, 0], radius: 0.45 };
  assert.ok(Math.abs(trunkReach(bounds, [nest], 'right') - 2.05) < 1e-9);
  // A bough difference (no object attached) never widens the reach.
  const bough = { tree: 'left', position: [3, 3, 0], radius: 1 };
  assert.equal(trunkReach(bounds, [bough], 'left'), 2 + LEAF_BLADE_REACH);
});
