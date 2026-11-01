import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {inspectBeam, inspectBoardBounds} from '../src/render/scene.js';

test('beam inspection requires a drawn, visible mesh attached to the scene', () => {
  const scene = new THREE.Scene();
  const board = new THREE.Group();
  const beam = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 3);
  beam.count = 3;
  scene.add(board);
  board.add(beam);
  assert.deepEqual(inspectBeam(beam, scene),
      {visible: true, inScene: true, opacity: 1, drawCount: 3});
  beam.visible = false;
  assert.equal(inspectBeam(beam, scene).visible, false);
  beam.visible = true;
  beam.material.visible = false;
  assert.equal(inspectBeam(beam, scene).visible, false);
  beam.material.visible = true;
  beam.material.opacity = 0;
  assert.equal(inspectBeam(beam, scene).opacity, 0);
  beam.material.opacity = 1;
  beam.geometry.setDrawRange(0, 0);
  assert.equal(inspectBeam(beam, scene).drawCount, 0);
  beam.geometry.setDrawRange(0, 3);
  board.remove(beam);
  assert.equal(inspectBeam(beam, scene).inScene, false);
});

test('board bounds inspect geometry inside a nested frame group', () => {
  const board = new THREE.Group();
  const frame = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(.2, 1, .2), new THREE.MeshBasicMaterial());
  bar.name = 'frame bar';
  frame.add(bar);
  board.add(frame);
  const level = {grid: ['.S.', '...', '...']};
  assert.deepEqual(inspectBoardBounds(board, level, [], null), []);
  frame.position.x = 3;
  assert.deepEqual(inspectBoardBounds(board, level, [], null), ['frame bar']);
});

test('board bounds include nested sprites', () => {
  const board = new THREE.Group();
  const frame = new THREE.Group();
  const label = new THREE.Sprite(new THREE.SpriteMaterial());
  label.name = 'detector label';
  label.position.x = 3;
  frame.add(label);
  board.add(frame);
  const level = {grid: ['.S.', '...', '...']};
  assert.deepEqual(inspectBoardBounds(board, level, [], null), ['detector label']);
});
