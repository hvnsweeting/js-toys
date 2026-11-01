import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, hashOfFile, readWorker, stamped, storedFiles, versionOf, writtenVersion, writeStamped } from '../tools/stamp-sw.mjs';

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const html = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));
const pictures = JSON.parse(read('pictures/manifest.json'));
const files = storedFiles().map(([file]) => file);

test('stamping removes its temporary path after a write or rename error', () => {
  for (const failure of ['write', 'rename']) {
    const removed = [];
    const operations = {
      write: () => { if (failure === 'write') throw Error('write failed'); },
      rename: () => { if (failure === 'rename') throw Error('rename failed'); },
      remove: (file) => removed.push(file),
    };
    assert.throws(() => writeStamped('updated', '/private/sw.js', operations), /failed/);
    assert.deepEqual(removed, [`/private/sw.js.${process.pid}.new`]);
  }
});

test('the manifest and app icons describe an installable Jigsaw', () => {
  assert.equal(manifest.name, 'Jigsaw');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#f2efe4');
  assert.equal(manifest.theme_color, '#526f61');
  for (const icon of manifest.icons) {
    const data = readFileSync(path.join(ROOT, icon.src));
    assert.equal(data.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`, icon.sizes);
  }
  const touch = readFileSync(path.join(ROOT, 'icons/apple-touch-icon.png'));
  assert.equal(`${touch.readUInt32BE(16)}x${touch.readUInt32BE(20)}`, '180x180');
  for (const tag of ['manifest', 'apple-touch-icon', 'theme-color',
    'apple-mobile-web-app-capable', 'mobile-web-app-capable', 'apple-mobile-web-app-title'])
    assert.ok(html.includes(tag), `page includes ${tag}`);
  assert.match(read('css/style.css'), /@media \(display-mode: standalone\)\s*\{\s*#arcade-link\s*\{\s*display: none;/);
});

test('the worker lists every loaded file, all 20 paintings, and no missing file', () => {
  const needed = new Set(['./', 'index.html', 'pictures/manifest.json', 'pictures/CREDITS.md']);
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (!match[1].startsWith('../') && !match[1].includes(':')) needed.add(match[1]);
  }
  for (const icon of manifest.icons) needed.add(icon.src);
  for (const picture of pictures) {
    needed.add(picture.file);
    needed.add(picture.thumb);
  }
  const visit = (file) => {
    if (needed.has(file)) return;
    needed.add(file);
    for (const match of read(file).matchAll(/(?:import|export)\s[\s\S]*?from\s+["'](\.[^"']+)["']/g)) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
    }
  };
  needed.delete('js/app.js');
  visit('js/app.js');
  for (const match of read('css/style.css').matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    if (!match[1].startsWith('data:')) needed.add(path.posix.normalize(path.posix.join('css', match[1])));
  }
  assert.equal(pictures.length, 20);
  assert.ok(needed.has('js/core.js') && needed.has('js/render.js'));
  assert.equal(new Set(files).size, files.length);
  for (const file of needed) assert.ok(files.includes(file), `${file} is in FILES`);
  for (const file of files) assert.ok(existsSync(path.join(ROOT, file === './' ? 'index.html' : file)), `${file} exists`);
});

test('every stored hash and the worker version are current', () => {
  for (const [file, hash] of storedFiles()) assert.equal(hash, hashOfFile(file), file);
  assert.equal(writtenVersion(), versionOf(readWorker()));
  assert.equal(stamped(readWorker()), readWorker());
});

test('the version changes when worker code or a file hash changes', () => {
  const source = readWorker();
  const original = versionOf(source);
  const changedCode = source.replace('return stored ?? fetch(request);', 'return fetch(request);');
  assert.notEqual(versionOf(changedCode), original);
  const [file, hash] = storedFiles(source)[2];
  const changedHash = source.replace(`'${file}': '${hash}'`, `'${file}': '${'0'.repeat(64)}'`);
  assert.notEqual(versionOf(changedHash), original);
});

test('the vendored emoji matches its recorded SHA-256', () => {
  const lines = read('vendor/CHECKSUMS.txt').trim().split('\n');
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  \.\/(emoji\/[^\s]+)$/);
    assert.ok(match, line);
    const data = readFileSync(path.join(ROOT, 'vendor', match[2]));
    assert.equal(createHash('sha256').update(data).digest('hex'), match[1]);
  }
});
