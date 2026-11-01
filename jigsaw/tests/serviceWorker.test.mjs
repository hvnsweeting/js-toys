// Runs sw.js in Node against stand-ins for the browser's cache storage, network and worker events,
// to check what a browser run cannot easily set up: an install that meets a stale or missing
// file, an update replacing an older version, cleanup that spares other copies of the game on
// the same site, and which requests the worker answers (doc/specs/OfflineApp.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileOnDisk, readWorker, storedFiles, writtenVersion } from '../tools/stamp-sw.mjs';

const SCOPE = 'https://example.test/js-toys/jigsaw/';
const WORKER_URL = `${SCOPE}sw.js`;
const SOURCE = readWorker();
const FILES = storedFiles(SOURCE).map(([file]) => file);
const cacheName = (version, scope = SCOPE) => `jigsaw ${scope} ${version}`;

// Cache storage shared by every worker of one test, like a site's storage in a browser.
class FakeCache {
  constructor() {
    this.entries = new Map();
  }
  async put(request, response) {
    this.entries.set(new URL(typeof request === 'string' ? request : request.url, WORKER_URL).href, response.clone());
  }
  async match(request, { ignoreSearch = false } = {}) {
    const wanted = new URL(typeof request === 'string' ? request : request.url, WORKER_URL);
    if (ignoreSearch) wanted.search = '';
    for (const [key, response] of this.entries) {
      const stored = new URL(key);
      if (ignoreSearch) stored.search = '';
      if (stored.href === wanted.href) return response.clone();
    }
    return undefined;
  }
}
class FakeCacheStorage {
  constructor() {
    this.caches = new Map();
  }
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name);
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name) {
    return this.caches.delete(name);
  }
}

// A server holding the game's files as they are on disk, unless `changes` replaces one (a Buffer
// for other contents, a number for an error status, 'unreachable' for a connection that fails).
// Every request it gets is logged.
function makeServer(changes = {}) {
  const log = [];
  const fetch = async (request) => {
    const url = new URL(request.url);
    log.push(url.href);
    const file = url.pathname.slice(new URL(SCOPE).pathname.length) || './';
    const change = changes[file];
    if (change === 'unreachable') throw new TypeError('Failed to fetch');
    if (typeof change === 'number') return new Response('', { status: change });
    if (change) return new Response(change);
    if (!FILES.includes(file)) return new Response('not found', { status: 404 });
    return new Response(fileOnDisk(file));
  };
  return { fetch, log };
}

// Loads one worker. `source` may be a changed copy of sw.js (another version).
function startWorker({ storage, server, source = SOURCE }) {
  const listeners = {};
  const calls = { skipWaiting: 0, claim: 0, messages: [] };
  // In a worker, a relative address is relative to the worker's own file.
  class WorkerRequest extends Request {
    constructor(input, init) {
      super(typeof input === 'string' ? new URL(input, WORKER_URL) : input, init);
    }
  }
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type, listener) => (listeners[type] = listener),
    skipWaiting: async () => calls.skipWaiting++,
    clients: {
      claim: async () => calls.claim++,
      matchAll: async () => [{ postMessage: (message) => calls.messages.push(message) }],
    },
  };
  const context = vm.createContext({ self, caches: storage, fetch: server.fetch, Request: WorkerRequest, Response, URL, crypto, Uint8Array, Object, Promise, Error });
  vm.runInContext(source, context);
  // An extendable event: runs the listener and waits for what it passed to waitUntil.
  const lifecycle = async (type) => {
    let work = Promise.resolve();
    listeners[type]({ waitUntil: (promise) => (work = promise) });
    await work;
  };
  // A fetch event: returns the answer, or null when the worker leaves the request to the browser.
  const request = async (url, init = {}) => {
    let answer = null;
    let background = Promise.resolve();
    const browserRequest = new Request(url, init.navigation ? {} : init);
    if (init.navigation) Object.defineProperty(browserRequest, 'mode', { value: 'navigate' });
    listeners.fetch({ request: browserRequest,
      respondWith: (promise) => (answer = promise),
      waitUntil: (promise) => (background = promise) });
    const response = answer === null ? null : await answer;
    await background;
    return response;
  };
  const message = async (data) => {
    let work = Promise.resolve();
    listeners.message({ data,
      source: { postMessage: (value) => calls.messages.push(value) },
      waitUntil: (promise) => (work = promise) });
    await work;
  };
  return { install: () => lifecycle('install'), activate: () => lifecycle('activate'), request, message, calls };
}

test('an online navigation refills evicted files only when their hashes match', async () => {
  const storage = new FakeCacheStorage();
  const server = makeServer();
  const worker = startWorker({ storage, server });
  await worker.install();
  const cache = await storage.open(cacheName(writtenVersion(SOURCE)));
  const missing = `${SCOPE}pictures/great-wave.jpg`;
  cache.entries.delete(missing);
  await worker.message('CHECK_OFFLINE_READY');
  assert.deepEqual(worker.calls.messages, [], 'an incomplete cache is not announced');
  await worker.request(`${SCOPE}index.html`, { navigation: true });
  assert.ok(cache.entries.has(missing), 'online visit repaired the missing picture');
  assert.deepEqual(worker.calls.messages, ['OFFLINE_READY'], 'a completed refill is announced');
  const badServer = makeServer({ 'pictures/great-wave.jpg': Buffer.from('changed') });
  const badWorker = startWorker({ storage, server: badServer });
  cache.entries.delete(missing);
  await badWorker.request(`${SCOPE}index.html`, { navigation: true });
  assert.equal(cache.entries.has(missing), false, 'changed picture was not stored');
  assert.deepEqual(badWorker.calls.messages, [], 'a failed refill is not announced');
});

test('install stores every listed file, checked against its hash, then takes over at once', async () => {
  const storage = new FakeCacheStorage();
  const worker = startWorker({ storage, server: makeServer() });
  await worker.install();
  assert.deepEqual(worker.calls.messages, [], 'installing alone does not announce readiness');
  const stored = storage.caches.get(cacheName(writtenVersion(SOURCE)));
  assert.ok(stored, 'a cache named after this copy and version');
  assert.deepEqual([...stored.entries.keys()].sort(), FILES.map((file) => new URL(file, WORKER_URL).href).sort());
  assert.equal(worker.calls.skipWaiting, 1);
});

test('a stale or missing file fails the install, removes the new cache, and leaves the running version alone', async () => {
  const cases = [['css/style.css', Buffer.from('/* an older stylesheet */')], ['js/app.js', 404], ['icons/icon-512.png', 500], ['pictures/great-wave.jpg', 'unreachable']];
  for (const [file, change] of cases) {
    const storage = new FakeCacheStorage();
    const running = await storage.open(cacheName('1111111111111111'));
    await running.put(`${SCOPE}index.html`, new Response('the running version'));
    const worker = startWorker({ storage, server: makeServer({ [file]: change }) });
    const named = change === 'unreachable' ? /Failed to fetch/ : new RegExp(file.replace('.', '\\.'));
    await assert.rejects(worker.install(), named, `${file}: ${change}`);
    assert.deepEqual(await storage.keys(), [cacheName('1111111111111111')], `only the running version's cache is left after ${file}`);
    assert.equal(worker.calls.skipWaiting, 0);
  }
});

test('activation deletes this copy\'s older caches only, then controls open pages', async () => {
  const storage = new FakeCacheStorage();
  const otherCopy = cacheName('2222222222222222', 'https://example.test/test/jigsaw/');
  for (const name of [cacheName('1111111111111111'), otherCopy, 'another-app-v1']) await storage.open(name);
  const worker = startWorker({ storage, server: makeServer() });
  await worker.install();
  await worker.activate();
  assert.deepEqual((await storage.keys()).sort(), [cacheName(writtenVersion(SOURCE)), otherCopy, 'another-app-v1'].sort());
  assert.equal(worker.calls.claim, 1);
  assert.deepEqual(worker.calls.messages, ['OFFLINE_READY']);
  await worker.message('CHECK_OFFLINE_READY');
  assert.deepEqual(worker.calls.messages, ['OFFLINE_READY', 'OFFLINE_READY']);
});

test('an update installs beside the version in use and replaces it when it activates', async () => {
  const storage = new FakeCacheStorage();
  const server = makeServer();
  const first = startWorker({ storage, server });
  await first.install();
  await first.activate();
  const nextSource = SOURCE.replace(/const VERSION = '[0-9a-f]{16}';/, "const VERSION = 'abcdefabcdefabcd';");
  const next = startWorker({ storage, server, source: nextSource });
  await next.install();
  assert.deepEqual((await storage.keys()).sort(), [cacheName(writtenVersion(SOURCE)), cacheName('abcdefabcdefabcd')].sort(), 'both while the update waits to activate');
  await next.activate();
  assert.deepEqual(await storage.keys(), [cacheName('abcdefabcdefabcd')]);
});

test('requests: the stored copy answers the game\'s files and its page with any query; others go to the network or are left alone', async () => {
  const storage = new FakeCacheStorage();
  const server = makeServer();
  const worker = startWorker({ storage, server });
  await worker.install();
  await worker.activate();
  server.log.length = 0;
  const text = async (response) => (response ? await response.text() : null);
  const page = fileOnDisk('index.html').toString();
  assert.equal(await text(await worker.request(`${SCOPE}?quality=low`)), page, 'the folder with a query');
  assert.equal(await text(await worker.request(`${SCOPE}index.html?quality=low`)), page, 'index.html with a query');
  assert.equal(await text(await worker.request(`${SCOPE}js/app.js`)), fileOnDisk('js/app.js').toString());
  assert.deepEqual(server.log, [], 'stored files need no network');
  // Not stored: a new page in the folder, and a stored file asked for with a query, go to the network.
  assert.equal((await worker.request(`${SCOPE}help.html`)).status, 404, 'the server, not the stored page, answers help.html');
  await worker.request(`${SCOPE}js/app.js?x=1`);
  assert.deepEqual(server.log, [`${SCOPE}help.html`, `${SCOPE}js/app.js?x=1`]);
  // Outside the folder, on another site, or not a GET: left to the browser.
  assert.equal(await worker.request('https://example.test/js-toys/index.html'), null, 'the arcade page');
  assert.equal(await worker.request('https://other.test/js-toys/jigsaw/js/app.js'), null, 'another site');
  assert.equal(await worker.request(`${SCOPE}js/app.js`, { method: 'POST', body: 'x' }), null, 'a POST');
});
