// Procedural tree skeletons, independent of three.js.
//
// A tree is made in two stages:
//   createSpecies(seed)  decides the topology: how many branches, where each one
//                        sits on its parent, where every leaf and blossom goes.
//                        Only the seed is used here.
//   growTree(...)        turns that plan into geometry for a given set of genes and
//                        a growth stage. Genes only bend, stretch, thicken and colour
//                        the plan, never add or remove a branch.
//
// Because topology never depends on genes, any gene can be changed continuously and
// the tree morphs smoothly. The reveal animation and the growth animation rely on this.

import { mulberry32, between, clamp, lerp, smoothstep } from './random.js';

const GOLDEN_ANGLE = 2.39996;
const LEAVES_PER_TIP = 10;
const LEAVES_PER_TWIG = 4;
const BLOSSOMS_PER_TIP = 2;
// Branches never dip lower than this; weeping branches run along just above the grass.
export const GROUND_CLEARANCE = 0.08;
// No part of a leaf or blossom of the still tree goes lower than this. The wind (materials.js)
// moves leaves on screen a little further: down by up to about 0.04 on the most flexible twigs,
// so a weeping leaf can touch the grass (0.003 above the ground at the lowest found).
export const LOWEST_FOLIAGE_Y = GROUND_CLEARANCE / 2;

// The leaf blade's shape, shared with materials.js, which builds the leaf mesh from
// it: rows along the midrib (0 at the stem, 1 at the tip), the half-width at each
// row, and how far the edges curl up, as a share of the half-width.
export const LEAF_ROWS = [0, 0.2, 0.45, 0.7, 0.88, 1];
export const LEAF_CURL = 0.07 / 0.3;
export function leafHalfWidth(y) {
  return 0.3 * Math.pow(Math.sin(Math.PI * y), 0.75);
}

// The blossom's shape, shared the same way: five petals of this radius in the
// blossom's plane, raised at most this far along its facing direction.
export const BLOSSOM_RADIUS = 1;
export const BLOSSOM_RISE = 0.18;

function stepsForDepth(depth) {
  if (depth === 0) return 8;
  if (depth === 1) return 6;
  if (depth === 2) return 4;
  return 3;
}

export function createSpecies(seed) {
  const rng = mulberry32(seed);
  const maxDepth = rng() < 0.45 ? 4 : 5;
  const species = {
    seed,
    maxDepth,
    trunkTilt: [between(rng, -0.07, 0.07), between(rng, -0.07, 0.07)],
    leafHueShift: between(rng, -10, 10),
    blossomHue: between(rng, 322, 356),
    barkWarmth: between(rng, -0.03, 0.03),
    branches: [],
    leaves: [],
    blossoms: [],
    pointCount: 0,
  };

  function addFoliage(plan) {
    const isTwig = plan.depth >= maxDepth - 1;
    if (!isTwig) return;
    const leafCount = plan.isTip ? LEAVES_PER_TIP : LEAVES_PER_TWIG;
    for (let i = 0; i < leafCount; i++) {
      species.leaves.push({
        branch: plan.index,
        t: between(rng, 0.2, 1),
        azimuth: rng() * Math.PI * 2,
        lift: between(rng, -0.3, 0.5),
        twist: between(rng, -0.7, 0.7),
        size: between(rng, 0.75, 1.2),
        threshold: rng(),
        hueJitter: rng() * 2 - 1,
        lightJitter: rng() * 2 - 1,
        appear: between(rng, 0.72, 0.9),
      });
    }
    if (!plan.isTip) return;
    for (let i = 0; i < BLOSSOMS_PER_TIP; i++) {
      species.blossoms.push({
        branch: plan.index,
        t: between(rng, 0.65, 1),
        azimuth: rng() * Math.PI * 2,
        size: between(rng, 0.8, 1.25),
        threshold: rng(),
        tint: rng(),
        appear: between(rng, 0.8, 0.92),
      });
    }
  }

  // Depth-first, so every parent is in the list before its children and growTree
  // can build the whole tree in one forward pass.
  function addBranch(parent, depth, t, azimuth, isApical) {
    const steps = stepsForDepth(depth);
    const wiggle = new Float32Array(steps * 3);
    for (let i = 0; i < wiggle.length; i++) wiggle[i] = rng() * 2 - 1;
    const plan = {
      index: species.branches.length,
      parent,
      depth,
      t,
      azimuth,
      isApical,
      isTip: depth === maxDepth,
      steps,
      pointOffset: species.pointCount,
      angleJitter: between(rng, 0.75, 1.2),
      lengthJitter: between(rng, 0.82, 1.15),
      radiusJitter: between(rng, 0.9, 1.1),
      wiggle,
    };
    species.branches.push(plan);
    species.pointCount += steps + 1;
    addFoliage(plan);
    if (plan.isTip) return;

    const lateralCount = depth === 0 ? 3 + Math.floor(rng() * 3) : rng() < 0.3 ? 3 : 2;
    const lowest = depth === 0 ? 0.35 : 0.25;
    let childAzimuth = rng() * Math.PI * 2;
    for (let i = 0; i < lateralCount; i++) {
      const childT = lerp(lowest, 0.92, (i + 0.2 + rng() * 0.6) / lateralCount);
      childAzimuth += GOLDEN_ANGLE + (rng() - 0.5) * 0.7;
      addBranch(plan.index, depth + 1, childT, childAzimuth, false);
    }
    // The apical child continues the parent's line, like a leader shoot.
    addBranch(plan.index, depth + 1, 1, rng() * Math.PI * 2, true);
  }

  addBranch(-1, 0, 0, 0, false);

  // Sorting by threshold means "the visible leaves" is always a prefix of the list,
  // so the renderer can draw the first N instances and skip the rest.
  species.leaves.sort((a, b) => a.threshold - b.threshold);
  species.blossoms.sort((a, b) => a.threshold - b.threshold);
  return species;
}

// Gene values in [0, 1] mapped to physical quantities (world units are roughly metres).
export function mapGenes(genes) {
  return {
    trunkLength: lerp(1.5, 3.3, genes.height),
    spreadAngle: lerp(0.28, 1.25, genes.spread),
    droop: lerp(-0.5, 1.7, genes.weeping),
    reach: lerp(0.55, 0.9, genes.reach),
    trunkRadius: lerp(0.08, 0.3, genes.girth),
    gnarl: lerp(0.04, 1.1, genes.gnarl),
    lean: lerp(0, 1.0, genes.lean),
    leafDensity: lerp(0.12, 1, genes.lushness),
    leafSize: lerp(0.08, 0.24, genes.leafSize),
    autumn: genes.autumn,
    blossomDensity: genes.blossom,
    barkLightness: genes.bark,
  };
}

// Marks `index` and every branch that grows from it (parents come before children in the list).
export function branchSubtree(species, index) {
  const mask = new Uint8Array(species.branches.length);
  for (const plan of species.branches) mask[plan.index] = plan.index === index || (plan.parent >= 0 && mask[plan.parent]) ? 1 : 0;
  return mask;
}

export const TINT_AUTUMN = 1;
export const TINT_BLOSSOM = 2;

// Turns a description of changes to one tree into the masks growTree uses:
//   { omit: [branch, ...], tints: [{ branch, kind: 'autumn' | 'blossom' }, ...] }
// An omitted branch and everything on it is left out; a tinted bough has its leaves coloured
// like autumn leaves or like blossom. Everything else about the tree stays as it was.
export function prepareEdit(species, spec) {
  const omit = new Uint8Array(species.branches.length);
  const tint = new Uint8Array(species.branches.length);
  for (const branch of spec?.omit ?? []) {
    const mask = branchSubtree(species, branch);
    for (let b = 0; b < mask.length; b++) if (mask[b]) omit[b] = 1;
  }
  for (const { branch, kind } of spec?.tints ?? []) {
    const mask = branchSubtree(species, branch);
    for (let b = 0; b < mask.length; b++) if (mask[b]) tint[b] = kind === 'autumn' ? TINT_AUTUMN : TINT_BLOSSOM;
  }
  return { omit, tint };
}

export function createTreeData(species) {
  return {
    branchCount: species.branches.length,
    pointCount: species.pointCount,
    positions: new Float32Array(species.pointCount * 3),
    tangents: new Float32Array(species.pointCount * 3),
    normals: new Float32Array(species.pointCount * 3),
    radii: new Float32Array(species.pointCount),
    flex: new Float32Array(species.pointCount),
    // Working storage for the unscaled sizes, kept here to avoid per-frame allocation.
    fullRadii: new Float32Array(species.pointCount),
    distances: new Float32Array(species.pointCount),
    fullLengths: new Float32Array(species.branches.length),
    leafCount: 0,
    leafMatrices: new Float32Array(species.leaves.length * 16),
    leafAnchors: new Float32Array(species.leaves.length * 4),
    leafColors: new Float32Array(species.leaves.length * 3),
    blossomCount: 0,
    blossomMatrices: new Float32Array(species.blossoms.length * 16),
    blossomAnchors: new Float32Array(species.blossoms.length * 4),
    blossomColors: new Float32Array(species.blossoms.length * 3),
    barkColor: [0, 0, 0],
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
  };
}

// Reusable scratch vectors for sampling. growTree is synchronous, so sharing is safe.
const sample = {
  position: [0, 0, 0],
  tangent: [0, 0, 0],
  normal: [0, 0, 0],
  binormal: [0, 0, 0],
  radius: 0,
  fullRadius: 0,
  distance: 0,
  flex: 0,
};

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= length;
  v[1] /= length;
  v[2] /= length;
  return v;
}

function cross(a, b, out) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

// Interpolates position, frame and size at fraction t along an already-grown branch.
function sampleBranch(data, plan, t) {
  const f = t * plan.steps;
  const i0 = Math.min(Math.floor(f), plan.steps - 1);
  const frac = f - i0;
  const a = plan.pointOffset + i0;
  const b = a + 1;
  for (let c = 0; c < 3; c++) {
    sample.position[c] = lerp(data.positions[a * 3 + c], data.positions[b * 3 + c], frac);
    sample.tangent[c] = lerp(data.tangents[a * 3 + c], data.tangents[b * 3 + c], frac);
    sample.normal[c] = lerp(data.normals[a * 3 + c], data.normals[b * 3 + c], frac);
  }
  normalize(sample.tangent);
  // Re-orthogonalize the interpolated normal against the interpolated tangent.
  const along = sample.normal[0] * sample.tangent[0] + sample.normal[1] * sample.tangent[1] + sample.normal[2] * sample.tangent[2];
  for (let c = 0; c < 3; c++) sample.normal[c] -= sample.tangent[c] * along;
  normalize(sample.normal);
  cross(sample.tangent, sample.normal, sample.binormal);
  sample.radius = lerp(data.radii[a], data.radii[b], frac);
  sample.fullRadius = lerp(data.fullRadii[a], data.fullRadii[b], frac);
  sample.distance = lerp(data.distances[a], data.distances[b], frac);
  sample.flex = lerp(data.flex[a], data.flex[b], frac);
  return sample;
}

function hslToRgb(hueDegrees, saturation, lightness, out, offset) {
  const h = (((hueDegrees % 360) + 360) % 360) / 360;
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  out[offset] = channel(h + 1 / 3);
  out[offset + 1] = channel(h);
  out[offset + 2] = channel(h - 1 / 3);
}

// Leaf colour along the autumn gene: fresh green, gold, orange, crimson.
const AUTUMN_STOPS = [
  { at: 0.0, hue: 102, saturation: 0.5, lightness: 0.38 },
  { at: 0.35, hue: 78, saturation: 0.58, lightness: 0.42 },
  { at: 0.6, hue: 46, saturation: 0.78, lightness: 0.5 },
  { at: 0.8, hue: 24, saturation: 0.85, lightness: 0.5 },
  { at: 1.0, hue: -4, saturation: 0.75, lightness: 0.44 },
];

function autumnColor(u) {
  let i = 0;
  while (i < AUTUMN_STOPS.length - 2 && u > AUTUMN_STOPS[i + 1].at) i++;
  const from = AUTUMN_STOPS[i];
  const to = AUTUMN_STOPS[i + 1];
  const t = clamp((u - from.at) / (to.at - from.at), 0, 1);
  return {
    hue: lerp(from.hue, to.hue, t),
    saturation: lerp(from.saturation, to.saturation, t),
    lightness: lerp(from.lightness, to.lightness, t),
  };
}

// How far through its own growth a branch at this depth is, given the tree's growth.
function branchProgress(depth, maxDepth, growth) {
  const overlap = 1.6;
  return clamp((growth * (maxDepth + overlap) - depth) / overlap, 0, 1);
}

function writeMatrix(target, offset, xAxis, yAxis, zAxis, position, scale) {
  target[offset] = xAxis[0] * scale;
  target[offset + 1] = xAxis[1] * scale;
  target[offset + 2] = xAxis[2] * scale;
  target[offset + 3] = 0;
  target[offset + 4] = yAxis[0] * scale;
  target[offset + 5] = yAxis[1] * scale;
  target[offset + 6] = yAxis[2] * scale;
  target[offset + 7] = 0;
  target[offset + 8] = zAxis[0] * scale;
  target[offset + 9] = zAxis[1] * scale;
  target[offset + 10] = zAxis[2] * scale;
  target[offset + 11] = 0;
  target[offset + 12] = position[0];
  target[offset + 13] = position[1];
  target[offset + 14] = position[2];
  target[offset + 15] = 1;
}

function growBranches(species, g, growth, data, edit) {
  const growthEase = smoothstep(0, 1, growth);
  const flexReference = g.trunkLength * 2.8;
  const direction = [0, 0, 0];
  const frame = [0, 0, 0];
  const side = [0, 0, 0];

  for (const plan of species.branches) {
    let startX, startY, startZ, fullLength, fullRadius, startDistance;

    if (plan.parent < 0) {
      startX = 0;
      startY = 0;
      startZ = 0;
      direction[0] = species.trunkTilt[0];
      direction[1] = 1;
      direction[2] = species.trunkTilt[1];
      normalize(direction);
      frame[0] = 1;
      frame[1] = 0;
      frame[2] = 0;
      const along = frame[0] * direction[0];
      for (let c = 0; c < 3; c++) frame[c] -= direction[c] * along;
      normalize(frame);
      fullLength = g.trunkLength;
      fullRadius = g.trunkRadius;
      startDistance = 0;
    } else {
      const parent = species.branches[plan.parent];
      const at = sampleBranch(data, parent, plan.t);
      startX = at.position[0];
      startY = at.position[1];
      startZ = at.position[2];
      const angle = (plan.isApical ? g.spreadAngle * 0.18 : g.spreadAngle) * plan.angleJitter;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const cosZ = Math.cos(plan.azimuth);
      const sinZ = Math.sin(plan.azimuth);
      for (let c = 0; c < 3; c++) {
        // side: a direction perpendicular to the parent, chosen by azimuth.
        side[c] = at.normal[c] * cosZ + at.binormal[c] * sinZ;
        direction[c] = at.tangent[c] * cosA + side[c] * sinA;
        // The child's frame starts perpendicular to its own direction, in the same plane.
        frame[c] = side[c] * cosA - at.tangent[c] * sinA;
      }
      const lengthShape = plan.isApical ? 0.92 : lerp(1.05, 0.62, plan.t);
      fullLength = data.fullLengths[parent.index] * g.reach * plan.lengthJitter * lengthShape;
      fullRadius = at.fullRadius * (plan.isApical ? 0.8 : 0.62) * plan.radiusJitter;
      startDistance = at.distance;
    }

    data.fullLengths[plan.index] = fullLength;
    const progress = smoothstep(0, 1, branchProgress(plan.depth, species.maxDepth, growth));
    const radiusScale = lerp(0.25, 1, growthEase) * Math.min(1, progress * 2);
    const stepLength = (fullLength * progress) / plan.steps;
    const tipTaper = plan.isTip ? 0.3 : 0.62;
    const depthShare = 1 / (species.maxDepth + 1);

    let x = startX;
    let y = startY;
    let z = startZ;
    let distance = startDistance;
    for (let i = 0; i <= plan.steps; i++) {
      if (i > 0) {
        // Bend the direction a little at each step: crookedness, gravity, wind.
        const along = i / plan.steps;
        const flexAmount = (plan.depth + along) * depthShare;
        const w = (i - 1) * 3;
        const gnarlAmount = (g.gnarl * 1.6 * (0.4 + flexAmount)) / plan.steps;
        direction[0] += plan.wiggle[w] * gnarlAmount;
        direction[1] += plan.wiggle[w + 1] * gnarlAmount;
        direction[2] += plan.wiggle[w + 2] * gnarlAmount;
        direction[1] -= (g.droop * Math.pow(flexAmount, 1.3) * 2) / plan.steps;
        direction[0] += (g.lean * (0.3 + flexAmount)) / plan.steps;
        normalize(direction);

        x += direction[0] * stepLength;
        y += direction[1] * stepLength;
        z += direction[2] * stepLength;
        if (y < GROUND_CLEARANCE) {
          y = GROUND_CLEARANCE;
          if (direction[1] < 0) {
            direction[1] = 0;
            normalize(direction);
          }
        }
        distance += stepLength;

        // Parallel transport keeps the frame from twisting as the branch bends.
        const dot = frame[0] * direction[0] + frame[1] * direction[1] + frame[2] * direction[2];
        for (let c = 0; c < 3; c++) frame[c] -= direction[c] * dot;
        normalize(frame);
      }

      const k = plan.pointOffset + i;
      data.positions[k * 3] = x;
      data.positions[k * 3 + 1] = y;
      data.positions[k * 3 + 2] = z;
      data.tangents[k * 3] = direction[0];
      data.tangents[k * 3 + 1] = direction[1];
      data.tangents[k * 3 + 2] = direction[2];
      data.normals[k * 3] = frame[0];
      data.normals[k * 3 + 1] = frame[1];
      data.normals[k * 3 + 2] = frame[2];
      const pointFullRadius = fullRadius * lerp(1, tipTaper, i / plan.steps);
      data.fullRadii[k] = pointFullRadius;
      // A left-out branch is drawn with no thickness, so its tube collapses to a line.
      data.radii[k] = edit?.omit[plan.index] ? 0 : Math.max(0.004, pointFullRadius * radiusScale);
      data.distances[k] = distance;
      data.flex[k] = Math.min(1.4, Math.pow(distance / flexReference, 1.7));
    }
  }
}

// The leaf model is one unit long along its direction. Weeping curtains can reach
// the grass, so a leaf that would dip below the ground is tilted up just enough
// to keep its tip above it, keeping its compass direction.
function keepTipAboveGround(direction, baseY, length) {
  const neededY = (LOWEST_FOLIAGE_Y - baseY) / length;
  if (direction[1] >= neededY) return;
  const y = Math.min(1, neededY);
  let horizontal = Math.hypot(direction[0], direction[2]);
  if (horizontal < 1e-6) {
    direction[0] = 1;
    direction[2] = 0;
    horizontal = 1;
  }
  const keep = Math.sqrt(1 - y * y) / horizontal;
  direction[0] *= keep;
  direction[1] = y;
  direction[2] *= keep;
}

// Lowest height of the unit leaf's outline relative to its base, for the given axes.
function lowestLeafOffset(xAxis, yAxis, zAxis) {
  let lowest = 0;
  for (const y of LEAF_ROWS) {
    const w = leafHalfWidth(y);
    const centre = y * yAxis[1];
    const edgeCurl = w * LEAF_CURL * zAxis[1];
    const edgeSide = w * Math.abs(xAxis[1]);
    lowest = Math.min(lowest, centre, centre + edgeCurl - edgeSide);
  }
  return lowest;
}

// Lowest height a blossom can reach below its centre: the petals span a disc in
// the plane of xAxis and yAxis, raised at most BLOSSOM_RISE along normalAxis.
function lowestBlossomOffset(xAxis, yAxis, normalAxis) {
  const discDrop = BLOSSOM_RADIUS * Math.hypot(xAxis[1], yAxis[1]);
  const riseDrop = BLOSSOM_RISE * Math.max(0, -normalAxis[1]);
  return -(discDrop + riseDrop);
}

function growLeaves(species, g, growth, data, edit) {
  const leafDirection = [0, 0, 0];
  const xAxis = [0, 0, 0];
  const zAxis = [0, 0, 0];
  const twistedX = [0, 0, 0];
  const twistedZ = [0, 0, 0];
  const position = [0, 0, 0];
  const hangDown = Math.max(0, g.droop - 0.4) * 0.6;

  let count = 0;
  while (count < species.leaves.length && species.leaves[count].threshold < g.leafDensity) count++;
  data.leafCount = count;

  for (let k = 0; k < count; k++) {
    const leaf = species.leaves[k];
    const at = sampleBranch(data, species.branches[leaf.branch], leaf.t);
    const cosZ = Math.cos(leaf.azimuth);
    const sinZ = Math.sin(leaf.azimuth);
    for (let c = 0; c < 3; c++) {
      const side = at.normal[c] * cosZ + at.binormal[c] * sinZ;
      leafDirection[c] = at.tangent[c] * 0.55 + side;
      position[c] = at.position[c] + side * at.radius * 0.8;
    }
    leafDirection[1] += leaf.lift - hangDown;
    normalize(leafDirection);

    // Leaves near the density cut-off fade in by size instead of popping.
    const fade = clamp((g.leafDensity - leaf.threshold) / 0.05, 0, 1);
    const appear = smoothstep(leaf.appear, leaf.appear + 0.1, growth);
    const scale = edit?.omit[leaf.branch] ? 0 : g.leafSize * leaf.size * fade * appear;
    if (scale > 0) keepTipAboveGround(leafDirection, position[1], scale);

    cross(leafDirection, at.tangent, xAxis);
    if (Math.hypot(xAxis[0], xAxis[1], xAxis[2]) < 1e-4) {
      xAxis[0] = 1;
      xAxis[1] = 0;
      xAxis[2] = 0;
    }
    normalize(xAxis);
    cross(xAxis, leafDirection, zAxis);
    const cosT = Math.cos(leaf.twist);
    const sinT = Math.sin(leaf.twist);
    for (let c = 0; c < 3; c++) {
      twistedX[c] = xAxis[c] * cosT + zAxis[c] * sinT;
      twistedZ[c] = zAxis[c] * cosT - xAxis[c] * sinT;
    }

    // With the tip kept up, an edge of the blade can still dip below the ground;
    // lift the whole leaf by whatever is left. The lift is a few centimetres at most.
    const lowestY = position[1] + scale * lowestLeafOffset(twistedX, leafDirection, twistedZ);
    if (lowestY < LOWEST_FOLIAGE_Y) position[1] += LOWEST_FOLIAGE_Y - lowestY;

    writeMatrix(data.leafMatrices, k * 16, twistedX, leafDirection, twistedZ, position, scale);

    data.leafAnchors[k * 4] = position[0];
    data.leafAnchors[k * 4 + 1] = position[1];
    data.leafAnchors[k * 4 + 2] = position[2];
    data.leafAnchors[k * 4 + 3] = at.flex;

    const tint = edit?.tint[leaf.branch];
    if (tint === TINT_BLOSSOM) {
      hslToRgb(species.blossomHue, 0.5, 0.9 + leaf.lightJitter * 0.04, data.leafColors, k * 3);
      continue;
    }
    // An autumn bough is well into autumn whatever the rest of the tree is doing.
    const u = tint === TINT_AUTUMN ? clamp(0.88 + leaf.hueJitter * 0.1, 0, 1) : clamp(g.autumn + leaf.hueJitter * 0.16, 0, 1);
    const tone = autumnColor(u);
    const hue = tone.hue + species.leafHueShift * (1 - u);
    const lightness = clamp(tone.lightness + leaf.lightJitter * 0.06, 0.15, 0.8);
    hslToRgb(hue, tone.saturation, lightness, data.leafColors, k * 3);
  }
}

function growBlossoms(species, g, growth, data, edit) {
  const normalAxis = [0, 0, 0];
  const xAxis = [0, 0, 0];
  const yAxis = [0, 0, 0];
  const helper = [0, 1, 0];
  const blossomCentre = [0, 0, 0];

  let count = 0;
  while (count < species.blossoms.length && species.blossoms[count].threshold < g.blossomDensity) count++;
  data.blossomCount = count;

  for (let k = 0; k < count; k++) {
    const blossom = species.blossoms[k];
    const at = sampleBranch(data, species.branches[blossom.branch], blossom.t);
    const cosZ = Math.cos(blossom.azimuth);
    const sinZ = Math.sin(blossom.azimuth);
    for (let c = 0; c < 3; c++) {
      const side = at.normal[c] * cosZ + at.binormal[c] * sinZ;
      normalAxis[c] = at.tangent[c] * 0.4 + side * 0.6;
    }
    normalAxis[1] += 0.5;
    normalize(normalAxis);
    // Pick a helper axis that is not parallel to the blossom's facing direction.
    helper[0] = Math.abs(normalAxis[1]) > 0.9 ? 1 : 0;
    helper[1] = Math.abs(normalAxis[1]) > 0.9 ? 0 : 1;
    normalize(cross(helper, normalAxis, xAxis));
    cross(normalAxis, xAxis, yAxis);

    const fade = clamp((g.blossomDensity - blossom.threshold) / 0.05, 0, 1);
    const appear = smoothstep(blossom.appear, blossom.appear + 0.08, growth);
    const scale = edit?.omit[blossom.branch] ? 0 : 0.12 * blossom.size * fade * appear;
    // Blossoms on branches lying on the grass would sink their lower petals into it.
    blossomCentre[0] = at.position[0];
    blossomCentre[1] = Math.max(at.position[1], LOWEST_FOLIAGE_Y - scale * lowestBlossomOffset(xAxis, yAxis, normalAxis));
    blossomCentre[2] = at.position[2];
    writeMatrix(data.blossomMatrices, k * 16, xAxis, yAxis, normalAxis, blossomCentre, scale);

    data.blossomAnchors[k * 4] = blossomCentre[0];
    data.blossomAnchors[k * 4 + 1] = blossomCentre[1];
    data.blossomAnchors[k * 4 + 2] = blossomCentre[2];
    data.blossomAnchors[k * 4 + 3] = at.flex;

    const saturation = lerp(0.3, 0.8, blossom.tint);
    const lightness = lerp(0.92, 0.8, blossom.tint);
    hslToRgb(species.blossomHue, saturation, lightness, data.blossomColors, k * 3);
  }
}

// The bounds of the branch points and the leaves' bases, not of the leaf blades or blossoms,
// which reach a little further (at most 0.24 units past these bounds in a sample of 1000 trees).
// Camera framing adds margins larger than that (0.8 across, 0.9 up).
function measureBounds(species, data, edit) {
  const b = data.bounds;
  b.minX = b.minY = b.minZ = Infinity;
  b.maxX = b.maxY = b.maxZ = -Infinity;
  const include = (x, y, z) => {
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  };
  for (const plan of species.branches) {
    if (edit?.omit[plan.index]) continue;
    for (let k = plan.pointOffset; k <= plan.pointOffset + plan.steps; k++) {
      include(data.positions[k * 3], data.positions[k * 3 + 1], data.positions[k * 3 + 2]);
    }
  }
  for (let k = 0; k < data.leafCount; k++) {
    if (edit?.omit[species.leaves[k].branch]) continue;
    include(data.leafAnchors[k * 4], data.leafAnchors[k * 4 + 1], data.leafAnchors[k * 4 + 2]);
  }
}

// Builds the tree's geometry into `data` (allocated if omitted) and returns it.
// growth runs from 0 (bare ground) to 1 (fully grown, leaves out). `edit` comes from
// prepareEdit and changes single boughs; without it the tree is unchanged.
export function growTree(species, genes, growth = 1, data = createTreeData(species), edit = null) {
  const g = mapGenes(genes);
  growBranches(species, g, growth, data, edit);
  growLeaves(species, g, growth, data, edit);
  growBlossoms(species, g, growth, data, edit);

  const pale = g.barkLightness;
  data.barkColor[0] = lerp(0.25, 0.83, pale) + species.barkWarmth;
  data.barkColor[1] = lerp(0.17, 0.8, pale);
  data.barkColor[2] = lerp(0.12, 0.75, pale) - species.barkWarmth;

  measureBounds(species, data, edit);
  return data;
}
