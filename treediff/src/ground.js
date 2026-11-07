// The shape of the meadow, and how high the camera must be to see the trees over it. Kept apart
// from world.js (which needs a browser) so it can be tested in Node.

import { fbm, smoothstep } from './random.js';

// Ground height: flat meadow near the trees, rolling hills toward the horizon.
export function groundHeight(x, z) {
  const r = Math.hypot(x, z * 1.25);
  const hills = smoothstep(18, 85, r) * (7 + fbm(x * 0.018 + 3, z * 0.018 - 7) * 22);
  const ripple = fbm(x * 0.12, z * 0.12) * 0.35 * smoothstep(6, 14, r);
  return hills + ripple;
}

// How far the camera and its line of sight keep above the ground, measured where the ground is
// sampled: every SAMPLE_SPACING units along the line. Between samples the hills (their shape
// changes over tens of units) and the ripple (0.35 high) can come a little closer.
export const CAMERA_CLEARANCE = 0.8;
const SAMPLE_SPACING = 0.5;

// The lowest height for a camera at (cameraX, cameraZ) that sees the point `target` ({ x, y, z })
// over the ground: the camera itself, and the straight line from it to the target, stay
// CAMERA_CLEARANCE above the ground at every sample. On a narrow screen the camera stands far
// back, among the hills; without this it can end up inside one, showing its underside.
export function lowestClearHeight(target, cameraX, cameraZ) {
  let lowest = -Infinity;
  const samples = Math.max(2, Math.ceil(Math.hypot(cameraX - target.x, cameraZ - target.z) / SAMPLE_SPACING));
  // Sample the ground from the camera's foot (f = 1) toward the target, stopping short of it:
  // near the target the line is at the target's height whatever the camera does.
  for (let i = 0; i < samples; i++) {
    const f = 1 - i / samples;
    const x = target.x + (cameraX - target.x) * f;
    const z = target.z + (cameraZ - target.z) * f;
    const needAtSample = groundHeight(x, z) + CAMERA_CLEARANCE;
    // The line's height at this sample is target.y + f * (cameraY - target.y).
    lowest = Math.max(lowest, target.y + (needAtSample - target.y) / f);
  }
  return lowest;
}

// Where a camera at `camera` ({ x, y, z }) looking at `target` should be so that it sees the
// target over the ground: the same point if it already does, otherwise lifted on the sphere
// around the target (the same distance, so zoom limits still hold). Lifting moves the camera's
// foot toward the target, onto ground of another height, so the check is repeated from there.
export function liftAboveGround(target, camera) {
  let { x, y, z } = camera;
  const distance = Math.hypot(x - target.x, y - target.y, z - target.z);
  for (let round = 0; round < 6; round++) {
    const lowest = lowestClearHeight(target, x, z);
    if (y >= lowest) break;
    const rise = Math.min(lowest - target.y, distance * 0.95);
    const across = Math.sqrt(distance * distance - rise * rise);
    const horizontal = Math.hypot(x - target.x, z - target.z) || 1;
    x = target.x + ((x - target.x) / horizontal) * across;
    z = target.z + ((z - target.z) / horizontal) * across;
    y = target.y + rise;
  }
  return { x, y, z };
}
