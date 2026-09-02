/**
 * ColorBridge - Pure functional adapter around Spectral.js for pixel-level canvas blending.
 */
(function (global) {
  'use strict';

  /**
   * Convert RGB values (0-255) to hex string format #RRGGBB.
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @returns {string} Hex string in uppercase #RRGGBB
   */
  function rgbToHex(r, g, b) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const toHex = (v) => clamp(v).toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  /**
   * Convert hex string (#RGB, #RRGGBB, RGB, or RRGGBB) to [r, g, b] array (0-255).
   * @param {string} hex
   * @returns {[number, number, number]}
   */
  function hexToRgb(hex) {
    let clean = hex.replace(/^#/, '').trim();
    if (clean.length === 3) {
      clean = clean.split('').map((c) => c + c).join('');
    }
    const num = parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return [r, g, b];
  }

  /**
   * Mix two RGBA pixel colors using Spectral.js Kubelka-Munk subtractive color mixing.
   * @param {[number, number, number, number]} rgba1 - Base pixel [r, g, b, a]
   * @param {[number, number, number, number]} rgba2 - Incoming brush pixel [r, g, b, a]
   * @param {number} ratio - Mix factor (0 = all rgba1, 1 = all rgba2)
   * @returns {[number, number, number, number]} Mixed pixel [r, g, b, a]
   */
  function mixPixelColors(rgba1, rgba2, ratio) {
    const r = Math.max(0, Math.min(1, ratio));

    // Handle trivial ratios
    if (r === 0) return [rgba1[0], rgba1[1], rgba1[2], rgba1[3]];
    if (r === 1) return [rgba2[0], rgba2[1], rgba2[2], rgba2[3]];

    const a1 = rgba1[3] ?? 255;
    const a2 = rgba2[3] ?? 255;

    // Handle transparent pixels
    if (a1 === 0 && a2 === 0) return [0, 0, 0, 0];
    if (a1 === 0) return [rgba2[0], rgba2[1], rgba2[2], a2];
    if (a2 === 0) return [rgba1[0], rgba1[1], rgba1[2], a1];

    const hex1 = rgbToHex(rgba1[0], rgba1[1], rgba1[2]);
    const hex2 = rgbToHex(rgba2[0], rgba2[1], rgba2[2]);

    const outA = Math.round(a1 * (1 - r) + a2 * r);

    // If colors are identical, no need for spectral computation
    if (hex1 === hex2) {
      return [rgba1[0], rgba1[1], rgba1[2], outA];
    }

    // Use Spectral.js
    const spectralLib = global.spectral || (typeof spectral !== 'undefined' ? spectral : null);
    if (!spectralLib || !spectralLib.Color || !spectralLib.mix) {
      // Fallback linear mix if spectral is somehow not loaded
      return [
        Math.round(rgba1[0] * (1 - r) + rgba2[0] * r),
        Math.round(rgba1[1] * (1 - r) + rgba2[1] * r),
        Math.round(rgba1[2] * (1 - r) + rgba2[2] * r),
        outA,
      ];
    }

    const c1 = new spectralLib.Color(hex1);
    const c2 = new spectralLib.Color(hex2);
    const mixed = spectralLib.mix([c1, 1 - r], [c2, r]);
    const mixedRgb = hexToRgb(mixed.toString());

    return [mixedRgb[0], mixedRgb[1], mixedRgb[2], outA];
  }

  // Export functions to global scope / CommonJS
  global.rgbToHex = rgbToHex;
  global.hexToRgb = hexToRgb;
  global.mixPixelColors = mixPixelColors;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { rgbToHex, hexToRgb, mixPixelColors };
  }
})(typeof window !== 'undefined' ? window : globalThis);
