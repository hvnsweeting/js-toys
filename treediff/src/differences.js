// What differs between the two trees of a pair, and where. A pair has DIFFERENCES of them, each
// of a different kind, each on one tree only. Objects (a bird, a nest, apples, a lantern) are
// added to one tree; boughs are changed on one tree (turned early to autumn, covered in
// blossom, or left out). Placement depends only on the pair's seed and traits, so it can be
// tested without a browser.

import { createSpecies, growTree, mapGenes, branchSubtree } from './skeleton.js';
import { mulberry32, shuffle, between, clamp } from './random.js';

export const DIFFERENCES = 3;
export const KINDS = ['bird', 'nest', 'fruit', 'lantern', 'blossomBough', 'autumnBough', 'missingBranch'];
export const LABELS = {
  bird: 'a bird',
  nest: 'a nest',
  fruit: 'a cluster of apples',
  lantern: 'a lantern',
  blossomBough: 'a bough in blossom',
  autumnBough: 'a bough that turned early',
  missingBranch: 'a missing branch',
};
// Two differences are never closer than this (world units): 1.5 on a large crown, less on a small one.
export function separationFor(crownRadius) {
  return clamp(0.5 * crownRadius, 0.9, 1.5);
}

const BOUGH_KINDS = new Set(['blossomBough', 'autumnBough', 'missingBranch']);
// Smallest branch (radius) that can carry an object, the radius within which a click finds it,
// and how far the drawn object reaches straight up from its centre past that radius (a lantern's
// thread: the top of its 0.3-high thread, 0.45 up, times the props' scale of 1.4; props.js).
const OBJECT_RULES = {
  bird: { minRadius: 0.008, flat: true, hit: 0.5, reachUp: 0 },
  nest: { minRadius: 0.01, flat: true, hit: 0.45, reachUp: 0 },
  fruit: { minRadius: 0.006, flat: false, hit: 0.45, reachUp: 0 },
  lantern: { minRadius: 0.006, flat: false, hit: 0.4, reachUp: 0.63 },
};
export const OBJECT_REACH_UP = Object.fromEntries(Object.entries(OBJECT_RULES).map(([kind, rules]) => [kind, rules.reachUp]));
// Objects sit on the outer part of the crown, where they can be seen from outside it.
const OUTER_SHARE = 0.5;
// A tree with an autumn trait above this already has turning leaves, so one early bough would not stand out.
const MOST_AUTUMN_FOR_AUTUMN_BOUGH = 0.4;
const BOUGH_DEPTH = 2;
const BOUGH_MIN_LEAVES = 90;

function describeTree(species, genes) {
  const data = growTree(species, genes, 1);
  const { bounds } = data;
  const crownRadius = Math.max(Math.abs(bounds.minX), bounds.maxX, Math.abs(bounds.minZ), bounds.maxZ);
  return { data, height: bounds.maxY, crownRadius, frontBack: [(bounds.minZ + bounds.maxZ) / 2, (bounds.maxZ - bounds.minZ) / 2] };
}

// How far a drawn leaf reaches from the middle of its blade, for a leaf of this length and flex.
// The leaf geometry (materials.js) runs one length from its base along its own y and is narrower
// than long; flutter moves the tip up to 0.12 lengths; the wind sway (swayOffset in materials.js,
// with uWind 1) moves the whole leaf up to 0.2 times its flex. So 0.5 + 0.12 lengths, plus a
// little for the blade's width, plus the sway, plus 0.05 to spare.
function leafReach(length, flex) {
  return 0.75 * length + 0.2 * flex + 0.05;
}

// Boughs a difference can change: depth-2 branches with enough leaves, each with the centre of
// its leaves, a click radius around that centre, and where its leaves are drawn (a click on one of
// them counts as aimed at the bough, since the radius does not reach the outermost ones; where
// another difference's area overlaps, the better-aimed one is found, see findDifferenceAt). Each
// leaf is [x, y, z, reach]: the middle of its blade and how far a click may pass from it.
function findBoughs(species, genes, tree) {
  const { data, crownRadius } = tree;
  const { leafDensity } = mapGenes(genes);
  const boughs = [];
  for (const plan of species.branches) {
    if (plan.depth !== BOUGH_DEPTH) continue;
    const mask = branchSubtree(species, plan.index);
    const centre = [0, 0, 0];
    const leaves = [];
    for (let k = 0; k < data.leafCount && species.leaves[k].threshold < leafDensity; k++) {
      if (!mask[species.leaves[k].branch]) continue;
      const anchor = [data.leafAnchors[k * 4], data.leafAnchors[k * 4 + 1], data.leafAnchors[k * 4 + 2]];
      for (let c = 0; c < 3; c++) centre[c] += anchor[c];
      // The leaf's own y axis (column 1 of its matrix) runs from its base to its tip.
      const m = data.leafMatrices.subarray(k * 16, k * 16 + 16);
      const length = Math.hypot(m[4], m[5], m[6]);
      const middle = [m[12] + 0.5 * m[4], m[13] + 0.5 * m[5], m[14] + 0.5 * m[6]];
      leaves.push([...middle, leafReach(length, data.leafAnchors[k * 4 + 3])]);
    }
    const count = leaves.length;
    if (count < BOUGH_MIN_LEAVES) continue;
    for (let c = 0; c < 3; c++) centre[c] /= count;
    let extent = 0;
    for (let k = 0; k < data.leafCount; k++) {
      if (!mask[species.leaves[k].branch]) continue;
      extent = Math.max(extent, Math.hypot(data.leafAnchors[k * 4] - centre[0], data.leafAnchors[k * 4 + 1] - centre[1], data.leafAnchors[k * 4 + 2] - centre[2]));
    }
    // A bough in the middle of the crown is hidden by the rest of the tree.
    if (Math.hypot(centre[0], centre[2]) < 0.3 * crownRadius) continue;
    boughs.push({ branch: plan.index, position: centre, radius: clamp(extent * 0.7, 0.5, 1.2), leaves, mask });
  }
  return boughs;
}

// Places on branches where an object can sit or hang, on the outer crown above the grass.
function findPerches(species, tree) {
  const { data, height, crownRadius } = tree;
  const perches = [];
  for (const plan of species.branches) {
    if (plan.depth < 1 || plan.depth >= species.maxDepth) continue;
    for (let i = 1; i < plan.steps; i++) {
      const k = plan.pointOffset + i;
      const x = data.positions[k * 3];
      const y = data.positions[k * 3 + 1];
      const z = data.positions[k * 3 + 2];
      if (y < 1.2 || y > 0.95 * height || Math.hypot(x, z) < OUTER_SHARE * crownRadius) continue;
      perches.push({
        branch: plan.index,
        position: [x, y, z],
        tangent: [data.tangents[k * 3], data.tangents[k * 3 + 1], data.tangents[k * 3 + 2]],
        radius: data.radii[k],
        flex: data.flex[k],
      });
    }
  }
  return perches;
}

function pickObject(kind, perches, rng) {
  const rules = OBJECT_RULES[kind];
  const fitting = perches.filter((p) => p.radius >= rules.minRadius && (!rules.flat || Math.abs(p.tangent[1]) <= 0.55));
  if (fitting.length === 0) return null;
  const perch = fitting[Math.floor(rng() * fitting.length)];
  // The object's centre: a bird or nest sits on top of the branch, apples and a lantern hang below it.
  const lift = rules.flat ? perch.radius + 0.12 : -(perch.radius + 0.2);
  return {
    kind,
    branch: perch.branch,
    position: [perch.position[0], perch.position[1] + lift, perch.position[2]],
    radius: rules.hit,
    reachUp: rules.reachUp,
    attach: { position: perch.position, tangent: perch.tangent, radius: perch.radius, flex: perch.flex },
  };
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function tryPlan(kinds, boughs, perches, separation, rng) {
  const chosen = [];
  for (const kind of kinds) {
    let pick = null;
    for (let attempt = 0; attempt < 30 && !pick; attempt++) {
      let candidate = null;
      if (BOUGH_KINDS.has(kind)) {
        const bough = boughs[Math.floor(rng() * boughs.length)];
        if (bough) candidate = { kind, branch: bough.branch, position: bough.position, radius: bough.radius, leaves: bough.leaves, mask: bough.mask };
      } else {
        candidate = pickObject(kind, perches, rng);
      }
      if (!candidate) continue;
      candidate.tree = rng() < 0.5 ? 'left' : 'right';
      const apart = chosen.every((other) => distance(other.position, candidate.position) >= separation);
      if (apart && !hidesOrIsHidden(candidate, chosen)) pick = candidate;
    }
    if (!pick) return null;
    chosen.push(pick);
  }
  return chosen;
}

// A branch left out of one tree takes everything on it away: an object on that branch of the
// same tree would never be seen, and an omitted bough must not carry another difference's object.
function hidesOrIsHidden(candidate, chosen) {
  return chosen.some((other) => {
    if (other.tree !== candidate.tree) return false;
    const objectOnOmitted = candidate.attach && other.kind === 'missingBranch' && other.mask[candidate.branch];
    const omittedUnderObject = other.attach && candidate.kind === 'missingBranch' && candidate.mask[other.branch];
    return Boolean(objectOnOmitted || omittedUnderObject);
  });
}

// At least one difference is on the side facing the starting camera (it looks along -z from +z)
// and at least one on the far side, measured from the middle of the tree's depth, so the pair
// is neither found at a glance nor needs a turn every time.
function hasBothSides(chosen, [middle, half]) {
  return chosen.some((d) => d.position[2] > middle + 0.15 * half) && chosen.some((d) => d.position[2] < middle - 0.15 * half);
}

// Plans DIFFERENCES differences for the pair with this seed and these traits:
//   { kind, tree: 'left' | 'right', position: [x, y, z] (tree space), radius, label, branch, attach?, leaves? }
// `attach` (objects only) says where on its branch the object sits; `leaves` (boughs only) lists
// where the bough's leaves are, in tree space.
// `kinds` (for tests and for looking at one kind) names up to DIFFERENCES distinct kinds to use
// instead of a random choice; they must fit the tree like randomly chosen ones.
export function planDifferences(seed, genes, rng = mulberry32(seed ^ 0x2f6e2b1), kinds = null) {
  const species = createSpecies(seed);
  const tree = describeTree(species, genes);
  const boughs = findBoughs(species, genes, tree);
  const perches = findPerches(species, tree);

  // Only kinds this tree has room for: a small tree may have no bough with enough leaves.
  // A bough that turns early shows only on a tree that is still green.
  const roomFor = (kind) => {
    if (kind === 'autumnBough') return boughs.length > 0 && genes.autumn <= MOST_AUTUMN_FOR_AUTUMN_BOUGH;
    return BOUGH_KINDS.has(kind) ? boughs.length > 0 : perches.some((p) => p.radius >= OBJECT_RULES[kind].minRadius);
  };
  const possible = KINDS.filter(roomFor);
  if (kinds) {
    const tooMany = kinds.length > DIFFERENCES;
    const repeated = new Set(kinds).size !== kinds.length;
    if (tooMany || repeated || !kinds.every((kind) => possible.includes(kind))) {
      throw new Error(`these kinds do not fit the tree of seed ${seed}: ${kinds.join(', ')}`);
    }
  } else if (possible.length < DIFFERENCES) {
    throw new Error(`no room for ${DIFFERENCES} differences on the tree of seed ${seed}`);
  }
  const separation = separationFor(tree.crownRadius);

  let fallback = null;
  for (let attempt = 0; attempt < 250; attempt++) {
    const chosenKinds = kinds ?? shuffle(rng, possible).slice(0, DIFFERENCES);
    const chosen = tryPlan(chosenKinds, boughs, perches, separation, rng);
    if (!chosen) continue;
    fallback ??= chosen;
    if (hasBothSides(chosen, tree.frontBack)) return finish(chosen);
  }
  if (!fallback) throw new Error(`no room for ${DIFFERENCES} differences on the tree of seed ${seed}`);
  return finish(fallback);
}

function finish(chosen) {
  return chosen.map(({ mask, ...difference }) => ({ ...difference, label: LABELS[difference.kind] }));
}

// The changes to one tree's boughs, as prepareEdit takes them.
export function editFor(differences, tree) {
  const own = differences.filter((d) => d.tree === tree);
  return {
    omit: own.filter((d) => d.kind === 'missingBranch').map((d) => d.branch),
    tints: own.filter((d) => d.kind === 'autumnBough' || d.kind === 'blossomBough').map((d) => ({ branch: d.branch, kind: d.kind === 'autumnBough' ? 'autumn' : 'blossom' })),
  };
}

// The objects to add to one tree.
export function objectsFor(differences, tree) {
  return differences.filter((d) => d.tree === tree && d.attach);
}

// How far a ray passes from `centre` (its closest approach) and how far along the ray that is.
// A centre behind the origin is never passed (miss Infinity): with the camera zoomed in close,
// it can stand inside a difference's area, and a click looking away from it must not find it.
// `direction` must have length 1.
export function rayPassesCentre(origin, direction, centre) {
  const along = (centre[0] - origin[0]) * direction[0] + (centre[1] - origin[1]) * direction[1] + (centre[2] - origin[2]) * direction[2];
  if (along < 0) return { along: 0, miss: Infinity };
  const closest = [origin[0] + direction[0] * along, origin[1] + direction[1] * along, origin[2] + direction[2] * along];
  return { along, miss: distance(closest, centre) };
}

// Where a ray passes within `radius` of `centre`: the distance along it, or null.
export function rayHitsSphere(origin, direction, centre, radius) {
  const { along, miss } = rayPassesCentre(origin, direction, centre);
  return miss <= radius ? along : null;
}

// How well a ray points at `difference` on the tree at offset `x`: the closest the ray passes to
// its centre as a share of its radius; for an object that reaches up past its radius (a lantern's
// thread), to any point on the line from its centre up to its top; for a bough, to the middle of
// one of its leaves as a share of that leaf's reach. The smallest share counts; 1 or less is a hit.
const OBJECT_SAMPLES = 6;
function aimShare(ray, difference, x) {
  const centre = [x + difference.position[0], difference.position[1], difference.position[2]];
  const toCentre = rayPassesCentre(ray.origin, ray.direction, centre);
  let best = { share: toCentre.miss / difference.radius, along: toCentre.along };
  if (difference.reachUp > 0) {
    for (let i = 1; i <= OBJECT_SAMPLES; i++) {
      const point = [centre[0], centre[1] + (difference.reachUp * i) / OBJECT_SAMPLES, centre[2]];
      const toPoint = rayPassesCentre(ray.origin, ray.direction, point);
      const share = toPoint.miss / difference.radius;
      if (share < best.share) best = { share, along: toPoint.along };
    }
  }
  for (const leaf of difference.leaves ?? []) {
    const toLeaf = rayPassesCentre(ray.origin, ray.direction, [x + leaf[0], leaf[1], leaf[2]]);
    const share = toLeaf.miss / leaf[3];
    if (share < best.share) best = { share, along: toLeaf.along };
  }
  return best;
}

// Which difference a click on either tree points at, if any. A difference can be clicked on
// either tree: the other tree shows the place where it is missing. `treeX` gives each tree's
// offset along x. A ray can pass through several differences' areas (they overlap on the screen
// when they are in line); the one the ray is best aimed at (see aimShare) is meant. Leaves and
// branches in front of a difference do not stop a click: seen from
// the front, most objects on the far side still show through the crown (doc/specs/
// SpotTheDifference.md, "Clicks through the crown"). Returns { index, tree, along } or null.
export function findDifferenceAt(differences, ray, treeX) {
  let best = null;
  differences.forEach((difference, index) => {
    for (const tree of ['left', 'right']) {
      const { share, along } = aimShare(ray, difference, treeX[tree]);
      if (share <= 1 && (!best || share < best.share)) best = { index, tree, along, share };
    }
  });
  return best && { index: best.index, tree: best.tree, along: best.along };
}
