/**
 * Tests for geometry.js
 */
describe('geometry: distance', () => {
  it('returns 0 for the same point', () => {
    assertEqual(distance(0, 0, 0, 0), 0);
    assertEqual(distance(42, 99, 42, 99), 0);
  });

  it('calculates 3-4-5 right triangle distance correctly', () => {
    assertApprox(distance(0, 0, 3, 4), 5);
    assertApprox(distance(1, 1, 4, 5), 5);
  });

  it('handles negative coordinates correctly', () => {
    assertApprox(distance(-2, -3, 1, 1), 5);
  });

  it('calculates horizontal and vertical distances', () => {
    assertEqual(distance(10, 20, 10, 50), 30);
    assertEqual(distance(10, 20, 60, 20), 50);
  });
});

describe('geometry: interpolatePoints', () => {
  it('returns single point when start and end are identical', () => {
    const points = interpolatePoints(10, 20, 10, 20, 5);
    assertEqual(points.length, 1);
    assertEqual(points[0].x, 10);
    assertEqual(points[0].y, 20);
  });

  it('returns single point when distance is less than spacing (adjacent)', () => {
    const points = interpolatePoints(10, 20, 11, 21, 5);
    assertEqual(points.length, 1);
    assertEqual(points[0].x, 10);
    assertEqual(points[0].y, 20);
  });

  it('always includes the starting point as the first element', () => {
    const points = interpolatePoints(5, 15, 100, 115, 10);
    assertTrue(points.length > 1);
    assertApprox(points[0].x, 5);
    assertApprox(points[0].y, 15);
  });

  it('fills the gap between distant points with step size <= spacing', () => {
    const points = interpolatePoints(0, 0, 0, 20, 5);
    // 0, 5, 10, 15, 20 -> 5 points
    assertEqual(points.length, 5);
    assertEqual(points[0], { x: 0, y: 0 });
    assertEqual(points[1], { x: 0, y: 5 });
    assertEqual(points[2], { x: 0, y: 10 });
    assertEqual(points[3], { x: 0, y: 15 });
    assertEqual(points[4], { x: 0, y: 20 });

    for (let i = 1; i < points.length; i++) {
      const stepDist = distance(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
      assertTrue(stepDist <= 5.001, `Step distance ${stepDist} should be <= spacing (5)`);
    }
  });

  it('handles diagonal interpolation evenly', () => {
    const points = interpolatePoints(0, 0, 30, 40, 10); // dist = 50, steps = 5 -> 6 points
    assertEqual(points.length, 6);
    assertApprox(points[0].x, 0);
    assertApprox(points[0].y, 0);
    assertApprox(points[points.length - 1].x, 30);
    assertApprox(points[points.length - 1].y, 40);

    for (let i = 1; i < points.length; i++) {
      const stepDist = distance(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
      assertTrue(stepDist <= 10.001, `Step distance ${stepDist} should be <= spacing (10)`);
    }
  });

  it('handles invalid or non-positive spacing safely', () => {
    const points = interpolatePoints(0, 0, 10, 0, 0);
    assertTrue(points.length >= 2, 'Should fallback to default spacing and interpolate');
  });
});
