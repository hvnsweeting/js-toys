export const PLAYER_Z = 2;
export const FLOOR = -3.8;
export const CEILING = 4.2;
// Flight-pose bounds cover the scaled solid mesh throughout its tilt range.
export const WITCH_RADIUS = 0.45;
export const WITCH_FRONT = 0.636;
export const WITCH_BACK = 0.85;
export const GATE_FRONT = 0.426;
export const GATE_BACK = 0.535;
export const WISP_DEPTH_OFFSET = 0.8;
export const COLLISION_FORGIVENESS = 0.08;
export const FIXED_STEP = 1 / 120;
export const MAX_BACKLOG = 0.25;
export const GRAVITY = -7.8;
export const PUFF_SPEED = 3.6;
export const FALL_SPEED = -3.8;
export const GATE_SPACING = 7.4;
export const CALM_GATE_COUNT = 1;
export const CALM_CENTER = 0.2;
export const FIRST_SPREAD_SCORE = 1;
export const FIRST_SPREAD = 1.3;
export const FULL_SPREAD_SCORE = 10;
export const FULL_SPREAD = 2.2;
export const WORLD_GAP_INSET = 0.3;
export const MIN_NEIGHBOR_CHANGE = 0.9;
export const REACH_SAFETY = 0.7;
export const CALM_CLEARANCE = 2.4;
export const FIRST_CLEARANCE = 1.7;
export const MID_CLEARANCE_SCORE = 15;
export const MID_CLEARANCE = 1.15;
export const LATE_CLEARANCE_SCORE = 30;
export const LATE_CLEARANCE = 0.95;
export const FINAL_CLEARANCE_SCORE = 40;
export const FINAL_CLEARANCE = 0.85;
export const MOVING_START_SCORE = 5;
export const FIRST_MOTION = 0.35;
export const FULL_MOTION_SCORE = 30;
export const FULL_MOTION = 0.8;
export const GATE_MOTION_RATE = 0.8;
export const START_SPEED = 3.6;
export const FULL_SPEED_SCORE = 30;
export const FULL_SPEED = 5.2;
export const STAIRCASE_LENGTH = 3;
export const NORMAL_MAX_CHANGE = 0.95;
export const BIG_DROP_CHANGE = 1.15;

export function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

export function physicsStep(y, velocity, seconds, gust = 0) {
  const nextVelocity = clamp(velocity + (GRAVITY + gust) * seconds, FALL_SPEED, PUFF_SPEED);
  return { y: y + nextVelocity * seconds, velocity: nextVelocity };
}

export function fixedSteps(backlog, elapsed) {
  const accumulated = Math.min(MAX_BACKLOG, backlog + Math.max(0, elapsed));
  const count = Math.floor((accumulated + 1e-10) / FIXED_STEP);
  return { count, backlog: Math.max(0, accumulated - count * FIXED_STEP) };
}

export function puffVelocity() {
  return PUFF_SPEED;
}

export function difficulty(score) {
  const progress = Math.max(0, score);
  let clearance = FIRST_CLEARANCE + (MID_CLEARANCE - FIRST_CLEARANCE)
    * clamp((progress - FIRST_SPREAD_SCORE) / (MID_CLEARANCE_SCORE - FIRST_SPREAD_SCORE), 0, 1);
  if (progress > MID_CLEARANCE_SCORE) {
    clearance = MID_CLEARANCE + (LATE_CLEARANCE - MID_CLEARANCE)
      * clamp((progress - MID_CLEARANCE_SCORE) / (LATE_CLEARANCE_SCORE - MID_CLEARANCE_SCORE), 0, 1);
  }
  if (progress > LATE_CLEARANCE_SCORE) {
    clearance = LATE_CLEARANCE + (FINAL_CLEARANCE - LATE_CLEARANCE)
      * clamp((progress - LATE_CLEARANCE_SCORE) / (FINAL_CLEARANCE_SCORE - LATE_CLEARANCE_SCORE), 0, 1);
  }
  return {
    speed: START_SPEED + (FULL_SPEED - START_SPEED) * clamp(progress / FULL_SPEED_SCORE, 0, 1),
    halfGap: WITCH_RADIUS - COLLISION_FORGIVENESS + clearance / 2,
    moving: score >= MOVING_START_SCORE,
    motion: FIRST_MOTION + (FULL_MOTION - FIRST_MOTION) * clamp((progress - MOVING_START_SCORE) / (FULL_MOTION_SCORE - MOVING_START_SCORE), 0, 1),
  };
}

export function gateSpacing(score) {
  return GATE_SPACING * (1 - .15 * clamp(score / 20, 0, 1));
}

export function alignGateSpacing(gates, score) {
  const spacing = gateSpacing(score);
  let previous = null;
  for (const gate of gates) {
    if (!gate.passed && previous) gate.z = previous.z - spacing;
    previous = gate;
  }
}

export function gateCanMove(index, score) {
  if (score < MOVING_START_SCORE) return false;
  return score >= 15 ? index % 2 === 0 : index % 3 === 2;
}

export function gapCenter(gate, time) {
  if (!gate.moving) return gate.baseY;
  return gate.baseY + Math.sin(time * GATE_MOTION_RATE + gate.phase) * gate.motion * (gate.motionBlend ?? 1);
}

export function activateGate(gate, score, time) {
  const settings = difficulty(score);
  gate.active = true;
  gate.transitionAt = time;
  gate.fromHalfGap = gate.halfGap;
  gate.targetHalfGap = gate.index < CALM_GATE_COUNT ? gate.halfGap : settings.halfGap;
  gate.fromMotionBlend = gate.motionBlend ?? 0;
  gate.targetMotionBlend = settings.moving && gateCanMove(gate.index, score) ? 1 : 0;
  gate.motion = settings.motion;
  gate.moving = gate.targetMotionBlend > 0 || gate.fromMotionBlend > 0;
  if (gate.targetMotionBlend > 0) {
    // Cross the centre line halfway through broom overlap to limit abrupt exit changes.
    const entryZ = PLAYER_Z - WITCH_FRONT - GATE_BACK + COLLISION_FORGIVENESS;
    const clearZ = PLAYER_Z + WITCH_BACK + GATE_FRONT;
    const midpointZ = (entryZ + clearZ) / 2;
    const midpointTime = time + Math.max(0, midpointZ - gate.z) / settings.speed;
    gate.phase = (gate.index % 2 ? Math.PI : 0) - midpointTime * GATE_MOTION_RATE;
  }
}

export function updateGateTransition(gate, time) {
  if (!gate.active) return;
  const fraction = clamp((time - gate.transitionAt) / 0.4, 0, 1);
  const eased = fraction * fraction * (3 - 2 * fraction);
  gate.halfGap = gate.fromHalfGap + (gate.targetHalfGap - gate.fromHalfGap) * eased;
  gate.motionBlend = gate.fromMotionBlend + (gate.targetMotionBlend - gate.fromMotionBlend) * eased;
}

export function fireflyCenter(gate, time) {
  return gapCenter(gate, time) + gate.fireflyY - gate.baseY;
}

export function wispAtWitch(gateZ) {
  return gateZ + WISP_DEPTH_OFFSET >= PLAYER_Z;
}

export function gateOverlaps(z, front = WITCH_FRONT, back = WITCH_BACK) {
  const entryZ = PLAYER_Z - front - GATE_BACK + COLLISION_FORGIVENESS;
  const exitZ = PLAYER_Z + back + GATE_FRONT - COLLISION_FORGIVENESS;
  return z >= entryZ && z <= exitZ;
}

export function gateCleared(z, back = WITCH_BACK) {
  return z - GATE_FRONT > PLAYER_Z + back;
}

export function hitsGate(y, center, halfGap, radius = WITCH_RADIUS) {
  const reach = radius - COLLISION_FORGIVENESS;
  return y - reach < center - halfGap || y + reach > center + halfGap;
}

export function hitsWorld(y, radius = WITCH_RADIUS) {
  return y - radius < FLOOR || y + radius > CEILING;
}

export function collectFirefly(streak, shield, caught) {
  if (!caught) return { streak: 0, shield, gained: false };
  const next = streak + 1;
  return { streak: next % 5, shield: shield || next >= 5, gained: next >= 5 };
}

// Clearance is measured from the same forgiving reach that hitsGate uses, so every pass that does not
// crash has a clearance of zero or more, and the closest safe passes earn the bonus.
export function gateClearance(y, center, halfGap, radius = WITCH_RADIUS) {
  const reach = radius - COLLISION_FORGIVENESS;
  return halfGap - Math.abs(y - center) - reach;
}

// The band was 0.27 measured from the drawn witch; it grows by the forgiveness so passes that earned the
// bonus before still do, and the forgiven sliver next to the edge now earns it too.
export const NEAR_MISS_BAND = 0.27 + COLLISION_FORGIVENESS;

export function scorePassAtClearance(score, clearance) {
  const nearMiss = clearance >= 0 && clearance < NEAR_MISS_BAND;
  return { score: score + 1 + Number(nearMiss), nearMiss };
}

export function scorePass(score, y, center, halfGap, radius = WITCH_RADIUS) {
  return scorePassAtClearance(score, gateClearance(y, center, halfGap, radius));
}

export function medalFor(score) {
  if (score >= 50) return 'Gold';
  if (score >= 25) return 'Silver';
  if (score >= 10) return 'Bronze';
  return 'No medal yet';
}

export function skyPeriod(score) {
  return Math.min(3, Math.floor(Math.max(0, score) / 15));
}

export function readBest(storage) {
  try {
    const value = storage.getItem('flappy-witch-best');
    if (value === null) return 0;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1000000 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function saveBest(storage, score) {
  if (!Number.isSafeInteger(score) || score < 0) return false;
  try {
    storage.setItem('flappy-witch-best', String(Math.max(readBest(storage), score)));
    return true;
  } catch {
    return false;
  }
}

export function seededRandom(seed) {
  let value = (Number(seed) || 1) >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let x = value;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function reachableChange(speed, spacing = GATE_SPACING) {
  const steps = Math.floor(spacing / speed / FIXED_STEP);
  // A skilled exit can be level; use that attainable starting velocity for the fall bound.
  let velocity = 0;
  let fall = 0;
  for (let step = 0; step < steps; step++) {
    const next = physicsStep(0, velocity, FIXED_STEP);
    velocity = next.velocity;
    fall -= velocity * FIXED_STEP;
  }
  const rise = PUFF_SPEED * steps * FIXED_STEP;
  return Math.min(rise, fall) * REACH_SAFETY;
}

export function nextGapCenter(previous, score, random, halfGap, motionReserve = 0) {
  const spread = FIRST_SPREAD + (FULL_SPREAD - FIRST_SPREAD)
    * clamp((score - FIRST_SPREAD_SCORE) / (FULL_SPREAD_SCORE - FIRST_SPREAD_SCORE), 0, 1);
  const low = Math.max(-spread, FLOOR + halfGap + WORLD_GAP_INSET + motionReserve);
  const high = Math.min(spread, CEILING - halfGap - WORLD_GAP_INSET - motionReserve);
  const stairLow = Math.max(low, FLOOR + halfGap + WORLD_GAP_INSET + FULL_MOTION);
  const stairHigh = Math.min(high, CEILING - halfGap - WORLD_GAP_INSET - FULL_MOTION);
  const limit = reachableChange(difficulty(score).speed, gateSpacing(score));
  const last = previous?.baseY ?? CALM_CENTER;
  let pattern = previous?.pattern;
  let direction = previous?.direction ?? 1;
  let stepsLeft = previous?.stepsLeft ?? 0;
  if (!stepsLeft) {
    const choice = random();
    pattern = choice < .45 ? 'zigzag' : choice < .85 ? 'staircase' : 'big-drop';
    if (pattern === 'staircase') {
      direction = stairHigh - last >= last - stairLow ? 1 : -1;
      const room = direction > 0 ? stairHigh - last : last - stairLow;
      if (room >= STAIRCASE_LENGTH * MIN_NEIGHBOR_CHANGE) stepsLeft = STAIRCASE_LENGTH;
      else { pattern = 'zigzag'; stepsLeft = 1; }
    } else if (pattern === 'big-drop') {
      direction = -1;
      stepsLeft = 1;
    } else {
      direction = previous?.direction ? -direction : (random() < .5 ? -1 : 1);
      stepsLeft = 1;
    }
  }
  if (pattern === 'big-drop' && last - low < MIN_NEIGHBOR_CHANGE) {
    pattern = 'zigzag';
    direction = 1;
  }
  // Reverse at an edge so every generated neighbour still has room for the minimum move.
  if (pattern !== 'staircase' && (direction > 0 ? high - last : last - low) < MIN_NEIGHBOR_CHANGE) direction *= -1;
  const room = pattern === 'staircase'
    ? (direction > 0 ? stairHigh - last : last - stairLow)
    : (direction > 0 ? high - last : last - low);
  const bigDrop = pattern === 'big-drop' && direction < 0;
  const desired = bigDrop ? Math.min(limit, BIG_DROP_CHANGE)
    : MIN_NEIGHBOR_CHANGE + random() * (Math.min(limit, NORMAL_MAX_CHANGE) - MIN_NEIGHBOR_CHANGE);
  const stairStep = pattern === 'staircase' ? room - (stepsLeft - 1) * MIN_NEIGHBOR_CHANGE : room;
  const change = Math.min(stairStep, limit, desired);
  return { baseY: clamp(last + direction * change, low, high), pattern, direction, stepsLeft: stepsLeft - 1 };
}

export function makeGate(index, z, score, random, previous = null) {
  const generationScore = Math.max(score, index);
  const settings = difficulty(generationScore);
  const calmOpening = index < CALM_GATE_COUNT;
  const motionReserve = gateCanMove(index, generationScore) ? FULL_MOTION : 0;
  const halfGap = calmOpening ? WITCH_RADIUS - COLLISION_FORGIVENESS + CALM_CLEARANCE / 2 : settings.halfGap;
  const placement = calmOpening ? { baseY: CALM_CENTER, pattern: 'calm', direction: 0, stepsLeft: 0 }
    : nextGapCenter(previous, generationScore, random, halfGap, motionReserve);
  const baseY = placement.baseY;
  const moving = false;
  const gust = index >= 5 && index % 5 === 3 ? (random() < 0.5 ? -0.8 : 0.8) : 0;
  return {
    index, z, ...placement, moving, phase: random() * Math.PI * 2,
    halfGap, motion: settings.motion,
    fireflyY: baseY + (random() - 0.5) * 0.8,
    gust, passed: false, gustStarted: false, active: false, motionBlend: 0,
    wispCaught: null, minimumClearance: Infinity,
  };
}
