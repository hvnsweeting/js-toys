import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor');

function filesIn(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? filesIn(file) : [path.relative(vendor, file).split(path.sep).join('/')];
  });
}

test('each vendored file has its recorded SHA-256', () => {
  const lines = readFileSync(path.join(vendor, 'CHECKSUMS.txt'), 'utf8').trim().split('\n');
  const listed = new Map();
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  \.\/(.+)$/);
    assert.ok(match, `invalid checksum line: ${line}`);
    assert.equal(listed.has(match[2]), false, `${match[2]} listed twice`);
    listed.set(match[2], match[1]);
  }
  const present = filesIn(vendor).filter(file => file !== 'CHECKSUMS.txt').sort();
  assert.deepEqual([...listed.keys()].sort(), present);
  for (const [file, hash] of listed) {
    const actual = createHash('sha256').update(readFileSync(path.join(vendor, file))).digest('hex');
    assert.equal(actual, hash, file);
  }
});

test('Node resolves three from the browser import map', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  const file = pathToFileURL(path.join(root, importMap.imports.three)).href;
  assert.equal(import.meta.resolve('three'), file);
});
