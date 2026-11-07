import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpecies,
  createTreeData,
  growTree,
  mapGenes,
  prepareEdit,
  branchSubtree,
  GROUND_CLEARANCE,
  LOWEST_FOLIAGE_Y,
  LEAF_ROWS,
  LEAF_CURL,
  leafHalfWidth,
  BLOSSOM_RADIUS,
  BLOSSOM_RISE,
} from '../src/skeleton.js';
import { randomGenes, TRAIT_KEYS } from '../src/traits.js';
import { mulberry32 } from '../src/random.js';

const genesFor = (seed) => randomGenes(mulberry32(seed));

test('the same seed always produces the same topology', () => {
  const a = createSpecies(1234);
  const b = createSpecies(1234);
  assert.equal(a.branches.length, b.branches.length);
  assert.equal(a.leaves.length, b.leaves.length);
  assert.deepEqual(
    a.branches.map((plan) => [plan.parent, plan.depth, plan.t]),
    b.branches.map((plan) => [plan.parent, plan.depth, plan.t]),
  );
});

test('different seeds produce different trees', () => {
  const a = createSpecies(1);
  const b = createSpecies(2);
  const sameShape = a.branches.length === b.branches.length && a.branches.every((plan, i) => plan.t === b.branches[i].t);
  assert.equal(sameShape, false);
});

test('branches are listed parent first, one level apart, with point ranges end to end', () => {
  const species = createSpecies(77);
  let nextOffset = 0;
  species.branches.forEach((plan, i) => {
    assert.equal(plan.index, i);
    assert.equal(plan.pointOffset, nextOffset, `branch ${i} points do not follow the previous branch`);
    nextOffset += plan.steps + 1;
    if (plan.parent < 0) return;
    const parent = species.branches[plan.parent];
    assert.ok(plan.parent < i, `branch ${i} has parent ${plan.parent}`);
    assert.equal(plan.depth, parent.depth + 1);
  });
  assert.equal(species.pointCount, nextOffset);
});

// Linear interpolation along a branch's points at fraction t, written out
// independently of skeleton.js so the test checks it rather than repeats it.
function pointAlong(data, plan, t) {
  const f = t * plan.steps;
  const segment = Math.min(Math.floor(f), plan.steps - 1);
  const frac = f - segment;
  const a = (plan.pointOffset + segment) * 3;
  const b = a + 3;
  return [0, 1, 2].map((c) => data.positions[a + c] + (data.positions[b + c] - data.positions[a + c]) * frac);
}

test('every child branch starts on its parent, at its planned place along it', () => {
  const species = createSpecies(13);
  const data = growTree(species, genesFor(13), 1);
  let checked = 0;
  for (const plan of species.branches) {
    if (plan.parent < 0) continue;
    const expected = pointAlong(data, species.branches[plan.parent], plan.t);
    const k = plan.pointOffset * 3;
    const actual = [data.positions[k], data.positions[k + 1], data.positions[k + 2]];
    const gap = Math.hypot(...actual.map((value, c) => value - expected[c]));
    assert.ok(gap < 1e-4, `branch ${plan.index} starts ${gap.toFixed(4)} away from its place on branch ${plan.parent}`);
    checked++;
  }
  assert.ok(checked > 50);
});

test('growing is deterministic for the same seed and genes', () => {
  const species = createSpecies(99);
  const genes = genesFor(99);
  const first = growTree(species, genes, 1);
  const second = growTree(species, genes, 1);
  assert.deepEqual(Array.from(first.positions), Array.from(second.positions));
  assert.deepEqual(Array.from(first.leafMatrices), Array.from(second.leafMatrices));
});

test('changing a gene never changes the topology, so trees can morph', () => {
  const species = createSpecies(5);
  const genes = genesFor(5);
  const data = createTreeData(species);
  for (const key of TRAIT_KEYS) {
    for (const value of [0, 0.5, 1]) {
      growTree(species, { ...genes, [key]: value }, 1, data);
      assert.ok(data.positions.every(Number.isFinite), `${key}=${value} produced a non-finite position`);
      assert.ok(data.leafMatrices.every(Number.isFinite), `${key}=${value} produced a non-finite leaf matrix`);
    }
  }
});

// Length of the instance's local y axis, which is its scale in skeleton.js's matrices.
function instanceScale(matrices, k) {
  return Math.hypot(matrices[k * 16 + 4], matrices[k * 16 + 5], matrices[k * 16 + 6]);
}

function largestChange(a, b, count = a.length) {
  let largest = 0;
  for (let i = 0; i < count; i++) largest = Math.max(largest, Math.abs(a[i] - b[i]));
  return largest;
}

test('a small gene change moves the tree only a little (no jumps while morphing)', () => {
  const species = createSpecies(11);
  const genes = genesFor(11);
  for (const key of TRAIT_KEYS) {
    const a = growTree(species, { ...genes, [key]: 0.5 }, 1);
    const b = growTree(species, { ...genes, [key]: 0.505 }, 1);
    const moved = largestChange(a.positions, b.positions);
    assert.ok(moved < 0.25, `${key}: a 0.005 gene step moved a point by ${moved.toFixed(3)}`);

    // Leaves and blossoms near the density cut-off grow in by size; none may pop.
    const shownLeaves = Math.max(a.leafCount, b.leafCount);
    const leafJump = Math.max(...Array.from({ length: shownLeaves }, (_, k) => Math.abs(instanceScale(a.leafMatrices, k) - instanceScale(b.leafMatrices, k))));
    assert.ok(leafJump < 0.03, `${key}: a leaf changed size by ${leafJump.toFixed(3)}`);
    const shownBlossoms = Math.max(a.blossomCount, b.blossomCount);
    const blossomJump = Math.max(0, ...Array.from({ length: shownBlossoms }, (_, k) => Math.abs(instanceScale(a.blossomMatrices, k) - instanceScale(b.blossomMatrices, k))));
    assert.ok(blossomJump < 0.03, `${key}: a blossom changed size by ${blossomJump.toFixed(3)}`);
    const recoloured = largestChange(a.leafColors, b.leafColors, a.leafCount * 3);
    assert.ok(recoloured < 0.05, `${key}: a leaf colour channel changed by ${recoloured.toFixed(3)}`);
  }
});

test('each trait changes what it should', () => {
  const species = createSpecies(21);
  const genes = { ...genesFor(21), lean: 0.2, weeping: 0.3 };
  const grow = (changes) => growTree(species, { ...genes, ...changes }, 1);

  assert.ok(grow({ height: 0.9 }).bounds.maxY > grow({ height: 0.1 }).bounds.maxY, 'height raises the crown');
  assert.ok(grow({ lushness: 0.9 }).leafCount > grow({ lushness: 0.2 }).leafCount, 'lushness adds leaves');
  assert.ok(grow({ blossom: 0.9 }).blossomCount > grow({ blossom: 0.1 }).blossomCount, 'blossom adds flowers');
  assert.equal(grow({ blossom: 0 }).blossomCount, 0, 'no blossom gene, no flowers');
  assert.ok(grow({ girth: 0.9 }).radii[0] > grow({ girth: 0.1 }).radii[0], 'girth thickens the trunk');
  assert.ok(grow({ bark: 0.9 }).barkColor[0] > grow({ bark: 0.1 }).barkColor[0], 'pale bark is lighter');

  const centreX = (data) => (data.bounds.minX + data.bounds.maxX) / 2;
  assert.ok(centreX(grow({ lean: 0.9 })) > centreX(grow({ lean: 0 })), 'lean pushes the crown with the wind (+x)');

  const meanTipHeight = (data) => {
    let sum = 0;
    let count = 0;
    for (const plan of species.branches) {
      if (!plan.isTip) continue;
      sum += data.positions[(plan.pointOffset + plan.steps) * 3 + 1];
      count++;
    }
    return sum / count;
  };
  const upright = meanTipHeight(grow({ weeping: 0 }));
  const weeping = meanTipHeight(grow({ weeping: 1 }));
  assert.ok(weeping < upright, 'weeping lowers the branch tips');

  const leafGreen = (data) => data.leafColors[1] - data.leafColors[0];
  assert.ok(leafGreen(grow({ autumn: 0 })) > leafGreen(grow({ autumn: 1 })), 'autumn turns leaves from green toward red');

  const crownWidth = (data) => data.bounds.maxX - data.bounds.minX;
  assert.ok(crownWidth(grow({ spread: 0.9 })) > crownWidth(grow({ spread: 0.1 })), 'spread widens the crown');

  const totalBranchLength = (data) => {
    let total = 0;
    for (const plan of species.branches) {
      for (let i = 0; i < plan.steps; i++) {
        const a = (plan.pointOffset + i) * 3;
        const b = a + 3;
        total += Math.hypot(data.positions[b] - data.positions[a], data.positions[b + 1] - data.positions[a + 1], data.positions[b + 2] - data.positions[a + 2]);
      }
    }
    return total;
  };
  assert.ok(totalBranchLength(grow({ reach: 0.9 })) > totalBranchLength(grow({ reach: 0.1 })), 'reach lengthens the branches');

  // Gnarl bends branches step by step: successive tangents agree less.
  const meanBend = (data) => {
    let bend = 0;
    let count = 0;
    for (const plan of species.branches) {
      for (let i = 0; i < plan.steps; i++) {
        const a = (plan.pointOffset + i) * 3;
        const b = a + 3;
        const dot = data.tangents[a] * data.tangents[b] + data.tangents[a + 1] * data.tangents[b + 1] + data.tangents[a + 2] * data.tangents[b + 2];
        bend += 1 - dot;
        count++;
      }
    }
    return bend / count;
  };
  assert.ok(meanBend(grow({ gnarl: 0.9 })) > meanBend(grow({ gnarl: 0.1 })), 'gnarl twists the branches');

  assert.ok(instanceScale(grow({ leafSize: 0.9 }).leafMatrices, 0) > instanceScale(grow({ leafSize: 0.1 }).leafMatrices, 0), 'leaf size enlarges leaves');
});

test('growth 0 is bare and growth 1 is fully leafed', () => {
  const species = createSpecies(8);
  const genes = { ...genesFor(8), lushness: 1 };
  const bare = growTree(species, genes, 0);
  for (let k = 0; k < bare.leafCount; k++) assert.equal(instanceScale(bare.leafMatrices, k), 0, `leaf ${k} is showing on a seedling`);
  // Zero-length stubs sit at the ground clamp height (0.08); leaf anchors sit a
  // fraction of a radius off the branch surface.
  assert.ok(bare.bounds.maxY < 0.09, 'no branch has length at growth 0');
  const grown = growTree(species, genes, 1);
  assert.ok(bare.radii[0] < grown.radii[0] * 0.5, 'the trunk starts much thinner than it ends');
  assert.ok(instanceScale(grown.leafMatrices, 0) > 0);
  assert.ok(grown.bounds.maxY > 2);
});

// Trees that sweep the grass: strongly weeping, short, long-reaching, fully leafed.
function groundSweepers() {
  return [3, 4, 5, 6, 7, 8].map((seed) => {
    const species = createSpecies(seed);
    const genes = { ...genesFor(seed), weeping: 1, reach: 1, height: 0, lushness: 1, blossom: 1 };
    return { seed, species, data: growTree(species, genes, 1) };
  });
}

test('branches run along the ground 8 cm up, at about full step length', () => {
  // 8 cm keeps a branch lying on the meadow visible above the grass roots.
  assert.equal(GROUND_CLEARANCE, 0.08);
  const groundStepShares = [];
  for (const { seed, species, data } of groundSweepers()) {
    let pointsAtClearance = 0;
    for (let k = 1; k < data.pointCount; k++) {
      const y = data.positions[k * 3 + 1];
      assert.ok(y >= 0.08 - 1e-6, `seed ${seed} point ${k} at ${y.toFixed(3)}`);
      if (y < 0.08 + 1e-4) pointsAtClearance++;
    }
    assert.ok(pointsAtClearance > 0, `seed ${seed} never reaches the ground, so the test checks no clamping`);

    // A branch that meets the ground turns to run along it. If it kept pressing
    // down instead, every step on the ground would be clamped short.
    for (const plan of species.branches) {
      const steps = [];
      for (let i = 0; i < plan.steps; i++) {
        const a = (plan.pointOffset + i) * 3;
        const b = a + 3;
        const length = Math.hypot(data.positions[b] - data.positions[a], data.positions[b + 1] - data.positions[a + 1], data.positions[b + 2] - data.positions[a + 2]);
        const onGround = data.positions[a + 1] < 0.08 + 1e-4 && data.positions[b + 1] < 0.08 + 1e-4;
        steps.push({ length, onGround });
      }
      const longest = Math.max(...steps.map((step) => step.length));
      for (const step of steps) if (step.onGround) groundStepShares.push(step.length / longest);
    }
  }
  assert.ok(groundStepShares.length > 100);
  // Measured: 0.88 with the turn, 0.61 when branches keep pressing down.
  const mean = groundStepShares.reduce((sum, share) => sum + share, 0) / groundStepShares.length;
  assert.ok(mean > 0.8, `steps along the ground average ${mean.toFixed(2)} of a full step`);
});

test('leaves near the ground stay on their branches', () => {
  // Leaves are first tilted up and only then lifted, so the lift stays small.
  // Lifting alone would float hanging leaves up to a leaf length off their twig.
  assert.equal(LOWEST_FOLIAGE_Y, 0.04);
  for (const { seed, species, data } of groundSweepers()) {
    let farthest = 0;
    for (let k = 0; k < data.leafCount; k++) {
      const leaf = species.leaves[k];
      const plan = species.branches[leaf.branch];
      const onBranch = pointAlong(data, plan, leaf.t);
      let thickest = 0;
      for (let i = 0; i <= plan.steps; i++) thickest = Math.max(thickest, data.radii[plan.pointOffset + i]);
      const base = [data.leafMatrices[k * 16 + 12], data.leafMatrices[k * 16 + 13], data.leafMatrices[k * 16 + 14]];
      const gap = Math.hypot(...base.map((value, c) => value - onBranch[c])) - thickest;
      farthest = Math.max(farthest, gap);
    }
    // Measured: at most 6.8 cm of lift over many weeping trees.
    assert.ok(farthest < 0.08, `seed ${seed}: a leaf sits ${farthest.toFixed(3)} off its branch`);
  }
});

test('no part of any leaf or blossom goes below the foliage clearance', () => {
  for (const { seed, data } of groundSweepers()) {
    // Leaf vertices in the leaf's own space, as materials.js builds the mesh.
    const outline = LEAF_ROWS.flatMap((y) => {
      const w = leafHalfWidth(y);
      return [[-w, y, w * LEAF_CURL], [0, y, 0], [w, y, w * LEAF_CURL]];
    });
    for (let k = 0; k < data.leafCount; k++) {
      const m = data.leafMatrices.subarray(k * 16, k * 16 + 16);
      for (const [x, y, z] of outline) {
        const worldY = m[13] + x * m[1] + y * m[5] + z * m[9];
        assert.ok(worldY >= LOWEST_FOLIAGE_Y - 1e-5, `seed ${seed} leaf ${k} reaches ${worldY.toFixed(3)}`);
      }
    }
    let blossoms = 0;
    for (let k = 0; k < data.blossomCount; k++) {
      const m = data.blossomMatrices.subarray(k * 16, k * 16 + 16);
      // Petals span a disc in the matrix's first two axes, raised along the third.
      const lowest = m[13] - BLOSSOM_RADIUS * Math.hypot(m[1], m[5]) - BLOSSOM_RISE * Math.max(0, -m[9]);
      assert.ok(lowest >= LOWEST_FOLIAGE_Y - 1e-5, `seed ${seed} blossom ${k} reaches ${lowest.toFixed(3)}`);
      blossoms++;
    }
    assert.ok(blossoms > 0);
  }
});

test('the leaves and blossoms shown are exactly those under the density threshold', () => {
  const species = createSpecies(31);
  const genes = genesFor(31);
  for (const value of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
    const changed = { ...genes, lushness: value, blossom: value };
    const data = growTree(species, changed, 1);
    const { leafDensity, blossomDensity } = mapGenes(changed);
    assert.equal(data.leafCount, species.leaves.filter((leaf) => leaf.threshold < leafDensity).length, `lushness ${value}`);
    assert.equal(data.blossomCount, species.blossoms.filter((blossom) => blossom.threshold < blossomDensity).length, `blossom ${value}`);
  }
});

// A depth-2 branch with leaves on it, to leave out or recolour.
function boughOf(species, data) {
  const leavesOn = new Map();
  for (let k = 0; k < data.leafCount; k++) leavesOn.set(species.leaves[k].branch, (leavesOn.get(species.leaves[k].branch) ?? 0) + 1);
  return species.branches.find((plan) => plan.depth === 2 && [...leavesOn].some(([b, n]) => n > 3 && branchSubtree(species, plan.index)[b])).index;
}

test('a branch subtree holds the branch and everything that grows from it', () => {
  const species = createSpecies(77);
  const mask = branchSubtree(species, 5);
  assert.equal(mask[5], 1);
  for (const plan of species.branches) {
    const grows = plan.index === 5 || (plan.parent >= 0 && mask[plan.parent] === 1);
    assert.equal(mask[plan.index], grows ? 1 : 0, `branch ${plan.index}`);
  }
  assert.equal(mask[species.branches[5].parent], 0, 'not its parent');
});

test('a tree with no edit, or an empty edit, is the tree it was', () => {
  const species = createSpecies(31);
  const genes = genesFor(31);
  const plain = growTree(species, genes, 1);
  const empty = growTree(species, genes, 1, undefined, prepareEdit(species, { omit: [], tints: [] }));
  assert.deepEqual(empty.positions, plain.positions);
  assert.deepEqual(empty.leafMatrices, plain.leafMatrices);
  assert.deepEqual(empty.leafColors, plain.leafColors);
  assert.deepEqual(empty.bounds, plain.bounds);
});

test('a left-out branch takes its twigs, leaves and blossoms with it, and no other part changes', () => {
  const species = createSpecies(31);
  const genes = { ...genesFor(31), blossom: 0.9, lushness: 0.9 };
  const plain = growTree(species, genes, 1);
  const bough = boughOf(species, plain);
  const gone = branchSubtree(species, bough);
  const cut = growTree(species, genes, 1, undefined, prepareEdit(species, { omit: [bough] }));
  // The shape of every branch is as before; the left-out ones have no thickness.
  assert.deepEqual(cut.positions, plain.positions);
  for (const plan of species.branches) {
    for (let k = plan.pointOffset; k <= plan.pointOffset + plan.steps; k++) {
      if (gone[plan.index]) assert.equal(cut.radii[k], 0, `branch ${plan.index}`);
      else assert.equal(cut.radii[k], plain.radii[k], `branch ${plan.index}`);
    }
  }
  const sizeOf = (matrices, k) => Math.hypot(matrices[k * 16], matrices[k * 16 + 1], matrices[k * 16 + 2]);
  // Every leaf or blossom elsewhere keeps its whole matrix (place, turn and size) and its colour.
  const unchanged = (name, k) => {
    const sameMatrix = cut[`${name}Matrices`].subarray(k * 16, k * 16 + 16).every((v, i) => v === plain[`${name}Matrices`][k * 16 + i]);
    const sameColour = [0, 1, 2].every((c) => cut[`${name}Colors`][k * 3 + c] === plain[`${name}Colors`][k * 3 + c]);
    return sameMatrix && sameColour;
  };
  let hidden = 0;
  for (let k = 0; k < plain.leafCount; k++) {
    if (gone[species.leaves[k].branch]) {
      assert.equal(sizeOf(cut.leafMatrices, k), 0);
      hidden++;
    } else {
      assert.ok(unchanged('leaf', k), `leaf ${k}, off the bough, changed`);
    }
  }
  assert.ok(hidden > 3, `${hidden} leaves were on the bough`);
  let hiddenBlossoms = 0;
  let keptBlossoms = 0;
  for (let k = 0; k < plain.blossomCount; k++) {
    if (gone[species.blossoms[k].branch]) {
      assert.equal(sizeOf(cut.blossomMatrices, k), 0);
      hiddenBlossoms++;
    } else {
      assert.ok(unchanged('blossom', k), `blossom ${k}, off the bough, changed`);
      if (sizeOf(plain.blossomMatrices, k) > 0) keptBlossoms++;
    }
  }
  assert.ok(hiddenBlossoms > 0 && keptBlossoms > 3, `${hiddenBlossoms} blossoms on the bough, ${keptBlossoms} shown elsewhere`);
  // The bounds no longer include the left-out branch.
  assert.ok(cut.bounds.maxX <= plain.bounds.maxX && cut.bounds.minX >= plain.bounds.minX);
});

test('a recoloured bough changes only its own leaves', () => {
  const species = createSpecies(31);
  const genes = { ...genesFor(31), autumn: 0.1 };
  const plain = growTree(species, genes, 1);
  const bough = boughOf(species, plain);
  const inBough = branchSubtree(species, bough);
  for (const kind of ['autumn', 'blossom']) {
    const tinted = growTree(species, genes, 1, undefined, prepareEdit(species, { tints: [{ branch: bough, kind }] }));
    assert.deepEqual(tinted.positions, plain.positions);
    assert.deepEqual(tinted.leafMatrices, plain.leafMatrices);
    let changed = 0;
    for (let k = 0; k < plain.leafCount; k++) {
      const same = [0, 1, 2].every((c) => tinted.leafColors[k * 3 + c] === plain.leafColors[k * 3 + c]);
      if (inBough[species.leaves[k].branch]) {
        assert.equal(same, false, `${kind}: a leaf of the bough kept its colour`);
        changed++;
      } else {
        assert.equal(same, true, `${kind}: a leaf outside the bough changed`);
      }
    }
    assert.ok(changed > 3);
  }
});

test('an autumn bough is redder than the green tree, a blossom bough is paler', () => {
  const species = createSpecies(31);
  const genes = { ...genesFor(31), autumn: 0.1 };
  const plain = growTree(species, genes, 1);
  const bough = boughOf(species, plain);
  const inBough = branchSubtree(species, bough);
  const average = (data, channel) => {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < data.leafCount; k++) if (inBough[species.leaves[k].branch]) { sum += data.leafColors[k * 3 + channel]; n++; }
    return sum / n;
  };
  const autumn = growTree(species, genes, 1, undefined, prepareEdit(species, { tints: [{ branch: bough, kind: 'autumn' }] }));
  const blossom = growTree(species, genes, 1, undefined, prepareEdit(species, { tints: [{ branch: bough, kind: 'blossom' }] }));
  assert.ok(average(autumn, 0) - average(plain, 0) > 0.15, 'more red');
  assert.ok(average(autumn, 1) - average(plain, 1) < 0.05 || average(autumn, 0) > average(autumn, 1), 'red over green');
  assert.ok(average(blossom, 0) > 0.75 && average(blossom, 2) > 0.6, 'pale');
});

// A bough planned as blossom must look like blossom and one planned as autumn like autumn, on a
// tree that is still green: the planned kind reaches the right tint (editFor), and each tint
// draws its own colours: pale for blossom (every channel high), warm for autumn (red over 1.5
// times green and blue, and not pale; the deepest reds have green and blue about equal).
test('a blossom bough is drawn pale and an autumn bough warm, on a green tree', async () => {
  const { editFor } = await import('../src/differences.js');
  const differences = [
    { tree: 'left', kind: 'blossomBough', branch: 3 },
    { tree: 'right', kind: 'autumnBough', branch: 3 },
  ];
  assert.deepEqual(editFor(differences, 'left').tints, [{ branch: 3, kind: 'blossom' }]);
  assert.deepEqual(editFor(differences, 'right').tints, [{ branch: 3, kind: 'autumn' }]);

  const species = createSpecies(4321);
  const genes = { ...randomGenes(mulberry32(5)), autumn: 0 };
  const branch = Math.floor(species.branches.length / 2);
  const plain = growTree(species, genes, 1).leafColors.slice();
  const coloursOf = (kind) => {
    const colours = growTree(species, genes, 1, undefined, prepareEdit(species, { tints: [{ branch, kind }] })).leafColors;
    const changed = [];
    for (let k = 0; k < colours.length / 3; k++) {
      const rgb = [colours[k * 3], colours[k * 3 + 1], colours[k * 3 + 2]];
      if (rgb.some((value, c) => value !== plain[k * 3 + c])) changed.push(rgb);
    }
    return changed;
  };
  const blossom = coloursOf('blossom');
  const autumn = coloursOf('autumn');
  assert.ok(blossom.length >= 5 && autumn.length >= 5, `${blossom.length} blossom and ${autumn.length} autumn leaves changed`);
  assert.ok(blossom.every(([r, g, b]) => Math.min(r, g, b) > 0.7), 'blossom leaves are pale');
  assert.ok(autumn.every(([r, g, b]) => r > 1.5 * Math.max(g, b) && Math.min(r, g, b) < 0.5), 'autumn leaves are warm');
});
