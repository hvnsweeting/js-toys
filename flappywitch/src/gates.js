import * as THREE from 'three';
import { WISP_DEPTH_OFFSET } from './rules.js';

const stone = new THREE.MeshStandardMaterial({ color: 0x302638, roughness: 1 });
const face = new THREE.MeshStandardMaterial({ color: 0x4b3a51, roughness: 1 });
const trim = new THREE.MeshStandardMaterial({ color: 0x211c2c, roughness: .92 });
const glow = new THREE.MeshBasicMaterial({ color: 0xffcc75, toneMapped: false });
for (const material of [stone, face, trim, glow]) material.isSharedMaterial = true;

function block(group, width, height, depth, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

export function createGateVisual(gate) {
  const group = new THREE.Group();
  const sides = [];
  const edge = gate.halfGap;
  const outside = 5.1;
  const height = outside - edge;

  // The middle has no geometry, so the opening stays readable from an angle.
  for (const side of [-1, 1]) {
    const section = new THREE.Group();
    group.add(section);
    sides.push({ section, side });
    const center = side * (edge + height / 2);
    block(section, 3.2, height, .72, 0, center, 0, stone);
    block(section, 3.02, height - .2, .055, 0, center, .39, face);
    block(section, 3.48, .18, .88, 0, side * (edge + .09), .03, trim);
    block(section, 3.16, .055, .51, 0, side * (edge + .025), .28, glow);
    for (const x of [-1.2, 1.2]) {
      block(section, .075, height - .3, .06, x, center, .43, trim);
    }
    for (let row = 0; row < 3; row++) {
      const y = edge + .52 + row * .76;
      block(section, 2.55, .035, .065, 0, side * y, .43, trim);
    }
  }
  for (const x of [-1.6, 1.6]) {
    block(group, .22, 10.2, .85, x, 0, 0, trim);
  }

  const fly = new THREE.Group();
  fly.add(new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xc9ffe0, toneMapped: false })));
  fly.add(new THREE.Mesh(new THREE.SphereGeometry(.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9fffc7, transparent: true, opacity: .24, depthWrite: false })));
  fly.position.set(0, gate.fireflyY - gate.baseY, WISP_DEPTH_OFFSET);
  group.add(fly);

  const ribbons = new THREE.Group();
  if (gate.gust) {
    const material = new THREE.MeshBasicMaterial({ color: 0xd6ece0, transparent: true, opacity: .5, side: THREE.DoubleSide });
    for (let i = 0; i < 5; i++) {
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(.65, .025), material);
      ribbon.position.set(-1.15 + i * .56, (i - 2) * .26, .9);
      ribbon.rotation.z = gate.gust > 0 ? .22 : -.22;
      ribbons.add(ribbon);
    }
  }
  group.add(ribbons);
  return { group, fly, ribbons, sides, initialHalfGap: edge };
}

export function measureGateDepth(visual) {
  visual.group.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  for (const { section } of visual.sides) bounds.expandByObject(section);
  for (const child of visual.group.children) {
    if (child.isMesh) bounds.expandByObject(child);
  }
  return { front: -bounds.min.z, back: bounds.max.z };
}
