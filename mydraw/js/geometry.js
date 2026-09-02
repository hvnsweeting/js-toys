/**
 * Geometry - Pure functions for Euclidean distance and line interpolation.
 */
(function (global) {
  'use strict';

  /**
   * Calculate Euclidean distance between two points (x1, y1) and (x2, y2).
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @returns {number}
   */
  function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.hypot(dx, dy);
  }

  /**
   * Interpolate points between two coordinates, spaced by at most `spacing` pixels.
   * Returns array of {x, y} points starting with (x1, y1).
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @param {number} spacing
   * @returns {Array<{x: number, y: number}>}
   */
  function interpolatePoints(x1, y1, x2, y2, spacing) {
    const safeSpacing = (typeof spacing === 'number' && spacing > 0) ? spacing : 1;
    const dist = distance(x1, y1, x2, y2);

    if (dist < safeSpacing) {
      return [{ x: x1, y: y1 }];
    }

    const steps = Math.ceil(dist / safeSpacing);
    const points = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({
        x: x1 + (x2 - x1) * t,
        y: y1 + (y2 - y1) * t,
      });
    }

    return points;
  }

  // Export functions to global scope / CommonJS
  global.distance = distance;
  global.interpolatePoints = interpolatePoints;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { distance, interpolatePoints };
  }
})(typeof window !== 'undefined' ? window : globalThis);
