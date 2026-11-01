import * as THREE from 'three';
import { FLOOR, PLAYER_Z } from './rules.js';

function haloTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,220,139,.65)');
  gradient.addColorStop(.3, 'rgba(255,173,67,.3)');
  gradient.addColorStop(1, 'rgba(255,128,35,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function oval(parent, material, position, scale) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function rod(parent, material, radius, length, position, rotationX = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
  mesh.position.set(...position);
  mesh.rotation.x = rotationX;
  parent.add(mesh);
  return mesh;
}

function cloakPanel(parent, material, x) {
  const points = [
    x, .24, -.06, x, -.35, .63, x, -.28, .12,
    x, .24, -.06, x, -.31, .12, x, .04, -.37,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  parent.add(mesh);
}

export function createWitch() {
  const group = new THREE.Group();
  const solid = new THREE.Group();
  group.add(solid);
  const dark = new THREE.MeshStandardMaterial({ color: 0x161323, roughness: .85, side: THREE.DoubleSide });
  const cloakMaterial = new THREE.MeshStandardMaterial({ color: 0x482257, roughness: .9, side: THREE.DoubleSide });
  const purple = new THREE.MeshStandardMaterial({ color: 0x8e55bd, roughness: .7 });
  const green = new THREE.MeshBasicMaterial({ color: 0xaff279 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x20172c, roughness: .9 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x9d633a, roughness: 1 });
  const straw = new THREE.MeshStandardMaterial({ color: 0xd5a35f, roughness: 1 });
  const emberMaterial = new THREE.MeshBasicMaterial({ color: 0xffcb65, toneMapped: false, transparent: true });

  // The broom follows the depth axis: the witch faces incoming gates at negative z.
  rod(solid, wood, .045, 3.12, [0, -.24, -.02], Math.PI / 2);
  oval(solid, straw, [0, -.24, 1.56], [.14, .15, .43]);
  for (let i = -2; i <= 2; i++) {
    const bristle = rod(solid, straw, .018, .62, [i * .047, -.28 + Math.abs(i) * .016, 1.8], Math.PI / 2 + i * .08);
    bristle.rotation.z = i * .09;
  }
  oval(solid, dark, [0, .03, .01], [.2, .32, .31]);
  const cloak = new THREE.Group();
  cloak.position.set(0, .02, 0);
  cloakPanel(cloak, cloakMaterial, .205);
  cloakPanel(cloak, cloakMaterial, -.205);
  solid.add(cloak);
  oval(solid, cloakMaterial, [0, .12, .06], [.23, .27, .28]);
  for (const x of [-.16, .22]) {
    oval(solid, cloakMaterial, [x, -.16, -.13], [.09, .18, .14]);
    oval(solid, boot, [x, -.36, -.23], [.1, .085, .19]);
  }
  oval(solid, green, [0, .38, -.36], [.2, .2, .21]);
  oval(solid, dark, [-.1, .42, -.18], [.12, .16, .08]);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.055, .21, 10), green);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(.035, .35, -.6);
  solid.add(nose);
  oval(solid, dark, [.168, .41, -.45], [.018, .023, .025]);
  oval(solid, purple, [.16, .28, -.43], [.023, .012, .05]);
  const brim = rod(solid, dark, .33, .045, [0, .55, -.33]);
  brim.scale.z = 1.25;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(.24, .51, 16), dark);
  hat.position.set(0, .8, -.35);
  hat.rotation.z = -.16;
  solid.add(hat);
  rod(solid, purple, .253, .07, [0, .64, -.35]);
  oval(solid, green, [.21, .07, -.43], [.07, .07, .09]);
  oval(solid, green, [-.17, .07, -.43], [.07, .07, .09]);

  rod(solid, dark, .018, .39, [0, -.47, 1.12]);
  const pumpkin = oval(solid, new THREE.MeshStandardMaterial({ color: 0xd86b21, emissive: 0xa34a08, emissiveIntensity: .8 }), [0, -.64, 1.12], [.17, .16, .17]);
  oval(solid, emberMaterial, [.14, -.63, 1.12], [.025, .065, .095]);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0xffbd65, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .85 }));
  halo.position.set(0, -.64, 1.12);
  halo.scale.set(2.3, 2.3, 1);
  group.add(halo);
  const shield = new THREE.Mesh(new THREE.TorusGeometry(.72, .035, 8, 48), new THREE.MeshBasicMaterial({ color: 0xfff4af, transparent: true, opacity: .9, toneMapped: false }));
  shield.visible = false;
  group.add(shield);
  const light = new THREE.PointLight(0xffa748, 4, 6);
  light.position.set(0, -.64, 1.12);
  group.add(light);
  group.position.set(0, .2, PLAYER_Z);
  group.scale.setScalar(.4);
  return { group, solid, cloak, cloakMaterial, pumpkin, emberMaterial, halo, light, shield };
}

export function measureWitchBounds(witch) {
  witch.group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(witch.solid);
  return {
    vertical: Math.max(bounds.max.y - witch.group.position.y, witch.group.position.y - bounds.min.y),
    front: witch.group.position.z - bounds.min.z,
    back: bounds.max.z - witch.group.position.z,
  };
}

export function measureFlightBounds(witch) {
  const originalRotation = witch.group.rotation.clone();
  const originalCloak = witch.cloak.rotation.x;
  const reach = { vertical: 0, front: 0, back: 0 };
  // Sample the full flight tilt range so the collision bounds cover poses between its endpoints.
  for (let x = -.03; x <= .030001; x += .01) {
    for (let z = -.27; z <= .270001; z += .01) {
      for (const flutter of [-.18, .18]) {
        witch.group.rotation.set(x, 0, z);
        witch.cloak.rotation.x = flutter;
        const bounds = measureWitchBounds(witch);
        reach.vertical = Math.max(reach.vertical, bounds.vertical);
        reach.front = Math.max(reach.front, bounds.front);
        reach.back = Math.max(reach.back, bounds.back);
      }
    }
  }
  witch.group.rotation.copy(originalRotation);
  witch.cloak.rotation.x = originalCloak;
  return reach;
}

export function updateWitch(witch, state, visualTime, renderSeconds) {
  const dying = state.phase === 'dying' || state.phase === 'over';
  const elapsed = dying ? state.time - state.deathTime : 0;
  const fall = dying ? Math.min(1, elapsed / .8) : 0;
  const idle = state.phase === 'title' ? Math.sin(visualTime * 1.4) * .15 : 0;
  witch.group.position.x = 0;
  // The lake surface is below the collision floor, so the tumble finishes inside it.
  witch.group.position.y = dying ? state.deathY + (FLOOR - .5 - state.deathY) * fall * fall : state.y + idle;
  const tiltBlend = 1 - Math.exp(-9.05 * renderSeconds);
  witch.group.rotation.z += (-state.velocity * .065 - witch.group.rotation.z) * tiltBlend;
  witch.group.rotation.x = Math.sin(visualTime * 2) * .025 + fall * .55;
  witch.group.rotation.y = fall * visualTime * 4;
  witch.cloak.rotation.x = Math.sin(visualTime * (5 + Math.abs(state.velocity))) * .16;
  const puff = Math.max(0, 1 - (state.time - state.lastPuff) / .24);
  const blink = state.time < state.invulnerableUntil && Math.floor(state.time * 12) % 2 === 0;
  witch.group.visible = !blink;
  witch.shield.visible = state.shield;
  witch.shield.rotation.z = visualTime * .55;
  const dim = dying ? Math.max(.04, 1 - elapsed * 1.3) : 1;
  witch.cloakMaterial.color.setHex(0x482257).multiplyScalar(Math.max(.2, dim));
  witch.pumpkin.material.emissiveIntensity = (state.shield ? 1.5 : .8) * dim;
  witch.emberMaterial.opacity = dim * (1 + puff * .25);
  witch.light.intensity = (state.shield ? 5 : 4) * dim + Math.sin(visualTime * 12) * .2 * dim;
  witch.halo.material.opacity = .85 * dim;
}
