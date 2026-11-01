// Brings sw.js up to date with the files it stores: writes each file's SHA-256 into FILES, then
// VERSION, the first 16 hexadecimal digits of a SHA-256 over sw.js's own text with VERSION left
// out. VERSION therefore changes when any stored file or the worker's code changes. Run it after
// changing either, or after adding a file to FILES (as `'path': '',`):
//
//   node tools/stamp-sw.mjs
//
// test/offlineApp.test.mjs uses the same functions and fails while sw.js is out of date.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORKER = path.join(ROOT, 'sw.js');
const VERSION_LINE = /^const VERSION = '([0-9a-f]{16})';$/m;
const FILES_BLOCK = /^const FILES = \{\n([\s\S]*?)\n\};$/m;
const FILE_LINE = /^ {2}'([^']+)': '([0-9a-f]{64}|)',$/;

export const readWorker = () => readFileSync(WORKER, 'utf8');

// FILES as written in sw.js: [path, hash] pairs in order (the hash is '' for a file just added).
export function storedFiles(source = readWorker()) {
  const block = source.match(FILES_BLOCK);
  if (!block) throw new Error('sw.js has no "const FILES = { ... };" block');
  return block[1].split('\n').map((line) => {
    const entry = line.match(FILE_LINE);
    if (!entry) throw new Error(`sw.js FILES line is not "  'path': '<hash>',": ${line}`);
    return [entry[1], entry[2]];
  });
}

export function writtenVersion(source = readWorker()) {
  const line = source.match(VERSION_LINE);
  if (!line) throw new Error("sw.js has no \"const VERSION = '<16 hexadecimal digits>';\" line");
  return line[1];
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// './' is the folder's page, which the server answers with index.html.
export const fileOnDisk = (file) => readFileSync(path.join(ROOT, file === './' ? 'index.html' : file));
export const hashOfFile = (file) => sha256(fileOnDisk(file));

// The version a given sw.js text should carry.
export function versionOf(source) {
  return sha256(source.replace(VERSION_LINE, "const VERSION = '0000000000000000';")).slice(0, 16);
}

// The sw.js text with every hash and the version brought up to date.
export function stamped(source) {
  const lines = storedFiles(source).map(([file]) => `  '${file}': '${hashOfFile(file)}',`);
  const withHashes = source.replace(FILES_BLOCK, `const FILES = {\n${lines.join('\n')}\n};`);
  return withHashes.replace(VERSION_LINE, `const VERSION = '${versionOf(withHashes)}';`);
}

const runAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
export function replaceWorkerFile(target, updated, operations = { openSync, writeFileSync, closeSync, renameSync, rmSync }, uniqueName = randomUUID) {
  const next = `${target}.${uniqueName()}.new`;
  let opened = false;
  try {
    const descriptor = operations.openSync(next, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    opened = true;
    try { operations.writeFileSync(descriptor, updated); } finally { operations.closeSync(descriptor); }
    operations.renameSync(next, target);
  } finally {
    if (opened) operations.rmSync(next, { force: true });
  }
}

if (runAsScript) {
  const source = readWorker();
  const updated = stamped(source);
  if (updated === source) {
    console.log(`sw.js VERSION ${writtenVersion(source)} is up to date`);
  } else {
    // Written beside it under a name of this run's own and renamed over it, so a failed write
    // leaves the old sw.js whole.
    replaceWorkerFile(WORKER, updated);
    console.log(`sw.js VERSION ${writtenVersion(source)} -> ${writtenVersion(updated)}`);
  }
}
