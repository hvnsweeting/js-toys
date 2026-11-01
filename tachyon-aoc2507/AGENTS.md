# Tachyon Cascade: notes for developers

A three.js puzzle based on [Advent of Code 2025, day 7](https://adventofcode.com/2025/day/7). The README covers play and running; this file covers what you need to change the code.

## Constraints

- No build step. `index.html` maps `three` to `vendor/three/` with an import map; `npm run vendor` refreshes that copy from `node_modules` (three.js 0.180.0).
- Use relative paths only. GitHub Pages serves the game at `/js-toys/tachyon-aoc2507/`.
- Phones and iPad must work: touch only, portrait and landscape, every control at least 44 px, bottom buttons kept clear of the iPhone Safari toolbar. The browser check tests ten touch sizes.
- Keep the arcade wiring: the "Back to Arcade" link (`../index.html`), the GAME 05 card in the repository root `index.html`, and a Makefile with `serve`, `test` and `check` like the other games.
- Folder naming rule for Advent of Code games: `tachyon-aoc25XX`, where XX is the puzzle day.

## Commands

```sh
npm install     # once: three.js (for npm run vendor) and puppeteer-core
npm test        # node --test
npm run check   # headless system Chromium; writes shots/
./run.sh        # serve on 0.0.0.0:8099 for phones on the local network; ./run.sh stop
```

Run both `npm test` and `npm run check` before committing, and look at the changed screenshots in `shots/`.

## Files

- `src/sim.js`: the beam rules, win check and stars. No DOM, no three.js.
- `src/levels.js`: the 15 campaign levels. Each design lists fixed pieces and a reference solution; inventory and par come from that solution, and detector goals are in `goals`.
- `src/solver.js`: search solver used by tests and by the Rush generator to set par.
- `src/generator.js`: seeded Cascade Rush boards. `src/rush.js`: Rush score and timer.
- `src/storage.js`: profile in localStorage key `tachyon-cascade-v1`, validated field by field; a malformed save is copied to rotating backup keys when storage has room (if the copy fails, the player sees a message and the original stays in place). A save re-reads the stored profile and merges it (best stars, fewest pieces, best Rush score), so two tabs do not erase each other's progress.
- `src/render/scene.js`: all three.js code (board, pieces, beam, effects, labels, camera fit).
- `src/ui.js`: DOM screens and overlay. `src/main.js`: boot, input, game loop, `window.game`. `src/runtime.js`: keyboard shortcut filter, guarded localStorage access, elapsed wall time for the Rush timer.
- `src/audio/music.js`: the composed score and its synthesizer. `src/audio/sfx.js`: effects; split notes use the current music chord.
- `server.mjs`: the `npm start` and `run.sh` server; serves the listed top-level files and anything under `src/`, `vendor/` and `assets/`.
- `tools/browser-check.mjs`: browser scenarios. `tools/screenshots.mjs`: screenshot names per scenario. `tools/audio-preview.html`: page to listen to music and effects alone. `tools/preview-file.mjs`: opens the game over `file://` and saves three `shots/file-*.png` images (needs an existing `shots/`).

## Rules the tests hold

- Beam rules match the puzzle exactly. A splitter sends its count to the left and right cells only if they are empty; a block absorbs; counts add where paths meet. The puzzle's example gives 21 splits and 40 timelines (`AOC_EXAMPLE` in `src/sim.js`).
- Campaign levels and 200 Rush seeds: par equals the solver's minimum and no board starts solved. Campaign bonus stars must be reachable; Rush boards must have a target, a void, and no unused hidden piece. Only levels with par 3 or less and Rush seeds 0 to 11 are also checked without the solver, by `test/brute-force.js`; for the rest, a solver bug would also hide a wrong par.
- The row under the source cannot take a piece.

## Browser check

- Needs `/usr/bin/chromium-browser`. Keep the launch flags in `tools/browser-check.mjs`: on this Linux host, launching without `--use-angle=gl-egl --ignore-gpu-blocklist --disable-gpu-watchdog` left WebGL unavailable and `window.game` never appeared.
- Scenarios drive the game through `window.game` (`loadLevel`, `place`, `fire`, `startRush`, `beamPixels()`, `blockHitPixels()` and others in `src/main.js`).
- Pixel checks render with and without the object and compare canvas pixels; they turn off bloom and the beam aura so a neighbour's glow cannot hide a missing segment.
- A "Connection closed" failure has so far meant the host ran low on memory; rerun before debugging.
- Codex's sandbox cannot bind sockets or start Chromium, so run the check yourself.

## Rendering details that broke before

- The board stretches rows to fit the screen (`board.scale.y`). Pieces keep their shape through `applyShapeScale`, so distances inside a piece, such as a block's face (`blockFace`), depend on the row scale. After a resize the beam is redrawn.
- `#app` is sized from `window.visualViewport` so the Safari toolbar does not cover the buttons.
- A failed run zooms and outlines the detectors that broke the goal instead of naming a column.

## Known limits

- Two tabs saving in the same instant can lose one result; localStorage has no atomic update.
- Not tested on a real iPhone or iPad; frame rate there is unmeasured.
- The 15 by 16 finale is small on a phone held sideways.
- Fire's label reads "Skip" while the beam animates; skipping plays no notes for the splits not yet shown.
- The browser check publishes screenshots one file at a time; a failure partway leaves `shots/` with old and new images mixed.
- `npm run vendor` uses fixed `vendor/three.staging` and `vendor/three.previous` folders: run one at a time. If it is killed between its two renames, move `vendor/three.previous` back to `vendor/three`.
- `run.sh` recognises its server by the process command `node server.mjs`, so a stale `server.pid` naming another such process would stop that process.
