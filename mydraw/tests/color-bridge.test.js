/**
 * Tests for color-bridge.js
 */
describe('color-bridge: rgbToHex', () => {
  it('converts black [0, 0, 0] to #000000', () => {
    assertEqual(rgbToHex(0, 0, 0), '#000000');
  });

  it('converts white [255, 255, 255] to #FFFFFF', () => {
    assertEqual(rgbToHex(255, 255, 255), '#FFFFFF');
  });

  it('converts red [255, 0, 0] to #FF0000', () => {
    assertEqual(rgbToHex(255, 0, 0), '#FF0000');
  });

  it('pads single-digit hex values correctly (e.g. 5, 10, 15 -> #050A0F)', () => {
    assertEqual(rgbToHex(5, 10, 15), '#050A0F');
  });

  it('clamps and rounds out-of-range or float values', () => {
    assertEqual(rgbToHex(255.4, -5, 300), '#FF00FF');
  });
});

describe('color-bridge: hexToRgb', () => {
  it('converts #000000 to [0, 0, 0]', () => {
    assertEqual(hexToRgb('#000000'), [0, 0, 0]);
  });

  it('converts #FFFFFF to [255, 255, 255]', () => {
    assertEqual(hexToRgb('#FFFFFF'), [255, 255, 255]);
  });

  it('handles lowercase and hex without hash', () => {
    assertEqual(hexToRgb('#ff00aa'), [255, 0, 170]);
    assertEqual(hexToRgb('00ff00'), [0, 255, 0]);
  });

  it('round-trips with rgbToHex correctly', () => {
    const originalHex = '#3D933E';
    const rgb = hexToRgb(originalHex);
    assertEqual(rgbToHex(...rgb), originalHex);

    const originalRgb = [42, 128, 200];
    const hex = rgbToHex(...originalRgb);
    assertEqual(hexToRgb(hex), originalRgb);
  });
});

describe('color-bridge: mixPixelColors', () => {
  it('mixes blue and yellow to produce realistic green (G > R and G > B)', () => {
    const blue = [0, 0, 255, 255];
    const yellow = [255, 255, 0, 255];
    const mixed = mixPixelColors(blue, yellow, 0.5);

    assertTrue(mixed[1] > mixed[0], `Green channel (${mixed[1]}) should be > Red (${mixed[0]})`);
    assertTrue(mixed[1] > mixed[2], `Green channel (${mixed[1]}) should be > Blue (${mixed[2]})`);
    assertEqual(mixed[3], 255, 'Alpha should be 255');
  });

  it('returns first color when ratio is 0', () => {
    const c1 = [0, 0, 255, 255];
    const c2 = [255, 255, 0, 255];
    const mixed = mixPixelColors(c1, c2, 0);
    assertEqual(mixed, [0, 0, 255, 255]);
  });

  it('returns second color when ratio is 1', () => {
    const c1 = [0, 0, 255, 255];
    const c2 = [255, 255, 0, 255];
    const mixed = mixPixelColors(c1, c2, 1);
    assertEqual(mixed, [255, 255, 0, 255]);
  });

  it('mixing identical colors yields the same color', () => {
    const c = [120, 80, 40, 255];
    const mixed = mixPixelColors(c, c, 0.5);
    assertEqual(mixed, [120, 80, 40, 255]);
  });

  it('mixes red and blue to produce purple/violet', () => {
    const red = [255, 0, 0, 255];
    const blue = [0, 0, 255, 255];
    const mixed = mixPixelColors(red, blue, 0.5);
    assertTrue(mixed[0] > 0, 'Red component should be > 0');
    assertTrue(mixed[2] > 0, 'Blue component should be > 0');
    assertEqual(mixed[3], 255, 'Alpha should be 255');
  });

  it('handles transparent base pixel by adopting incoming color', () => {
    const transparent = [0, 0, 0, 0];
    const red = [255, 0, 0, 255];
    const mixed = mixPixelColors(transparent, red, 0.3);
    assertEqual(mixed, [255, 0, 0, 255]);
  });

  it('handles transparent incoming pixel by keeping base color', () => {
    const blue = [0, 0, 255, 255];
    const transparent = [0, 0, 0, 0];
    const mixed = mixPixelColors(blue, transparent, 0.3);
    assertEqual(mixed, [0, 0, 255, 255]);
  });

  it('interpolates alpha channel for semi-transparent colors', () => {
    const semi1 = [255, 0, 0, 100];
    const semi2 = [0, 0, 255, 200];
    const mixed = mixPixelColors(semi1, semi2, 0.5);
    assertEqual(mixed[3], 150, 'Alpha should be interpolated');
  });
});
