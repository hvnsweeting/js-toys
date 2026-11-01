import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publishScreenshots, screenshotsFor, touchSizes} from '../tools/screenshots.mjs';

test('every touch size checked by the browser has its screenshot names registered', () => {
  assert.equal(touchSizes.length, 10);
  const names = new Set(screenshotsFor(['sizes']));
  for (const [width, height] of touchSizes) {
    for (const screen of ['title', 'select', 'help', 'game', 'rush-game', 'result']) {
      assert.ok(names.has(`${screen}-${width}x${height}`), `${screen} ${width}x${height}`);
    }
  }
});

test('a partial browser run selects only its own screenshots', () => {
  assert.deepEqual(screenshotsFor(['title']),
      ['title-1280x800', 'select-1280x800', 'help-1280x800']);
  assert.deepEqual(screenshotsFor(['input', 'memory']), []);
  assert.ok(screenshotsFor(['campaign', 'sizes']).includes('win-390x844'));
  assert.ok(!screenshotsFor(['campaign', 'sizes']).includes('rush-win'));
});

test('failed screenshot staging keeps prior images until the scenario passes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tachyon-shots-'));
  const shots = join(root, 'shots');
  const staging = join(root, 'staging');
  try {
    await mkdir(shots);
    await mkdir(staging);
    const names = screenshotsFor(['title']);
    for (const name of names) await writeFile(join(shots, `${name}.png`), 'old');
    await writeFile(join(staging, `${names[0]}.png`), 'new');
    await assert.rejects(publishScreenshots('title', staging, shots), /Missing screenshot/);
    for (const name of names)
      assert.equal(await readFile(join(shots, `${name}.png`), 'utf8'), 'old');
    for (const name of names.slice(1)) await writeFile(join(staging, `${name}.png`), 'new');
    await publishScreenshots('title', staging, shots);
    for (const name of names)
      assert.equal(await readFile(join(shots, `${name}.png`), 'utf8'), 'new');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
