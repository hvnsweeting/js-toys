import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { randomGenes } from '../src/traits.js';
import { mulberry32 } from '../src/random.js';

// materials.js paints its textures on a canvas. Node has no document, so give it
// a canvas with a 2D context that accepts every call and draws no pixels; the geometry
// tested here does not depend on the pictures.
function inertContext() {
  const handler = {
    get: (target, name) => (name in target ? target[name] : () => new Proxy({}, handler)),
    set: (target, name, value) => {
      target[name] = value;
      return true;
    },
  };
  return new Proxy({}, handler);
}
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => inertContext() }),
};
const { TreeView } = await import('../src/treeView.js');

function grownView(seed) {
  const view = new TreeView(new THREE.Scene(), 0);
  view.setTree(seed, randomGenes(mulberry32(seed)), 1);
  view.rebuild();
  return view;
}

test('bark triangles face outward, matching their vertex normals', () => {
  const view = grownView(21);
  const geometry = view.bark.geometry;
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const index = geometry.index.array;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();
  let agreeing = 0;
  let measured = 0;
  for (let i = 0; i < index.length; i += 3) {
    a.fromBufferAttribute(position, index[i]);
    b.fromBufferAttribute(position, index[i + 1]);
    c.fromBufferAttribute(position, index[i + 2]);
    // three.js treats counter-clockwise as the front: (b - a) x (c - a) points out of it.
    faceNormal.subVectors(b, a).cross(c.sub(a));
    if (faceNormal.lengthSq() < 1e-14) continue;
    vertexNormal.fromBufferAttribute(normal, index[i]);
    measured++;
    if (faceNormal.dot(vertexNormal) > 0) agreeing++;
  }
  assert.ok(measured > 1000);
  assert.ok(agreeing / measured > 0.99, `${agreeing} of ${measured} triangles face outward`);
});

test('grown bounds are right after switching to a species with the same branch count', () => {
  // Seeds 18 and 14 both have 203 branches, but 18 has one more point. A scratch
  // buffer kept from 18 would still hold that extra point when 14 is measured, and
  // would put a branch of the previous tree into the bounds (0.87 m off with these genes).
  const genes = randomGenes(mulberry32(1));
  const switched = new TreeView(new THREE.Scene(), 0);
  switched.setTree(18, genes, 1);
  switched.grownBounds();
  assert.equal(switched.species.branches.length, 203);
  switched.setTree(14, genes, 1);
  assert.equal(switched.species.branches.length, 203);

  const fresh = new TreeView(new THREE.Scene(), 0);
  fresh.setTree(14, genes, 1);
  assert.deepEqual(switched.grownBounds(), fresh.grownBounds());
});

test('no vertex of the drawn leaves or blossoms goes below the foliage clearance', () => {
  // Ground sweepers: strongly weeping, short, long-reaching, fully leafed and in flower.
  const lowestFoliageY = 0.04;
  for (const seed of [3, 5, 7]) {
    const view = new TreeView(new THREE.Scene(), 0);
    view.setTree(seed, { ...randomGenes(mulberry32(seed)), weeping: 1, reach: 1, height: 0, lushness: 1, blossom: 1 }, 1);
    view.rebuild();
    for (const mesh of [view.leaves, view.blossoms]) {
      assert.ok(mesh.count > 0);
      const vertices = mesh.geometry.attributes.position;
      const matrix = new THREE.Matrix4();
      const vertex = new THREE.Vector3();
      let lowest = Infinity;
      for (let k = 0; k < mesh.count; k++) {
        mesh.getMatrixAt(k, matrix);
        for (let v = 0; v < vertices.count; v++) {
          lowest = Math.min(lowest, vertex.fromBufferAttribute(vertices, v).applyMatrix4(matrix).y);
        }
      }
      assert.ok(lowest >= lowestFoliageY - 1e-5, `seed ${seed}: a vertex at ${lowest.toFixed(4)}`);
    }
  }
});

test('grown bounds can be measured for other genes without disturbing the tree on screen', () => {
  const view = grownView(21);
  const own = view.grownBounds();
  const taller = view.grownBounds({ ...view.genes, height: Math.min(1, view.genes.height + 0.3) });
  assert.notDeepEqual(taller, own, 'other genes give other bounds');
  assert.deepEqual(view.grownBounds(), own, 'the tree keeps its own genes');
});

test('objects and rings can be put on a tree, and are cleared when another tree is planted', async () => {
  const { planDifferences, objectsFor } = await import('../src/differences.js');
  const genes = randomGenes(mulberry32(5));
  const differences = planDifferences(1234, genes, undefined, ['bird', 'nest', 'lantern']);
  const view = new TreeView(new THREE.Scene(), 0);
  view.setTree(1234, genes, 1);
  const all = objectsFor(differences, 'left').concat(objectsFor(differences, 'right'));
  view.setProps(all);
  assert.equal(view.propsGroup.children.length, 3);
  for (const [i, prop] of view.propsGroup.children.entries()) {
    const { attach, position, radius } = all[i];
    const box = new THREE.Box3().setFromObject(prop);
    const centre = box.getCenter(new THREE.Vector3());
    assert.ok(centre.distanceTo(new THREE.Vector3(...position)) < radius, `${all[i].kind} is where the difference says`);
    for (const mesh of prop.children) {
      const anchors = mesh.geometry.attributes.aAnchor;
      assert.equal(anchors.count, mesh.geometry.attributes.position.count);
      assert.deepEqual([anchors.getX(0), anchors.getY(0), anchors.getZ(0)], attach.position.map((v) => Math.fround(v)));
      assert.equal(anchors.getW(0), Math.fround(attach.flex));
      assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    }
  }
  view.setRings([{ position: [0, 2, 0], radius: 0.5, color: '#7ccf4a' }, { position: [1, 2, 0], radius: 0.5, color: '#ffd166', pulse: true }]);
  assert.equal(view.ringsGroup.children.length, 2);
  view.growTo(1);
  view.update(0.1);
  assert.equal(view.propsGroup.visible, true, 'objects show on a fully grown tree');
  view.setTree(1234, genes, 0.5);
  view.growTo(1);
  view.update(0);
  assert.equal(view.propsGroup.children.length, 0);
  assert.equal(view.ringsGroup.children.length, 0);
  view.setProps(all);
  view.update(0);
  assert.equal(view.propsGroup.visible, false, 'objects stay hidden while the tree is still growing');
});

test('each object reaches up from its centre as far as the click rules say, and no further', async () => {
  const { createProp } = await import('../src/props.js');
  const { OBJECT_REACH_UP } = await import('../src/differences.js');
  // Click radii by kind (differences.js); a part above the radius needs reachUp to be clickable.
  const radius = { bird: 0.5, nest: 0.45, fruit: 0.45, lantern: 0.4 };
  const attach = { position: [0, 0, 0], tangent: [1, 0, 0], radius: 0.02, flex: 0.5 };
  for (const kind of Object.keys(OBJECT_REACH_UP)) {
    for (let draw = 0; draw < 5; draw++) {
      const prop = createProp({ kind, position: [0, 0, 0], attach }, mulberry32(draw));
      const top = new THREE.Box3().setFromObject(prop).max.y;
      const reach = Math.max(radius[kind], OBJECT_REACH_UP[kind]);
      assert.ok(top <= reach + 0.01, `${kind} reaches ${top.toFixed(3)} up, clickable to ${reach}`);
      if (OBJECT_REACH_UP[kind] > 0) assert.ok(top >= OBJECT_REACH_UP[kind] - 0.01, `${kind} reaches only ${top.toFixed(3)} up`);
    }
  }
});

test('every kind of object can be built', async () => {
  const { createProp } = await import('../src/props.js');
  const attach = { position: [1, 2, 3], tangent: [1, 0, 0], radius: 0.02, flex: 0.5 };
  for (const kind of ['bird', 'nest', 'fruit', 'lantern']) {
    const prop = createProp({ kind, position: [1, 2.1, 3], attach });
    assert.ok(prop.children.length >= 4, kind);
  }
  assert.throws(() => createProp({ kind: 'dragon', position: [0, 0, 0], attach }), /no object/);
});

test('a tree planted with a left-out branch has smaller bounds than the same tree whole', async () => {
  const { planDifferences, editFor } = await import('../src/differences.js');
  const genes = randomGenes(mulberry32(5));
  // Seed 1244's missing branch reaches out to the right and up, so leaving it out pulls in maxX
  // (by 0.73) and maxY (by 0.68). On many seeds the bounds do not change at all.
  const differences = planDifferences(1244, genes, undefined, ['missingBranch', 'bird', 'nest']);
  const side = differences[0].tree;
  const whole = new TreeView(new THREE.Scene(), 0);
  whole.setTree(1244, genes, 1);
  const cut = new TreeView(new THREE.Scene(), 0);
  cut.setTree(1244, genes, 1, editFor(differences, side));
  const a = whole.grownBounds();
  const b = cut.grownBounds();
  const noLarger = b.maxX <= a.maxX + 1e-9 && b.minX >= a.minX - 1e-9 && b.maxY <= a.maxY + 1e-9 && b.minZ >= a.minZ - 1e-9 && b.maxZ <= a.maxZ + 1e-9;
  assert.ok(noLarger, 'leaving a branch out never makes the tree larger');
  assert.ok(a.maxX - b.maxX > 0.5, `maxX ${a.maxX} whole, ${b.maxX} cut`);
  assert.ok(a.maxY - b.maxY > 0.5, `maxY ${a.maxY} whole, ${b.maxY} cut`);
});

// Each kind of object is built from its own parts, written out here by hand from props.js, so
// a builder swapped or changed (a nest drawn where the game says "a bird") fails.
test('each kind of object is built from its own parts', async () => {
  const { createProp } = await import('../src/props.js');
  const attach = { position: [0, 0, 0], tangent: [1, 0, 0], radius: 0.02, flex: 0.5 };
  const partsOf = (kind) => {
    const prop = createProp({ kind, position: [0, 0, 0], attach }, mulberry32(3));
    const counts = {};
    for (const mesh of prop.children) counts[mesh.geometry.type] = (counts[mesh.geometry.type] ?? 0) + 1;
    const glows = prop.children.some((mesh) => mesh.material.emissive && mesh.material.emissive.getHex() !== 0);
    return { counts, glows };
  };
  assert.deepEqual(partsOf('bird'), { counts: { SphereGeometry: 7, ConeGeometry: 1, BoxGeometry: 1 }, glows: false });
  assert.deepEqual(partsOf('nest'), { counts: { TorusGeometry: 1, SphereGeometry: 4 }, glows: false });
  assert.deepEqual(partsOf('fruit'), { counts: { SphereGeometry: 4, CylinderGeometry: 4 }, glows: false });
  assert.deepEqual(partsOf('lantern'), { counts: { CylinderGeometry: 3, ConeGeometry: 1 }, glows: true });
});
