# Tree Appreciator

Two trees grow side by side from one seed, in a meadow drawn with three.js. They are the same except
for three differences. Find them.

## Run

Online, it is part of the js-toys arcade: https://hvnsweeting.github.io/js-toys/treediff/

Locally, from this folder:

```sh
make serve      # serves the whole js-toys arcade at http://127.0.0.1:8000/treediff/
make test       # unit tests, with Node only
make check      # plays the game in headless Chromium (needs make serve running)
```

`HOST` and `PORT` override the defaults for `make serve` and `make check` (127.0.0.1, port 8000);
`BASE_URL` points `make check` at a game served elsewhere.

## How to play

Two trees grew from the same seed. They are the same except for 3 differences: things like a bird, a
nest, a cluster of apples or a lantern that one tree has and the other does not, a bough that turned
to autumn colours or to blossom early, or a branch that is missing. Click each difference on either
tree. A click on a difference puts a ring around it on both trees, fills one of the three dots at
the top and scores 100 points; a click at anything else is a miss and costs 20 (the score never
goes below 0). Some differences are on the far side, so drag to turn the trees (all the way round)
and scroll or pinch to zoom. Hint (at the bottom) rings an area near a difference you have not
found; the plus button at the top left starts a new pair (it pulses when a pair is done, or shows a steady ring if your system asks for reduced motion), and the score carries on until you
reload. Keys: H hint, N or Space new pair, M mute. The guide at the top goes away once you click,
drag or scroll on the trees. Wind and occasional birdsong play in the background; the third find
gets its own win sound. Sound pauses while the game's tab is in the background. No data
is saved between visits.

## Install it as an app (plays offline)

Open the game once with internet; from then on it starts and plays with none. A service worker
(`sw.js`) keeps a copy of every file it needs, about 1.5 MB, most of it three.js. The copy
downloads in the background while you play; the game shows no sign when it is done. If the game
is closed before it finishes, the next launch with internet finishes it.

- **iPad or iPhone:** open the link in Safari, tap Share, then Add to Home Screen. Then open the
  pumpkin icon (named "Trees") once while still online: the installed app keeps its own storage,
  apart from Safari's, so the copy Safari made does not carry over. After that the icon opens the
  game full screen, with or without internet.
- **Desktop Chrome or Edge:** use the install button at the right of the address bar. Other
  browsers still keep the offline copy for the tab.

The installed app hides the ◀ Back to Arcade button: the arcade page is not part of the app and is
not kept for offline use. When a new version is published, the next launch with internet fetches
it in the background and the launch after that uses it. Each downloaded file is checked against
the SHA-256 recorded for it in `sw.js`; if any does not match (an old copy still in a cache in
front of the site, say), the update is not used and the version already stored keeps playing. The offline copy needs HTTPS (as on GitHub
Pages) or a `localhost` / `127.0.0.1` address; served over plain HTTP to another machine, the game
plays online only. iPadOS may delete the copy when the device runs short of storage or the app goes
unused for a long time; the next visit with internet stores it again.

## Running it alone

No build step and no package manager: the game's own files, three.js and the two typefaces are in
this folder. Any static file server works; from this folder:

```sh
python3 -m http.server 8080 --bind 127.0.0.1   # the game at http://127.0.0.1:8080/
```

That server sends every file in this folder (tests and tools too), and without `--bind` it
listens on every network interface. The ◀ button in the bottom-left corner goes back to the js-toys
arcade page (`../index.html`); with the game served alone, that address is the game itself, so the
button reloads it. Opening `index.html` straight from disk does not work, because browsers block
ES modules on `file://` URLs.

On a slow GPU, add `?quality=low` to the URL.

The page makes no request to any other host: three.js is in `vendor/three/` and the two
typefaces (Cormorant Garamond and Inter, Latin letters only) are in `vendor/fonts/`.

## Developing

No npm install is needed: the tests and the browser check need Node (run on 25.9) and, for the
browser check, Chromium (and `make serve`, which uses python3).

`make test` runs the unit tests. They cover the tree generator and its changes to single boughs,
the placement of the differences, the objects, the click tests, the camera's height over the
hills, the app manifest and its icons, that the service worker stores every file the page loads,
and that the page makes no request outside the project (a text scan: it cannot see addresses
built at run time, so a new script that assembles a URL needs a human look).
`tools/register-vendor-three.mjs` makes `import 'three'` find `vendor/three/`, the same mapping
the importmap in `index.html` gives the browser (a unit test compares the two). Use Node 22.7 or
later: there is no `package.json` to mark the `.js` files as ES modules, and Node detects that
by itself by default from 22.7 on (and from 20.19 on the 20 line, which does not expand the
`*.test.js` pattern itself, so it needs a POSIX shell for that).

`make check` (with `make serve` running) plays the game in headless Chromium and covers what unit
tests cannot: clicking differences on the trees, turning the camera, the hint, keyboard handling,
the layout on a phone, the camera turned round on a phone, falling leaves that match on both
trees, camera framing after resizes, a page loaded while hidden, playing offline from the
service worker, and that the page asks no host but its own. `node tools/browser-check.mjs clickFinds hint` runs only the named scenarios.
`tools/chromium.mjs` drives the browser over the Chrome DevTools Protocol through a pipe, with
Node's own modules only; it gives the browser check the few puppeteer calls it uses. Each run
starts Chromium with a new profile folder in the system's temporary folder (`TMPDIR`, else
`/tmp`) and removes it when the run ends (a run stopped part way, for example with Ctrl-C, can
leave its `browser-check-profile-*` folder there). Set `BASE_URL` if the game is not at
http://127.0.0.1:8000/treediff/, `CHROME_PATH` for a browser other than
`/usr/bin/chromium-browser`, and `SHOTS` to a folder to keep screenshots (`SHOTS=shots`: git
ignores that folder, not others). It renders on the CPU when there is no GPU, so a full run takes
several minutes.

**After changing any file the service worker stores, or `sw.js` itself**, run
`node tools/stamp-sw.mjs`. The stored files are the `FILES` list in `sw.js`: the page,
`style.css`, `src/`, the vendored three.js and fonts, the manifest and the icons. The tool writes
each file's SHA-256 into `FILES` and a new `VERSION`, a hash of `sw.js`'s own text, which is how
browsers learn there is an update; `make test` fails until it is run. A new file the page loads
must also be added to `FILES`, as `'path': '',` (a unit test names any that is missing).
`test/serviceWorker.test.js` runs `sw.js` in Node against stand-ins for the browser's storage and
network: install, a stale or missing file, an update, cleanup, and which requests it answers. `node tools/make-icons.mjs` renders
the icon PNGs from the vendored pumpkin emoji with Chromium.

### What is vendored, and how to check it

`vendor/CHECKSUMS.txt` lists the SHA-256 hash of every vendored file. A unit test fails when a
file and its hash disagree, or when a file is listed twice, missing from the list, or listed but
absent. The project's `.gitattributes` stops git from converting line endings there (a
converted file would no longer match its hash). To check by hand: `cd vendor && sha256sum -c CHECKSUMS.txt`.

- **three.js 0.180.0** (`vendor/three/`): `three.module.js` and `three.core.js` from the package's
  `build/` folder, `OrbitControls.js` from `examples/jsm/controls/`, and `LICENSE`. They were
  copied from the npm package `three@0.180.0` (tarball integrity
  `sha512-o+qycAMZrh+TsE01GqWUxUIKR1AL0S8pq7zDkYOQw8GqfX8b8VoCKYUoHbhiX5j+7hr8XsuHDVU6+gkQJQKg9w==`).
  They were not compared against the three.js GitHub release; to be sure, download the `r180`
  tag from https://github.com/mrdoob/three.js and compare the four files with `cmp`.
- **Pumpkin emoji** (`vendor/emoji/`): `emoji_u1f383.svg`, the 🎃 picture from Google's Noto Emoji,
  release `v2026-09-24-unicode18_0`, file `2D/svg/emoji_u1f383.svg` of
  https://github.com/googlefonts/noto-emoji, downloaded on 2026-11-01, with that folder's
  `LICENSE` (Apache License 2.0). The app icons in `icons/` are made from it by
  `tools/make-icons.mjs` (the pumpkin placed on a cream square); the page does not load it.
- **Fonts** (`vendor/fonts/`): the Latin subsets Google Fonts serves, downloaded on 2026-10-29 from
  fonts.gstatic.com (`cormorantgaramond/v21` for both Cormorant Garamond files, `inter/v20` for
  Inter). The two upright files are variable fonts (weight axes 300 to 700 and 100 to 900); the
  italic Cormorant file is a static Medium Italic, so italic text is limited to that weight. The licenses (SIL Open Font License 1.1) are copied from
  https://github.com/CatharsisFonts/Cormorant and https://github.com/rsms/inter.

To upgrade three.js without npm: download the release archive, copy the four files above into
`vendor/three/` (the `addons` folder keeps its path), compare them with the release, regenerate
the hashes with
`cd vendor && (set -o pipefail; find . -type f ! -path ./CHECKSUMS.txt ! -path '*/.*' | LC_ALL=C sort | xargs sha256sum > ../CHECKSUMS.new) && mv ../CHECKSUMS.new CHECKSUMS.txt`
(bash or zsh, for `pipefail`: a failure anywhere in the pipeline, not only in its last command,
keeps the old list; GNU coreutils; on macOS use `shasum -a 256` in place of `sha256sum`),
change the version in this file and in the spec, and run the unit tests.

The game's design is in `doc/specs/SpotTheDifference.md`, the installable offline app in
`doc/specs/OfflineApp.md`.
