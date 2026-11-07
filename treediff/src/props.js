// The objects that a difference adds to a tree (a bird, a nest, apples, a lantern), drawn from
// simple shapes, and the ring that marks a found difference. Each object is built in tree space
// and given the wind-sway anchor of the branch point it hangs from, so it moves with its branch.

import * as THREE from 'three';
import { addSway, swayingDepthMaterial } from './materials.js';

// Objects are drawn this much larger than the measurements below, which are in metres.
const PROP_SCALE = 1.4;

const materials = new Map();
function material(color, { emissive = null, roughness = 0.75 } = {}) {
  const key = `${color}|${emissive}`;
  if (!materials.has(key)) {
    const standard = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, emissive: emissive ?? '#000000', emissiveIntensity: emissive ? 1.1 : 0 });
    materials.set(key, addSway(standard, 'branch'));
  }
  return materials.get(key);
}

let depthMaterial = null;

const BIRD_COLOURS = [
  { body: '#7a5a3a', breast: '#d2543a' },
  { body: '#3f6fb5', breast: '#e9eef5' },
  { body: '#6e6a62', breast: '#e7c230' },
];

// Parts are described in the object's own space: its centre at the origin, +y up, +z forward.
function bird(rng) {
  const colours = BIRD_COLOURS[Math.floor(rng() * BIRD_COLOURS.length)];
  const body = material(colours.body);
  const dark = material('#1c1c1c', { roughness: 0.4 });
  return [
    { geometry: new THREE.SphereGeometry(1, 14, 10), material: body, scale: [0.1, 0.09, 0.17] },
    { geometry: new THREE.SphereGeometry(1, 12, 8), material: material(colours.breast), position: [0, -0.015, 0.07], scale: [0.085, 0.07, 0.1] },
    { geometry: new THREE.SphereGeometry(0.07, 12, 10), material: body, position: [0, 0.07, 0.15] },
    { geometry: new THREE.ConeGeometry(0.025, 0.07, 8), material: material('#e0a030'), position: [0, 0.065, 0.24], rotation: [Math.PI / 2, 0, 0] },
    { geometry: new THREE.BoxGeometry(0.09, 0.012, 0.16), material: body, position: [0, 0.03, -0.2], rotation: [-0.35, 0, 0] },
    { geometry: new THREE.SphereGeometry(1, 10, 8), material: body, position: [0.085, 0.01, -0.01], scale: [0.02, 0.07, 0.13] },
    { geometry: new THREE.SphereGeometry(1, 10, 8), material: body, position: [-0.085, 0.01, -0.01], scale: [0.02, 0.07, 0.13] },
    { geometry: new THREE.SphereGeometry(0.012, 6, 6), material: dark, position: [0.045, 0.09, 0.19] },
    { geometry: new THREE.SphereGeometry(0.012, 6, 6), material: dark, position: [-0.045, 0.09, 0.19] },
  ];
}

function nest() {
  const twigs = material('#6b4a2b', { roughness: 0.95 });
  const egg = material('#9ccfd8', { roughness: 0.5 });
  return [
    { geometry: new THREE.TorusGeometry(0.14, 0.05, 8, 18), material: twigs, rotation: [Math.PI / 2, 0, 0] },
    { geometry: new THREE.SphereGeometry(1, 12, 8), material: material('#4a3320', { roughness: 0.95 }), position: [0, -0.01, 0], scale: [0.14, 0.04, 0.14] },
    { geometry: new THREE.SphereGeometry(0.045, 10, 8), material: egg, position: [0.05, 0.045, 0], scale: [1, 1.25, 1] },
    { geometry: new THREE.SphereGeometry(0.045, 10, 8), material: egg, position: [-0.05, 0.045, 0.02], scale: [1, 1.25, 1] },
    { geometry: new THREE.SphereGeometry(0.045, 10, 8), material: egg, position: [0, 0.045, -0.06], scale: [1, 1.25, 1] },
  ];
}

function fruit(rng) {
  const skin = material(rng() < 0.5 ? '#c0392b' : '#b8c23a', { roughness: 0.45 });
  const stem = material('#4b3a22');
  const apples = [[0, 0, 0], [0.09, -0.07, 0.03], [-0.08, -0.05, -0.04], [0.02, -0.12, -0.08]];
  return apples.flatMap(([x, y, z]) => [
    { geometry: new THREE.SphereGeometry(0.07, 12, 10), material: skin, position: [x, y, z] },
    { geometry: new THREE.CylinderGeometry(0.006, 0.006, 0.22, 5), material: stem, position: [x, y + 0.18, z] },
  ]);
}

function lantern() {
  const dark = material('#3a2a22');
  return [
    { geometry: new THREE.CylinderGeometry(0.07, 0.07, 0.16, 10), material: material('#ffcf7a', { emissive: '#ff9d3a', roughness: 0.4 }) },
    { geometry: new THREE.ConeGeometry(0.09, 0.07, 10), material: dark, position: [0, 0.115, 0] },
    { geometry: new THREE.CylinderGeometry(0.075, 0.075, 0.02, 10), material: dark, position: [0, -0.09, 0] },
    { geometry: new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), material: dark, position: [0, 0.3, 0] },
  ];
}

const BUILDERS = { bird, nest, fruit, lantern };

// The object for a difference, as a group of meshes in tree space. `difference` comes from
// planDifferences: its kind, its centre `position` and its `attach` point on the branch.
export function createProp(difference, rng = Math.random) {
  const build = BUILDERS[difference.kind];
  if (!build) throw new Error(`no object for the kind ${difference.kind}`);
  depthMaterial ??= swayingDepthMaterial('branch');
  const placement = new THREE.Matrix4().compose(
    new THREE.Vector3(...difference.position),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2),
    new THREE.Vector3(PROP_SCALE, PROP_SCALE, PROP_SCALE),
  );
  const group = new THREE.Group();
  // Which kind this object was built as, so the browser check can match it with the plan.
  group.userData.kind = difference.kind;
  const { position: anchor, flex } = difference.attach;
  for (const part of build(rng)) {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...(part.position ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0]))),
      new THREE.Vector3(...(part.scale ?? [1, 1, 1])),
    );
    // Baked into tree space, so the sway shader can move every vertex with its branch point.
    const geometry = part.geometry.applyMatrix4(placement.clone().multiply(local));
    const anchors = new Float32Array(geometry.attributes.position.count * 4);
    for (let v = 0; v < anchors.length; v += 4) anchors.set([anchor[0], anchor[1], anchor[2], flex], v);
    geometry.setAttribute('aAnchor', new THREE.BufferAttribute(anchors, 4));
    const mesh = new THREE.Mesh(geometry, part.material);
    mesh.customDepthMaterial = depthMaterial;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

export function disposeProp(group) {
  for (const mesh of group.children) mesh.geometry.dispose();
}

let ringTexture = null;
function ringImage() {
  if (ringTexture) return ringTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.lineWidth = 9;
  context.strokeStyle = '#ffffff';
  context.beginPath();
  context.arc(64, 64, 54, 0, Math.PI * 2);
  context.stroke();
  ringTexture = new THREE.CanvasTexture(canvas);
  ringTexture.colorSpace = THREE.SRGBColorSpace;
  return ringTexture;
}

// A ring around `position` (tree space) with the given radius. It is drawn over the foliage, so a
// difference inside the crown can still be seen marked.
export function createRing(position, radius, color) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringImage(), color, transparent: true, depthTest: false, depthWrite: false }));
  sprite.position.set(...position);
  sprite.scale.setScalar(radius * 2.4);
  sprite.renderOrder = 10;
  return sprite;
}
