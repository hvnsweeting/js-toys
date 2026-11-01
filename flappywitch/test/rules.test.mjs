import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWitch, measureFlightBounds, measureWitchBounds } from '../src/witch.js';
import { createGateVisual, measureGateDepth } from '../src/gates.js';
import { CEILING, FLOOR, GRAVITY, PUFF_SPEED, FALL_SPEED, FIXED_STEP, WITCH_RADIUS, WITCH_FRONT, WITCH_BACK, GATE_FRONT, GATE_BACK, COLLISION_FORGIVENESS, GATE_SPACING, CALM_GATE_COUNT, CALM_CENTER, FIRST_SPREAD_SCORE, FIRST_SPREAD, FULL_SPREAD_SCORE, FULL_SPREAD, WORLD_GAP_INSET, MIN_NEIGHBOR_CHANGE, REACH_SAFETY, CALM_CLEARANCE, FIRST_CLEARANCE, MID_CLEARANCE_SCORE, MID_CLEARANCE, LATE_CLEARANCE_SCORE, LATE_CLEARANCE, FINAL_CLEARANCE_SCORE, FINAL_CLEARANCE, MOVING_START_SCORE, FIRST_MOTION, FULL_MOTION_SCORE, FULL_MOTION, GATE_MOTION_RATE, START_SPEED, FULL_SPEED, FULL_SPEED_SCORE, STAIRCASE_LENGTH, NORMAL_MAX_CHANGE, BIG_DROP_CHANGE, activateGate, collectFirefly, difficulty, fireflyCenter, fixedSteps, gapCenter, gateCanMove, gateCleared, gateOverlaps, gateSpacing, hitsGate, hitsWorld, makeGate, medalFor, nextGapCenter, physicsStep, puffVelocity, reachableChange, readBest, saveBest, scorePass, seededRandom, skyPeriod, updateGateTransition } from '../src/rules.js';
import {
  NEAR_MISS_BAND, PLAYER_Z, WISP_DEPTH_OFFSET, gateClearance, scorePassAtClearance, wispAtWitch,
} from '../src/rules.js';

test('puff lifts, gravity slows, and falling velocity has a cap', () => {
  assert.equal(GRAVITY, -7.8);
  assert.equal(PUFF_SPEED, 3.6);
  assert.equal(FALL_SPEED, -3.8);
  assert.equal(puffVelocity(-2), 3.6);
  assert.equal(puffVelocity(4.8), 3.6);
  const after = physicsStep(0, 0, 1);
  assert.equal(after.velocity, -3.8);
  assert.equal(after.y, -3.8);
  assert.equal(physicsStep(0, 0, .1).velocity, -.78);
  assert.ok(physicsStep(0, 0, .1, 2).velocity > physicsStep(0, 0, .1, -2).velocity);
});

test('collision uses the drawn witch and gate mesh bounds', () => {
  assert.equal(WITCH_RADIUS, .45);
  assert.equal(WITCH_FRONT, .636);
  assert.equal(WITCH_BACK, .85);
  assert.equal(GATE_FRONT, .426);
  assert.equal(GATE_BACK, .535);
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, {
    get: (_, name) => name === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {},
  }) }) };
  try {
    const witch = createWitch();
    witch.group.position.set(0, 0, 0);
    witch.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(witch.solid);
    assert.ok(bounds.max.y < WITCH_RADIUS);
    assert.ok(-bounds.min.y < WITCH_RADIUS);
    assert.ok(bounds.max.z < WITCH_BACK);
    const measured = measureFlightBounds(witch);
    assert.ok(Math.abs(measured.vertical - .44988531627012235) < .00001);
    assert.ok(Math.abs(measured.front - .6351734238499569) < .00001);
    assert.ok(Math.abs(measured.back - .8472015755983766) < .00001);
    assert.ok(measured.vertical <= WITCH_RADIUS && WITCH_RADIUS - measured.vertical < .001);
    assert.ok(measured.front <= WITCH_FRONT && WITCH_FRONT - measured.front < .001);
    assert.ok(measured.back <= WITCH_BACK && WITCH_BACK - measured.back < .003);
    for (const tilt of [-.27, .27]) {
      witch.group.rotation.set(.03, 0, tilt);
      const tilted = measureWitchBounds(witch);
      assert.ok(tilted.vertical <= WITCH_RADIUS);
      assert.ok(tilted.front <= WITCH_FRONT);
      assert.ok(tilted.back <= WITCH_BACK);
      assert.ok(tilted.vertical > .4);
    }
    assert.ok(COLLISION_FORGIVENESS >= .06 && COLLISION_FORGIVENESS <= .1);

    const visual = createGateVisual(makeGate(0, 0, 0, seededRandom(1)));
    const gateDepth = measureGateDepth(visual);
    assert.ok(Math.abs(gateDepth.front - .425) < .00001);
    assert.ok(Math.abs(gateDepth.back - .535) < .00001);
    assert.ok(gateDepth.front <= GATE_FRONT);
    assert.ok(gateDepth.back <= GATE_BACK);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('gap edges and full gate depth agree with the collision rules', () => {
  assert.equal(hitsGate(0, 0, 1.48), false);
  const inside = 1.48 - (WITCH_RADIUS - COLLISION_FORGIVENESS) - .001;
  const outside = inside + .002;
  for (const sign of [-1, 1]) {
    assert.equal(hitsGate(sign * inside, 0, 1.48), false);
    assert.equal(hitsGate(sign * outside, 0, 1.48), true);
  }
  const entry = 2 - WITCH_FRONT - GATE_BACK + COLLISION_FORGIVENESS;
  const exit = 2 + WITCH_BACK + GATE_FRONT - COLLISION_FORGIVENESS;
  assert.equal(gateOverlaps(entry - .001), false);
  assert.equal(gateOverlaps(entry + .001), true);
  assert.equal(gateOverlaps(exit - .001), true);
  assert.equal(gateOverlaps(exit + .001), false);
  const clear = 2 + GATE_FRONT + WITCH_BACK;
  assert.equal(gateCleared(clear), false);
  assert.equal(gateCleared(clear + .001), true);
  assert.equal(hitsWorld(FLOOR), true);
  assert.equal(hitsWorld(CEILING), true);
});

test('fixed simulation reaches the same state at 16 and 50 millisecond frames', () => {
  function run(frameSeconds, frames) {
    let backlog = 0;
    let state = { y: 0, velocity: 3.6 };
    for (let frame = 0; frame < frames; frame++) {
      const steps = fixedSteps(backlog, frameSeconds);
      backlog = steps.backlog;
      for (let step = 0; step < steps.count; step++) state = physicsStep(state.y, state.velocity, FIXED_STEP);
    }
    return state;
  }
  const fast = run(.016, 125);
  const slow = run(.05, 40);
  assert.ok(Math.abs(fast.y - slow.y) < 1e-6);
  assert.ok(Math.abs(fast.velocity - slow.velocity) < 1e-6);
  assert.equal(fixedSteps(0, 2).count, 30);
});

test('near miss awards one bonus and ordinary pass awards one', () => {
  assert.deepEqual(scorePass(3, 0, 0, 1.48), { score: 4, nearMiss: false });
  assert.deepEqual(scorePass(3, .8, 0, 1.48), { score: 5, nearMiss: true });
});

test('a wisp reaches the witch before the gate clears', () => {
  const crossing = PLAYER_Z - WISP_DEPTH_OFFSET;
  assert.equal(wispAtWitch(crossing - .001), false);
  assert.equal(wispAtWitch(crossing), true);
  assert.equal(gateCleared(crossing), false);
});

test('the closest safe point during overlap determines the near miss', () => {
  const edge = gateClearance(.5, 0, 1);
  const center = gateClearance(0, 0, 1);
  assert.ok(edge >= 0 && edge < NEAR_MISS_BAND);
  assert.ok(center >= NEAR_MISS_BAND);
  for (const path of [[edge, center], [center, edge]]) {
    const minimum = Math.min(...path);
    assert.deepEqual(scorePassAtClearance(3, minimum), { score: 5, nearMiss: true });
  }
  assert.deepEqual(scorePassAtClearance(3, center), { score: 4, nearMiss: false });
});

test('every pass that does not crash has clearance zero or more, and the closest ones earn the bonus', () => {
  // Inside the forgiven sliver: the drawn witch overlaps the gate edge, but hitsGate says safe.
  const forgiven = .6;
  assert.equal(hitsGate(forgiven, 0, 1), false);
  assert.deepEqual(scorePass(3, forgiven, 0, 1), { score: 5, nearMiss: true });
  // A little further from the edge is still a near miss, as before.
  assert.deepEqual(scorePass(3, .5, 0, 1), { score: 5, nearMiss: true });
  // Sweep the whole safe band: clearance never goes negative while hitsGate says safe.
  for (let y = 0; y <= 1; y += .005) {
    if (hitsGate(y, 0, 1)) continue;
    assert.ok(gateClearance(y, 0, 1) >= 0, `safe height ${y.toFixed(3)} has negative clearance`);
  }
});

test('five consecutive fireflies grant one shield and a miss resets the streak', () => {
  let result = { streak: 0, shield: false };
  for (let i = 0; i < 4; i++) result = collectFirefly(result.streak, result.shield, true);
  assert.equal(result.streak, 4);
  result = collectFirefly(result.streak, result.shield, false);
  assert.equal(result.streak, 0);
  for (let i = 0; i < 5; i++) result = collectFirefly(result.streak, result.shield, true);
  assert.deepEqual(result, { streak: 0, shield: true, gained: true });
});

test('difficulty uses the specified speed, clearance, and motion milestones', () => {
  assert.deepEqual([GATE_SPACING, CALM_GATE_COUNT, CALM_CENTER, FIRST_SPREAD_SCORE, FIRST_SPREAD, FULL_SPREAD_SCORE, FULL_SPREAD, WORLD_GAP_INSET, MIN_NEIGHBOR_CHANGE, REACH_SAFETY], [7.4, 1, .2, 1, 1.3, 10, 2.2, .3, .9, .7]);
  assert.deepEqual([CALM_CLEARANCE, FIRST_CLEARANCE, MID_CLEARANCE_SCORE, MID_CLEARANCE, LATE_CLEARANCE_SCORE, LATE_CLEARANCE, FINAL_CLEARANCE_SCORE, FINAL_CLEARANCE], [2.4, 1.7, 15, 1.15, 30, .95, 40, .85]);
  assert.deepEqual([MOVING_START_SCORE, FIRST_MOTION, FULL_MOTION_SCORE, FULL_MOTION, GATE_MOTION_RATE, START_SPEED, FULL_SPEED_SCORE, FULL_SPEED, STAIRCASE_LENGTH, NORMAL_MAX_CHANGE, BIG_DROP_CHANGE], [5, .35, 30, .8, .8, 3.6, 30, 5.2, 3, .95, 1.15]);
  assert.equal(gateSpacing(0), 7.4);
  assert.equal(gateSpacing(20), 6.29);
  assert.equal(difficulty(0).speed, 3.6);
  assert.equal(difficulty(30).speed, 5.2);
  assert.equal(difficulty(1).halfGap, WITCH_RADIUS - COLLISION_FORGIVENESS + .85);
  assert.equal(difficulty(15).halfGap, WITCH_RADIUS - COLLISION_FORGIVENESS + .575);
  assert.equal(difficulty(30).halfGap, WITCH_RADIUS - COLLISION_FORGIVENESS + .475);
  assert.equal(difficulty(40).halfGap, WITCH_RADIUS - COLLISION_FORGIVENESS + .425);
  assert.equal(difficulty(4).moving, false);
  assert.equal(difficulty(5).moving, true);
  assert.equal(difficulty(5).motion, .35);
  assert.equal(difficulty(30).motion, .8);
  assert.equal(gateCanMove(5, 5), true);
  assert.equal(gateCanMove(6, 5), false);
  assert.equal(gateCanMove(16, 15), true);
  assert.equal(gateCanMove(17, 15), false);
});

test('seeded gate generation repeats and only the first gap stays centred', () => {
  const a = makeGate(1, -12, 0, seededRandom(42));
  const b = makeGate(1, -12, 0, seededRandom(42));
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.baseY - .2) >= .9);
  assert.equal(a.halfGap, difficulty(1).halfGap);
  const early = makeGate(0, -9, 0, seededRandom(42));
  assert.equal(early.baseY, .2);
  assert.equal(early.halfGap, WITCH_RADIUS - COLLISION_FORGIVENESS + 1.2);
  assert.equal(early.moving, false);
  assert.equal(early.gust, 0);
  assert.equal(gapCenter(a, 100), a.baseY);
  const late = makeGate(16, -80, 16, seededRandom(10), a);
  activateGate(late, 16, 0);
  updateGateTransition(late, .4);
  assert.notEqual(gapCenter(late, 0), gapCenter(late, 1));
  assert.equal(fireflyCenter(late, 1), gapCenter(late, 1) + late.fireflyY - late.baseY);
  assert.notEqual(fireflyCenter(late, 0), fireflyCenter(late, 1));
});

test('the first eligible active gate moves and narrows over 0.4 seconds', () => {
  const moving = makeGate(5, -80, 5, seededRandom(10));
  activateGate(moving, 5, 1);
  updateGateTransition(moving, 1);
  assert.equal(gapCenter(moving, 1), moving.baseY);
  updateGateTransition(moving, 1.2);
  assert.ok(moving.motionBlend > 0 && moving.motionBlend < 1);
  updateGateTransition(moving, 1.4);
  assert.equal(moving.motionBlend, 1);
  const beforeMovement = makeGate(4, -72, 4, seededRandom(7));
  activateGate(beforeMovement, 4, 0);
  assert.equal(beforeMovement.targetMotionBlend, 0);
  assert.equal(moving.targetMotionBlend, 1);
  const narrow = makeGate(10, -80, 3, seededRandom(20));
  activateGate(narrow, 25, 2);
  updateGateTransition(narrow, 2.2);
  assert.ok(narrow.halfGap < difficulty(11).halfGap && narrow.halfGap > difficulty(25).halfGap);
  updateGateTransition(narrow, 2.4);
  assert.equal(narrow.halfGap, difficulty(25).halfGap);
});

test('medal thresholds use the score', () => {
  assert.equal(medalFor(9), 'No medal yet');
  assert.equal(medalFor(10), 'Bronze');
  assert.equal(medalFor(25), 'Silver');
  assert.equal(medalFor(50), 'Gold');
});

test('dusk deepens at each fifteen-point threshold', () => {
  assert.equal(skyPeriod(14), 0);
  assert.equal(skyPeriod(15), 1);
  assert.equal(skyPeriod(30), 2);
  assert.equal(skyPeriod(45), 3);
  assert.equal(skyPeriod(100), 3);
});

test('best score validates stored data and tolerates storage failures', () => {
  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.equal(readBest(storage), 0);
  assert.equal(saveBest(storage, 23), true);
  assert.equal(readBest(storage), 23);
  assert.equal(saveBest(storage, 5), true);
  assert.equal(readBest(storage), 23);
  for (const invalid of ['abc', '-2', '2.5', 'Infinity', '1000001']) {
    store.set('flappy-witch-best', invalid);
    assert.equal(readBest(storage), 0);
  }
  assert.equal(saveBest(storage, -1), false);
  assert.equal(readBest({ getItem() { throw new Error('blocked'); } }), 0);
  assert.equal(saveBest({ setItem() { throw new Error('full'); } }, 2), false);
});
