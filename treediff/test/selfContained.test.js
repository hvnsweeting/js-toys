import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const pathParts = (file) => file.split('/');

// XML namespace names look like addresses but are identifiers; no request is made for them.
const IDENTIFIERS = ['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink'];

// Writes of "/" that a browser or a JavaScript string reads as a slash.
function decodeSlashes(text) {
  return text
    .replace(/\\\//g, '/')
    .replace(/\\x2f|\\u002f|&#0*47;|&#x0*2f;|&sol;/gi, '/')
    .replace(/([a-z]:)[\\/]{2,}/gi, '$1//'); // https:\\host and https:/\host load as https://host
}

// Every address with a scheme and a host, and every protocol-relative one (`//host` right after
// the start of a line, white space, a quote, a bracket, "=" or ","). Any host counts, including
// numeric ones and other ports. Comments and links count too: write a comment's "//" followed by
// a space, and give a site's name without "http://". Strings built at run time are out of reach
// of a text scan (see the README).
export function outsideAddresses(text) {
  const pattern = /[a-z][a-z0-9+.-]*:\/\/[^\s"'`)<>/][^\s"'`)<>]*|(?<![^\s"'`(=,])\/\/[a-z0-9][^\s"'`)<>]*/gi;
  return [...decodeSlashes(text).matchAll(pattern)].map((match) => match[0]).filter((address) => !IDENTIFIERS.includes(address));
}

function filesBelow(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(relative) : [relative];
  });
}

// Every web file a browser could be sent: the page-type files in the project root, everything in
// src/, and the vendored files other than three.js itself (its source holds addresses in comments)
// and binary or license files. Documents, tests and tools legitimately hold addresses.
const PAGE_TYPES = /\.(html|css|js|mjs|svg|json|webmanifest)$/;
function servedFiles() {
  const rootFiles = readdirSync(root).filter((name) => statSync(path.join(root, name)).isFile() && PAGE_TYPES.test(name));
  const vendored = filesBelow('vendor').filter((file) => !file.startsWith('vendor/three/') && PAGE_TYPES.test(file));
  return [...rootFiles, ...filesBelow('src'), ...vendored];
}

const indexHtml = read('index.html');
const clean = (target) => target.split(/[?#]/)[0].replace(/^\.?\//, '');
// Links with a scheme (the inline data: icon) carry their content; the address test reads them in the page text.
// HTML attribute names ignore case (SRC is src), so the scan does too.
const linkTargets = [...indexHtml.matchAll(/\b(?:href|src)\s*=\s*["']?([^"'\s>]+)/gi)].map((match) => match[1]).filter((value) => !value.includes(':'));
// The one link that leaves the game folder: Back to Arcade, to the js-toys arcade page one folder
// up. It is a page the player goes to, not a file this page loads, and it stays on the same site.
const ARCADE_LINK = '../index.html';
const linkedFiles = linkTargets.filter((value) => value !== ARCADE_LINK).map(clean);

test('the page, its stylesheets and its scripts make no request outside the project', () => {
  const files = servedFiles();
  const sources = readdirSync(path.join(root, 'src'), { recursive: true }).filter((name) => statSync(path.join(root, 'src', name)).isFile());
  for (const name of sources) assert.ok(files.includes(`src/${name.split(path.sep).join('/')}`), `src/${name} is scanned`);
  for (const file of ['index.html', 'style.css']) assert.ok(files.includes(file), `${file} is scanned`);
  // A PNG is a picture and cannot ask for another address; every other linked file is scanned.
  for (const target of linkedFiles.filter((file) => !file.endsWith('.png'))) assert.ok(files.includes(target), `${target} is linked by index.html and must be scanned`);
  for (const file of ['manifest.webmanifest', 'sw.js']) assert.ok(files.includes(file), `${file} is scanned`);
  for (const file of files) assert.deepEqual(outsideAddresses(read(file)), [], file);
});

test('the address scanner catches every kind of outside host and spares the namespace names', () => {
  const caught = [
    'https://fonts.googleapis.com/css', 'HTTP://EVIL.COM/x', '//cdn.example.com/a.js', '//cdn/a.js', 'http://192.168.1.5/log',
    'https://127.0.0.1:8000/a.js', 'http://localhost:9000/x', 'https://user@evil.com/x', 'https://my_cdn.example.com/x',
    'https://[::1]/x', 'https://exämple.com/x', 'https:\\/\\/evil.com/x', 'wss://sync.example.com', 'https:\\\\evil.com/x',
    'https:\\x2f\\x2fevil.com/x', 'https:\\u002f\\u002fevil.com/x', 'https:&#47;&#47;evil.com/x', 'http://www.w3.org/2000/svgZ',
    'http://www.w3.org/2000/svg.evil.com/x', 'http://www.w3.org/2000/svg?x=1', 'http://www.w3.org/TR/x',
  ];
  for (const text of caught) {
    assert.ok(outsideAddresses(`x = '${text}';`).length > 0, `single quotes: ${text}`);
    assert.ok(outsideAddresses(`x = "${text}";`).length > 0, `double quotes: ${text}`);
  }
  const forms = ['url(//evil.example/x.png)', 'url( //evil.example/x.png)', 'url(\n//evil.example/x.png)', 'src=//evil.example/a.js', 'href = //evil.example/x.css',
    'srcset="a.png 1x, //evil.example/b.png 2x"', '`//evil.example/x`', "' //evil.example/x.png'", 'fetch(//evil.example)'];
  for (const text of forms) assert.ok(outsideAddresses(text).length > 0, text);
  const spared = [
    `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink="http://www.w3.org/1999/xlink"></svg>`,
    '// a comment, no address', 'a = b / c; /* css */', "text.replace(/\\/\\//g, '/')", "s.startsWith('https://')", '// opened from file:// URLs',
    "const parts = path.split('//');", 'a = `${b}//${c}`',
  ];
  for (const text of spared) assert.deepEqual(outsideAddresses(text), [], text);
});

test('the only link out of the game folder is Back to Arcade, and only as a link', () => {
  const outOfFolder = linkTargets.filter((value) => value.startsWith('..') || value.startsWith('/'));
  assert.deepEqual(outOfFolder, [ARCADE_LINK]);
  assert.match(indexHtml, /<a id="arcade"[^>]*href="\.\.\/index\.html"/);
});

test('index.html names only files that exist, and its importmap has exactly the two three.js entries', () => {
  const expected = ['icons/apple-touch-icon.png', 'manifest.webmanifest', 'src/main.js', 'style.css'];
  assert.deepEqual([...new Set(linkedFiles)].sort(), expected, 'the page links its stylesheet, its script, the app manifest and the iPad icon');
  for (const target of linkedFiles) assert.ok(existsSync(path.join(root, target)), target);
  const blocks = [...indexHtml.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1, 'one importmap');
  const importmap = JSON.parse(blocks[0][1]);
  assert.deepEqual(Object.keys(importmap), ['imports'], 'no scopes or other sections');
  assert.deepEqual(Object.keys(importmap.imports).sort(), ['three', 'three/addons/']);
  for (const target of Object.values(importmap.imports)) {
    assert.ok(target.startsWith('./'), `${target} is relative to the page`);
    assert.ok(existsSync(path.join(root, target)), target);
  }
  // A browser ignores an importmap that comes after the first module script.
  assert.ok(indexHtml.indexOf('<script type="importmap">') < indexHtml.indexOf('<script type="module"'), 'importmap before the module script');
});

test('the stylesheet declares the three typefaces, each tied to the right file', () => {
  const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((css.match(/@font-face/gi) ?? []).length, 3);
  assert.equal(css.includes('@media') && /@media[^{]*\{\s*@font-face/i.test(css), false, 'no font rule hidden inside a media query');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/gi)].map((match) =>
    Object.fromEntries(match[1].split(';').map((declaration) => declaration.trim()).filter(Boolean).map((declaration) => {
      const colon = declaration.indexOf(':');
      return [declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim().replace(/"/g, "'")];
    })),
  );
  const face = (family, style, weight, file) => ({ 'font-family': `'${family}'`, 'font-style': style, 'font-weight': weight, 'font-display': 'swap', src: `url(${file}) format('woff2')` });
  assert.deepEqual(faces, [
    face('Cormorant Garamond', 'normal', '500 600', 'vendor/fonts/cormorant-garamond-latin.woff2'),
    face('Cormorant Garamond', 'italic', '500', 'vendor/fonts/cormorant-garamond-italic-latin.woff2'),
    face('Inter', 'normal', '400 600', 'vendor/fonts/inter-latin.woff2'),
  ]);
  for (const { src } of faces) {
    const file = src.match(/url\(([^)]+)\)/)[1];
    assert.ok(existsSync(path.join(root, file)), file);
    assert.equal(readFileSync(path.join(root, file)).subarray(0, 4).toString('latin1'), 'wOF2', `${file} is a woff2 file`);
  }
});

test('vendor/CHECKSUMS.txt lists every vendored file once, with its current SHA-256 hash', () => {
  const listed = new Map();
  for (const line of read('vendor/CHECKSUMS.txt').split('\n').filter((text) => text.trim() !== '')) {
    const [, hash, file] = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/) ?? [];
    assert.ok(hash, `a hash line: ${line}`);
    const name = file.replace(/^\.\//, '');
    assert.equal(listed.has(name), false, `${name} is listed twice`);
    listed.set(name, hash);
  }
  // Hidden files and folders (.DS_Store, .cache/) are not vendored files; the README command skips them too.
  const present = filesBelow('vendor').map((file) => file.slice('vendor/'.length)).filter((file) => file !== 'CHECKSUMS.txt' && !pathParts(file).some((part) => part.startsWith('.')));
  assert.deepEqual([...listed.keys()].sort(), present.sort(), 'the list and the folder name the same files');
  for (const [file, hash] of listed) {
    const actual = createHash('sha256').update(readFileSync(path.join(root, 'vendor', file))).digest('hex');
    assert.equal(actual, hash, file);
  }
});

// The game saves nothing between visits (no best score either). The browser check counts storage
// method calls while playing; this scan also catches a value set through a property, such as
// `localStorage.best = 280`, which no method call reveals. The vendored three.js is left out: it
// is not the game's code.
test('the game code uses no browser storage', () => {
  const files = ['index.html', ...filesBelow('src')];
  const storage = /\b(localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open|navigator\.storage)\b/;
  const users = files.filter((file) => storage.test(read(file)));
  assert.deepEqual(users, []);
});
