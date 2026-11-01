// Service worker: keeps a copy of every file the game needs, so after one visit with internet
// the game starts and plays with none.
//
// FILES maps each stored file to the SHA-256 of its contents, and VERSION is a hash of this
// file's own text (with VERSION itself left out), so it changes when any stored file or this code
// changes. Both are written by tools/stamp-sw.mjs; a unit test fails while either is out of date.
// A new VERSION changes this file, which is how browsers notice an update.

const VERSION = '5d92b0e7eebf2ab6';

// Paths relative to this file. './' is the page as the app's start address opens it.
const FILES = {
  './': 'e16205b37f09b93999446bd15098d2307c2764497cb289e07d87ad65def18f48',
  'index.html': 'e16205b37f09b93999446bd15098d2307c2764497cb289e07d87ad65def18f48',
  'style.css': 'd214843096a31422d997a93ca2d7bd06fe033a7163002949651c282cebe7102b',
  'manifest.webmanifest': '6fe8d4693bf54314720835e0c335e66155d701a49c6e73ecf823e7d4dd2bd313',
  'icons/icon-192.png': '257527119a697d9676c0a8e13f5b1c419a45705a8c71d9d71db962fcc709d029',
  'icons/icon-512.png': '3bf57aed16002500fe97aa6cb3928a8ff436e6a6276daa8b0e2305a9850430ea',
  'icons/icon-maskable-512.png': '3bf57aed16002500fe97aa6cb3928a8ff436e6a6276daa8b0e2305a9850430ea',
  'icons/apple-touch-icon.png': 'b39e7812b7401b88cba0da78f3090f721a4a1129a6f53607682b5f2d8cc42140',
  'src/effects.js': '93074534a11f68cddbe583c9bf7e651a2c01664c8b8d7a59c9c2e7ca46f79749',
  'src/gates.js': 'ffa0220f51534935cff8f3e38d01e55f6121d282d9c49c0d2c76c724d229aaeb',
  'src/main.js': '3e49c72503d3a80adff3f2546946f32aab18cc1ed186c4baaaea87d41560676f',
  'src/music.js': '5597db2cc1cf44282523e183243b4d96df95b01e9899d394a254fa5f793002b2',
  'src/musicScore.js': '521d48b054b66f6a04b8b61017cf81fb3bc90b737a260ecb97b95e19e35af423',
  'src/rules.js': 'defa9ace8bfed6ea815dc18117ebb88c7540a53ece845fb0b04d86b1964e5fe6',
  'src/scene.js': 'a073fd7e03771cd854595201bb5f70473ed3f70aa3152d1602a176295debb3be',
  'src/witch.js': '8aa1856c3246ae69dc999c9bdfcb4d71862513465e256f1c46d960004dafcced',
  'src/world.js': '18a1294e197eecb9869061c5e9ffe5623397621ed6f3c30b192dd8c3be5af1a6',
  'vendor/three/three.module.js': 'c8211c69345d2e9949dc7a8ac969380497aa0600a5a8ac6a459c8cd02dd9cb8a',
  'vendor/three/three.core.js': 'eb077d2417f61d3e6d9264c317cabc4ea35769ed6b0ab533067292a550784c20',
};

// Cache names carry the worker's scope, so two copies of the game on one site (say /flappywitch/ and
// /test/flappywitch/) keep separate caches and never delete each other's.
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `flappywitch ${SCOPE.href} `;
const CACHE = CACHE_PREFIX + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(storeAll().then(() => self.skipWaiting()));
});

// Downloads every file, checks each against its hash, and only then stores them. A file the
// server answers with an old copy (a stale cache in front of the site) or an error fails the
// install: the version already in charge keeps serving, and the next visit with internet tries
// again. 'reload' skips the browser's ordinary HTTP cache.
async function storeAll() {
  const cache = await caches.open(CACHE);
  try {
    const downloads = Object.entries(FILES).map(async ([path, expected]) => {
      const response = await fetch(new Request(path, { cache: 'reload' }));
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      const actual = await sha256(await response.clone().arrayBuffer());
      if (actual !== expected) throw new Error(`${path}: not the copy this version was made from`);
      return [path, response];
    });
    for (const [path, response] of await Promise.all(downloads)) await cache.put(path, response);
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

self.addEventListener('activate', (event) => {
  const removeOld = async () => {
    const names = await caches.keys();
    const old = names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE);
    await Promise.all(old.map((name) => caches.delete(name)));
    await self.clients.claim();
  };
  event.waitUntil(removeOld());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'offline-ready' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const files = await Promise.all(Object.keys(FILES).map(path => cache.match(path)));
    event.ports[0].postMessage({ ready: files.every(Boolean) });
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const inScope = url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
  if (request.method !== 'GET' || !inScope) return;
  event.respondWith(answer(request, url));
});

// From the stored copy when there is one, else from the network. The page itself (the folder or
// index.html) matches whatever its ?query, so ?quality=low works offline; any other address must
// match exactly, and one not stored goes to the network.
async function answer(request, url) {
  const cache = await caches.open(CACHE);
  const isThePage = url.pathname === SCOPE.pathname || url.pathname === `${SCOPE.pathname}index.html`;
  const stored = await cache.match(request, { ignoreSearch: isThePage });
  return stored ?? fetch(request);
}
