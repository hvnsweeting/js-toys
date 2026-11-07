import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run with `node --import ./tools/register-vendor-three.mjs --test`; the browser gets the same
// mapping from the importmap in index.html, and the two must agree.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { imports } = JSON.parse(readFileSync(path.join(root, 'index.html'), 'utf8').match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
const fromImportmap = (target) => pathToFileURL(path.join(root, target)).href;

test('the Node hook resolves three and its addons to the files the importmap names', () => {
  assert.equal(import.meta.resolve('three'), fromImportmap(imports.three), 'run the tests with --import ./tools/register-vendor-three.mjs');
  const addon = 'controls/OrbitControls.js';
  assert.equal(import.meta.resolve(`three/addons/${addon}`), fromImportmap(imports['three/addons/'] + addon));
});

test('an addon specifier cannot climb out of the addons folder', () => {
  const climbing = ['three/addons/../../../README.md', 'three/addons/../three.module.js', 'three/addons/../addons-evil/x.js'];
  for (const specifier of climbing) {
    // The hook declines and Node's own resolver then fails; the error must be a resolution error.
    assert.throws(() => import.meta.resolve(specifier), (error) => /^ERR_(MODULE_NOT_FOUND|PACKAGE_PATH_NOT_EXPORTED|INVALID_MODULE_SPECIFIER)$/.test(error.code), specifier);
  }
});

test("an addon's own import of three gets the vendored copy too", async () => {
  // OrbitControls does `import ... from 'three'`. If that import reached node_modules
  // while the test's own import reached vendor/, two copies of three.js would mix.
  const { resolve } = await import('../tools/vendor-three-hooks.mjs');
  const addonFile = pathToFileURL(path.join(root, imports['three/addons/'], 'controls/OrbitControls.js')).href;
  const fallback = () => ({ url: 'file:///node_modules/three/build/three.module.js' });
  assert.equal(resolve('three', { parentURL: addonFile }, fallback).url, fromImportmap(imports.three));
});

test('the addon the game uses loads through the hook', async () => {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  assert.equal(typeof OrbitControls, 'function');
  assert.equal(typeof THREE.PerspectiveCamera, 'function');
});
