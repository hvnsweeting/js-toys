import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

const cyan = new THREE.Color('#57f4ff');
const gold = new THREE.Color('#ffe49b');
const red = new THREE.Color('#ff5478');
const up = new THREE.Vector3(0, 1, 0);

function labelTexture(text, color = '#e7faff') {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  context.font = '900 34px Trebuchet MS, Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 7;
  context.lineJoin = 'round';
  context.strokeStyle = '#06111c';
  context.strokeText(text, 64, 24);
  context.fillStyle = color;
  context.fillText(text, 64, 24);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function disposeGroup(group) {
  group.traverse(object => {
    if (object.isInstancedMesh) object.dispose();
    if (object.geometry) object.geometry.dispose();
    const materials = object.material ?
        (Array.isArray(object.material) ? object.material : [object.material]) :
        [];
    for (const material of materials) {
      if (material.map) material.map.dispose();
      material.dispose();
    }
  });
  group.clear();
}

// The back panel extends below the grid to hold the detector row.
const BACK_PANEL_EXTRA_HEIGHT = 1.78;
const BACK_PANEL_CENTER_Y = -.42;

export function inspectBeam(beam, scene) {
  if (!beam) return {visible: false, inScene: false, opacity: 0, drawCount: 0};
  let inScene = false;
  let visible = true;
  for (let object = beam; object; object = object.parent) {
    visible = visible && object.visible;
    if (object === scene) inScene = true;
  }
  visible = visible && beam.material.visible;
  return {
    visible,
    inScene,
    opacity: beam.material.opacity,
    drawCount: Math.min(beam.count, beam.geometry.drawRange.count)
  };
}

export function inspectBoardBounds(board, level, waves, sparkPoints) {
  if (!level) return [];
  const outside = [];
  const widthLimit = (level.grid[0].length + .65) / 2 + .06;
  const topLimit = BACK_PANEL_CENTER_Y + (level.grid.length + BACK_PANEL_EXTRA_HEIGHT) / 2 + .06;
  const bottomLimit = BACK_PANEL_CENTER_Y - (level.grid.length + BACK_PANEL_EXTRA_HEIGHT) / 2 - .06;
  const transientWaves = new Set(waves.map(item => item.object));
  const instanceMatrix = new THREE.Matrix4();
  const localMatrix = new THREE.Matrix4();
  const boardInverse = new THREE.Matrix4();
  const bounds = new THREE.Box3();
  board.updateMatrixWorld(true);
  boardInverse.copy(board.matrixWorld).invert();

  function checkBounds(object, box) {
    const outsideFrame = box.min.x < -widthLimit || box.max.x > widthLimit ||
        box.min.y < bottomLimit || box.max.y > topLimit;
    if (outsideFrame) outside.push(object.name || object.type);
  }

  board.traverse(object => {
    if (object === board || (!object.geometry && !object.isSprite)) return;
    let ancestor = object;
    while (ancestor && ancestor !== board) {
      if (!ancestor.visible || ancestor === sparkPoints || transientWaves.has(ancestor)) return;
      ancestor = ancestor.parent;
    }
    if (object.material?.opacity === 0) return;
    localMatrix.multiplyMatrices(boardInverse, object.matrixWorld);
    if (object.isSprite) {
      bounds.min.set(-.5, -.5, 0);
      bounds.max.set(.5, .5, 0);
      bounds.applyMatrix4(localMatrix);
      checkBounds(object, bounds);
      return;
    }
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (object.isInstancedMesh) {
      for (let index = 0; index < object.count; index++) {
        object.getMatrixAt(index, instanceMatrix);
        const localInstance = localMatrix.clone().multiply(instanceMatrix);
        bounds.copy(object.geometry.boundingBox).applyMatrix4(localInstance);
        checkBounds(object, bounds);
      }
      return;
    }
    bounds.copy(object.geometry.boundingBox).applyMatrix4(localMatrix);
    checkBounds(object, bounds);
  });
  return outside;
}

export function createScene(stage, getCoveredArea) {
  const low = new URLSearchParams(location.search).get('quality') === 'low';
  const touchCapable = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const renderer =
      new THREE.WebGLRenderer({antialias: low, alpha: true, powerPreference: 'low-power'});
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-8, 8, 8, -8, .1, 200);
  camera.position.set(0, 0, 35);
  camera.lookAt(0, 0, 0);
  const ambient = new THREE.AmbientLight(0x7292bd, 2.2);
  scene.add(ambient);
  const key = new THREE.PointLight(0x83edff, 85, 50);
  key.position.set(-5, 7, 12);
  scene.add(key);
  const rim = new THREE.PointLight(0x7349cf, 60, 40);
  rim.position.set(6, -5, -2);
  scene.add(rim);
  let composer = null;
  if (!low) {
    // The renderer's own antialias does not apply inside the composer, and the tilted board's edges
    // then step between pixel rows, which bloom turns into uneven bright segments.
    // A full-resolution multisample buffer uses too much memory on large touch screens.
    const multisampledTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: touchCapable ? 0 : 4
    });
    composer = new EffectComposer(renderer, multisampledTarget);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), .68, .5, .38));
    composer.addPass(new OutputPass());
  }
  let board = new THREE.Group();
  scene.add(board);
  let level = null;
  let ghost = null;
  let ghostCell = null;
  let beam = null;
  let aura = null;
  // The last beam drawn, kept so a resize can redraw its ends at block faces.
  let drawnBeam = null;
  let detectorLabels = [];
  let detectorCrystals = [];
  let detectorRings = [];
  let detectorCounts = [];
  // Detectors that broke the goal on the last run, by column: {started, kind}.
  let failureMarks = new Map();
  let waves = [];
  let sparks = [];
  let sparkPoints = null;
  let flash = null;
  let flashBorn = -100;
  let flashKind = 'win';
  let sourceOrb = null;
  let shapeObjects = [];
  let frameBars = [];
  let gridDots = null;
  let viewMode = 'title';
  const scratch = new THREE.Object3D();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const pickOrigin = new THREE.Vector3();
  const pickNormal = new THREE.Vector3();

  function mesh(geometry, material, x, y, z, scale = 1) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.scale.setScalar(scale);
    board.add(object);
    return object;
  }
  function keepShape(object) {
    shapeObjects.push(object);
    object.userData.authoredScale = object.scale.clone();
    applyShapeScale(object);
    return object;
  }
  // The board group stretches or squeezes rows to fill tall or short screens. Pieces undo that so they
  // keep their shape. When rows are squeezed they also shrink, or a full-size piece in a short row
  // overlaps its neighbours and the frame.
  // `pulse` multiplies the authored scale for animated pieces such as the source orb.
  function applyShapeScale(object, pulse = 1) {
    const authored = object.userData.authoredScale;
    const size = Math.min(1, board.scale.y) * pulse;
    object.scale.set(authored.x * size, authored.y * size / board.scale.y, authored.z * size);
  }
  function cellY(row) {
    return (level.grid.length - 1) / 2 - row;
  }
  function cellX(col) {
    return col - (level.grid[0].length - 1) / 2;
  }
  function crystal(row, col, fixed = false) {
    // An upward pyramid echoes the puzzle's '^'. Turned 45 degrees, two facets face the camera and
    // catch the key light differently; a pyramid pointing at the camera reads as a flat square.
    const material = new THREE.MeshStandardMaterial({
      color: fixed ? 0x6fa6e8 : 0x8dffff,
      metalness: .1,
      roughness: .25,
      emissive: fixed ? 0x1d4f9a : 0x0e9aa6,
      emissiveIntensity: fixed ? .7 : .85,
      flatShading: true
    });
    const geometry = new THREE.ConeGeometry(.44, .78, 4);
    geometry.rotateY(Math.PI / 4);
    geometry.rotateX(.35);
    const pyramid = keepShape(mesh(geometry, material, cellX(col), cellY(row) + .02, .38));
    pyramid.name = 'splitter';
    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({color: fixed ? 0xb4d4ff : 0xe6ffff}));
    pyramid.add(edges);
  }
  function block(row, col) {
    const cube = keepShape(mesh(
        new THREE.BoxGeometry(.62, .62, .24),
        new THREE.MeshStandardMaterial(
            {color: 0x1e3444, metalness: .7, roughness: .35, emissive: 0x40250c}),
        cellX(col), cellY(row), .18));
    cube.name = 'block';
    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(.68, .68, .3)),
        new THREE.LineBasicMaterial({color: 0xe49b57}));
    edges.position.set(cellX(col), cellY(row), .19);
    board.add(edges);
    keepShape(edges);
  }
  function detector(col, kind) {
    const y = cellY(level.grid.length - 1) - .94;
    const material = new THREE.MeshStandardMaterial({
      color: kind === 'V' ? 0x6e203b :
          kind === 'T'    ? 0xad965b :
                            0x30778c,
      emissive: kind === 'V' ? 0x5b0f27 :
          kind === 'T'       ? 0x8c6922 :
                               0x124f68,
      emissiveIntensity: 1.1,
      metalness: .3,
      roughness: .2,
      flatShading: true
    });
    const detectorGeometry = new THREE.CylinderGeometry(.29, .33, .33, 6);
    detectorGeometry.rotateX(Math.PI / 2);
    const object = keepShape(mesh(detectorGeometry, material, cellX(col), y, .18));
    object.name = 'detector';
    object.userData.baseEmissive = material.emissive.getHex();
    detectorCrystals.push(object);
    const ringColor = kind === 'V' ? 0xfa5c76 : kind === 'T' ? 0xffd982 : 0x64bdd0;
    const ring = keepShape(mesh(
        new THREE.RingGeometry(.36, .42, 6),
        new THREE.MeshBasicMaterial({color: ringColor, side: THREE.DoubleSide}), cellX(col), y,
        .06));
    ring.name = 'detector ring';
    ring.userData.baseColor = ringColor;
    detectorRings.push(ring);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(
          kind === 'T'     ? level.quotas?.[col] == null ? 'T' : `x${level.quotas[col]}` :
              kind === 'V' ? 'VOID' :
                             '0',
          kind === 'V'     ? '#ff8b9d' :
              kind === 'T' ? '#ffde8b' :
                             '#9cdae6'),
      transparent: true,
      depthTest: false
    }));
    label.position.set(cellX(col), y, .8);
    label.scale.set(1.08, .78, 1);
    board.add(label);
    keepShape(label);
    detectorLabels.push(label);
  }
  function setLevel(next, placements = []) {
    drawnBeam = null;
    scene.remove(board);
    disposeGroup(board);
    board = new THREE.Group();
    scene.add(board);
    level = next;
    ghost = null;
    ghostCell = null;
    sourceOrb = null;
    shapeObjects = [];
    frameBars = [];
    gridDots = null;
    beam = null;
    aura = null;
    detectorLabels = [];
    detectorCrystals = [];
    detectorRings = [];
    detectorCounts = [];
    failureMarks = new Map();
    waves = [];
    sparks = [];
    const width = level.grid[0].length;
    const height = level.grid.length;
    const tile = document.createElement('canvas');
    tile.width = 64;
    tile.height = 64;
    const tileContext = tile.getContext('2d');
    tileContext.fillStyle = '#173048';
    tileContext.fillRect(0, 0, 64, 64);
    tileContext.strokeStyle = '#426a7b';
    tileContext.globalAlpha = .22;
    for (const position of [0, 32, 64]) {
      tileContext.beginPath();
      tileContext.moveTo(position, 0);
      tileContext.lineTo(position, 64);
      tileContext.stroke();
    }
    const panelTexture = new THREE.CanvasTexture(tile);
    panelTexture.colorSpace = THREE.SRGBColorSpace;
    panelTexture.wrapS = THREE.RepeatWrapping;
    panelTexture.wrapT = THREE.RepeatWrapping;
    panelTexture.repeat.set(width / 3, height / 3);
    const back = mesh(
        new THREE.BoxGeometry(width + .62, height + BACK_PANEL_EXTRA_HEIGHT, .25), new THREE.MeshPhysicalMaterial({
          color: 0x83a7bc,
          map: panelTexture,
          metalness: .28,
          // A glossy back mirrors the key light as a hot spot that bloom turns into a stray orb.
          roughness: .7,
          transparent: true,
          opacity: .84,
          clearcoat: .3,
          clearcoatRoughness: .65
        }),
        0, BACK_PANEL_CENTER_Y, -.32);
    back.renderOrder = -1;
    const loader = new THREE.TextureLoader();
    loader.load('./assets/panel.jpg', texture => {
      if (!board.children.includes(back)) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(width / 3, height / 3);
      back.material.map.dispose();
      back.material.map = texture;
      back.material.needsUpdate = true;
    }, undefined, () => {});
    // Just outside the back panel: bars lying on the panel's top face blend with it in uneven strips.
    const halfFrameWidth = (width + .65) / 2 + .03;
    const halfFrameHeight = (height + BACK_PANEL_EXTRA_HEIGHT) / 2 + .03;
    // Thin bars instead of a 1-pixel line: on the tilted board a line steps between pixel rows and
    // its long edges look broken into offset segments.
    const border = new THREE.Group();
    const frameMaterial = new THREE.MeshBasicMaterial({color: 0x4ac8de, transparent: true, opacity: .85});
    const barThickness = .05;
    const horizontalBar = new THREE.PlaneGeometry(halfFrameWidth * 2 + barThickness, barThickness);
    const verticalBar = new THREE.PlaneGeometry(barThickness, halfFrameHeight * 2 + barThickness);
    for (const [geometry, x, y] of [
      [horizontalBar, 0, halfFrameHeight],
      [horizontalBar, 0, -halfFrameHeight],
      [verticalBar, -halfFrameWidth, 0],
      [verticalBar, halfFrameWidth, 0],
    ]) {
      const bar = new THREE.Mesh(geometry, frameMaterial);
      bar.name = 'frame bar';
      bar.position.set(x, y, 0);
      border.add(bar);
      const horizontal = geometry === horizontalBar;
      const centre = horizontal ? y : x;
      frameBars.push({bar, horizontal, outerEdge: centre + Math.sign(centre) * barThickness / 2});
    }
    border.position.set(0, BACK_PANEL_CENTER_Y, .02);
    board.add(border);
    const dots = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(.044, .044),
        new THREE.MeshBasicMaterial({color: 0x83d6e6, transparent: true, opacity: .65}),
        width * height);
    let dotIndex = 0;
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        scratch.position.set(cellX(col), cellY(row), -.14);
        scratch.quaternion.identity();
        scratch.scale.set(1, 1, 1);
        scratch.updateMatrix();
        dots.setMatrixAt(dotIndex++, scratch.matrix);
      }
    dots.instanceMatrix.needsUpdate = true;
    board.add(dots);
    gridDots = dots;
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const kind = level.grid[row][col];
        if (kind === '^') crystal(row, col, true);
        if (kind === '#') block(row, col);
      }
    for (const piece of placements)
      piece.kind === 'splitter' ? crystal(piece.row, piece.col) : block(piece.row, piece.col);
    const source = level.grid[0].indexOf('S');
    sourceOrb = keepShape(mesh(
        new THREE.SphereGeometry(.34, 16, 12),
        new THREE.MeshBasicMaterial({color: 0xe7ffff, toneMapped: false}), cellX(source),
        cellY(0), .35));
    sourceOrb.name = 'source orb';
    const sourceRing = keepShape(mesh(
        new THREE.RingGeometry(.42, .52, 32),
        new THREE.MeshBasicMaterial({color: 0x72f2ff, side: THREE.DoubleSide}), cellX(source),
        cellY(0), .18));
    sourceRing.name = 'source ring';
    for (let col = 0; col < width; col++) detector(col, level.detectors[col]);
    const capacity = width * height * 4;
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 6);
    beam = new THREE.InstancedMesh(
        cylinder, new THREE.MeshBasicMaterial({color: 0x9cf8ff, toneMapped: false}), capacity);
    beam.count = 0;
    beam.frustumCulled = false;
    board.add(beam);
    aura = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(1, 1, 1, 6),
        new THREE.MeshBasicMaterial(
            {color: 0x21dafa, transparent: true, opacity: .2, depthWrite: false}),
        capacity);
    aura.count = 0;
    aura.frustumCulled = false;
    board.add(aura);
    for (let index = 0; index < 12; index++) {
      const wave = mesh(
          new THREE.RingGeometry(.3, .34, 28), new THREE.MeshBasicMaterial({
            color: 0xa8f8ff,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            depthWrite: false
          }),
          0, 0, .7);
      waves.push({object: wave, born: -100});
    }
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(192 * 3), 3));
    sparkGeometry.setDrawRange(0, 0);
    sparkPoints = new THREE.Points(
        sparkGeometry,
        new THREE.PointsMaterial(
            {color: 0xa7faff, size: .16, transparent: true, opacity: .92, depthWrite: false}));
    sparkPoints.frustumCulled = false;
    board.add(sparkPoints);
    flash = mesh(
        new THREE.PlaneGeometry(width + .6, height + 1.7), new THREE.MeshBasicMaterial({
          color: 0xffda84,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide
        }),
        0, BACK_PANEL_CENTER_Y, .96);
    flash.name = 'result flash';
    flashBorn = -100;
    board.rotation.y = .055;
    board.rotation.x = -.035;
    resize();
  }
  function setPlacements(placements) {
    if (level) setLevel(level, placements);
  }
  function putSegment(index, a, b, count) {
    if (index >= beam.instanceMatrix.count) return index;
    const delta = b.clone().sub(a);
    const center = a.clone().add(b).multiplyScalar(.5);
    const thick = .048 + Math.log2(count + 1) * .014;
    scratch.position.copy(center);
    scratch.quaternion.setFromUnitVectors(up, delta.clone().normalize());
    scratch.scale.set(thick, delta.length(), thick);
    scratch.updateMatrix();
    beam.setMatrixAt(index, scratch.matrix);
    scratch.scale.set(thick * 3.4, delta.length(), thick * 3.4);
    scratch.updateMatrix();
    aura.setMatrixAt(index, scratch.matrix);
    beam.setColorAt(index, count > 2 ? gold : cyan);
    return index + 1;
  }
  // A beam that runs into a block stops at the block's face, so the player sees the block absorb it
  // instead of the beam ending one cell early. Blocks are .62 wide and keep their shape when rows
  // stretch (see applyShapeScale), so the face distance in board units follows the row scale.
  const BLOCK_HALF_WIDTH = .31;
  function blockFace(vertical) {
    const size = Math.min(1, board.scale.y);
    return vertical ? BLOCK_HALF_WIDTH * size / board.scale.y : BLOCK_HALF_WIDTH * size;
  }
  function setBeam(result, revealRow) {
    drawnBeam = result ? {result, revealRow} : null;
    if (!beam || !result) return;
    // A new run starts from a clean board; the old failure highlights would point at stale results.
    if (revealRow === 0) clearFailureMarks();
    let index = 0;
    for (let row = 1; row <= Math.min(revealRow, level.grid.length - 1); row++) {
      const previous = result.beamRows[row - 1];
      for (let col = 0; col < previous.length; col++) {
        if (!previous[col]) continue;
        const top = new THREE.Vector3(cellX(col), cellY(row - 1), .65);
        const bottom = new THREE.Vector3(cellX(col), cellY(row), .65);
        const cell = result.grid[row][col];
        if (cell === '.') index = putSegment(index, top, bottom, previous[col]);
        if (cell === '#') {
          const blockTop = new THREE.Vector3(cellX(col), cellY(row) + blockFace(true), .65);
          index = putSegment(index, top, blockTop, previous[col]);
        }
        if (cell === '^') {
          index = putSegment(index, top, bottom, previous[col]);
          for (const side of [col - 1, col + 1]) {
            if (side < 0 || side >= previous.length) continue;
            const sideCell = result.grid[row][side];
            const direction = Math.sign(side - col);
            if (sideCell === '.') {
              index = putSegment(
                  index, bottom, new THREE.Vector3(cellX(side), cellY(row), .65), previous[col]);
            }
            if (sideCell === '#') {
              const blockSide = new THREE.Vector3(cellX(side) - direction * blockFace(false), cellY(row), .65);
              index = putSegment(index, bottom, blockSide, previous[col]);
            }
          }
        }
      }
    }
    beam.count = index;
    aura.count = index;
    beam.instanceMatrix.needsUpdate = true;
    aura.instanceMatrix.needsUpdate = true;
    if (beam.instanceColor) beam.instanceColor.needsUpdate = true;
    if (revealRow < level.grid.length - 1) return;
    detectorCounts = result.detectorCounts.slice();
    for (const item of result.detectorResults) {
      const label = detectorLabels[item.col];
      if (!label) continue;
      const text = item.kind === 'V' ? 'VOID' :
          item.quota !== null ? `${item.count}/x${item.quota}` :
          String(item.count);
      if (label.userData.text === text) continue;
      label.userData.text = text;
      label.material.map.dispose();
      label.material.map = labelTexture(
          text,
          item.kind === 'V' && item.count ? '#ff6c81' :
              item.count                  ? '#fff4b8' :
                                            '#9bbac7');
      label.material.needsUpdate = true;
      detectorCrystals[item.col].material.emissiveIntensity = item.count ? 2.6 : 1.1;
    }
  }
  function splitWave(row, col, now) {
    const wave = waves.reduce((old, item) => item.born < old.born ? item : old, waves[0]);
    if (!wave) return;
    wave.born = now;
    wave.object.position.set(cellX(col), cellY(row), .78);
    for (let index = 0; index < 14; index++) {
      const angle = index * Math.PI * 2 / 14;
      sparks.push({
        x: cellX(col),
        y: cellY(row),
        vx: Math.cos(angle) * (1.7 + index % 3 * .22),
        vy: Math.sin(angle) * (1.7 + index % 4 * .17),
        born: now
      });
    }
    if (sparks.length > 192) sparks = sparks.slice(-192);
  }
  function feedback(kind, now, failures = []) {
    flashKind = kind;
    flashBorn = now;
    flash.material.color.set(kind === 'win' ? 0xffda84 : 0xff4d66);
    clearFailureMarks();
    if (kind !== 'fail') return;
    for (const failure of failures) failureMarks.set(failure.col, {started: now, kind: failure.kind});
  }
  function clearFailureMarks() {
    for (const col of failureMarks.keys()) {
      const crystal = detectorCrystals[col];
      const ring = detectorRings[col];
      const label = detectorLabels[col];
      crystal.material.emissive.setHex(crystal.userData.baseEmissive);
      crystal.material.emissiveIntensity = detectorCounts[col] ? 2.6 : 1.1;
      ring.material.color.setHex(ring.userData.baseColor);
      label.renderOrder = 0;
      for (const object of [crystal, ring, label]) applyShapeScale(object);
    }
    failureMarks.clear();
  }
  function setGhost(row, col, kind, allowed) {
    if (ghost) {
      board.remove(ghost);
      ghost.geometry.dispose();
      ghost.material.dispose();
      ghost = null;
    }
    ghostCell = null;
    if (!level || row == null) return;
    ghostCell = {row, col, kind, allowed};
    const geometry = kind === 'block' ? new THREE.BoxGeometry(.55, .55, .25) :
                                        new THREE.ConeGeometry(.4, .7, 4);
    if (kind !== 'block') geometry.rotateY(Math.PI / 4);
    ghost = mesh(
        geometry, new THREE.MeshBasicMaterial({
          color: allowed ? 0x74ffbb : 0xff677b,
          transparent: true,
          opacity: .55,
          depthWrite: false
        }),
        cellX(col), cellY(row), .75);
    ghost.userData.authoredScale = new THREE.Vector3(1, 1, 1);
    applyShapeScale(ghost);
  }
  function pick(clientX, clientY) {
    if (!level) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.set(
        (clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height * 2 - 1));
    raycaster.setFromCamera(pointer, camera);
    board.updateWorldMatrix(true, false);
    board.localToWorld(pickOrigin.set(0, 0, 0));
    pickNormal.set(0, 0, 1).transformDirection(board.matrixWorld);
    plane.setFromNormalAndCoplanarPoint(pickNormal, pickOrigin);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    board.worldToLocal(hit);
    const col = Math.round(hit.x + (level.grid[0].length - 1) / 2);
    const row = Math.round((level.grid.length - 1) / 2 - hit.y);
    if (row < 0 || row >= level.grid.length || col < 0 || col >= level.grid[0].length) return null;
    if (Math.abs(hit.x - cellX(col)) > .44 || Math.abs(hit.y - cellY(row)) > .44) return null;
    return {row, col};
  }
  function cellScreenPosition(row, col) {
    if (!level || row < 0 || row >= level.grid.length || col < 0 ||
        col >= level.grid[0].length) return null;
    board.updateWorldMatrix(true, false);
    const point = board.localToWorld(new THREE.Vector3(cellX(col), cellY(row), 0)).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (point.x + 1) * rect.width / 2,
      y: rect.top + (1 - point.y) * rect.height / 2,
    };
  }
  function resize() {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height || !Number.isFinite(width / height)) return;
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, touchCapable ? 1.5 : 1.6));
    renderer.setSize(width, height, false);
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    }
    const covered = getCoveredArea(viewMode);
    const topbarHeight = document.getElementById('topbar').getBoundingClientRect().height;
    const horizontalPadding = width <= 700 ? 16 : 24;
    const freeWidth = Math.max(140, width - covered.left - (covered.right ?? 0) - horizontalPadding);
    const coveredTop = topbarHeight + (covered.top ?? 0);
    const freeHeight = Math.max(130, height - covered.bottom - coveredTop - 24);
    const boardWidth = (level?.grid[0].length ?? 15) + 1.1;
    const boardHeight = (level?.grid.length ?? 16) + BACK_PANEL_EXTRA_HEIGHT + .3;
    const activeGame = viewMode === 'game' || viewMode === 'result';
    const heightAtFullWidth = boardHeight * freeWidth / boardWidth;
    const desiredRowScale = freeHeight / heightAtFullWidth;
    board.scale.y = activeGame && width <= 700 ?
        Math.max(1, Math.min(1.55, desiredRowScale)) :
        activeGame && height <= 500 ? Math.max(.45, Math.min(1.55, desiredRowScale)) : 1;
    for (const object of shapeObjects)
      applyShapeScale(object);
    // Beam ends at block faces depend on the row scale, so a drawn beam is redrawn for the new one.
    if (drawnBeam && drawnBeam.revealRow > 0) setBeam(drawnBeam.result, drawnBeam.revealRow);
    const worldHeight =
        Math.max(boardHeight * board.scale.y * height / freeHeight,
            boardWidth * height / freeWidth) * 1.02;
    const worldWidth = worldHeight * width / height;
    camera.left = -worldWidth / 2;
    camera.right = worldWidth / 2;
    // Aim at the back panel's centre, not the grid's, so the detector row is not pushed under the HUD.
    camera.position.y = BACK_PANEL_CENTER_Y * board.scale.y;
    camera.top = worldHeight / 2;
    camera.bottom = -worldHeight / 2;
    camera.updateProjectionMatrix();
    // Touch rendering has no multisampling, so a subpixel bar or dot can disappear between samples.
    const devicePixelWorldSize = worldHeight / (height * renderer.getPixelRatio());
    const minimumThickness = touchCapable ? devicePixelWorldSize * 1.5 : 0;
    for (const {bar, horizontal, outerEdge} of frameBars) {
      const scale = horizontal ?
          Math.max(1, minimumThickness / (.05 * board.scale.y)) :
          Math.max(1, minimumThickness / .05);
      bar.scale.set(horizontal ? 1 : scale, horizontal ? scale : 1, 1);
      // Thicken inward: the outer edge is the board's boundary, which framing and bounds checks use.
      const inwardCentre = outerEdge - Math.sign(outerEdge) * .05 * scale / 2;
      if (horizontal) bar.position.y = inwardCentre;
      else bar.position.x = inwardCentre;
    }
    if (gridDots && level) {
      const dotScaleX = Math.max(1, minimumThickness / .044);
      const dotScaleY = Math.max(1, minimumThickness / (.044 * board.scale.y));
      let dotIndex = 0;
      for (let row = 0; row < level.grid.length; row++)
        for (let col = 0; col < level.grid[0].length; col++) {
          scratch.position.set(cellX(col), cellY(row), -.14);
          scratch.quaternion.identity();
          scratch.scale.set(dotScaleX, dotScaleY, 1);
          scratch.updateMatrix();
          gridDots.setMatrixAt(dotIndex++, scratch.matrix);
        }
      gridDots.instanceMatrix.needsUpdate = true;
    }
    camera.setViewOffset(
        width, height, ((covered.right ?? 0) - covered.left) / 2,
        (covered.bottom - coveredTop) / 2, width, height);
    camera.updateProjectionMatrix();
  }
  function setViewMode(mode) {
    viewMode = mode;
    resize();
  }
  let resolutionQuery;
  function watchPixelRatio() {
    if (resolutionQuery) resolutionQuery.removeEventListener('change', watchPixelRatio);
    resolutionQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    resolutionQuery.addEventListener('change', watchPixelRatio, {once: true});
    resize();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  // The free area depends on overlay panels too: the HUD grows when a hint or failure reason wraps.
  for (const selector of ['#hud', '#hud-info', '#topbar', '.title-panel', '.selection-panel', '.help', '.result']) {
    const panel = document.querySelector(selector);
    if (panel) observer.observe(panel);
  }
  window.addEventListener('resize', resize);
  watchPixelRatio();
  function render(now, mouse = {x: 0, y: 0}) {
    if (!stage.clientWidth || !stage.clientHeight) return;
    if (sourceOrb) {
      const pulse = 1 + Math.sin(now * 3.4) * .11;
      applyShapeScale(sourceOrb, pulse);
    }
    board.rotation.y = .055 + mouse.x * .025 + Math.sin(now * .25) * .008;
    board.rotation.x = -.035 + mouse.y * .015;
    const flashAge = now - flashBorn;
    board.position.x = flashKind === 'fail' && flashAge < .45 ?
        Math.sin(flashAge * 60) * (.11 * (1 - flashAge / .45)) :
        0;
    if (flash)
      flash.material.opacity = flashAge >= 0 && flashAge < .65 ?
          (1 - flashAge / .65) * (flashKind === 'win' ? .16 : .21) :
          0;
    // A failing detector pops to 1.6 times its size, settles at 1.3 and keeps breathing until the
    // next run or edit, so the player can find it without counting columns.
    for (const [col, mark] of failureMarks) {
      const age = Math.max(0, now - mark.started);
      const pop = age < .3 ? age / .3 : Math.max(0, 1 - (age - .3) / .45);
      const zoom = 1.3 + .3 * pop + .05 * Math.sin(age * 6);
      const isVoid = mark.kind === 'void';
      const crystal = detectorCrystals[col];
      const ring = detectorRings[col];
      const label = detectorLabels[col];
      crystal.material.emissive.setHex(isVoid ? 0xff2048 : 0xff9a1f);
      crystal.material.emissiveIntensity = 2.6 + Math.sin(age * 6) * .6;
      ring.material.color.setHex(isVoid ? 0xff8fa2 : 0xffc061);
      // Draw the enlarged label above its neighbours.
      label.renderOrder = 10;
      for (const object of [crystal, ring, label]) applyShapeScale(object, zoom);
    }
    for (const wave of waves) {
      const age = now - wave.born;
      wave.object.material.opacity = age >= 0 && age < .5 ? (1 - age / .5) * .9 : 0;
      wave.object.scale.setScalar(1 + Math.max(0, age) * 2.5);
    }
    if (sparkPoints) {
      const positions = sparkPoints.geometry.attributes.position;
      let visibleSparks = 0;
      for (let index = 0; index < 192; index++) {
        const spark = sparks[index];
        const age = spark ? now - spark.born : 10;
        if (age >= 0 && age < .55) {
          positions.setXYZ(
              visibleSparks++, spark.x + spark.vx * age,
              spark.y + spark.vy * age - .8 * age * age, .85);
        }
      }
      sparkPoints.geometry.setDrawRange(0, visibleSparks);
      positions.needsUpdate = true;
    }
    if (composer && !sampleWithoutGlow)
      composer.render();
    else
      renderer.render(scene, camera);
  }
  // Pixel probes render without bloom and without the beam's aura: their glow spreads light from
  // neighbouring segments over a sampled point, so a missing segment would still look lit.
  let sampleWithoutGlow = false;
  function beamSegments(result) {
    const segments = [];
    for (let row = 1; row < level.grid.length; row++) {
      const previous = result.beamRows[row - 1];
      for (let col = 0; col < previous.length; col++) {
        if (!previous[col]) continue;
        const cell = result.grid[row][col];
        if (cell !== '.' && cell !== '^' && cell !== '#') continue;
        const end = cell === '#' ? cellY(row) + blockFace(true) : cellY(row);
        const y = (cellY(row - 1) + end) / 2;
        segments.push({row, col, kind: 'vertical', point: new THREE.Vector3(cellX(col), y, .65)});
        if (cell !== '^') continue;
        for (const side of [col - 1, col + 1]) {
          if (side < 0 || side >= previous.length) continue;
          const sideCell = result.grid[row][side];
          if (sideCell !== '.' && sideCell !== '#') continue;
          const sideEnd = sideCell === '#' ?
              cellX(side) - Math.sign(side - col) * blockFace(false) : cellX(side);
          const x = (cellX(col) + sideEnd) / 2;
          segments.push({row, col, side, kind: 'horizontal',
            point: new THREE.Vector3(x, cellY(row), .65)});
        }
      }
    }
    return segments;
  }
  function evenlySpaced(items, count) {
    if (items.length <= count) return items;
    return Array.from({length: count}, (_, index) =>
      items[Math.floor((index + .5) * items.length / count)]);
  }
  function readScenePixels(samples) {
    const gl = renderer.getContext();
    const width = renderer.domElement.width, height = renderer.domElement.height;
    board.updateWorldMatrix(true, false);
    return samples.map(({point, ...location}) => {
      const projected = board.localToWorld(point.clone()).project(camera);
      const x = Math.floor((projected.x + 1) * width / 2);
      const pixelY = Math.floor((projected.y + 1) * height / 2);
      const pixels = new Uint8Array(3 * 3 * 4);
      gl.readPixels(x - 1, pixelY - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let brightest = [0, 0, 0];
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 1] > brightest[1])
          brightest = [pixels[index], pixels[index + 1], pixels[index + 2]];
      }
      return {...location, color: brightest};
    });
  }
  function compareScenePixels(samples, hiddenObject, now, mouse, withoutGlow = false) {
    const wasVisible = hiddenObject.visible;
    const auraWasVisible = aura?.visible;
    let hidden;
    let shown;
    try {
      sampleWithoutGlow = withoutGlow;
      if (withoutGlow && aura) aura.visible = false;
      hiddenObject.visible = false;
      render(now, mouse);
      hidden = readScenePixels(samples);
      hiddenObject.visible = wasVisible;
      render(now, mouse);
      shown = readScenePixels(samples);
    } finally {
      hiddenObject.visible = wasVisible;
      if (aura) aura.visible = auraWasVisible;
      sampleWithoutGlow = false;
    }
    // Draw a normal frame again so the screen does not keep the probe's unglowing image.
    render(now, mouse);
    return {samples: shown, hidden};
  }
  function beamPixels(result, now, mouse) {
    if (!level || !beam || !result) return null;
    const segments = beamSegments(result);
    const horizontal = segments.filter(segment => segment.kind === 'horizontal');
    const sampleLimit = 60;
    let selected;
    if (horizontal.length >= sampleLimit) {
      selected = evenlySpaced(segments, sampleLimit);
    } else {
      const vertical = segments.filter(segment => segment.kind === 'vertical');
      const chosen = new Set([...horizontal, ...evenlySpaced(vertical, sampleLimit - horizontal.length)]);
      selected = segments.filter(segment => chosen.has(segment));
    }
    return {...compareScenePixels(selected, beam, now, mouse, true),
      total: segments.length, horizontal: horizontal.length};
  }
  // For each beam that ends at a block, samples a point just outside the block's face (the beam
  // must light it) and one just inside (the beam must not, or it would look like it passes over the
  // block). The face comes from the block mesh's own size and scale, not from blockFace().
  function blockHitPixels(result, now, mouse) {
    if (!level || !beam || !result) return null;
    const blocks = board.children.filter(child => child.name === 'block');
    const samples = [];
    const faces = [];
    function addHit(row, col, towardBeam) {
      const cube = blocks.find(item => Math.abs(item.position.x - cellX(col)) < .01 &&
          Math.abs(item.position.y - cellY(row)) < .01);
      if (!cube) {
        samples.push({row, col, kind: 'missing block',
          point: new THREE.Vector3(cellX(col), cellY(row), .65)});
        return;
      }
      cube.geometry.computeBoundingBox();
      const vertical = towardBeam.y !== 0;
      const halfSize = vertical ? cube.geometry.boundingBox.max.y * cube.scale.y :
          cube.geometry.boundingBox.max.x * cube.scale.x;
      // Small offsets in screen-sized units: rows may be squeezed, so a vertical offset is divided
      // by the row scale to stay the same distance on screen.
      const offset = vertical ? 1 / board.scale.y : 1;
      const center = new THREE.Vector3(cube.position.x, cube.position.y, .65);
      faces.push(center.clone().addScaledVector(towardBeam, halfSize));
      const direction = vertical ? 'vertical' : 'side';
      samples.push({row, col, direction, kind: 'outside',
        point: center.clone().addScaledVector(towardBeam, halfSize + .1 * offset)});
      samples.push({row, col, direction, kind: 'inside',
        point: center.clone().addScaledVector(towardBeam, halfSize - .14 * offset)});
    }
    for (let row = 1; row < level.grid.length; row++) {
      const previous = result.beamRows[row - 1];
      for (let col = 0; col < previous.length; col++) {
        if (!previous[col]) continue;
        if (result.grid[row][col] === '#') addHit(row, col, new THREE.Vector3(0, 1, 0));
        if (result.grid[row][col] !== '^') continue;
        for (const side of [col - 1, col + 1]) {
          if (result.grid[row][side] === '#')
            addHit(row, side, new THREE.Vector3(Math.sign(col - side), 0, 0));
        }
      }
    }
    // Pixels cannot tell apart beam ends a pixel or two apart, so each face is also compared with
    // the nearest end of a drawn beam segment (unit-height cylinders scaled to their length).
    const ends = [];
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    const rotation = new THREE.Quaternion(), size = new THREE.Vector3();
    for (let index = 0; index < beam.count; index++) {
      beam.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, size);
      const halfLength = up.clone().applyQuaternion(rotation).multiplyScalar(size.y / 2);
      ends.push(position.clone().add(halfLength), position.clone().sub(halfLength));
    }
    const faceGaps = faces.map(face =>
        Math.min(...ends.map(end => end.distanceTo(face))));
    return {...compareScenePixels(samples, beam, now, mouse, true), faceGaps};
  }
  function titlePixels(result, now) {
    if (!level || !beam || !sourceOrb || !result) return null;
    // Only already revealed instances are sampled, so the probe follows the title animation.
    const lit = beamSegments(result).slice(0, beam.count)
        .filter(segment => segment.kind === 'vertical');
    if (lit.length < 3) return null;
    const samples = evenlySpaced(lit, 3);
    samples.push({kind: 'source', point: sourceOrb.position.clone()});
    return compareScenePixels(samples, board, now, {x: 0, y: 0});
  }
  renderer.domElement.inspectTitlePixels = titlePixels;
  function boardBounds() {
    if (!level || !stage.clientWidth || !stage.clientHeight) return null;
    board.updateWorldMatrix(true, false);
    const halfWidth = (level.grid[0].length + .65) / 2;
    const top = BACK_PANEL_CENTER_Y + (level.grid.length + BACK_PANEL_EXTRA_HEIGHT) / 2;
    const bottom = BACK_PANEL_CENTER_Y - (level.grid.length + BACK_PANEL_EXTRA_HEIGHT) / 2;
    const corners = [
      [-halfWidth, top],
      [halfWidth, top],
      [-halfWidth, bottom],
      [halfWidth, bottom],
    ];
    const projected = corners.map(([x, y]) => {
      const point = board.localToWorld(new THREE.Vector3(x, y, 0)).project(camera);
      return {
        x: (point.x + 1) * stage.clientWidth / 2,
        y: (1 - point.y) * stage.clientHeight / 2,
      };
    });
    return {
      left: Math.min(...projected.map(point => point.x)),
      right: Math.max(...projected.map(point => point.x)),
      top: Math.min(...projected.map(point => point.y)),
      bottom: Math.max(...projected.map(point => point.y)),
    };
  }
  function straySceneObjects() {
    return inspectBoardBounds(board, level, waves, sparkPoints);
  }
  function beamDrawState() {
    return inspectBeam(beam, scene);
  }
  return {
    setLevel,
    setPlacements,
    setBeam,
    setGhost,
    splitWave,
    feedback,
    pick,
    cellScreenPosition,
    beamPixels,
    blockHitPixels,
    boardRowScale: () => board.scale.y,
    ghostCell: () => ghostCell,
    resize,
    setViewMode,
    render,
    memory: () => ({...renderer.info.memory}),
    boardBounds,
    beamSegmentCount: () => beam?.count ?? 0,
    beamDrawState,
    straySceneObjects,
    unusedSparkCount: () => sparkPoints?.geometry.drawRange.count ?? 0,
    failureMarks: () => [...failureMarks].map(([col, mark]) => {
      const crystal = detectorCrystals[col];
      const drawnZoom = crystal.scale.x / crystal.userData.authoredScale.x / Math.min(1, board.scale.y);
      return {col, kind: mark.kind, zoom: drawnZoom};
    }),
    domElement: renderer.domElement
  };
}
