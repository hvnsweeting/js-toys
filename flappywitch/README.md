# Flappy Witch

Flappy Witch is GAME 06 in the [arcade](../index.html). After publication, play it on [GitHub Pages](https://hvnsweeting.github.io/js-toys/flappywitch/). Ride a broom through moonlit gates with a tap, click, Space, or Up arrow. Collect five wisps without a miss for a shield. A close pass earns a bonus point.

Music begins after a game gesture. The speaker button mutes all sound, while the note button mutes only music. Both choices and the best score are saved in the browser when storage is available.

## Run

Run `make serve` in this folder and open `http://127.0.0.1:8097/flappywitch/`. It runs Python's static server on the arcade root (the folder above), so Back to arcade opens the arcade page. `PORT=8098 make serve` chooses another port. The unit tests and the browser check need Node.js; playing needs only a browser.

For local network play, the owner's arcade server runs at `http://192.168.72.3:8090/flappywitch/`; the arcade is at `http://192.168.72.3:8091/`. The host firewall must allow the chosen port. The game has no build step, no npm dependencies, and makes no request to another host.

## Install it as an app

On iPad, open the GitHub Pages address in Safari, choose Share > Add to Home Screen, then open the installed icon once with internet and wait for "Ready to play offline" on the title screen. The home-screen app has its own storage, so the Safari visit alone does not prepare offline play. On desktop Chrome or Edge, use the install button in the address bar, then open the app once with internet and wait for the same note. The installed app opens without browser controls and plays after a reload with no network.

App installation and offline storage require HTTPS, or a local address such as `localhost` or `127.0.0.1`. A plain HTTP local network address plays online. When files change, a visit with internet installs the update in the background; the next launch uses it. If a downloaded file fails its hash check, the old version stays available and the app retries on a later online visit. iPadOS may remove stored app files when storage is short or the app has been unused for a long time. In that case, open it with internet to download them again.

After changing a stored game file, run `node tools/stamp-sw.mjs` before publishing. If the icon artwork changes, run `node tools/make-icons.mjs` first. The unit tests check the file list and version.

## Verify

Run `make test` for game rules, vendor checksums, and offline app files. Run `node tools/mutation-check.mjs` to verify the gate-change test catches a broken rule.

With `make serve` running, run `make check`. The check uses `/usr/bin/chromium-browser`, covers eight screen shapes, plays with touch on a phone and iPad, checks offline play, and saves screenshots in `shots/`. Set `BASE_URL` to the game's full folder address if the server uses another port. Run `node tools/browser-check.mjs --subpath` to check the arcade route and Back navigation separately.

After a fully passing full check, it replaces the fixed screenshot names. It keeps the newest five timestamped `shots/run-*` directories and removes older timestamped run directories, including after a failed check. It leaves other paths in `shots/` alone. Run one browser check at a time so check runs do not remove each other's screenshots. A check interrupted while publishing can leave fixed screenshot names from two runs.

With the server running, `node tools/music-render.mjs` checks music levels and writes two audio samples and measurements in `.scratch/`.

Use `?seed=42` to repeat gate generation and `?quality=low` for reduced rendering work.
