import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, shuffle, valueNoise } from '../src/random.js';
import { randomGenes, TRAIT_KEYS } from '../src/traits.js';

test('mulberry32 is deterministic and stays in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
  }
});

test('shuffle keeps every item', () => {
  const items = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(shuffle(mulberry32(1), items).sort(), items);
});

test('value noise is continuous', () => {
  const step = Math.abs(valueNoise(3.5, 7.25) - valueNoise(3.501, 7.25));
  assert.ok(step < 0.01);
});

test('random genes are all in [0, 1]', () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    for (const value of Object.values(randomGenes(rng))) assert.ok(value >= 0 && value <= 1);
  }
});

test('there are twelve different traits', () => {
  assert.equal(TRAIT_KEYS.length, 12);
  assert.equal(new Set(TRAIT_KEYS).size, 12);
});
