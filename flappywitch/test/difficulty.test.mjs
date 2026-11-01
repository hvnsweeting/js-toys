import test from 'node:test';
import assert from 'node:assert/strict';
import { runBot } from './flight-controller.mjs';
import {
  CEILING, FLOOR, CALM_CENTER, WORLD_GAP_INSET, difficulty, gateCanMove,
  gateSpacing, makeGate, reachableChange, seededRandom,
} from '../src/rules.js';

function makeSequence(seed, count) {
  const random = seededRandom(seed);
  const gates = [];
  for (let index = 0; index < count; index++) {
    const previous = gates.at(-1);
    gates.push(makeGate(index, previous ? previous.z - gateSpacing(index) : -9, index, random, previous));
  }
  return gates;
}

test('seed fixes the full pattern and gates vary within safe bounds', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const gates = makeSequence(seed, 150);
    assert.deepEqual(gates, makeSequence(seed, 150));
    assert.equal(gates[0].baseY, CALM_CENTER);
    for (let index = 1; index < gates.length; index++) {
      const gate = gates[index];
      const previous = gates[index - 1];
      const change = Math.abs(gate.baseY - previous.baseY);
      assert.ok(change >= .9 - 1e-9, `seed ${seed}, gate ${index + 1}: ${change}`);
      assert.ok(change <= reachableChange(difficulty(index).speed, gateSpacing(index)) + 1e-9);
      const reserve = gateCanMove(gate.index, index) ? .8 : 0;
      assert.ok(gate.baseY - gate.halfGap - reserve >= FLOOR + WORLD_GAP_INSET - 1e-9);
      assert.ok(gate.baseY + gate.halfGap + reserve <= CEILING - WORLD_GAP_INSET + 1e-9);
      if (gate.pattern === 'big-drop') assert.ok(gate.baseY < previous.baseY, `seed ${seed}, gate ${index + 1}: big drop must descend`);
    }
  }
  const patterns = new Set(makeSequence(7, 150).map(gate => gate.pattern));
  for (const pattern of ['zigzag', 'staircase', 'big-drop']) assert.ok(patterns.has(pattern));
});

test('a staircase keeps one direction for three gates', () => {
  let staircases = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const gates = makeSequence(seed, 150);
    for (let index = 1; index < gates.length - 2; index++) {
      const gate = gates[index];
      if (gate.pattern !== 'staircase' || gate.stepsLeft !== 2) continue;
      staircases++;
      for (let next = index; next <= index + 2; next++) {
        assert.equal(gates[next].pattern, 'staircase', `seed ${seed}, gate ${next + 1}`);
        assert.equal(gates[next].direction, gate.direction, `seed ${seed}, gate ${next + 1}`);
        assert.equal(Math.sign(gates[next].baseY - gates[next - 1].baseY), gate.direction, `seed ${seed}, gate ${next + 1} centre`);
      }
    }
  }
  assert.ok(staircases > 0);
});


test('a flight controller clears 150 gates on 50 seeds', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const result = runBot(seed, 'pilot', 150);
    assert.equal(result.passed, 150, `seed ${seed}: ${JSON.stringify(result)}`);
  }
});

test('constant inputs cannot clear gate three', () => {
  for (let seed = 1; seed <= 50; seed++) {
    assert.ok(runBot(seed, 'never', 3).passed < 3, `never, seed ${seed}`);
    assert.ok(runBot(seed, 'always', 3).passed < 3, `always, seed ${seed}`);
  }
});
