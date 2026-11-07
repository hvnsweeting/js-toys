// Service worker: keeps a copy of every file the game needs, so after one visit with internet
// the game starts and plays with none (doc/specs/OfflineApp.md).
//
// FILES maps each stored file to the SHA-256 of its contents, and VERSION is a hash of this
// file's own text (with VERSION itself left out), so it changes when any stored file or this code
// changes. Both are written by tools/stamp-sw.mjs; a unit test fails while either is out of date.
// A new VERSION changes this file, which is how browsers notice an update.

const VERSION = '21979d403b848866';

// Paths relative to this file. './' is the page as the app's start address opens it.
const FILES = {
  './': '999a1825cc28f4fc87accfb6be6f510cb13e935c2335799009b97fb5e620cd6f',
  'index.html': '999a1825cc28f4fc87accfb6be6f510cb13e935c2335799009b97fb5e620cd6f',
  'style.css': 'a973f2eb94e0c196b86fdb12c1baae792c012cfbe771abba749124dae03674c6',
  'manifest.webmanifest': '4b83346d861b6f9768f8afa0a14c88b413a4759d2e3d90d5906e5719e1b5ed06',
  'icons/icon-192.png': '172949df69d11129fa6039edff80f194a36ef0d731867242f8855d900f56a393',
  'icons/icon-512.png': 'd26a9a98aebf72a0ed7317f375c83f4353875ff09c2dec1ef1c95ffb73ceed56',
  'icons/icon-maskable-512.png': 'd26a9a98aebf72a0ed7317f375c83f4353875ff09c2dec1ef1c95ffb73ceed56',
  'icons/apple-touch-icon.png': '51df1d6709490e4f4778b6f4d0ff651873ce69ea3fb37483778a0be87561c6f4',
  'src/differences.js': 'c4106f58d05cd27488b81fa2f3d30aafbac26c5cde314da1eab0b700b00dbb22',
  'src/game.js': '480456c0206588f4390082f704ffed9292e37ee7478876e7a6914b7db52d967a',
  'src/ground.js': '037e60c951eee913fe2017bcffa123c02ca92ca648fdf092f7844190e267802f',
  'src/main.js': 'a17b7fce382438a4f7e8062532b896fd626bc69971f86e5201351f1b05e2eb9f',
  'src/materials.js': '04af4b1d0ede5d7474b63e1598f23cff13077da5d5933b62dddada3566a5462b',
  'src/props.js': '42a72a1c91d0aa411a2b6d189c4352c69223cf81704947175956f14b29a9cbdc',
  'src/random.js': '672fd4310de5ed2f75eb66d6777a2682b92868b63ce6e788d6e872525b3ac2ff',
  'src/skeleton.js': 'ae75217ea06c68f349a2ba1b0c294d83078d64b17a7b6567ea93e78ed469960a',
  'src/sound.js': 'c335fe61778e029d4ca855dba915917e6aec155bdf29d9d1c244b9c827a6a7ae',
  'src/traits.js': 'fbb56a6c4bd2197fac32cb2525068dce6e0138f6d6ece639b7e700529daa90ff',
  'src/treeView.js': '3a7a5961bbc5c1b1ee66fce7043e23589b51ab16c0c287de946229e7a732927a',
  'src/world.js': '679d4e22498b8ace44b1ca96b00681a837677630377a7f4916896f570766510e',
  'vendor/three/three.module.js': 'c8211c69345d2e9949dc7a8ac969380497aa0600a5a8ac6a459c8cd02dd9cb8a',
  'vendor/three/three.core.js': 'eb077d2417f61d3e6d9264c317cabc4ea35769ed6b0ab533067292a550784c20',
  'vendor/three/addons/controls/OrbitControls.js': 'b97879c748170baadeb3fb84cea1ffdf4674e283dc06042f34e2acb95a76042c',
  'vendor/fonts/cormorant-garamond-latin.woff2': 'd80df8ff5aecd299a61549f9e29ab1ed0b9b05f4ea71d50fe978e07d5240b235',
  'vendor/fonts/cormorant-garamond-italic-latin.woff2': '4fb55a7a6d564d428061fe12c82c896264bcc8b7f0b52840bf88e0db5b91256f',
  'vendor/fonts/inter-latin.woff2': '3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62',
};

// Cache names carry the worker's scope, so two copies of the game on one site (say /treediff/ and
// /test/treediff/) keep separate caches and never delete each other's.
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `treediff ${SCOPE.href} `;
const CACHE = CACHE_PREFIX + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(storeAll().then(() => self.skipWaiting()));
});

// Downloads every file, checks each against its hash, and only then stores them. A file the
// server answers with an old copy (a stale cache in front of the site) or an error fails the
// install before any cache is touched: the version already in charge keeps serving, and the
// next visit with internet tries again. 'reload' skips the browser's ordinary HTTP cache.
async function storeAll() {
  const downloads = Object.entries(FILES).map(async ([path, expected]) => {
    const response = await fetch(new Request(path, { cache: 'reload' }));
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const actual = await sha256(await response.clone().arrayBuffer());
    if (actual !== expected) throw new Error(`${path}: not the copy this version was made from`);
    return [path, response];
  });
  const checked = await Promise.all(downloads);
  // A cache already under this name (a worker published without a new VERSION) was filled by a
  // worker of the same version and is in use: it is not written to, and refill() puts back any
  // file missing from it. A new cache that fails part way through storing (storage full) is removed.
  if (await caches.has(CACHE)) return;
  const cache = await caches.open(CACHE);
  try {
    for (const [path, response] of checked) await cache.put(path, response);
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const inScope = url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
  if (request.method !== 'GET' || !inScope) return;
  event.respondWith(answer(request, url));
  if (request.mode === 'navigate') event.waitUntil(refill());
});

// The browser may delete a cache to free storage while the worker stays registered, and an
// unchanged worker is not installed again. So on every page load, any listed file missing from
// the cache is downloaded, checked against its hash and stored. A file that fails (offline, or
// the server already has a newer version) is left for a later load or for the new version.
async function refill() {
  const cache = await caches.open(CACHE);
  const missing = [];
  for (const path of Object.keys(FILES)) {
    if (!(await cache.match(new Request(path)))) missing.push(path);
  }
  const storeOne = async (path) => {
    try {
      const response = await fetch(new Request(path, { cache: 'reload' }));
      if (!response.ok) return;
      const actual = await sha256(await response.clone().arrayBuffer());
      if (actual === FILES[path]) await cache.put(path, response);
    } catch {
      // Offline or unreachable: the next page load tries again.
    }
  };
  await Promise.all(missing.map(storeOne));
}

// From the stored copy when there is one, else from the network. The page itself (the folder or
// index.html) matches whatever its ?query, so ?quality=low works offline; any other address must
// match exactly, and one not stored goes to the network.
async function answer(request, url) {
  const cache = await caches.open(CACHE);
  const isThePage = url.pathname === SCOPE.pathname || url.pathname === `${SCOPE.pathname}index.html`;
  const stored = await cache.match(request, { ignoreSearch: isThePage });
  return stored ?? fetch(request);
}
