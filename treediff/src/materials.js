// Shared three.js materials, geometry and textures for trees and the meadow,
// plus the wind-sway shader patch that every swaying thing uses.

import * as THREE from 'three';
import { LEAF_ROWS, LEAF_CURL, leafHalfWidth, BLOSSOM_RADIUS, BLOSSOM_RISE } from './skeleton.js';

export const wind = {
  uTime: { value: 0 },
  uWind: { value: 1 },
};

// Branches, leaves and blossoms all sway with the same function of
// (anchor point, flex), so a leaf moves exactly with the twig it hangs on.
const SWAY_FUNCTIONS = /* glsl */ `
uniform float uTime;
uniform float uWind;
#ifndef SWAY_GRASS
attribute vec4 aAnchor;
#endif
vec3 swayOffset(vec3 anchor, float flex) {
  float phase = anchor.x * 0.35 + anchor.z * 0.25;
  float gust = 0.65 + 0.35 * sin(uTime * 0.37 + anchor.x * 0.05);
  float sx = sin(uTime * 1.1 + phase) * 0.6 + sin(uTime * 2.3 + phase * 1.7) * 0.25;
  float sz = cos(uTime * 0.9 + phase * 1.3) * 0.35;
  return vec3(sx + 0.35, -abs(sx) * 0.12, sz) * flex * uWind * gust * 0.16;
}
`;

const PROJECT_WITH_SWAY = /* glsl */ `
vec3 swayed = transformed;
#ifdef SWAY_FLUTTER
  // Leaves and petals flutter around their stalk, more at the tip.
  swayed.z += sin(uTime * 7.0 + aAnchor.x * 13.0 + aAnchor.y * 7.0) * 0.12 * position.y * uWind;
#endif
vec4 mvPosition = vec4(swayed, 1.0);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
#ifdef SWAY_GRASS
  vec3 grassRoot = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  mvPosition.xyz += swayOffset(grassRoot, position.y * position.y * 2.2);
#else
  mvPosition.xyz += swayOffset(aAnchor.xyz, aAnchor.w);
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

// mode: 'branch' (no flutter), 'leaf' (flutter), or 'grass' (anchor from instance).
export function addSway(material, mode) {
  material.defines = material.defines || {};
  if (mode === 'leaf') material.defines.SWAY_FLUTTER = '';
  if (mode === 'grass') material.defines.SWAY_GRASS = '';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uWind = wind.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_FUNCTIONS}`)
      .replace('#include <project_vertex>', PROJECT_WITH_SWAY);
    if (mode === 'leaf') {
      // Thin leaves let light through; a little self-glow in their own colour fakes it.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.16;',
      );
    }
  };
  material.customProgramCacheKey = () => `sway-${mode}`;
  return material;
}

// A matching depth material so shadows sway with the geometry that casts them.
export function swayingDepthMaterial(mode) {
  return addSway(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), mode);
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// Grey bark with vertical fissures; multiplied by the tree's bark colour.
function createBarkTexture() {
  const size = 256;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, size, size);
  // The texture repeats in both directions along a branch, so every mark is also
  // drawn shifted by one tile width and height; whatever crosses an edge reappears
  // on the opposite one.
  const tileOffsets = [[0, 0], [-size, 0], [0, -size], [-size, -size], [size, 0], [0, size], [size, size], [size, -size], [-size, size]];
  for (let i = 0; i < 2600; i++) {
    const shade = 150 + Math.random() * 105;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.35)`;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const w = 2 + Math.random() * 3;
    const h = 2 + Math.random() * 3;
    for (const [dx, dy] of tileOffsets.slice(0, 4)) ctx.fillRect(x + dx, y + dy, w, h);
  }
  // Fissures wander sideways as they run down the bark. The wander is a sum of sine
  // waves with whole periods per tile, so a fissure leaves the bottom edge exactly
  // where it entered the top one.
  for (let i = 0; i < 26; i++) {
    const startX = Math.random() * size;
    const waves = [1, 2, 3, 7, 11].map((periods) => ({
      periods,
      amplitude: (Math.random() * 9) / periods,
      phase: Math.random() * Math.PI * 2,
    }));
    const xAt = (y) => startX + waves.reduce((sum, wave) => sum + wave.amplitude * Math.sin((wave.periods * 2 * Math.PI * y) / size + wave.phase), 0);
    const width = 1.5 + Math.random() * 3.5;
    const dark = 60 + Math.random() * 60;
    ctx.strokeStyle = `rgba(${dark},${dark * 0.95},${dark * 0.9},0.85)`;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const [dx, dy] of tileOffsets) {
      ctx.moveTo(xAt(0) + dx, dy);
      for (let y = 4; y <= size; y += 4) ctx.lineTo(xAt(y) + dx, y + dy);
    }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// A soft round blob, used for contact shadows and pollen.
export function createRadialTexture(stops) {
  const size = 128;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Puffy cloud made from overlapping soft circles.
export function createCloudTexture(seed) {
  const width = 512;
  const height = 256;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  for (let i = 0; i < 26; i++) {
    const x = width * (0.18 + random() * 0.64);
    const y = height * (0.45 + random() * 0.25) - Math.sin(((x / width) * Math.PI)) * height * 0.12;
    const radius = 30 + random() * 70;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Leaf in the XY plane: stalk at the origin, tip at y = 1, folded along the midrib.
export function createLeafGeometry() {
  const rows = LEAF_ROWS;
  const positions = [];
  const colors = [];
  for (const y of rows) {
    const w = leafHalfWidth(y);
    const shade = 0.72 + 0.28 * y;
    // left edge, midrib, right edge
    positions.push(-w, y, w * LEAF_CURL, 0, y, 0, w, y, w * LEAF_CURL);
    colors.push(shade * 0.9, shade * 0.9, shade * 0.9, shade * 1.08, shade * 1.08, shade * 1.0, shade * 0.9, shade * 0.9, shade * 0.9);
  }
  const indices = [];
  for (let r = 0; r < rows.length - 1; r++) {
    const a = r * 3;
    const b = (r + 1) * 3;
    indices.push(a, a + 1, b + 1, a, b + 1, b, a + 1, a + 2, b + 2, a + 1, b + 2, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Five-petal flower in the XY plane, facing +Z, with a creamy centre.
export function createBlossomGeometry() {
  const positions = [0, 0, 0.05];
  const colors = [1, 0.85, 0.55];
  const indices = [];
  const petals = 5;
  for (let p = 0; p < petals; p++) {
    const angle = (p / petals) * Math.PI * 2;
    const base = positions.length / 3;
    for (const [radius, offset, lift] of [[0.55 * BLOSSOM_RADIUS, -0.42, 0.06], [BLOSSOM_RADIUS, 0, BLOSSOM_RISE], [0.55 * BLOSSOM_RADIUS, 0.42, 0.06]]) {
      positions.push(Math.cos(angle + offset) * radius, Math.sin(angle + offset) * radius, lift);
      colors.push(1, 1, 1);
    }
    indices.push(0, base, base + 1, 0, base + 1, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

let shared = null;

// Created lazily because textures need a document.
export function treeMaterials() {
  if (shared) return shared;
  const barkTexture = createBarkTexture();
  shared = {
    bark: addSway(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: barkTexture,
        bumpMap: barkTexture,
        bumpScale: 2.5,
        roughness: 0.92,
        metalness: 0,
      }),
      'branch',
    ),
    barkDepth: swayingDepthMaterial('branch'),
    leaf: addSway(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        shadowSide: THREE.DoubleSide,
        roughness: 0.68,
        metalness: 0,
      }),
      'leaf',
    ),
    leafDepth: swayingDepthMaterial('leaf'),
    blossom: addSway(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 0.55,
        emissive: new THREE.Color('#ffe8ef'),
        emissiveIntensity: 0.12,
      }),
      'leaf',
    ),
    blossomDepth: swayingDepthMaterial('leaf'),
    leafGeometry: createLeafGeometry(),
    blossomGeometry: createBlossomGeometry(),
    contactShadow: createRadialTexture([
      [0, 'rgba(20,24,10,0.55)'],
      [0.5, 'rgba(20,24,10,0.25)'],
      [1, 'rgba(20,24,10,0)'],
    ]),
  };
  return shared;
}

// Colour values in skeleton.js are sRGB; three.js works in linear light.
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
