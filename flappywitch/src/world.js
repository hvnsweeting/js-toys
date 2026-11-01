import * as THREE from 'three';
import { CEILING, FLOOR } from './rules.js';

function reflectionTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(16, 32, 1, 16, 32, 31);
  gradient.addColorStop(0, 'rgba(255,195,104,.68)');
  gradient.addColorStop(.35, 'rgba(255,163,79,.25)');
  gradient.addColorStop(1, 'rgba(255,151,67,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWorld(scene, lowQuality, random) {
  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = 256;
  cloudCanvas.height = 64;
  const cloudContext = cloudCanvas.getContext('2d');
  const cloudFade = cloudContext.createLinearGradient(0, 0, 0, 64);
  cloudFade.addColorStop(0, 'rgba(151,116,170,0)');
  cloudFade.addColorStop(.35, 'rgba(151,116,170,.22)');
  cloudFade.addColorStop(.5, 'rgba(185,146,187,.42)');
  cloudFade.addColorStop(.65, 'rgba(151,116,170,.22)');
  cloudFade.addColorStop(1, 'rgba(151,116,170,0)');
  cloudContext.fillStyle = cloudFade;
  cloudContext.fillRect(0, 0, 256, 64);
  const cloudTexture = new THREE.CanvasTexture(cloudCanvas);
  const cloudMaterial = new THREE.MeshBasicMaterial({ map: cloudTexture, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide });
  for (const z of [3, -8, -19, -30]) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(65, 2), cloudMaterial);
    band.position.set(0, CEILING, z);
    scene.add(band);
  }
  const moon = new THREE.Mesh(new THREE.SphereGeometry(3.4, 32, 24), new THREE.MeshBasicMaterial({ color: 0xffe6bd, toneMapped: false }));
  moon.position.set(-15, 11, -51);
  scene.add(moon);
  const hillMaterial = new THREE.MeshStandardMaterial({ color: 0x28243a, roughness: 1, emissive: 0x372842, emissiveIntensity: .25 });
  for (let i = 0; i < 15; i++) {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(4 + (i % 3) * 2, 6 + (i % 4) * 2, 5), hillMaterial);
    hill.position.set((i - 7) * 7, -5.8, -45 - (i % 3) * 4);
    hill.rotation.y = i * .7;
    scene.add(hill);
  }
  const rimLight = new THREE.DirectionalLight(0xffb880, lowQuality ? .75 : 1.2);
  rimLight.position.set(0, 10, -35);
  scene.add(rimLight);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 140), new THREE.MeshPhongMaterial({
    color: 0x302743, emissive: 0x211c3b, emissiveIntensity: .42, shininess: 100, side: THREE.DoubleSide,
  }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, FLOOR - .45, -20);
  scene.add(water);

  const count = lowQuality ? 28 : 85;
  const lanterns = new THREE.InstancedMesh(new THREE.SphereGeometry(.19, 10, 8), new THREE.MeshStandardMaterial({ color: 0xdb651d, emissive: 0xa13d0a, emissiveIntensity: .7 }), count);
  const caps = new THREE.InstancedMesh(new THREE.ConeGeometry(.065, .17, 6), new THREE.MeshBasicMaterial({ color: 0x547c36 }), count);
  const faceGeometry = new THREE.BufferGeometry();
  faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.13, .015, .19, -.035, .015, .19, -.085, .105, .19,
    .035, .015, .19, .13, .015, .19, .085, .105, .19,
    -.105, -.045, .19, .105, -.045, .19, .07, -.105, .19,
    -.105, -.045, .19, .07, -.105, .19, -.07, -.105, .19,
  ], 3));
  faceGeometry.computeVertexNormals();
  const candle = new THREE.InstancedMesh(faceGeometry, new THREE.MeshBasicMaterial({ color: 0xffd978, toneMapped: false, side: THREE.DoubleSide }), count);
  const reflections = new THREE.InstancedMesh(new THREE.PlaneGeometry(.65, 1.5), new THREE.MeshBasicMaterial({ map: reflectionTexture(), color: 0xffbd79, transparent: true, opacity: .65, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), count);
  const positions = Array.from({ length: count }, () => ({ x: (random() - .5) * 55, z: 5 - random() * 76, phase: random() * Math.PI * 2, scale: .6 + random() * 1.2 }));
  const dummy = new THREE.Object3D();
  function updateFloating(time) {
    positions.forEach((item, index) => {
      dummy.position.set(item.x, FLOOR - .22 + Math.sin(time * 1.5 + item.phase) * .08, item.z);
      dummy.rotation.set(0, time * .12 + item.phase, 0);
      dummy.scale.setScalar(item.scale);
      dummy.updateMatrix();
      lanterns.setMatrixAt(index, dummy.matrix);
      dummy.position.y += .22 * item.scale;
      dummy.scale.setScalar(item.scale);
      dummy.updateMatrix();
      caps.setMatrixAt(index, dummy.matrix);
      dummy.position.y -= .22 * item.scale;
      dummy.scale.setScalar(item.scale);
      dummy.updateMatrix();
      candle.setMatrixAt(index, dummy.matrix);
      dummy.position.set(item.x, FLOOR - .445, item.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(item.scale, item.scale, 1);
      dummy.updateMatrix();
      reflections.setMatrixAt(index, dummy.matrix);
    });
    lanterns.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    candle.instanceMatrix.needsUpdate = true;
    reflections.instanceMatrix.needsUpdate = true;
  }
  updateFloating(0);
  scene.add(lanterns, caps, candle, reflections);

  const batMaterial = new THREE.MeshBasicMaterial({ color: 0x1a1528, side: THREE.DoubleSide });
  const bats = [];
  for (let index = 0; index < (lowQuality ? 2 : 5); index++) {
    const bat = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(.15, 8, 6), batMaterial);
    body.scale.set(1, .7, .55);
    bat.add(body);
    const wings = [];
    for (const side of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(side * .7, .2);
      shape.lineTo(side * .52, -.12);
      shape.lineTo(side * .32, -.04);
      shape.lineTo(side * .16, -.16);
      shape.closePath();
      const wing = new THREE.Mesh(new THREE.ShapeGeometry(shape), batMaterial);
      bat.add(wing);
      wings.push({ wing, side });
    }
    bat.scale.setScalar(1.3 + index * .14);
    scene.add(bat);
    bats.push({ bat, wings, phase: index * 2.6, z: -7.5 - index });
  }

  const starCount = lowQuality ? 55 : 160;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPositions[i * 3] = (random() - .5) * 110;
    starPositions[i * 3 + 1] = 5 + random() * 35;
    starPositions[i * 3 + 2] = -40 - random() * 35;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffebc6, size: .13, transparent: true, opacity: .04 }));
  scene.add(stars);

  const emberCount = lowQuality ? 8 : 25;
  const emberPositions = new Float32Array(emberCount * 3);
  const embers = [];
  for (let i = 0; i < emberCount; i++) embers.push({ x: (random() - .5) * 16, y: random() * 8 - 3, z: -random() * 25, phase: random() * 7 });
  const emberGeometry = new THREE.BufferGeometry();
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  const emberPoints = new THREE.Points(emberGeometry, new THREE.PointsMaterial({ color: 0xffbb70, size: .08, transparent: true, opacity: .7 }));
  scene.add(emberPoints);

  function update(time, score) {
    updateFloating(time);
    for (const { bat, wings, phase, z } of bats) {
      bat.position.set(-1.2 + Math.sin(time * .65 + phase) * 2, 6 + Math.sin(time * .7 + phase) * .3, z);
      bat.rotation.y = -.25;
      for (const { wing, side } of wings) wing.rotation.z = side * Math.sin(time * 9 + phase) * .48;
    }
    stars.material.opacity = Math.min(.8, .04 + score * .025);
    embers.forEach((item, index) => {
      emberPositions[index * 3] = item.x + Math.sin(time * .5 + item.phase) * .45;
      emberPositions[index * 3 + 1] = item.y + ((time * .35 + item.phase) % 7);
      emberPositions[index * 3 + 2] = item.z;
    });
    emberGeometry.attributes.position.needsUpdate = true;
  }
  return { update, get batCount() { return bats.length; } };
}
