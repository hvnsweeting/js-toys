import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMutationScratch } from './mutation-scratch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await createMutationScratch(root);
const source = path.join(scratch, 'src', 'rules.js');
const test = path.join(scratch, 'test', 'difficulty.test.mjs');

function run() {
  return spawnSync(process.execPath, ['--test', '--test-name-pattern=seed fixes the full pattern', test], { cwd: root, encoding: 'utf8' });
}

try {
  await mkdir(path.dirname(source), { recursive: true });
  await mkdir(path.dirname(test), { recursive: true });
  await copyFile(path.join(root, 'src', 'rules.js'), source);
  await copyFile(path.join(root, 'test', 'difficulty.test.mjs'), test);
  await copyFile(path.join(root, 'test', 'flight-controller.mjs'), path.join(scratch, 'test', 'flight-controller.mjs'));
  const baseline = run();
  assert.equal(baseline.status, 0, `Baseline failed:\n${baseline.stdout}\n${baseline.stderr}`);

  const original = await readFile(source, 'utf8');
  const target = 'export const MIN_NEIGHBOR_CHANGE = 0.9;';
  assert.ok(original.includes(target), 'Expected minimum-change source line is missing');
  await writeFile(source, original.replace(target, 'export const MIN_NEIGHBOR_CHANGE = 0;'));
  const mutated = run();
  assert.notEqual(mutated.status, 0, 'Minimum-change mutation was not caught');
  assert.match(mutated.stdout + mutated.stderr, /gate \d+:/, 'The gate-change assertion did not catch the mutation');
  console.log('Baseline passed; zero minimum-change mutation failed the gate-change assertion.');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
