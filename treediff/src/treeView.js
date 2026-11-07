// One tree on screen. Owns its meshes and rebuilds their vertex data whenever the
// genes or growth stage change (about a millisecond per rebuild).

import * as THREE from 'three';
import { createSpecies, createTreeData, growTree, prepareEdit } from './skeleton.js';
import { createProp, disposeProp, createRing } from './props.js';
import { treeMaterials, srgbToLinear } from './materials.js';
import { mulberry32 } from './random.js';

function radialSegmentsForDepth(depth) {
  if (depth === 0) return 12;
  if (depth === 1) return 9;
  if (depth === 2) return 6;
  return 4;
}

export class TreeView {
  constructor(scene, x) {
    this.materials = treeMaterials();
    this.group = new THREE.Group();
    this.group.position.x = x;
    scene.add(this.group);

    this.species = null;
    this.data = null;
    this.genes = null;
    this.growth = 0;
    this.growthTarget = 0;
    this.growthSpeed = 0.6;
    this.dirty = false;
    this.resolveGrowth = null;

    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.materials.contactShadow, transparent: true, depthWrite: false }),
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.02;
    this.contactShadow.renderOrder = 1;
    this.group.add(this.contactShadow);

    // The objects that a difference adds to this tree, and the rings that mark differences. The
    // objects are drawn only while the tree is fully grown: they sit on branch points of the
    // grown tree.
    this.propsGroup = new THREE.Group();
    this.ringsGroup = new THREE.Group();
    this.group.add(this.propsGroup);
    this.group.add(this.ringsGroup);
    this.edit = null;
    this.markerRings = [];
    this.time = 0;
  }

  get worldX() {
    return this.group.position.x;
  }

  // Moves the tree along the row. Done between pairs, while the tree is shrunk to nothing.
  setX(x) {
    this.group.position.x = x;
  }

  // Switching species rebuilds every buffer, because topology changes. `changes` describes
  // boughs to leave out or recolour (see prepareEdit in skeleton.js); objects and rings are
  // cleared, since they belong to the tree that was planted before.
  setTree(seed, genes, growth = 0, changes = null) {
    if (!this.species || this.species.seed !== seed) {
      this.species = createSpecies(seed);
      this.data = createTreeData(this.species);
      this.buildMeshes();
    }
    this.edit = changes ? prepareEdit(this.species, changes) : null;
    this.setProps([]);
    this.setRings([]);
    this.genes = { ...genes };
    this.growth = growth;
    this.dirty = true;
  }

  // Replaces the objects on the tree. `differences` are the entries of planDifferences with an `attach`.
  setProps(differences) {
    for (const prop of [...this.propsGroup.children]) {
      this.propsGroup.remove(prop);
      disposeProp(prop);
    }
    for (const difference of differences) this.propsGroup.add(createProp(difference));
  }

  // Replaces the rings: [{ position, radius, color, pulse }]. A pulsing ring fades in and out.
  setRings(rings) {
    for (const ring of [...this.ringsGroup.children]) {
      this.ringsGroup.remove(ring);
      ring.material.dispose();
    }
    this.markerRings = rings.map(({ position, radius, color, pulse = false }) => {
      const ring = createRing(position, radius, color);
      ring.userData.pulse = pulse;
      this.ringsGroup.add(ring);
      return ring;
    });
  }

  setGenes(genes) {
    this.genes = { ...genes };
    this.dirty = true;
  }

  // Animates growth toward `target` (0 bare, 1 grown) at `speed` per second.
  // Resolves when it gets there, or when a newer growTo call takes over.
  growTo(target, speed = 0.6) {
    this.finishGrowth();
    this.growthTarget = target;
    this.growthSpeed = speed;
    if (this.growth === target) return Promise.resolve();
    return new Promise((resolve) => {
      this.resolveGrowth = resolve;
    });
  }

  finishGrowth() {
    const resolve = this.resolveGrowth;
    this.resolveGrowth = null;
    if (resolve) resolve();
  }

  disposeMeshes() {
    for (const mesh of [this.bark, this.leaves, this.blossoms]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      // InstancedMesh also holds GPU buffers for its per-instance matrices and colours.
      if (mesh.isInstancedMesh) mesh.dispose();
    }
  }

  buildMeshes() {
    this.disposeMeshes();
    const { species } = this;
    const m = this.materials;

    // Bark: one tube per branch, all merged into a single geometry. The index
    // buffer depends only on topology, so it is written once here.
    let vertexCount = 0;
    let indexCount = 0;
    this.rings = species.branches.map((plan) => {
      const radial = radialSegmentsForDepth(plan.depth);
      const ring = { radial, firstVertex: vertexCount };
      vertexCount += (plan.steps + 1) * (radial + 1);
      indexCount += plan.steps * radial * 6;
      return ring;
    });
    const indices = new Uint32Array(indexCount);
    let w = 0;
    species.branches.forEach((plan, b) => {
      const { radial, firstVertex } = this.rings[b];
      for (let i = 0; i < plan.steps; i++) {
        for (let j = 0; j < radial; j++) {
          // a and a + 1 are neighbours around ring i; c and c + 1 the same on ring i + 1.
          // Ring angle runs from the normal toward tangent x normal, so this order
          // winds each triangle counter-clockwise seen from outside the branch.
          const a = firstVertex + i * (radial + 1) + j;
          const c = a + radial + 1;
          indices[w++] = a;
          indices[w++] = a + 1;
          indices[w++] = c;
          indices[w++] = a + 1;
          indices[w++] = c + 1;
          indices[w++] = c;
        }
      }
    });
    const barkGeometry = new THREE.BufferGeometry();
    barkGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3], ['aAnchor', 4]]) {
      const attribute = new THREE.BufferAttribute(new Float32Array(vertexCount * size), size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      barkGeometry.setAttribute(name, attribute);
    }
    this.bark = new THREE.Mesh(barkGeometry, m.bark);
    this.bark.customDepthMaterial = m.barkDepth;
    this.bark.castShadow = true;
    this.bark.receiveShadow = true;
    this.bark.frustumCulled = false;
    this.group.add(this.bark);

    // Per-branch shade variation, fixed per species so it does not flicker.
    const rng = mulberry32(species.seed ^ 0x5bd1e995);
    this.branchShade = new Float32Array(species.branches.length).map(() => 0.85 + rng() * 0.2);

    this.leaves = this.createInstanced(m.leafGeometry, m.leaf, m.leafDepth, species.leaves.length);
    this.blossoms = this.createInstanced(m.blossomGeometry, m.blossom, m.blossomDepth, species.blossoms.length);
  }

  createInstanced(baseGeometry, material, depthMaterial, capacity) {
    // Each tree needs its own geometry copy because the anchor attribute is per tree.
    const geometry = baseGeometry.clone();
    const anchors = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 4), 4);
    anchors.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aAnchor', anchors);
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.customDepthMaterial = depthMaterial;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    return mesh;
  }

  update(dt) {
    if (!this.species) return;
    if (this.growth !== this.growthTarget) {
      const step = this.growthSpeed * dt;
      this.growth =
        this.growth < this.growthTarget
          ? Math.min(this.growthTarget, this.growth + step)
          : Math.max(this.growthTarget, this.growth - step);
      this.dirty = true;
      if (this.growth === this.growthTarget) this.finishGrowth();
    }
    if (this.dirty) {
      this.rebuild();
      this.dirty = false;
    }
    this.propsGroup.visible = this.growth >= 1;
    this.time += dt;
    for (const ring of this.markerRings) {
      if (ring.userData.pulse) ring.material.opacity = 0.35 + 0.3 * Math.sin(this.time * 4);
    }
  }

  rebuild() {
    const data = growTree(this.species, this.genes, this.growth, this.data, this.edit);
    this.writeBark(data);
    this.writeInstances(this.leaves, data.leafCount, data.leafMatrices, data.leafAnchors, data.leafColors);
    this.writeInstances(this.blossoms, data.blossomCount, data.blossomMatrices, data.blossomAnchors, data.blossomColors);

    const b = data.bounds;
    const canopy = Math.max(1, (b.maxX - b.minX + b.maxZ - b.minZ) * 0.45) * Math.max(0.05, this.growth);
    this.contactShadow.scale.set(canopy, canopy, 1);
    this.contactShadow.position.x = (b.minX + b.maxX) * 0.25;
  }

  writeBark(data) {
    const geometry = this.bark.geometry;
    const position = geometry.attributes.position.array;
    const normal = geometry.attributes.normal.array;
    const uv = geometry.attributes.uv.array;
    const color = geometry.attributes.color.array;
    const anchor = geometry.attributes.aAnchor.array;
    const bark = data.barkColor.map(srgbToLinear);
    const n = [0, 0, 0];
    const bn = [0, 0, 0];

    this.species.branches.forEach((plan, b) => {
      const { radial, firstVertex } = this.rings[b];
      const shade = this.branchShade[b];
      for (let i = 0; i <= plan.steps; i++) {
        const k = plan.pointOffset + i;
        const px = data.positions[k * 3];
        const py = data.positions[k * 3 + 1];
        const pz = data.positions[k * 3 + 2];
        const tx = data.tangents[k * 3];
        const ty = data.tangents[k * 3 + 1];
        const tz = data.tangents[k * 3 + 2];
        n[0] = data.normals[k * 3];
        n[1] = data.normals[k * 3 + 1];
        n[2] = data.normals[k * 3 + 2];
        bn[0] = ty * n[2] - tz * n[1];
        bn[1] = tz * n[0] - tx * n[2];
        bn[2] = tx * n[1] - ty * n[0];
        const radius = data.radii[k];
        // Darker near the ground, a cheap stand-in for ambient occlusion.
        const occlusion = 0.62 + 0.38 * Math.min(1, py / 2.5);
        const v = data.distances[k] * 0.9;
        for (let j = 0; j <= radial; j++) {
          const angle = (j / radial) * Math.PI * 2;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const nx = n[0] * cos + bn[0] * sin;
          const ny = n[1] * cos + bn[1] * sin;
          const nz = n[2] * cos + bn[2] * sin;
          const vertex = firstVertex + i * (radial + 1) + j;
          position[vertex * 3] = px + nx * radius;
          position[vertex * 3 + 1] = py + ny * radius;
          position[vertex * 3 + 2] = pz + nz * radius;
          normal[vertex * 3] = nx;
          normal[vertex * 3 + 1] = ny;
          normal[vertex * 3 + 2] = nz;
          uv[vertex * 2] = (j / radial) * 2;
          uv[vertex * 2 + 1] = v;
          color[vertex * 3] = bark[0] * shade * occlusion;
          color[vertex * 3 + 1] = bark[1] * shade * occlusion;
          color[vertex * 3 + 2] = bark[2] * shade * occlusion;
          anchor[vertex * 4] = px;
          anchor[vertex * 4 + 1] = py;
          anchor[vertex * 4 + 2] = pz;
          anchor[vertex * 4 + 3] = data.flex[k];
        }
      }
    });
    for (const name of ['position', 'normal', 'uv', 'color', 'aAnchor']) geometry.attributes[name].needsUpdate = true;
  }

  writeInstances(mesh, count, matrices, anchors, colors) {
    mesh.count = count;
    if (count === 0) return;
    mesh.instanceMatrix.array.set(matrices.subarray(0, count * 16));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.attributes.aAnchor.array.set(anchors.subarray(0, count * 4));
    mesh.geometry.attributes.aAnchor.needsUpdate = true;
    const target = mesh.instanceColor.array;
    for (let i = 0; i < count * 3; i++) target[i] = srgbToLinear(colors[i]);
    mesh.instanceColor.needsUpdate = true;
  }

  // World-space bounds of the tree once fully grown, for camera framing, with its own genes or
  // with `genes` instead. Uses a separate buffer so the tree on screen is not disturbed.
  grownBounds(genes = this.genes) {
    if (!this.species) return null;
    // The buffer is sized for one species; two species can share a branch count
    // and still differ in point and leaf counts, so compare the species itself.
    if (!this.boundsData || this.boundsSpecies !== this.species) {
      this.boundsData = createTreeData(this.species);
      this.boundsSpecies = this.species;
    }
    const b = growTree(this.species, genes, 1, this.boundsData, this.edit).bounds;
    return { minX: b.minX + this.worldX, maxX: b.maxX + this.worldX, minY: b.minY, maxY: b.maxY, minZ: b.minZ, maxZ: b.maxZ };
  }
}
