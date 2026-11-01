import * as THREE from 'three';
import { PLAYER_Z, gapCenter, gateSpacing } from './rules.js';
import { createGateVisual } from './gates.js';
import { createWitch, measureFlightBounds, updateWitch } from './witch.js';
import { createWorld } from './world.js';

export function createScene(host, lowQuality, random) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x493552, .011);
  scene.add(new THREE.HemisphereLight(0xffcaaa, 0x292042, 2.1));
  const sun = new THREE.DirectionalLight(0xffc48d, 2.5);
  sun.position.set(8, 9, 12);
  scene.add(sun);
  const renderer = new THREE.WebGLRenderer({ antialias: !lowQuality, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  host.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(48, 1, .1, 180);
  const witch = createWitch();
  witch.collision = measureFlightBounds(witch);
  scene.add(witch.group);
  const world = createWorld(scene, lowQuality, random);
  const gateVisuals = new Map();
  const sparks = [];
  let lastSparkPuff = -10;
  const sparkGeometry = new THREE.OctahedronGeometry(.07, 0);
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffde91, toneMapped: false });
  const splash = new THREE.Mesh(new THREE.RingGeometry(.42, .48, 48), new THREE.MeshBasicMaterial({ color: 0xb7e6df, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  splash.rotation.x = -Math.PI / 2;
  splash.position.set(0, -4.23, PLAYER_Z);
  scene.add(splash);
  let pixelQuery;
  let shake = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const target = new THREE.Vector3(0, 0, -8.5);
  const direction = new THREE.Vector3(13, 5, 15);
  let basePosition = new THREE.Vector3();
  let viewTarget = target.clone();
  let playPosition = new THREE.Vector3();
  let playTarget = new THREE.Vector3();

  function fitCamera(width, height) {
    const aspect = width / height;
    target.z = aspect < .8 ? -5 : -8.5;
    direction.set(...(aspect < .8 ? [6, 3, 18] : [13, 5, 15])).normalize();
    camera.aspect = aspect;
    camera.position.copy(target).add(direction);
    camera.lookAt(target);
    const inverse = camera.quaternion.clone().invert();
    const halfY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfX = halfY * aspect;
    let distance = 0;
    // Include the witch and the next three gate openings and stone tops.
    for (const z of [PLAYER_Z, -9, -9 - gateSpacing(1), -9 - gateSpacing(1) - gateSpacing(2)]) {
      const widthAtZ = z === PLAYER_Z ? .9 : 1.75;
      const heightAtZ = z === PLAYER_Z ? .8 : 5.1;
      for (const x of [-widthAtZ, widthAtZ]) {
        for (const y of [-heightAtZ, heightAtZ]) {
          const point = new THREE.Vector3(x, y, z).sub(target).applyQuaternion(inverse);
          distance = Math.max(distance, point.z + Math.abs(point.x) / halfX, point.z + Math.abs(point.y) / halfY);
        }
      }
    }
    distance = THREE.MathUtils.clamp(distance * 1.05, 19, 75);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const shift = distance * 2 * halfX * (aspect < .8 ? .08 : .1);
    viewTarget = target.clone().addScaledVector(right, -shift);
    basePosition = viewTarget.clone().addScaledVector(direction, distance);
    camera.position.copy(basePosition);
    camera.lookAt(viewTarget);
    camera.updateProjectionMatrix();

    const portrait = aspect < .8;
    const phonePortrait = portrait && width < 600;
    // A play view needs a legible witch and the next opening, while the title
    // keeps the wider view of the festival and its full gate structures.
    const playDistance = phonePortrait ? 14.5 : portrait ? 12.2 : 12;
    const playDirection = new THREE.Vector3(...(portrait ? [3, 2, 18] : aspect < 1.7 ? [5, 2, 18] : [10, 3, 18])).normalize();
    playTarget.set(phonePortrait ? -.5 : 0, 0, -5);
    playPosition.copy(playTarget).addScaledVector(playDirection, playDistance);
  }

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width <= 0 || height <= 0) return;
    renderer.setPixelRatio(lowQuality ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    fitCamera(width, height);
    pixelQuery?.removeEventListener('change', pixelChanged);
    pixelQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    pixelQuery.addEventListener('change', pixelChanged);
  }
  function pixelChanged() { resize(); }
  new ResizeObserver(resize).observe(host);
  resize();

  function syncGates(gates, time, visualTime, title) {
    const active = new Set(gates.map(gate => gate.index));
    for (const [index, visual] of gateVisuals) {
      if (active.has(index)) continue;
      scene.remove(visual.group);
      visual.group.traverse(object => {
        object.geometry?.dispose();
        if (object.material && !object.material.isSharedMaterial) object.material.dispose();
      });
      gateVisuals.delete(index);
    }
    for (const gate of gates) {
      let visual = gateVisuals.get(gate.index);
      if (!visual) {
        visual = createGateVisual(gate);
        gateVisuals.set(gate.index, visual);
        scene.add(visual.group);
      }
      let z = gate.z;
      if (title) {
        z += visualTime * .8;
        const recycle = PLAYER_Z + 12;
        if (z > recycle) z -= Math.ceil((z - recycle) / (5 * gateSpacing(5))) * 5 * gateSpacing(5);
      }
      visual.group.position.set(0, gapCenter(gate, time) + (title ? 3 : 0), z);
      // A cleared gate sits between the camera and the next opening until it
      // leaves the simulation; hiding its panels keeps the route readable.
      visual.group.visible = !gate.passed;
      for (const { section, side } of visual.sides) {
        section.position.y = side * (gate.halfGap - visual.initialHalfGap);
      }
      visual.fly.visible = !gate.passed && !gate.wispCaught;
      visual.fly.scale.setScalar(1 + Math.sin(visualTime * 8 + gate.index) * .14);
      visual.ribbons.visible = gate.gust !== 0 && !gate.gustStarted;
    }
  }

  function render(state, visualTime, renderSeconds) {
    const title = state.phase === 'title';
    camera.position.copy(title ? basePosition : playPosition);
    camera.lookAt(title ? viewTarget : playTarget);
    camera.updateMatrixWorld(true);
    syncGates(state.gates, state.time, visualTime, state.phase === 'title');
    updateWitch(witch, state, visualTime, renderSeconds);
    if (state.phase === 'title') {
      const point = new THREE.Vector3(-.5, .61, .5).unproject(camera);
      const ray = point.sub(camera.position);
      const reach = (PLAYER_Z - camera.position.z) / ray.z;
      witch.group.position.x = camera.position.x + ray.x * reach;
      witch.group.position.y = camera.position.y + ray.y * reach + Math.sin(visualTime * 1.4) * .15;
    }
    if (state.phase === 'playing' && state.lastPuff !== lastSparkPuff) {
      lastSparkPuff = state.lastPuff;
      witch.group.updateMatrixWorld(true);
      const tail = witch.group.localToWorld(new THREE.Vector3(0, -.26, 1.87));
      for (let i = 0; i < 6; i++) {
        const mesh = new THREE.Mesh(sparkGeometry, sparkMaterial);
        scene.add(mesh);
        sparks.push({ mesh, born: visualTime, x: tail.x, y: tail.y, z: tail.z,
          vx: (i - 2.5) * .18, vy: .45 + i % 3 * .22, vz: .7 + i * .12 });
      }
    }
    world.update(visualTime, state.score);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      const age = visualTime - spark.born;
      if (age > .55) {
        scene.remove(spark.mesh);
        sparks.splice(i, 1);
        continue;
      }
      spark.mesh.position.set(spark.x + spark.vx * age, spark.y + spark.vy * age, spark.z + (spark.vz ?? 0) * age);
      spark.mesh.scale.setScalar(1 - age / .55);
    }
    const splashAge = state.phase === 'dying' || state.phase === 'over' ? state.time - state.deathTime : -1;
    splash.visible = splashAge >= .5 && splashAge < 1.3;
    if (splash.visible) {
      const spread = (splashAge - .5) * 3;
      splash.scale.setScalar(1 + spread);
      splash.material.opacity = Math.max(0, .8 - spread * .3);
    }
    camera.position.copy(title ? basePosition : playPosition);
    if (shake > 0 && !reducedMotion.matches) {
      camera.position.x += Math.sin(visualTime * 73) * Math.min(shake, .06);
      camera.position.y += Math.cos(visualTime * 61) * Math.min(shake, .04);
      shake *= Math.exp(-13.4 * renderSeconds);
      if (shake < .003) shake = 0;
    }
    camera.lookAt(title ? viewTarget : playTarget);
    renderer.render(scene, camera);
  }

  function sparkle(visualTime, y) {
    for (let i = 0; i < 13; i++) {
      const angle = i * Math.PI * 2 / 13;
      const mesh = new THREE.Mesh(sparkGeometry, sparkMaterial);
      scene.add(mesh);
      sparks.push({ mesh, born: visualTime, x: 0, y, z: PLAYER_Z + .3,
        vx: Math.cos(angle) * (1.2 + i % 3 * .3), vy: Math.sin(angle) * (1.2 + i % 3 * .3) });
    }
  }
  function shieldBreak(visualTime, y) {
    sparkle(visualTime, y);
    shake = .07;
  }
  return { render, resize, sparkle, shieldBreak, resetPuff() { lastSparkPuff = -10; }, shake() { shake = .05; }, canvas: renderer.domElement, camera, witch, get batCount() { return world.batCount; }, get shakeAmount() { return shake; }, get visibleGateCount() { return gateVisuals.size; }, get gateGroups() { return [...gateVisuals.values()].map(visual => visual.group); }, get gateVisuals() { return gateVisuals; }, get sparkMeshes() { return sparks.map(spark => spark.mesh); } };
}
