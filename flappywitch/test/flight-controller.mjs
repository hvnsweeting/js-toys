import {
  PLAYER_Z, FIXED_STEP, WITCH_RADIUS,
  GATE_MOTION_RATE, CALM_CENTER, activateGate, alignGateSpacing, difficulty, gapCenter,
  gateCleared, gateOverlaps, gateSpacing, hitsGate, hitsWorld, makeGate,
  gateClearance, physicsStep, puffVelocity, scorePassAtClearance, seededRandom, updateGateTransition,
} from '../src/rules.js';

export function runBot(seed, kind, gateGoal, options = {}) {
  const random = seededRandom(seed);
  const aimRandom = seededRandom(seed ^ 0x59a47c31);
  const gates = [];
  let score = 0;
  let passed = 0;
  let y = CALM_CENTER;
  let velocity = puffVelocity();
  let time = 0;
  let activeGust = 0;
  let gustUntil = 0;
  let plan = [];
  let planStep = 0;
  let noticedGate = -1;
  let reactionAt = 0;
  let aimError = 0;
  function addGate() {
    const previous = gates.at(-1);
    const index = previous ? previous.index + 1 : 0;
    gates.push(makeGate(index, previous ? previous.z - gateSpacing(score) : -9, score, random, previous));
  }
  for (let index = 0; index < 5; index++) addGate();
  while (passed < gateGoal && time < 400) {
    const gate = gates.find(item => !item.passed);
    const speed = difficulty(score).speed;
    if (kind === 'always') velocity = puffVelocity();
    if (kind === 'noisy') {
      if (noticedGate !== gate.index) {
        noticedGate = gate.index;
        reactionAt = time + (options.reactionDelay ?? .12);
        aimError = (aimRandom() * 2 - 1) * (options.aimError ?? .25);
        plan = [];
        planStep = 0;
      }
      if (time >= reactionAt) {
        if (planStep >= plan.length) {
          if (!gate.active) activateGate(gate, score, time + FIXED_STEP);
          plan = planFlight(gate, null, { y, velocity, time, activeGust, gustUntil }, speed, score, aimError);
          planStep = 0;
        }
        if (plan[planStep++]) velocity = puffVelocity();
      }
    }
    if (kind === 'pilot') {
      if (planStep >= plan.length) {
        if (!gate.active) activateGate(gate, score, time + FIXED_STEP);
        const following = gates.find(item => item.index === gate.index + 1);
        plan = planFlight(gate, following, { y, velocity, time, activeGust, gustUntil }, speed, score);
        if (!plan.length) {
          const prior = gates.find(item => item.index === gate.index - 1);
          return { passed, score, cause: 'no-plan', gate: gate.index, y, velocity, center: gate.baseY,
            z: gate.z, time, halfGap: gate.halfGap, phase: gate.phase, moving: gate.moving,
            motion: gate.motion, following: following?.baseY, gust: gate.gust,
            gustStarted: gate.gustStarted, activeGust, gustUntil,
            prior: prior && { baseY: prior.baseY, center: gapCenter(prior, time), z: prior.z, halfGap: prior.halfGap } };
        }
        planStep = 0;
      }
      if (plan[planStep++]) velocity = puffVelocity();
    }
    time += FIXED_STEP;
    const gust = time < gustUntil ? activeGust : 0;
    ({ y, velocity } = physicsStep(y, velocity, FIXED_STEP, gust));
    if (hitsWorld(y)) return { passed, cause: 'world' };
    if (!gate.active) activateGate(gate, score, time);
    let scoredGate = false;
    for (const item of gates) {
      item.z += speed * FIXED_STEP;
      updateGateTransition(item, time);
      if (item.gust && !item.gustStarted && item.z >= PLAYER_Z - speed) {
        item.gustStarted = true;
        activeGust = item.gust;
        gustUntil = time + .85;
      }
      if (item.passed) continue;
      const center = gapCenter(item, time);
      if (gateOverlaps(item.z)) {
        if (hitsGate(y, center, item.halfGap)) {
          return { passed, cause: 'gate', gate: item.index, y, center, baseY: item.baseY, z: item.z, time, velocity, motion: item.motion };
        }
        item.minimumClearance = Math.min(item.minimumClearance, gateClearance(y, center, item.halfGap));
      }
      if (!gateCleared(item.z)) continue;
      item.passed = true;
      passed++;
      score = scorePassAtClearance(score, item.minimumClearance).score;
      scoredGate = true;
    }
    if (scoredGate) alignGateSpacing(gates, score);
    while (gates.length && gates[0].z > PLAYER_Z + 5) gates.shift();
    while (gates.length < 5) addGate();
  }
  return { passed, cause: 'goal' };
}

function planFlight(gate, following, start, speed, score, aimError = 0) {
  const chunk = 3;
  const times = [start.time];
  const gatePositions = [gate.z];
  const followingPositions = [following?.z];
  let gustStart = Infinity;
  let followingGustStart = Infinity;
  while (!gateCleared(gatePositions.at(-1))) {
    const at = times.at(-1) + FIXED_STEP;
    const z = gatePositions.at(-1) + speed * FIXED_STEP;
    const nextZ = following ? followingPositions.at(-1) + speed * FIXED_STEP : undefined;
    times.push(at);
    gatePositions.push(z);
    followingPositions.push(nextZ);
    if (gate.gust && !gate.gustStarted && z >= PLAYER_Z - speed && gustStart === Infinity) gustStart = at;
    if (following?.gust && !following.gustStarted && nextZ >= PLAYER_Z - speed && followingGustStart === Infinity) followingGustStart = at;
  }
  const steps = times.length - 1;
  const stages = Math.ceil(steps / chunk);
  const targetAt = step => {
    const at = times[step];
    const fraction = Math.max(0, Math.min(1, (at - gate.transitionAt) / .4));
    const blend = fraction * fraction * (3 - 2 * fraction);
    const motion = gate.fromMotionBlend + (gate.targetMotionBlend - gate.fromMotionBlend) * blend;
    return { center: gate.baseY + aimError + Math.sin(at * GATE_MOTION_RATE + gate.phase) * gate.motion * motion,
      halfGap: gate.fromHalfGap + (gate.targetHalfGap - gate.fromHalfGap) * blend };
  };
  let beam = [{ y: start.y, velocity: start.velocity, cost: 0,
    minimumClearance: gate.minimumClearance, actions: [] }];
  for (let stage = 0; stage < stages; stage++) {
    const candidates = [];
    for (const state of beam) {
      for (const puff of [false, true]) {
        let y = state.y;
        let velocity = puff ? puffVelocity() : state.velocity;
        let cost = state.cost + Number(puff) * .002;
        let minimumClearance = state.minimumClearance;
        let safe = true;
        for (let offset = 1; offset <= chunk; offset++) {
          const step = stage * chunk + offset;
          if (step > steps) break;
          const at = times[step];
          let gustActive = at < start.gustUntil ? start.activeGust : 0;
          if (at > gustStart && at < gustStart + .85) gustActive = gate.gust;
          if (at > followingGustStart && at < followingGustStart + .85) gustActive = following.gust;
          ({ y, velocity } = physicsStep(y, velocity, FIXED_STEP, gustActive));
          if (hitsWorld(y)) { safe = false; break; }
          const z = gatePositions[step];
          const { center, halfGap } = targetAt(step);
          if (gateOverlaps(z)) {
            if (hitsGate(y, center, halfGap)) { safe = false; break; }
            minimumClearance = Math.min(minimumClearance, gateClearance(y, center, halfGap));
            cost += Math.abs(y - center) * .01;
          }
        }
        if (!safe) continue;
        const atStep = Math.min((stage + 1) * chunk, steps);
        const target = targetAt(atStep).center;
        let rank = cost + Math.abs(y - target) * .04;
        if (stage === stages - 1 && following) {
          const followingCenter = following.baseY;
          const direction = Math.sign(followingCenter - target);
          const edge = (targetAt(atStep).halfGap - WITCH_RADIUS + .08) * .8;
          const endY = target + direction * Math.min(Math.abs(followingCenter - target), edge);
          const endVelocity = 0;
          rank += Math.abs(y - endY) * 2 + Math.abs(velocity - endVelocity) * .8;
        }
        candidates.push({ y, velocity, cost, minimumClearance, actions: [...state.actions, puff], rank });
      }
    }
    candidates.sort((a, b) => a.rank - b.rank);
    const bins = new Set();
    beam = [];
    for (const candidate of candidates) {
      const earnsBonus = candidate.minimumClearance >= 0 && candidate.minimumClearance < .27;
      const bin = `${Math.round(candidate.y * 25)}:${Math.round(candidate.velocity * 10)}:${earnsBonus}`;
      if (bins.has(bin)) continue;
      bins.add(bin);
      beam.push(candidate);
      if (beam.length === 1000) break;
    }
    if (!beam.length) return [];
  }
  if (following) {
    const nextStartTime = times[steps];
    for (const candidate of beam) {
      const nextScore = scorePassAtClearance(score, candidate.minimumClearance).score;
      const nextSpeed = difficulty(nextScore).speed;
      // Passing the current gate realigns the next gate after every gate advances.
      const nextGate = { ...following, z: gatePositions[steps] - gateSpacing(nextScore) };
      let nextActiveGust = start.activeGust;
      let nextGustUntil = start.gustUntil;
      if (followingGustStart <= nextStartTime) {
        nextGate.gustStarted = true;
        nextActiveGust = nextGate.gust;
        nextGustUntil = followingGustStart + .85;
      } else if (nextGate.gust && !nextGate.gustStarted && nextGate.z >= PLAYER_Z - speed) {
        nextGate.gustStarted = true;
        nextActiveGust = nextGate.gust;
        nextGustUntil = nextStartTime + .85;
      }
      activateGate(nextGate, nextScore, nextStartTime + FIXED_STEP);
      const nextPlan = planFlight(nextGate, null, {
        y: candidate.y, velocity: candidate.velocity, time: nextStartTime,
        activeGust: nextActiveGust, gustUntil: nextGustUntil,
      }, nextSpeed, nextScore);
      if (nextPlan.length) {
        return candidate.actions.flatMap(puff => [puff, false, false]).slice(0, steps);
      }
    }
    return [];
  }
  return beam[0].actions.flatMap(puff => [puff, false, false]).slice(0, steps);
}
