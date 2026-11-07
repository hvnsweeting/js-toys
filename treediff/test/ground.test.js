import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundHeight, lowestClearHeight, liftAboveGround, CAMERA_CLEARANCE } from '../src/ground.js';

const target = { x: 0, y: 3, z: 0 };

// The smallest gap between the ground and the straight line from the camera to the target,
// over the part of the line away from the target (near the target the line is at its height).
function smallestGap(cameraX, cameraY, cameraZ) {
  let smallest = Infinity;
  for (let i = 0; i <= 400; i++) {
    const f = 0.1 + (0.9 * i) / 400;
    const x = target.x + (cameraX - target.x) * f;
    const z = target.z + (cameraZ - target.z) * f;
    const y = target.y + (cameraY - target.y) * f;
    smallest = Math.min(smallest, y - groundHeight(x, z));
  }
  return smallest;
}

test('near the trees the meadow is flat, so the usual camera height is clear', () => {
  for (let degrees = 0; degrees < 360; degrees += 15) {
    const angle = (degrees * Math.PI) / 180;
    assert.ok(lowestClearHeight(target, 17.8 * Math.sin(angle), 17.8 * Math.cos(angle)) < 3.5, `at ${degrees} degrees`);
  }
});

test('far back among the hills, the lowest clear height sees the trees over the ground', () => {
  let lifted = 0;
  for (const distance of [25, 40, 55, 70, 76.5, 80]) {
    for (let degrees = 0; degrees < 360; degrees += 4) {
      const angle = (degrees * Math.PI) / 180;
      const x = distance * Math.sin(angle);
      const z = distance * Math.cos(angle);
      const height = lowestClearHeight(target, x, z);
      if (height > 4.8) lifted++;
      assert.ok(height >= groundHeight(x, z) + CAMERA_CLEARANCE - 1e-9, `${distance} out at ${degrees} degrees: the camera is in the ground`);
      // The line is checked every half unit; between samples it may come a little closer.
      assert.ok(smallestGap(x, height, z) > 0.7, `${distance} out at ${degrees} degrees: a hill hides the trees`);
    }
  }
  // The phone camera (4.8 high, 55 out) is inside a hill at some angles: the hills are really there.
  assert.ok(lifted > 50, `${lifted} positions needed lifting`);
});

test('a camera lifted above the ground keeps its distance and ends where the ground is clear', () => {
  let moved = 0;
  // Every 7 degrees, and 307 degrees 80 out, where one lift leaves the camera 0.00006 short of clear.
  const places = [[80, 307]];
  for (const distance of [17.8, 40, 55, 80]) for (let degrees = 0; degrees < 360; degrees += 7) places.push([distance, degrees]);
  for (const [distance, degrees] of places) {
    const angle = (degrees * Math.PI) / 180;
    const camera = { x: distance * Math.sin(angle), y: 4.8, z: distance * Math.cos(angle) };
    const lifted = liftAboveGround(target, camera);
    const before = Math.hypot(camera.x, camera.y - target.y, camera.z);
    const after = Math.hypot(lifted.x, lifted.y - target.y, lifted.z);
    assert.ok(Math.abs(after - before) < 1e-9, `${distance} out at ${degrees} degrees: the distance changed`);
    assert.ok(lifted.y >= lowestClearHeight(target, lifted.x, lifted.z) - 1e-9, `${distance} out at ${degrees} degrees: not clear where it ended`);
    if (lifted.y !== camera.y) moved++;
    else assert.deepEqual(lifted, camera, 'a camera that sees the trees is left where it is');
  }
  assert.ok(moved > 30, `${moved} cameras lifted`);
});
