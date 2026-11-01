// Service worker: keeps a copy of every file the game needs, so after one visit with internet
// the game starts and plays with none (the offline app spec).
//
// FILES maps each stored file to the SHA-256 of its contents, and VERSION is a hash of this
// file's own text (with VERSION itself left out), so it changes when any stored file or this code
// changes. Both are written by tools/stamp-sw.mjs; a unit test fails while either is out of date.
// A new VERSION changes this file, which is how browsers notice an update.

const VERSION = '69fbd27cf7491c17';

// Paths relative to this file. './' is the page as the app's start address opens it.
const FILES = {
  './': '668bd76a4945ef9a866fcbac2f28089ab07724c582151ea412447a30637ad115',
  'index.html': '668bd76a4945ef9a866fcbac2f28089ab07724c582151ea412447a30637ad115',
  'css/style.css': 'f7afbd41affa54b76356ec634da472736751cbb124a87349c65572530514666e',
  'js/app.js': 'fc8f968eaa501a16dd12583ffdfb63d8a91d0bb1f97183c685fd4dfbe50ad886',
  'js/core.js': '172df727c34e69757afefe9490c184661800e35d488e201eeea0d9bb2b980344',
  'js/render.js': '0c2ec8b59a50c493a7b7b7af806bd7b570d69f2ab688f709b167b8bcee76f507',
  'js/music.js': '5565ed68ed7b2e1dec03bacf4e03cd6a02fa0d5ee7cbb387a7f7ee086071f425',
  'js/musicScore.js': 'cd9a1818aaebb27b00caf6e3c965bb9ea888398558652d48884f9a6d0da5bbb6',
  'js/effects.js': 'b2ce713e4321eb02d1e8c04e0e6b409f8de9432bcb8160a11893fd484c6beb00',
  'manifest.webmanifest': 'e9fef8dff6f90be04166b8fb208be9dfea14c23bb9481d86fa7bebefb770274d',
  'icons/icon-192.png': 'a2733b970aae8b8d897c93111103d7d31d60425d2e774e3172fae003d6d75ee8',
  'icons/icon-512.png': '00f5d405e83d81d9cbc2e113ce67019d31fe080d772a0b88c8c242b93b24c149',
  'icons/icon-maskable-512.png': '00f5d405e83d81d9cbc2e113ce67019d31fe080d772a0b88c8c242b93b24c149',
  'icons/apple-touch-icon.png': '62c2554c898d8c1fdd1ace3317d515c56feb60df23e4f289224f4505ca2c52dc',
  'pictures/manifest.json': 'ace0fc1427a026f720538a153a655ca6c14965a0e2f66d8ff97f9daa9a0a1944',
  'pictures/CREDITS.md': 'f3b9be45a71e3daf4466e59fd074556531afa7a078c575afe530170bc08a97d6',
  'pictures/great-wave.jpg': 'b3d24f6d05819f19ae362997f9e34bdc459d0382df4665164e92247da55945bd',
  'pictures/great-wave-thumb.jpg': '932a065559d36af601a713ac66b763fc34716dc2dfe05be29b4d83c3d0ae102f',
  'pictures/starry-night.jpg': '6c4531accb0d4fbdcf25f62894f57517de93572bfea34afa6c65159d40b80d91',
  'pictures/starry-night-thumb.jpg': '0134df53c60751629e8f1858717bce1a7de04d7ad4f33de649a382c80ac2be78',
  'pictures/sunflowers.jpg': '4d045489520aec1d72d6b9bd49ce76626111374687bae5799ad2c82f0c8b1830',
  'pictures/sunflowers-thumb.jpg': '6436ea0f35fb4e9c01e0c294728b73be08ebd197b07290b4e51db26204f23c42',
  'pictures/parasol.jpg': '8c1c55d72536b463595e7bc88da0583ab31335f1e3099ce49a8fd13ba703aa62',
  'pictures/parasol-thumb.jpg': '6689b4fb2a350f96b923547775ac5ac064d992cd37e29a61f11de1f3537c8487',
  'pictures/irises.jpg': '43c38fb4f07fab25cc910ed5b5bed2942084f8a659700c9e3625ef4faed56c3c',
  'pictures/irises-thumb.jpg': '9ae71439b1a3ef0f85327e2e45398881391f1eeb170d7f0ea4623ac5d8bf59ae',
  'pictures/hunters.jpg': '8518fd27c695e37cd29a875163f1f32f28febf048d9c8471146becbfd84b37e4',
  'pictures/hunters-thumb.jpg': '8c241bcd9a5e82d61aa489ae1755824c467ef7c25df88fef6bd75019a5c91b48',
  'pictures/blue-horses.jpg': '3944f5627452043dffa3ebba46ebb550342a4adfe152cc8e2131d1caa2205b89',
  'pictures/blue-horses-thumb.jpg': '2455895071b9c031558c2b66e2b516fb2fad53eff138b3c203be92d76535b00a',
  'pictures/plum-garden.jpg': '515e1e3cc6ce3234c6124385cabce18575ce5731d915f581bb3f59e78f8569b2',
  'pictures/plum-garden-thumb.jpg': 'c83c9b006196cc51a9e71e89e1c588eb2ce290765fd78ffc8274f5fe85f11fae',
  'pictures/grande-jatte.jpg': '1231085a3c8cc1dc458adf6ab3ad8df2329142695dedd7a9f21de67f9a090286',
  'pictures/grande-jatte-thumb.jpg': '19a3ca93e3d5bd49392605760f1f4ae340dcb3e553834645425eeb10f97673b5',
  'pictures/the-kiss.jpg': '2b571182cf743838cd4f6886adf846cd07e2445b5c463ab8ce1a6122af721e3b',
  'pictures/the-kiss-thumb.jpg': 'ca2c715f01fdccdfc9dd3a40561737449bb03a1be0fa9fcc2b5a3d2a66593f25',
  'pictures/cafe-terrace.jpg': 'eeba1159234be11f37437890b3015eb88589a5ed0349423867c2dcee879a7e12',
  'pictures/cafe-terrace-thumb.jpg': '8e31aa493da95601b85234d1153bd0ec45fae247d277124c43669c5e4803547b',
  'pictures/water-lilies.jpg': '15e5f648ffc2dd32eb2e5f26a34f304c90424425d958b981b2a56b0365813ce9',
  'pictures/water-lilies-thumb.jpg': '2d676f0c0ef7920b23c8f48992a1f8ffc4e2a6add29bd47ea24c969e034d6bcb',
  'pictures/red-fuji.jpg': 'aafcfa87ec05524137ea43b63a18949ceb376de42f7189d060d309f21f966b7b',
  'pictures/red-fuji-thumb.jpg': 'caebd7e5343f583f726fa8f8287ddb9c0736e7b6c6360484d8144af957f640a9',
  'pictures/gris-picasso.jpg': '52c44f4ee922201a268d543d4555dfa8b5c9a2f5b9acc48fb2b24e44eab092e8',
  'pictures/gris-picasso-thumb.jpg': '457c2869feb319c4e5f10f33781d74d76b9fc9d6dd16770d5088b8499749f454',
  'pictures/tower-of-babel.jpg': 'dbfafda781b6dab46c2a28fdb4876d01a492ec326dfb7b78d3632a4f27a287f2',
  'pictures/tower-of-babel-thumb.jpg': 'debdf5f3906a4f3db29f13411d0723a37b88cef04001ed83cafd0ea5d8e8d382',
  'pictures/sudden-shower.jpg': '89a94c45adba794386a18fda6e15584ce38976318fb911f46cadfe7226db5fb0',
  'pictures/sudden-shower-thumb.jpg': '92efafe6228367bbc68c0fa95bea2c385bd5504fa4750ef7eba167a33ec6ec96',
  'pictures/temeraire.jpg': '9756719287bc4713443db38e6d13c5c513664022f700aa13d0ec179c6ea88df1',
  'pictures/temeraire-thumb.jpg': 'b9afc4acc1b6ec9dc58492aa91dbd2d64dd1a4b343e615118c034f21003b7535',
  'pictures/composition-vii.jpg': '33c3309373dee29b98016e0a2ca4dde2705ab8bb5ccb28a8d2a24fae876926e1',
  'pictures/composition-vii-thumb.jpg': '07d17868d377761f97a4bfecd24b2dd8413eb56d753fa6fe7843f8704dd5d3f4',
  'pictures/van-gogh-self-portrait.jpg': 'cfafb2296b7071fe548cb6e41585e69cff3917c0083309a9a22948cebfa95fdf',
  'pictures/van-gogh-self-portrait-thumb.jpg': '9fd632d42184a29bdd9f8bc2771e951c50240f6d412921e02cf44227e3286cb6',
  'pictures/sierra-nevada.jpg': '650b8889d096cd288b9eaffa09f37b2de236eec6f2b9c5454c537fc9bfad8916',
  'pictures/sierra-nevada-thumb.jpg': 'c86c3af658a9a4b1efb3374427ca9110771cba5940aabca88858112d2cef9f21',
};

// Cache names carry the worker's scope, so two copies of the game on one site (say /jigsaw/ and
// /test/jigsaw/) keep separate caches and never delete each other's.
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `jigsaw ${SCOPE.href} `;
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
    await announceOfflineReady();
  };
  event.waitUntil(removeOld());
});

async function cacheComplete() {
  const cache = await caches.open(CACHE);
  for (const path of Object.keys(FILES)) {
    if (!await cache.match(path)) return false;
  }
  return true;
}

async function announceOfflineReady() {
  if (!await cacheComplete()) return;
  const pages = await self.clients.matchAll({ type: 'window' });
  for (const page of pages) page.postMessage('OFFLINE_READY');
}

self.addEventListener('message', (event) => {
  if (event.data !== 'CHECK_OFFLINE_READY') return;
  event.waitUntil(cacheComplete().then((ready) => {
    if (ready) event.source?.postMessage('OFFLINE_READY');
  }));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const inScope = url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
  if (request.method !== 'GET' || !inScope) return;
  if (request.mode === 'navigate')
    event.waitUntil(refillMissing().then(announceOfflineReady).catch(() => {}));
  event.respondWith(answer(request, url));
});

// An online page visit repairs entries the browser has evicted without replacing the worker.
async function refillMissing() {
  const cache = await caches.open(CACHE);
  for (const [path, expected] of Object.entries(FILES)) {
    if (await cache.match(path)) continue;
    const response = await fetch(new Request(path, { cache: 'reload' }));
    if (!response.ok) continue;
    const actual = await sha256(await response.clone().arrayBuffer());
    if (actual === expected) await cache.put(path, response);
  }
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
