/**
 * DrawingEngine - Imperative canvas drawing shell with Spectral subtractive mixing.
 */
(function (global) {
  'use strict';

  /**
   * Create an instance of the drawing engine bound to an HTML5 Canvas.
   * @param {HTMLCanvasElement} canvas
   * @returns {Object} Drawing engine API { drawDot, drawStroke, clear, getContext }
   */
  function createDrawingEngine(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new Error('createDrawingEngine requires a valid HTMLCanvasElement');
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    /**
     * Normalize color input to RGBA array [r, g, b, a].
     * @param {string|number[]} color
     * @returns {[number, number, number, number]}
     */
    function normalizeColor(color) {
      if (Array.isArray(color)) {
        return [
          color[0] ?? 0,
          color[1] ?? 0,
          color[2] ?? 0,
          color[3] ?? 255,
        ];
      }
      if (typeof color === 'string') {
        const rgb = hexToRgb(color);
        return [rgb[0], rgb[1], rgb[2], 255];
      }
      return [0, 0, 0, 255];
    }

    /**
     * Paint a single circular dot at (x, y) with spectral color mixing.
     * @param {number} x - Center X
     * @param {number} y - Center Y
     * @param {string|number[]} brushColor - Hex string or RGBA array
     * @param {number} brushSize - Diameter of brush in pixels
     * @param {number} [mixRatio=0.3] - Ratio for Spectral mixing
     */
    function drawDot(x, y, brushColor, brushSize, mixRatio = 0.3) {
      const radius = brushSize / 2;
      const left = Math.max(0, Math.floor(x - radius));
      const top = Math.max(0, Math.floor(y - radius));
      const right = Math.min(canvas.width, Math.ceil(x + radius));
      const bottom = Math.min(canvas.height, Math.ceil(y + radius));

      const width = right - left;
      const height = bottom - top;

      if (width <= 0 || height <= 0) return;

      const brushRgba = normalizeColor(brushColor);
      const imgData = ctx.getImageData(left, top, width, height);
      const data = imgData.data;
      const rSq = radius * radius;

      for (let py = 0; py < height; py++) {
        const canvasY = top + py;
        const dy = canvasY - y;
        const dySq = dy * dy;

        for (let px = 0; px < width; px++) {
          const canvasX = left + px;
          const dx = canvasX - x;

          if (dx * dx + dySq <= rSq) {
            const idx = (py * width + px) * 4;
            const existingA = data[idx + 3];

            if (existingA > 0) {
              const existingRgba = [data[idx], data[idx + 1], data[idx + 2], existingA];
              const mixed = mixPixelColors(existingRgba, brushRgba, mixRatio);
              data[idx] = mixed[0];
              data[idx + 1] = mixed[1];
              data[idx + 2] = mixed[2];
              data[idx + 3] = mixed[3];
            } else {
              data[idx] = brushRgba[0];
              data[idx + 1] = brushRgba[1];
              data[idx + 2] = brushRgba[2];
              data[idx + 3] = brushRgba[3];
            }
          }
        }
      }

      ctx.putImageData(imgData, left, top);
    }

    /**
     * Draw a smooth continuous stroke from (x1, y1) to (x2, y2).
     * @param {number} x1 - Start X
     * @param {number} y1 - Start Y
     * @param {number} x2 - End X
     * @param {number} y2 - End Y
     * @param {string|number[]} brushColor - Hex string or RGBA array
     * @param {number} brushSize - Diameter of brush in pixels
     * @param {number} [mixRatio=0.3] - Ratio for Spectral mixing
     */
    function drawStroke(x1, y1, x2, y2, brushColor, brushSize, mixRatio = 0.3) {
      const spacing = Math.max(1, brushSize / 4);
      const points = interpolatePoints(x1, y1, x2, y2, spacing);
      for (let i = 0; i < points.length; i++) {
        drawDot(points[i].x, points[i].y, brushColor, brushSize, mixRatio);
      }
    }

    /**
     * Erase a circular area at (x, y).
     * @param {number} x - Center X
     * @param {number} y - Center Y
     * @param {number} brushSize - Diameter of eraser in pixels
     */
    function eraseDot(x, y, brushSize) {
      const radius = brushSize / 2;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /**
     * Erase along a continuous stroke from (x1, y1) to (x2, y2).
     * @param {number} x1 - Start X
     * @param {number} y1 - Start Y
     * @param {number} x2 - End X
     * @param {number} y2 - End Y
     * @param {number} brushSize - Diameter of eraser in pixels
     */
    function eraseStroke(x1, y1, x2, y2, brushSize) {
      const spacing = Math.max(1, brushSize / 4);
      const points = interpolatePoints(x1, y1, x2, y2, spacing);
      for (let i = 0; i < points.length; i++) {
        eraseDot(points[i].x, points[i].y, brushSize);
      }
    }

    /**
     * Clear the entire canvas.
     */
    function clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    return {
      drawDot,
      drawStroke,
      eraseDot,
      eraseStroke,
      clear,
      getContext: () => ctx,
    };
  }

  // Export to global scope / CommonJS
  global.createDrawingEngine = createDrawingEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createDrawingEngine };
  }
})(typeof window !== 'undefined' ? window : globalThis);
