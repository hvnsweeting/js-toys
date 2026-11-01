// The installable, offline app: the manifest and its icons, and the
// service worker's list of stored files, their hashes and its version. What the worker does with
// them is tested in serviceWorker.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, hashOfFile, readWorker, stamped, storedFiles, versionOf, writtenVersion } from '../tools/stamp-sw.mjs';

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const indexHtml = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));
const FILES = storedFiles().map(([file]) => file);

// Width and height from a PNG file's header (the IHDR chunk follows the 8-byte signature), after
// checking the file also ends with the IEND chunk, so a file cut short fails.
const PNG_END = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
function pngSize(file) {
  const bytes = readFileSync(path.join(ROOT, file));
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${file} is a PNG`);
  assert.ok(bytes.subarray(-12).equals(PNG_END), `${file} ends with the PNG end chunk`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test('the manifest opens the game full screen from its own folder, in the game colours', () => {
  assert.equal(manifest.name, 'Flappy Witch');
  assert.equal(manifest.short_name, 'Flappy Witch');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#1d162e');
  assert.equal(manifest.theme_color, '#3b3156');
});

test('every icon the manifest and the page name exists at the size it claims', () => {
  const purposes = manifest.icons.map((icon) => icon.purpose);
  assert.ok(purposes.includes('any') && purposes.includes('maskable'), JSON.stringify(purposes));
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png', icon.src);
    assert.equal(pngSize(icon.src), icon.sizes, icon.src);
  }
  const touchIcon = indexHtml.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
  assert.ok(touchIcon, 'index.html names an apple-touch-icon');
  assert.equal(pngSize(touchIcon[1]), '180x180');
});

test('the page links the manifest and sets the app tags iPad and Chrome read', () => {
  assert.match(indexHtml, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(indexHtml, /<meta name="theme-color" content="#3b3156">/);
  assert.match(indexHtml, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(indexHtml, /<meta name="mobile-web-app-capable" content="yes">/);
  assert.match(indexHtml, /<meta name="apple-mobile-web-app-title" content="Flappy Witch">/);
});

// Every file the game loads: the modules reachable from src/main.js (bare names resolved by the
// page's importmap), the stylesheet and the fonts it names, and every local file index.html and
// the manifest link to. The arcade link leaves the app and is not stored.
function filesThePageLoads() {
  const importmap = JSON.parse(indexHtml.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const resolve = (specifier, fromFile) => {
    if (specifier.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
    const prefix = Object.keys(importmap).find((key) => specifier === key || (key.endsWith('/') && specifier.startsWith(key)));
    assert.ok(prefix, `${fromFile} imports ${specifier}, which the importmap does not map`);
    return path.posix.normalize(importmap[prefix] + specifier.slice(prefix.length));
  };
  const modules = new Set();
  const visit = (file) => {
    if (modules.has(file)) return;
    modules.add(file);
    const source = read(file);
    const specifiers = [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)];
    for (const match of specifiers) visit(resolve(match[1] ?? match[2], file));
  };
  visit('src/main.js');
  const fonts = [...read('style.css').matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((match) => match[1]).filter((url) => !url.startsWith('data:'));
  const pageLinks = [...indexHtml.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]).filter((url) => !url.includes(':') && url !== '../index.html');
  const manifestIcons = manifest.icons.map((icon) => icon.src);
  return [...modules, ...fonts, ...pageLinks, ...manifestIcons].map((file) => file.replace(/^\.\//, ''));
}

test('the service worker stores every file the game loads, and each stored file exists', () => {
  const needed = filesThePageLoads();
  // The walk itself must find the game's parts, or an empty walk would pass.
  for (const part of ['src/main.js', 'src/world.js', 'vendor/three/three.module.js', 'vendor/three/three.core.js', 'src/music.js', 'src/musicScore.js', 'src/effects.js', 'style.css', 'manifest.webmanifest']) {
    assert.ok(needed.includes(part), `the walk finds ${part}`);
  }
  for (const file of needed) assert.ok(FILES.includes(file), `sw.js FILES lists ${file}`);
  assert.ok(FILES.includes('./') && FILES.includes('index.html'), 'the page is stored under both its addresses');
  assert.equal(new Set(FILES).size, FILES.length, 'no file is listed twice');
  for (const file of FILES) {
    const onDisk = file === './' ? 'index.html' : file;
    assert.ok(existsSync(path.join(ROOT, onDisk)), `${file} exists`);
  }
});

test('each stored file\'s hash in sw.js matches the file, and VERSION matches sw.js (run node tools/stamp-sw.mjs after a change)', () => {
  for (const [file, hash] of storedFiles()) assert.equal(hash, hashOfFile(file), `${file}'s hash`);
  assert.equal(writtenVersion(), versionOf(readWorker()));
  assert.equal(stamped(readWorker()), readWorker(), 'stamping leaves sw.js as it is');
});

test('the version changes when a stored file\'s hash or the worker\'s code changes, and a second stamping leaves the result as it is', () => {
  const source = readWorker();
  const base = versionOf(source);
  assert.match(base, /^[0-9a-f]{16}$/);
  const [firstFile, firstHash] = storedFiles(source)[2];
  const otherHash = firstHash.replace(/^./, (digit) => (digit === '0' ? '1' : '0'));
  assert.notEqual(versionOf(source.replace(`'${firstFile}': '${firstHash}'`, `'${firstFile}': '${otherHash}'`)), base, 'a changed hash');
  assert.notEqual(versionOf(source.replace('return stored ?? fetch(request);', 'return fetch(request);')), base, 'changed code');
  assert.equal(versionOf(source.replace(/const VERSION = '[0-9a-f]{16}';/, "const VERSION = 'ffffffffffffffff';")), base, 'VERSION itself is left out');
  // A file with an out-of-date hash is brought up to date by stamping, which then changes VERSION.
  const stale = source.replace(`'${firstFile}': '${firstHash}'`, `'${firstFile}': '${otherHash}'`);
  assert.equal(stamped(stale), source);
  assert.equal(stamped(stamped(stale)), source);
});
