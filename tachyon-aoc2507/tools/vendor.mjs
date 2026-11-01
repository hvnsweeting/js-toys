// Copies the pinned three.js build and the addons the game uses into vendor/,
// so the game runs with no build step (loaded through an import map).
import {cpSync, existsSync, mkdirSync, renameSync, rmSync} from 'node:fs';
import {join} from 'node:path';

const src = join('node_modules', 'three');
const dest = join('vendor', 'three');
const staging = join('vendor', 'three.staging');

// Copy into a staging folder and swap it in only after every copy succeeded, so a missing or
// partial node_modules/three never leaves the game with a broken vendor/three. The swap is two
// renames; a process killed between them leaves the old copy in vendor/three.previous.
if (!existsSync(join(src, 'build', 'three.module.js'))) {
  console.error(`${src} is missing; run npm install first. vendor/ was left unchanged.`);
  process.exit(1);
}
rmSync(staging, {recursive: true, force: true});
mkdirSync(join(staging, 'build'), {recursive: true});
cpSync(join(src, 'LICENSE'), join(staging, 'LICENSE'));
for (const file of ['three.module.js', 'three.core.js']) {
  cpSync(join(src, 'build', file), join(staging, 'build', file));
}
for (const dir of ['postprocessing', 'shaders', 'controls', 'geometries', 'utils']) {
  cpSync(join(src, 'examples', 'jsm', dir), join(staging, 'addons', dir), {recursive: true});
}
// Move the old copy aside rather than deleting it, so a failed swap can put it back.
const previous = join('vendor', 'three.previous');
rmSync(previous, {recursive: true, force: true});
if (existsSync(dest)) renameSync(dest, previous);
try {
  renameSync(staging, dest);
} catch (error) {
  if (existsSync(previous)) renameSync(previous, dest);
  throw error;
}
rmSync(previous, {recursive: true, force: true});
console.log('vendored three.js into', dest);
