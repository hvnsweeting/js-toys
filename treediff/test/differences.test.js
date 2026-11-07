import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDifferences, editFor, objectsFor, rayHitsSphere, findDifferenceAt, separationFor, DIFFERENCES, KINDS, LABELS } from '../src/differences.js';
import { createSpecies, growTree, branchSubtree, mapGenes } from '../src/skeleton.js';
import { randomGenes } from '../src/traits.js';
import { mulberry32 } from '../src/random.js';

// Plans for many trees; seeds with no room for three differences (rare) are skipped.
function plans(count, firstSeed = 5000) {
  const rng = mulberry32(11);
  const result = [];
  for (let i = 0; i < count; i++) {
    const seed = firstSeed + i;
    const genes = randomGenes(rng);
    try {
      result.push({ seed, genes, differences: planDifferences(seed, genes) });
    } catch {
      // No room on this tree.
    }
  }
  return result;
}

const all = plans(400);

function crownRadiusOf({ bounds }) {
  return Math.max(Math.abs(bounds.minX), bounds.maxX, Math.abs(bounds.minZ), bounds.maxZ);
}

test('almost every tree has room, and a pair has three differences of three different kinds', () => {
  assert.ok(all.length >= 390, `${all.length} of 400 trees had room`);
  for (const { differences } of all) {
    assert.equal(differences.length, DIFFERENCES);
    assert.equal(new Set(differences.map((d) => d.kind)).size, DIFFERENCES);
    for (const d of differences) {
      assert.ok(KINDS.includes(d.kind));
      assert.equal(d.label, LABELS[d.kind]);
      assert.ok(d.tree === 'left' || d.tree === 'right');
      assert.ok(d.position.every(Number.isFinite) && d.radius > 0.3);
    }
  }
});

test('both trees carry differences across pairs, and every kind is used', () => {
  const trees = new Set();
  const kinds = new Set();
  for (const { differences } of all) for (const d of differences) {
    trees.add(d.tree);
    kinds.add(d.kind);
  }
  assert.equal(trees.size, 2);
  assert.equal(kinds.size, KINDS.length);
});

test('differences keep apart, and sit above the grass', () => {
  for (const { seed, genes, differences } of all) {
    const { bounds } = growTree(createSpecies(seed), genes, 1);
    const crownRadius = Math.max(Math.abs(bounds.minX), bounds.maxX, Math.abs(bounds.minZ), bounds.maxZ);
    for (let a = 0; a < differences.length; a++) {
      assert.ok(differences[a].position[1] > 0.1, `seed ${seed}: a difference at height ${differences[a].position[1]}`);
      for (let b = a + 1; b < differences.length; b++) {
        const gap = Math.hypot(...differences[a].position.map((v, i) => v - differences[b].position[i]));
        assert.ok(gap >= separationFor(crownRadius) - 1e-9, `seed ${seed}: ${differences[a].kind} and ${differences[b].kind} are ${gap.toFixed(2)} apart`);
      }
    }
  }
});

test('nearly every pair has a difference on the near side and one on the far side', () => {
  let both = 0;
  for (const { seed, genes, differences } of all) {
    const { bounds } = growTree(createSpecies(seed), genes, 1);
    const middle = (bounds.minZ + bounds.maxZ) / 2;
    const margin = 0.15 * ((bounds.maxZ - bounds.minZ) / 2);
    if (differences.some((d) => d.position[2] > middle + margin) && differences.some((d) => d.position[2] < middle - margin)) both++;
  }
  assert.ok(both / all.length > 0.97, `${both} of ${all.length}`);
});

test('an early autumn bough is only planned on a tree that is still green', () => {
  let seen = 0;
  for (const { genes, differences } of all) {
    if (!differences.some((d) => d.kind === 'autumnBough')) continue;
    seen++;
    assert.ok(genes.autumn <= 0.4, `autumn ${genes.autumn}`);
  }
  assert.ok(seen > 30, `${seen} pairs with an autumn bough`);
});

test('an object is never on a branch that is left out of the same tree', () => {
  for (const { seed, differences } of all) {
    const species = createSpecies(seed);
    for (const missing of differences.filter((d) => d.kind === 'missingBranch')) {
      const gone = branchSubtree(species, missing.branch);
      for (const object of differences.filter((d) => d.attach && d.tree === missing.tree)) {
        assert.equal(gone[object.branch], 0, `seed ${seed}: a ${object.kind} on the missing branch`);
      }
    }
  }
});

test('an object sits on a branch point on the outer crown, hanging or resting', () => {
  // The thinnest branch each kind may sit on, and the steepest slope a bird or nest may rest on.
  const minRadius = { bird: 0.008, nest: 0.01, fruit: 0.006, lantern: 0.006 };
  const steepestRest = 0.55;
  for (const { seed, genes, differences } of all) {
    const crownRadius = crownRadiusOf(growTree(createSpecies(seed), genes, 1));
    for (const d of differences.filter((x) => x.attach)) {
      assert.ok(d.attach.radius >= minRadius[d.kind], `seed ${seed}: a ${d.kind} on a branch of radius ${d.attach.radius}`);
      const fromTrunk = Math.hypot(d.attach.position[0], d.attach.position[2]);
      assert.ok(fromTrunk >= 0.5 * crownRadius, `seed ${seed}: a ${d.kind} ${fromTrunk.toFixed(2)} from the trunk of a crown ${crownRadius.toFixed(2)} wide`);
      const lift = d.position[1] - d.attach.position[1];
      const sitsOnTop = d.kind === 'bird' || d.kind === 'nest';
      if (sitsOnTop) {
        assert.ok(lift > 0, `${d.kind} sits on its branch`);
        assert.ok(Math.abs(d.attach.tangent[1]) <= steepestRest, `seed ${seed}: a ${d.kind} on a slope of ${d.attach.tangent[1].toFixed(2)}`);
      } else {
        assert.ok(lift < 0, `${d.kind} hangs from its branch`);
      }
      assert.deepEqual([d.position[0], d.position[2]], [d.attach.position[0], d.attach.position[2]]);
    }
  }
});

test('a changed bough has at least 90 leaves and is not in the middle of the crown', () => {
  let boughs = 0;
  for (const { seed, genes, differences } of all) {
    const species = createSpecies(seed);
    const data = growTree(species, genes, 1);
    const crownRadius = crownRadiusOf(data);
    const { leafDensity } = mapGenes(genes);
    for (const d of differences.filter((x) => !x.attach)) {
      boughs++;
      const onBough = branchSubtree(species, d.branch);
      let leaves = 0;
      for (let k = 0; k < data.leafCount && species.leaves[k].threshold < leafDensity; k++) {
        if (onBough[species.leaves[k].branch]) leaves++;
      }
      assert.ok(leaves >= 90, `seed ${seed}: a ${d.kind} with ${leaves} leaves`);
      const fromTrunk = Math.hypot(d.position[0], d.position[2]);
      assert.ok(fromTrunk >= 0.3 * crownRadius, `seed ${seed}: a ${d.kind} ${fromTrunk.toFixed(2)} from the trunk`);
    }
  }
  assert.ok(boughs > 200, `${boughs} bough differences`);
});

test('the plan depends only on the seed and the traits', () => {
  const { seed, genes, differences } = all[7];
  assert.deepEqual(planDifferences(seed, genes), differences);
  assert.notDeepEqual(planDifferences(seed, genes, mulberry32(999)), differences);
});

test('named kinds must be distinct and fit the tree like random ones', () => {
  const { seed, genes } = all[3];
  assert.throws(() => planDifferences(seed, genes, undefined, ['bird', 'bird', 'bird']), /do not fit/);
  assert.throws(() => planDifferences(seed, genes, undefined, ['bird', 'nest', 'fruit', 'lantern']), /do not fit/);
  const lateAutumn = { ...genes, autumn: 0.9 };
  assert.throws(() => planDifferences(seed, lateAutumn, undefined, ['autumnBough', 'bird', 'nest']), /do not fit/);
  // One kind alone is allowed, for looking at that kind.
  assert.equal(planDifferences(seed, genes, undefined, ['lantern']).length, 1);
});

test('kinds can be named, and the changes split by tree', () => {
  const { seed, genes } = all[3];
  const differences = planDifferences(seed, genes, undefined, ['bird', 'missingBranch', 'blossomBough']);
  assert.deepEqual(differences.map((d) => d.kind), ['bird', 'missingBranch', 'blossomBough']);
  for (const tree of ['left', 'right']) {
    const edit = editFor(differences, tree);
    assert.equal(edit.omit.length, differences.filter((d) => d.tree === tree && d.kind === 'missingBranch').length);
    assert.equal(edit.tints.length, differences.filter((d) => d.tree === tree && d.kind === 'blossomBough').length);
    assert.equal(objectsFor(differences, tree).length, differences.filter((d) => d.tree === tree && d.kind === 'bird').length);
  }
  const total = ['left', 'right'].reduce((sum, tree) => sum + editFor(differences, tree).omit.length + editFor(differences, tree).tints.length + objectsFor(differences, tree).length, 0);
  assert.equal(total, DIFFERENCES);
});

test('a ray hits a sphere within its radius, and misses outside it or behind', () => {
  const origin = [0, 0, 10];
  const ahead = [0, 0, -1];
  assert.ok(Math.abs(rayHitsSphere(origin, ahead, [0, 0, 0], 0.5) - 10) < 1e-9);
  assert.notEqual(rayHitsSphere(origin, ahead, [0.49, 0, 0], 0.5), null);
  assert.equal(rayHitsSphere(origin, ahead, [0.51, 0, 0], 0.5), null);
  assert.equal(rayHitsSphere(origin, [0, 0, 1], [0, 0, 0], 0.5), null, 'behind the origin');
  // The camera inside a difference's area (zoomed in close), its centre 0.23 behind: a click
  // looking away does not find it; one looking at it does.
  const inside = [0, 2, 0.23];
  const bird = [{ position: [0, 2, 0], radius: 0.5 }];
  assert.equal(findDifferenceAt(bird, { origin: inside, direction: [0, 0, 1] }, { left: 0, right: 0 }), null, 'looking away');
  assert.equal(findDifferenceAt(bird, { origin: inside, direction: [0, 0, -1] }, { left: 0, right: 0 })?.index, 0, 'looking at it');
});

test('a click finds the difference it is aimed at, on either tree', () => {
  const differences = [
    { position: [1, 2, 0], radius: 0.5 },
    { position: [1, 2, -3], radius: 0.5 },
  ];
  const treeX = { left: -4.6, right: 4.6 };
  // Straight at the first difference on the right tree, from the front.
  const atRight = findDifferenceAt(differences, { origin: [5.6, 2, 10], direction: [0, 0, -1] }, treeX);
  assert.deepEqual([atRight.index, atRight.tree], [0, 'right']);
  // The same place on the left tree, where the object is missing, counts too.
  const atLeft = findDifferenceAt(differences, { origin: [-3.6, 2, 10], direction: [0, 0, -1] }, treeX);
  assert.deepEqual([atLeft.index, atLeft.tree], [0, 'left']);
  // Two differences in line with the click: the one the ray passes closest to is meant, not the
  // nearer one.
  const inLine = [
    { position: [0, 2, 3], radius: 0.5 },
    { position: [0.3, 2, 0.5], radius: 0.5 },
  ];
  const aimedFar = findDifferenceAt(inLine, { origin: [4.6 + 0.3, 2, 10], direction: [0, 0, -1] }, treeX);
  assert.equal(aimedFar.index, 1, 'aimed at the second, though the first is nearer');
  const aimedNear = findDifferenceAt(inLine, { origin: [4.6, 2, 10], direction: [0, 0, -1] }, treeX);
  assert.equal(aimedNear.index, 0);
  // A ray through empty space.
  assert.equal(findDifferenceAt(differences, { origin: [0, 8, 10], direction: [0, 0, -1] }, treeX), null);
});

test('every planned difference is found by a click aimed at it from outside its tree', () => {
  const treeX = { left: -4.6, right: 4.6 };
  let checked = 0;
  for (const { seed, differences } of all) {
    differences.forEach((d, index) => {
      const offset = [d.position[0], d.position[2]];
      const length = Math.hypot(...offset);
      if (length < 0.4) return;
      const out = offset.map((v) => v / length);
      const trunk = treeX[d.tree];
      const centre = [trunk + d.position[0], d.position[1], d.position[2]];
      const rayFrom = (origin) => {
        const towards = centre.map((v, i) => v - origin[i]);
        const norm = Math.hypot(...towards);
        return { origin, direction: towards.map((v) => v / norm) };
      };
      const ownSide = [trunk + out[0] * 17, d.position[1] + 1.5, out[1] * 17];
      assert.equal(findDifferenceAt(differences, rayFrom(ownSide), treeX)?.index, index, `seed ${seed}: ${d.kind} from its side`);
      checked++;
    });
  }
  assert.ok(checked > 1000, `${checked} differences checked`);
});

// Where the wind has moved a leaf's tip at time `t`, as the leaf shader draws it (materials.js:
// flutter along the leaf's own z, then its matrix, then swayOffset with uWind 1).
function swayingTip(matrix, anchor, flex, t) {
  const flutter = Math.sin(t * 7 + anchor[0] * 13 + anchor[1] * 7) * 0.12;
  const local = [0, 1, flutter];
  const placed = [0, 1, 2].map((row) => matrix[row] * local[0] + matrix[4 + row] * local[1] + matrix[8 + row] * local[2] + matrix[12 + row]);
  const phase = anchor[0] * 0.35 + anchor[2] * 0.25;
  const gust = 0.65 + 0.35 * Math.sin(t * 0.37 + anchor[0] * 0.05);
  const sx = Math.sin(t * 1.1 + phase) * 0.6 + Math.sin(t * 2.3 + phase * 1.7) * 0.25;
  const sz = Math.cos(t * 0.9 + phase * 1.3) * 0.35;
  const sway = [sx + 0.35, -Math.abs(sx) * 0.12, sz].map((v) => v * flex * gust * 0.16);
  return placed.map((v, i) => v + sway[i]);
}

test('a click on the drawn tip of any leaf of a changed bough is a find, of that bough unless another difference is better aimed at', () => {
  const treeX = { left: -4.6, right: 4.6 };
  const times = [0, 2.3, 4.9, 6, 7.7, 11.3];
  let clicks = 0;
  let outside = 0;
  let thisBough = 0;
  // Seed 5005 at 6 seconds had a tip that a fixed reach of 0.3 round the leaf's base missed.
  for (const { seed, genes, differences } of all.slice(0, 120)) {
    const species = createSpecies(seed);
    const data = growTree(species, genes, 1);
    const { leafDensity } = mapGenes(genes);
    differences.forEach((d, index) => {
      if (!d.leaves) return;
      const onBough = branchSubtree(species, d.branch);
      for (let k = 0; k < data.leafCount && species.leaves[k].threshold < leafDensity; k++) {
        if (!onBough[species.leaves[k].branch]) continue;
        const matrix = data.leafMatrices.subarray(k * 16, k * 16 + 16);
        const anchor = [...data.leafAnchors.subarray(k * 4, k * 4 + 3)];
        const flex = data.leafAnchors[k * 4 + 3];
        for (const t of times) {
          const tip = swayingTip(matrix, anchor, flex, t);
          const point = [treeX[d.tree] + tip[0], tip[1], tip[2]];
          const origin = [point[0], point[1] + 1, point[2] + 15];
          const towards = point.map((v, i) => v - origin[i]);
          const norm = Math.hypot(...towards);
          const hit = findDifferenceAt(differences, { origin, direction: towards.map((v) => v / norm) }, treeX);
          clicks++;
          if (Math.hypot(...tip.map((v, i) => v - d.position[i])) > d.radius) outside++;
          assert.notEqual(hit, null, `seed ${seed}: the tip of a leaf of the ${d.kind} at ${t} s is not found`);
          if (hit.index === index) thisBough++;
        }
      }
    });
  }
  // Tips outside the bough's radius exist, so the leaf reach is what finds them.
  assert.ok(outside > 100, `${outside} of ${clicks} tips lie outside their bough's radius`);
  // Where two differences overlap on the screen, a tip can be better aimed at the other one (a
  // bird half a unit away): 1723 of 152820 tip clicks here, 1.1 percent.
  assert.ok(thisBough / clicks > 0.985, `${thisBough} of ${clicks} tip clicks found their own bough`);
});

test('a click anywhere up a lantern\'s thread finds the lantern', () => {
  const treeX = { left: -4.6, right: 4.6 };
  let clicks = 0;
  let onLantern = 0;
  for (const { seed, differences } of all) {
    differences.forEach((d, index) => {
      if (d.kind !== 'lantern') return;
      assert.equal(d.reachUp, 0.63);
      for (const up of [0.3, 0.5, 0.62]) {
        const world = [treeX[d.tree] + d.position[0], d.position[1] + up, d.position[2]];
        const hit = findDifferenceAt(differences, { origin: [world[0], world[1], world[2] + 15], direction: [0, 0, -1] }, treeX);
        clicks++;
        assert.notEqual(hit, null, `seed ${seed}: the lantern's thread ${up} above its centre`);
        if (hit.index === index) onLantern++;
      }
    });
  }
  // A thread can run through a changed bough's leaves; there the better-aimed one is found.
  assert.ok(clicks > 150 && onLantern / clicks > 0.95, `${onLantern} of ${clicks} thread clicks found the lantern`);
});

// The words the player reads when a round ends, written out here rather than taken from LABELS,
// so a label swapped or mistyped in the game fails this test.
test('each kind of difference is named for what it is', () => {
  assert.deepEqual(LABELS, {
    bird: 'a bird',
    nest: 'a nest',
    fruit: 'a cluster of apples',
    lantern: 'a lantern',
    blossomBough: 'a bough in blossom',
    autumnBough: 'a bough that turned early',
    missingBranch: 'a missing branch',
  });
});
