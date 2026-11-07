// The meadow the trees stand in: renderer, camera, sky, light, ground, grass,
// clouds, pollen and falling leaves, plus a time of day that changes each round.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { addSway, createCloudTexture, createRadialTexture, srgbToLinear, treeMaterials, wind } from './materials.js';
import { clamp, fbm, lerp, mulberry32, smoothstep } from './random.js';
import { groundHeight, liftAboveGround } from './ground.js';

// Where each trunk stands before the first pair is planted. Every pair then stands as close as
// its crowns allow (trunkOffset in game.js).
export const TREE_SPACING = 4.6;

// Each palette is a time of day. Colours are sRGB hex; angles in degrees.
export const PALETTES = [
  {
    name: 'Dawn',
    skyTop: '#7083bf', skyHorizon: '#f6c7b4', fog: '#e8c6bc', hemiSky: '#d6c2df', hemiGround: '#6e6050',
    sun: '#ffcfa6', sunIntensity: 2.6, sunElevation: 12, sunAzimuth: -70, hemiIntensity: 1.25,
    pollen: '#fff3e6', fireflies: 0, exposure: 1.0, cloud: '#ffe1d6',
  },
  {
    name: 'Morning',
    skyTop: '#3b7fd4', skyHorizon: '#cde6f3', fog: '#cfe2ec', hemiSky: '#c4def3', hemiGround: '#5e6b3c',
    sun: '#fff5e3', sunIntensity: 3.0, sunElevation: 40, sunAzimuth: -50, hemiIntensity: 1.2,
    pollen: '#ffffff', fireflies: 0, exposure: 0.95, cloud: '#ffffff',
  },
  {
    name: 'Golden hour',
    skyTop: '#5d7fc0', skyHorizon: '#ffd49a', fog: '#efd3a8', hemiSky: '#f2dab4', hemiGround: '#6b5a36',
    sun: '#ffc27a', sunIntensity: 3.2, sunElevation: 9, sunAzimuth: 155, hemiIntensity: 1.1,
    pollen: '#ffe7b0', fireflies: 0, exposure: 1.0, cloud: '#ffe2bd',
  },
  {
    name: 'Dusk',
    skyTop: '#232a5a', skyHorizon: '#d08690', fog: '#7a6888', hemiSky: '#9a88bb', hemiGround: '#4d4560',
    sun: '#ff9f72', sunIntensity: 1.8, sunElevation: 5, sunAzimuth: 110, hemiIntensity: 1.5,
    pollen: '#ffef9a', fireflies: 1, exposure: 1.15, cloud: '#e4a3b1',
  },
];

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
varying vec3 vDirection;
void main() {
  vec3 d = normalize(vDirection);
  vec3 color = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.45, d.y), 0.7));
  color = mix(color, uGround, smoothstep(0.0, -0.2, d.y));
  float s = max(dot(d, uSunDirection), 0.0);
  color += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const POLLEN_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uFireflies;
uniform float uPixelRatio;
attribute float aSeed;
varying float vBlink;
void main() {
  vec3 p = position;
  float t = uTime * (0.15 + aSeed * 0.1);
  p.x += sin(t + aSeed * 40.0) * 1.2 + uTime * 0.12;
  p.y += sin(t * 1.3 + aSeed * 17.0) * 0.6;
  p.z += cos(t * 0.8 + aSeed * 9.0) * 1.0;
  p.x = mod(p.x + 18.0, 36.0) - 18.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float blink = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 30.0);
  vBlink = mix(0.7, blink * blink, uFireflies);
  float size = mix(0.07, 0.16, uFireflies) * (0.6 + aSeed * 0.8);
  gl_PointSize = size * uPixelRatio * 600.0 / -mv.z;
}
`;

const POLLEN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vBlink;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float alpha = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(uColor * (1.0 + vBlink), alpha * uOpacity * vBlink);
  #include <colorspace_fragment>
}
`;

function createTerrain() {
  const geometry = new THREE.PlaneGeometry(500, 500, 220, 220);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const meadow = new THREE.Color('#7d9a45');
  const lush = new THREE.Color('#5f8a3a');
  const dry = new THREE.Color('#a5a85a');
  const tmp = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    positions.setY(i, groundHeight(x, z));
    const patch = fbm(x * 0.08 + 11, z * 0.08) * 0.5 + 0.5;
    const detail = fbm(x * 0.6, z * 0.6) * 0.5 + 0.5;
    tmp.copy(meadow).lerp(lush, clamp(patch * 1.4 - 0.2, 0, 1)).lerp(dry, clamp(detail - 0.55, 0, 1) * 0.8);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  mesh.receiveShadow = true;
  return mesh;
}

// ?quality=low trades shadows and grass density for speed on weak hardware.
export const LOW_QUALITY = new URLSearchParams(window.location.search).get('quality') === 'low';

function createGrass() {
  // A blade: a tapered strip, base at y = 0 and tip at y = 1, slightly curved.
  const segments = 4;
  const positions = [];
  const colors = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const y = i / segments;
    const half = 0.022 * (1 - y * 0.9);
    const bend = y * y * 0.18;
    positions.push(-half, y, bend, half, y, bend);
    const shade = 0.45 + 0.55 * y;
    colors.push(shade, shade, shade, shade, shade, shade);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = addSway(
    new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }),
    'grass',
  );
  const count = LOW_QUALITY ? 3500 : 18000;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.receiveShadow = true;
  const rng = mulberry32(7);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const color = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    // Denser near the trees, thinning out toward the edges.
    const radius = Math.pow(rng(), 0.7) * 17;
    const angle = rng() * Math.PI * 2;
    const x = Math.cos(angle) * radius * 1.15;
    let z = Math.sin(angle) * radius * 1.05 + 2;
    // Blades close to the camera would fill the screen, so fold them back.
    if (z > 12) z = 12 - (z - 12) * 2;
    position.set(x, groundHeight(x, z) - 0.02, z);
    quaternion.setFromAxisAngle(yAxis, rng() * Math.PI * 2);
    const nearCamera = smoothstep(4, 12, z);
    const height = lerp(0.12, 0.38, rng() * rng() + 0.2 * smoothstep(2, 14, radius)) * (1 - nearCamera * 0.55);
    scale.set(0.8 + rng() * 0.7, height, 1);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
    color.setHSL(lerp(0.19, 0.26, rng()), lerp(0.4, 0.6, rng()), lerp(0.4, 0.55, rng()));
    mesh.setColorAt(i, color);
  }
  return mesh;
}

function createWildflowers() {
  const { blossomGeometry } = treeMaterials();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 });
  const count = 420;
  const mesh = new THREE.InstancedMesh(blossomGeometry, material, count);
  const rng = mulberry32(19);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const tones = ['#ffffff', '#fff3a8', '#d9c4ff', '#ffd0e0', '#ffe9c9'];
  for (let i = 0; i < count; i++) {
    const radius = 2.5 + Math.pow(rng(), 0.8) * 14;
    const angle = rng() * Math.PI * 2;
    const x = Math.cos(angle) * radius * 1.2;
    let z = Math.sin(angle) * radius * 0.7 - 1;
    if (z > 4) z = 4 - (z - 4) * 2;
    position.set(x, groundHeight(x, z) + lerp(0.12, 0.3, rng()), z);
    euler.set(-Math.PI / 2 + (rng() - 0.5) * 0.6, 0, rng() * Math.PI * 2);
    quaternion.setFromEuler(euler);
    const s = lerp(0.035, 0.07, rng());
    scale.set(s, s, s);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
    color.set(tones[Math.floor(rng() * tones.length)]);
    mesh.setColorAt(i, color);
  }
  return mesh;
}

function createClouds() {
  const group = new THREE.Group();
  const rng = mulberry32(31);
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const material = new THREE.SpriteMaterial({
      map: createCloudTexture(1000 + i * 7919),
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: lerp(0.55, 0.9, rng()),
    });
    const sprite = new THREE.Sprite(material);
    const width = lerp(70, 140, rng());
    sprite.scale.set(width, width * 0.5, 1);
    const angle = lerp(-1.3, 1.3, rng());
    const distance = lerp(260, 330, rng());
    sprite.position.set(Math.sin(angle) * distance, lerp(45, 110, rng()), -Math.cos(angle) * distance);
    sprite.userData.drift = lerp(0.4, 1.2, rng());
    group.add(sprite);
    clouds.push(sprite);
  }
  return { group, clouds };
}

function createPollen() {
  const count = 360;
  const rng = mulberry32(53);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = lerp(-18, 18, rng());
    positions[i * 3 + 1] = lerp(0.3, 7.5, rng());
    positions[i * 3 + 2] = lerp(-8, 7, rng());
    seeds[i] = rng();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: POLLEN_VERTEX,
    fragmentShader: POLLEN_FRAGMENT,
    uniforms: {
      uTime: wind.uTime,
      uFireflies: { value: 0 },
      uPixelRatio: { value: 1 },
      uColor: { value: new THREE.Color('#ffffff') },
      uOpacity: { value: 0.4 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// Leaves that let go of the trees and drift down, coloured like the tree they left. The two
// trees drop the same leaf at the same moment and it falls the same way from each, so a falling
// leaf is never a difference between them.
class FallingLeaves {
  constructor(scene) {
    const { leafGeometry } = treeMaterials();
    this.capacity = 70;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 });
    this.mesh = new THREE.InstancedMesh(leafGeometry, material, this.capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.leaves = [];
    this.spawnTimer = 0;
    this.matrix = new THREE.Matrix4();
    this.quaternion = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.position = new THREE.Vector3();
    this.scale = new THREE.Vector3();
  }

  // Removes every leaf in the air or on the grass: they were dropped where the trees stood before
  // the new pair moved them, so their twins would no longer line up.
  clear() {
    this.leaves.length = 0;
  }

  // Drops leaf number `index` from every tree, with one fall, sway and spin for all. A leaf that
  // differs between the trees falls from neither: one on a missing branch (not drawn on one tree)
  // or on a recoloured bough (another colour on one tree).
  spawnFrom(views, index) {
    const sizes = views.map((view) => Math.hypot(view.data.leafMatrices[index * 16], view.data.leafMatrices[index * 16 + 1], view.data.leafMatrices[index * 16 + 2]));
    if (sizes.some((size) => size < 0.01)) return;
    const colourOf = (view) => [0, 1, 2].map((c) => view.data.leafColors[index * 3 + c]);
    const sameColour = views.every((view) => colourOf(view).every((value, c) => value === colourOf(views[0])[c]));
    if (!sameColour) return;
    const fall = lerp(0.35, 0.6, Math.random());
    const phase = Math.random() * 10;
    const spin = lerp(1.5, 3.5, Math.random());
    views.forEach((view, v) => {
      const data = view.data;
      this.leaves.push({
        x: data.leafAnchors[index * 4] + view.worldX,
        y: data.leafAnchors[index * 4 + 1],
        z: data.leafAnchors[index * 4 + 2],
        size: sizes[v],
        color: [
          srgbToLinear(data.leafColors[index * 3]),
          srgbToLinear(data.leafColors[index * 3 + 1]),
          srgbToLinear(data.leafColors[index * 3 + 2]),
        ],
        fall,
        phase,
        spin,
        age: 0,
        landed: -1,
      });
      if (this.leaves.length > this.capacity) this.leaves.shift();
    });
  }

  update(dt, elapsed, views) {
    // Both trees have the same traits and the same leaves; they differ only in the planned places.
    const grown = views.every((view) => view.data && view.growth >= 1 && view.data.leafCount === views[0].data.leafCount);
    if (grown && views[0].data.leafCount > 0) {
      // Autumn trees drop more leaves.
      const autumn = views[0].genes ? views[0].genes.autumn : 0;
      this.spawnTimer += dt * (0.25 + autumn * 1.4);
      if (this.spawnTimer >= 1) {
        this.spawnTimer %= 1;
        this.spawnFrom(views, Math.floor(Math.random() * views[0].data.leafCount));
      }
    }

    let n = 0;
    this.leaves = this.leaves.filter((leaf) => leaf.landed < 0 || elapsed - leaf.landed < 4);
    for (const leaf of this.leaves) {
      leaf.age += dt;
      let fade = 1;
      if (leaf.landed < 0) {
        leaf.y -= leaf.fall * dt;
        leaf.x += (Math.sin(elapsed * 1.3 + leaf.phase) * 0.5 + 0.35) * dt;
        leaf.z += Math.cos(elapsed * 0.9 + leaf.phase) * 0.3 * dt;
        if (leaf.y <= 0.03) {
          leaf.y = 0.03;
          leaf.landed = elapsed;
        }
      } else {
        fade = 1 - clamp((elapsed - leaf.landed - 2.5) / 1.5, 0, 1);
      }
      const tumble = leaf.landed < 0 ? leaf.age * leaf.spin : 0;
      this.euler.set(leaf.landed < 0 ? Math.sin(tumble) * 1.2 : -Math.PI / 2, tumble, leaf.phase);
      this.quaternion.setFromEuler(this.euler);
      const s = leaf.size * fade;
      this.position.set(leaf.x, leaf.y, leaf.z);
      this.scale.set(s, s, s);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(n, this.matrix);
      this.mesh.instanceColor.setXYZ(n, leaf.color[0], leaf.color[1], leaf.color[2]);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

function sunDirection(palette, target) {
  const elevation = THREE.MathUtils.degToRad(palette.sunElevation);
  const azimuth = THREE.MathUtils.degToRad(palette.sunAzimuth);
  // Azimuth 0 is behind the camera (sun lighting the trees' front), 90 is to the right,
  // 180 is straight ahead, low in the sky behind the trees.
  return target.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
}

export function createWorld(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  // Read again on resize: moving the window to another screen or zooming changes it.
  const pixelRatio = () => (LOW_QUALITY ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = !LOW_QUALITY;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#d2e5ef', 40, 230);

  // A stage hidden at load time is 0 by 0; 0 / 0 is NaN, so start square until it has a size.
  const camera = new THREE.PerspectiveCamera(36, container.clientWidth / container.clientHeight || 1, 0.1, 1500);
  camera.position.set(0, 3.4, 17);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 6;
  controls.maxDistance = 34;
  controls.minPolarAngle = 0.5;
  controls.maxPolarAngle = 1.52;
  // The camera turns all the way around both trees, so every side of them can be looked at.
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.rotateSpeed = 0.6;

  const skyUniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({ vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight('#ffffff', '#555555', 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -15;
  sun.shadow.camera.right = 15;
  sun.shadow.camera.top = 15;
  sun.shadow.camera.bottom = -15;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  sun.target.position.set(0, 2, 0);
  scene.add(sun);
  scene.add(sun.target);

  scene.add(createTerrain());
  scene.add(createGrass());
  scene.add(createWildflowers());
  const { group: cloudGroup, clouds } = createClouds();
  scene.add(cloudGroup);
  const pollen = createPollen();
  pollen.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  scene.add(pollen);
  const fallingLeaves = new FallingLeaves(scene);

  // Time of day is blended: `current` moves toward the target palette each frame.
  const current = {};
  const colorKeys = ['skyTop', 'skyHorizon', 'fog', 'hemiSky', 'hemiGround', 'sun', 'pollen', 'cloud'];
  const numberKeys = ['sunIntensity', 'sunElevation', 'sunAzimuth', 'hemiIntensity', 'fireflies', 'exposure'];
  function loadPalette(palette) {
    for (const key of colorKeys) current[key] = new THREE.Color(palette[key]);
    for (const key of numberKeys) current[key] = palette[key];
  }
  loadPalette(PALETTES[1]);
  let targetPalette = PALETTES[1];
  const sunDir = new THREE.Vector3();
  const tmpColor = new THREE.Color();

  function applyPalette(dt) {
    const t = dt === Infinity ? 1 : 1 - Math.exp(-dt * 1.2);
    for (const key of colorKeys) current[key].lerp(tmpColor.set(targetPalette[key]), t);
    for (const key of numberKeys) current[key] = lerp(current[key], targetPalette[key], t);

    skyUniforms.uTop.value.copy(current.skyTop);
    skyUniforms.uHorizon.value.copy(current.skyHorizon);
    skyUniforms.uGround.value.copy(current.fog);
    skyUniforms.uSunColor.value.copy(current.sun);
    scene.fog.color.copy(current.fog);
    hemi.color.copy(current.hemiSky);
    hemi.groundColor.copy(current.hemiGround);
    hemi.intensity = current.hemiIntensity;
    sun.color.copy(current.sun);
    sun.intensity = current.sunIntensity;
    sunDirection(current, sunDir);
    skyUniforms.uSunDirection.value.copy(sunDir);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 40);
    renderer.toneMappingExposure = current.exposure;
    pollen.material.uniforms.uColor.value.copy(current.pollen);
    pollen.material.uniforms.uFireflies.value = current.fireflies;
    pollen.material.uniforms.uOpacity.value = lerp(0.3, 1, current.fireflies);
    for (const cloud of clouds) cloud.material.color.copy(current.cloud);
  }

  function setPalette(index, immediate = false) {
    targetPalette = PALETTES[((index % PALETTES.length) + PALETTES.length) % PALETTES.length];
    if (immediate) loadPalette(targetPalette);
  }

  // Camera framing: ease the orbit target and distance so both trees fit.
  const framing = { active: false, until: 0, targetY: 3, distance: 17, shiftX: 0, shiftY: 0 };
  // Largest idle camera sway either side, in radians (about 7 degrees).
  const IDLE_SWING = 0.12;
  // The view shift actually applied, easing toward framing.shiftX / shiftY.
  const viewShift = { x: 0, y: 0 };
  let lastInteraction = -10;
  controls.addEventListener('start', () => {
    framing.active = false;
    lastInteraction = performance.now() / 1000;
  });

  // `panel` says how much of the screen is covered: `right` as a share of the width,
  // `top` and `bottom` as shares of the height. The trees are fitted into the
  // uncovered part, and the picture is shifted with a view offset so they sit in
  // its middle. Shifting the picture, rather than moving the camera, keeps the
  // camera above the ground however tall the panel is.
  function frameBounds(boundsList, elapsed, panel = {}) {
    const coveredRight = panel.right ?? 0;
    const coveredBottom = panel.bottom ?? 0;
    const coveredTop = panel.top ?? 0;
    const valid = boundsList.filter(Boolean);
    const aspectUsable = Number.isFinite(camera.aspect) && camera.aspect > 0;
    if (valid.length === 0 || !aspectUsable) return;
    const minX = Math.min(...valid.map((b) => b.minX));
    const maxX = Math.max(...valid.map((b) => b.maxX));
    const maxY = Math.max(...valid.map((b) => b.maxY));
    const halfWidth = Math.max(Math.abs(minX), Math.abs(maxX)) + 0.8;
    const halfHeight = maxY / 2 + 0.9;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // Covers that overlap on a very short window must not shrink the usable height to zero.
    const usableHeight = Math.max(0.2, 1 - coveredBottom - coveredTop);
    const byHeight = halfHeight / (tanHalf * usableHeight);
    const byWidth = halfWidth / (tanHalf * camera.aspect * (1 - coveredRight));
    // Portrait phones need the camera much further back to fit both trees side by side.
    framing.distance = clamp(Math.max(byHeight, byWidth) + 0.6, controls.minDistance, 80);
    controls.maxDistance = Math.max(34, framing.distance + 6);
    framing.targetY = halfHeight - 0.35;
    framing.shiftX = coveredRight / 2;
    // A cover at the bottom moves the picture up, one at the top moves it down.
    framing.shiftY = (coveredBottom - coveredTop) / 2;
    framing.active = true;
    framing.until = elapsed + 2.5;
  }

  const offset = new THREE.Vector3();
  const canvasSize = new THREE.Vector2();
  function updateViewShift(dt) {
    const t = 1 - Math.exp(-dt * 2.2);
    viewShift.x = lerp(viewShift.x, framing.shiftX, t);
    viewShift.y = lerp(viewShift.y, framing.shiftY, t);
    renderer.getSize(canvasSize);
    // setViewOffset also sets the aspect ratio from these sizes; a canvas that is
    // 0 by 0 (stage hidden) would make it NaN.
    if (canvasSize.x === 0 || canvasSize.y === 0) return;
    camera.setViewOffset(canvasSize.x, canvasSize.y, viewShift.x * canvasSize.x, viewShift.y * canvasSize.y, canvasSize.x, canvasSize.y);
  }

  function updateCamera(dt, elapsed) {
    updateViewShift(dt);
    if (framing.active) {
      // Move the target and keep the viewing angle, so the camera glides rather than swings.
      const t = 1 - Math.exp(-dt * 2.2);
      offset.copy(camera.position).sub(controls.target);
      controls.target.x = lerp(controls.target.x, 0, t);
      controls.target.y = lerp(controls.target.y, framing.targetY, t);
      offset.setLength(lerp(offset.length(), framing.distance, t));
      camera.position.copy(controls.target).add(offset);
      if (elapsed > framing.until) framing.active = false;
    }
    // A slow drift while the player is not touching the camera, to show depth. The
    // turn per frame is the change of IDLE_SWING * sin(0.13 t) over this frame, so its
    // size does not depend on the frame rate. Uninterrupted, it sways IDLE_SWING either
    // way; a drag pauses it mid-cycle, so from where the player leaves the camera it can
    // reach twice that. Both trees stay in view at twice the swing (checked on a phone
    // and a desktop window).
    const idle = performance.now() / 1000 - lastInteraction > 4;
    if (idle) {
      offset.copy(camera.position).sub(controls.target);
      offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, IDLE_SWING * 0.13 * Math.cos(elapsed * 0.13) * dt);
      camera.position.copy(controls.target).add(offset);
    }
    controls.update();
    keepAboveGround();
  }

  // On a narrow screen the camera stands far back, among the hills. Lift it, at the same
  // distance from the target, until it sees the trees over them. A change made after
  // controls.update() stays: the controls read the camera's position again on the next update.
  // The camera is turned to the target again here, since controls.update() aimed it from where
  // it was.
  function keepAboveGround() {
    const lifted = liftAboveGround(controls.target, camera.position);
    if (lifted.y === camera.position.y) return;
    camera.position.set(lifted.x, lifted.y, lifted.z);
    camera.lookAt(controls.target);
  }

  // The ray through a screen point: { origin, direction } as plain arrays, direction of length 1.
  const rayStart = new THREE.Vector3();
  const rayEnd = new THREE.Vector3();
  function rayAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    rayStart.set(x, y, -1).unproject(camera);
    rayEnd.set(x, y, 1).unproject(camera);
    rayEnd.sub(rayStart).normalize();
    return { origin: rayStart.toArray(), direction: rayEnd.toArray() };
  }

  // Screen position of a world point, in CSS pixels relative to the container (used by the
  // browser checks to see where the trees are).
  const projected = new THREE.Vector3();
  function toScreen(x, y, z) {
    projected.set(x, y, z).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: (projected.x * 0.5 + 0.5) * rect.width, y: (-projected.y * 0.5 + 0.5) * rect.height, visible: projected.z < 1 };
  }

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    // A hidden or minimised page can report 0 by 0. An aspect ratio of 0/0 is NaN,
    // which would spread into the camera position and never leave it.
    if (width === 0 || height === 0) return;
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(width, height);
    pollen.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    camera.aspect = width / height;
    updateViewShift(0);
  }
  // Watch the stage itself, which can change size without a window resize (a hidden
  // page or parent shown again); the window only in browsers without ResizeObserver.
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(container);
  else window.addEventListener('resize', resize);
  // A changed pixel ratio (window moved to another screen) changes neither size, so
  // it is watched separately: this query stops matching when the ratio changes, and
  // a new one is set up for the new ratio.
  function watchPixelRatio() {
    if (!window.matchMedia) return;
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', () => {
      resize();
      watchPixelRatio();
    }, { once: true });
  }
  watchPixelRatio();

  function update(dt, elapsed, views) {
    wind.uTime.value = elapsed;
    applyPalette(dt);
    updateCamera(dt, elapsed);
    sky.position.copy(camera.position);
    for (const cloud of clouds) {
      cloud.position.x += cloud.userData.drift * dt * 0.8;
      if (cloud.position.x > 360) cloud.position.x = -360;
    }
    fallingLeaves.update(dt, elapsed, views);
  }

  function render() {
    renderer.render(scene, camera);
  }

  applyPalette(Infinity);

  return { renderer, scene, camera, controls, fallingLeaves, update, render, setPalette, frameBounds, rayAt, toScreen, resize };
}
