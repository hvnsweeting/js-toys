# Spec: Tree Appreciator as an installable app that works offline

Status: asked for on 2026-11-01 ("write spec for offline PWA and then implement"). The open
choices below were not put to the owner one by one; each says which default was taken.

## Purpose and user problem

The owner wants to share the game for iPad and desktop. A player opens the link once, with
internet; after that the game must start and play with no internet at all, from a home-screen
or desktop icon that opens it like an app (full screen, no browser bar).

Today the game asks no other host for anything, but no part of it keeps its files: without a network
the next visit fails, or works only while the browser's ordinary cache happens to hold every file.

## Success criteria

1. After one visit over HTTPS (or on `localhost` / `127.0.0.1`), the game starts, grows a pair and
   can be played with the network cut off, including after a reload and after closing and
   reopening the browser. On iPad the visit that counts is one in the installed app: a
   home-screen app has storage of its own, apart from Safari's (review finding, Apple's WWDC 2023
   session on web apps), so the README tells players to open the icon once while online. A browser check proves this: it loads the game, waits until the
   service worker controls the page, cuts the network, reloads, and plays.
2. On iPad, Safari's Share > Add to Home Screen gives an icon named "Tree Appreciator" (label
   "Trees" where space is short) that opens the game full screen. On desktop Chrome and Edge,
   the address bar offers to install it. Chromium reports no manifest errors (checked by the browser
   check through the DevTools Protocol call `Page.getAppManifest`).
3. A new version reaches players by itself: when the game files change on the server, the next
   visit with internet installs the new version in the background and the version after that
   launch uses it. Players are never stuck on an old version while online for more than one launch,
   with one exception: while the server (or a cache in front of it) still sends an old copy of a
   file the new version changed, that file fails its hash check, the update is not installed, and
   the old version keeps playing until the server sends the new copy.
4. Stale caches cannot ship by mistake: `sw.js` records the SHA-256 of every file it stores and a
   version derived from its own text, and a unit test fails when a stored file changed but its
   hash or the version was not updated, or when the page needs a file the list does not store.
   At install the worker checks each downloaded file against its hash, so an old copy served by a
   cache in front of the site fails the install instead of being stored under the new version.
5. Everything stays as it is now when service workers are not available (plain HTTP to another
   machine, browsers or modes that block them): the game plays online exactly as before, with no
   error in the console.
6. No npm, no build step, no request to any other host (the existing self-contained checks keep
   passing and also scan the new files).

## Scope

1. **`manifest.webmanifest`**: name, short name, description, `start_url` and `scope` both `./`
   (so the app works under `/js-toys/treediff/` on GitHub Pages and under any other folder),
   `display: standalone`, background and theme colours from the game's palette (`--paper-solid`
   `#fbf7ec`, `--moss` `#4f6f3a`), and icons.
2. **Icons** in `icons/`: 192 and 512 pixel PNGs, a 512 pixel maskable PNG (the drawing inside
   the middle 80 percent, as the maskable icon rules ask), and a 180 pixel `apple-touch-icon.png`
   for iPad (opaque: iOS fills transparent parts with black). The picture (the owner's choice,
   2026-11-01: "use an emoji instead? if no pumpkin then use a ghost"): the pumpkin emoji 🎃 from
   Google's Noto Emoji (its 2D SVG, release `v2026-09-24-unicode18_0`, Apache License 2.0),
   vendored as `vendor/emoji/emoji_u1f383.svg` with its licence and hash, centred on the game's
   cream paper colour at 72 percent of the icon's width. Apple's emoji pictures are not licensed
   for this. The PNGs are rendered by `tools/make-icons.mjs`, which uses the project's own
   Chromium driver (`tools/chromium.mjs`); the PNGs are committed, so serving needs no tool.
3. **`index.html` head**: `<link rel="manifest">`, `<link rel="apple-touch-icon">`,
   `<meta name="theme-color">`, `<meta name="apple-mobile-web-app-capable">`,
   `<meta name="mobile-web-app-capable">`, `<meta name="apple-mobile-web-app-title" content="Trees">`.
4. **`sw.js`** (service worker, scope `./`):
   - `FILES`: every file the game needs, by path relative to the worker (`./` and `index.html`,
     `style.css`, every `src/*.js`, the three vendored three.js files, the three fonts, the
     manifest and the icons), each with the SHA-256 of its contents.
   - `VERSION`: the first 16 hexadecimal digits of a SHA-256 over `sw.js`'s own text with the
     `VERSION` value left out. It covers the file hashes (they are in that text) and the worker's
     code, so a change to either gives a new cache name; changing `VERSION` changes `sw.js`, which
     is what makes browsers fetch the new worker.
   - Install: downloads every file with `cache: 'reload'` (so the browser's ordinary cache cannot
     hand it an old copy), checks each against its hash, and only then stores them in a cache
     named `treediff <scope> <VERSION>`. A file that fails to download or does not match fails
     the install: the new cache is deleted and the old version stays in charge.
   - Activate: deletes the caches of the same scope other than its own (copies of the game at
     other paths on the same site keep theirs), and takes control of open pages.
   - Fetch: for a GET request to the worker's own origin inside its scope, answer from the cache.
     The page itself (the folder or `index.html`) matches whatever its `?query`, so
     `?quality=low` works offline; any other address must match exactly, and one not stored goes
     to the network as usual. Requests elsewhere are not touched.
   - Refill: on every page load the worker also downloads any listed file missing from its cache
     (the browser may delete a cache to free storage while the worker stays registered, and an
     unchanged worker is not installed again), checks it against its hash, and stores it. A file
     that fails or does not match is left for a later load or for the next version.
   - Update default (open choice, taken): the new worker calls `skipWaiting()`, so it takes over
     as soon as it is installed rather than after every window of the game is closed. On iPad a
     home-screen app is rarely closed for good, so waiting could keep an old version for weeks.
     The page in use keeps running on the files it already loaded; the next launch uses the new
     ones.
5. **Registration** in `src/main.js`: if `navigator.serviceWorker` exists, register `./sw.js`
   after the page has loaded; a failure is logged with `console.warn` (not an error) and the
   game plays on.
6. **`tools/stamp-sw.mjs`**: writes each file's hash into `FILES`, then `VERSION`, into `sw.js`
   (through a temporary file renamed over it). The
   README's development notes say to run it after changing any stored file, and the unit test of
   criterion 4 names it in its failure message.
7. **Back to Arcade in the installed app** (open choice, taken): hidden when the game runs as an
   installed app (`@media (display-mode: standalone)`), because the arcade page is outside the
   app's scope, would open outside the app, and is not stored for offline use. In a browser tab it
   stays as it is.
8. **Tests**:
   - Unit (`test/offlineApp.test.js`): the manifest's fields and that each icon file exists with
     the pixel size it claims (read from the PNG header); every file the page loads (the modules
     reachable from `src/main.js` by their imports, the importmap targets, the stylesheet, the
     fonts named in `style.css`, the manifest and the icons named in `index.html` and the
     manifest) is in `FILES`; every entry in `FILES` exists; each hash and `VERSION` are current.
   - Unit (`test/serviceWorker.test.js`): `sw.js` run in Node against stand-ins for cache
     storage, the network and worker events: install stores every file and takes over; a stale,
     missing or failing file fails the install, removes the new cache and leaves the running one;
     activation deletes only the same scope's older caches; an update replaces the old version;
     which requests are answered from the cache, sent to the network, or left alone; a page load
     puts back deleted files whose server copy matches its hash.
   - Browser (`offlineApp` scenario): service worker controls the page; no manifest errors from
     Chromium; with the HTTP cache emptied and the network cut off for the page and its service
     worker (DevTools Protocol `Network.clearBrowserCache` and `Network.emulateNetworkConditions`),
     the worker is stopped (Chromium must report it stopped, then running again during the
     reload, as when an installed app is launched again), a reload boots the game and a click on
     a difference scores; every request of the reloaded page was answered by a service worker
     that was cut off (one starting while offline is held at its start until it is). Chromium cannot emulate `display-mode: standalone`,
     so the hidden Back to Arcade is checked by finding the stylesheet rule for that condition
     that hides the button.
   - Each new check is shown to fail on a copy of the game broken on purpose (a file missing from
     `FILES`, a stale `VERSION`, a worker that does not answer from its cache).
9. **README**: an "Install it as an app" section: iPad (Safari, Share > Add to Home Screen, open
   it once with internet), desktop (the install button in Chrome or Edge's address bar); what
   works offline; that HTTPS is needed; how updates arrive.

## Constraints and technical notes

- Service workers run only in secure contexts: HTTPS, or `localhost` / `127.0.0.1`. The
  GitHub Pages address is HTTPS. `make serve` on 127.0.0.1 works; the game served over plain
  HTTP to another machine (port 8089 on this server) plays online only.
- The worker's scope is its own folder, `treediff/`; it cannot and does not serve the arcade.
- iPadOS may remove a home-screen app's stored files when the device is short of storage or the
  app has gone unused for a long time; it then downloads them again on the next visit with
  internet. The README says so; the game cannot prevent it.
- The stored files are about 1.5 MB, most of it three.js.
- `make serve` (Python's `http.server`) may send `.webmanifest` with a generic content type;
  Chromium and Safari read the manifest regardless. GitHub Pages sends `application/manifest+json`.

## Out of scope

- Offline use of the js-toys arcade page or of other games.
- Push notifications, background sync, an in-game "update ready" message.
- An App Store or other packaged native app.
- Changing `/opt/code/treeappre` (the original copy); this is done in js-toys `treediff/` only.

## After implementation

The `game3d` skill gains a section making this the default for every game in js-toys: manifest,
icons, content-versioned service worker, the tests above, and the README section.
