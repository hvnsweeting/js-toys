// Plays the game in headless Chromium and checks behaviour that unit tests cannot
// reach: clicking differences on the trees, turning the camera, the hint, keyboard
// handling, framing on narrow and hidden stages, and that the page asks no host but its own. It needs
// Node and Chromium only: tools/chromium.mjs drives the browser, no package from npm. Start the game
// server first (`make serve`), then:
//
//   node tools/browser-check.mjs               every scenario
//   node tools/browser-check.mjs clickFinds    only the named scenarios
//
// Settings from the environment:
//   BASE_URL     where the game is served (default http://127.0.0.1:8000/treediff/, where make serve puts it)
//   CHROME_PATH  the Chromium or Chrome binary (default /usr/bin/chromium-browser)
//   SHOTS        a folder to save screenshots in (default: no screenshots), made if missing; each
//                run replaces the files of the run before, which have the same names
//
// The browser flags make WebGL work on a server without a GPU: ANGLE on the
// system's OpenGL (Mesa llvmpipe renders on the CPU). Frames are then slow, so
// the waits that matter are on game state or game time; short fixed pauses only
// let a click or key event settle.
import { mkdirSync } from 'node:fs';
import { launch } from './chromium.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8000/treediff/';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const only = process.argv.slice(2);
// Every host name except the game server's resolves to "not found", so a connection to
// another host fails inside the browser even where the request listener below cannot see
// it. A failed WebSocket shows as a console error, which the runner checks after every
// scenario; a preconnect or prefetch hint fails silently, so the runner also looks for
// <link> elements that point at another host.
const blockOtherHosts = `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${new URL(BASE).hostname}`;
const browser = await launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
  args: ['--no-sandbox', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', blockOtherHosts],
});

async function shot(page, name, options = {}) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, ...options });
}

const results = [];
function report(name, ok, detail) {
  results.push(`${ok ? 'PASS' : 'FAIL'}\t${name}\t${detail}`);
  console.log(results.at(-1));
}

const openContexts = [];
// Every page a scenario opens; after each scenario they are checked for requests to other hosts.
const openPages = [];

// Compares origins, not text: "http://localhost:8089" is a prefix of "http://localhost:8089.example.com".
function isGameServer(url) {
  try {
    return new URL(url).origin === new URL(BASE).origin;
  } catch {
    return false;
  }
}
// Records a page's errors and its requests to other hosts, for the scenario and for the
// runner's checks after it. Every page a scenario opens must go through here.
async function track(page) {
  page.errors = [];
  // A WebSocket or EventSource fires no request event, and one to the game server's own
  // host name on another port is not blocked by the resolver rule; record each one made.
  await page.evaluateOnNewDocument(() => {
    window.__connections = [];
    for (const name of ['WebSocket', 'EventSource']) {
      const Original = window[name];
      if (!Original) continue;
      window[name] = function (url, ...rest) {
        window.__connections.push(String(new URL(url, location.href)));
        return new Original(url, ...rest);
      };
      window[name].prototype = Original.prototype;
    }
  });
  // The game is self-contained: every request must go to the game server. Inline data
  // (data: and blob: URLs) does not leave the page.
  page.outsideRequests = [];
  openPages.push(page);
  page.on('request', (request) => {
    const url = request.url();
    const inline = url.startsWith('data:') || url.startsWith('blob:');
    if (!inline && !isGameServer(url)) page.outsideRequests.push(url);
  });
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', async (message) => {
    if (message.type() !== 'error') return;
    // console.error(error) prints as "JSHandle@error"; ask the page for the message.
    const first = message.args()[0];
    const text = first ? await first.evaluate((value) => (value instanceof Error ? value.message : String(value))).catch(() => message.text()) : message.text();
    page.errors.push(text);
  });
  return page;
}

async function openPage({ width = 1280, height = 800, scale = 1, query = '', init = null, touch = false, waitUntil = 'networkidle0', beforeLoad = null } = {}) {
  const context = await browser.createBrowserContext();
  openContexts.push(context);
  const page = await track(await context.newPage());
  await page.setViewport({ width, height, deviceScaleFactor: scale, hasTouch: touch, isMobile: touch });
  if (init) await page.evaluateOnNewDocument(init);
  if (beforeLoad) await beforeLoad(page);
  await page.goto(BASE + query, { waitUntil });
  return page;
}

async function waitFor(page, fn, timeout = 60000, arg = null) {
  await page.waitForFunction(fn, { timeout, polling: 200 }, arg);
}

const gameReady = (page) => waitFor(page, () => window.treeAppreciator && window.treeAppreciator.right.growth >= 1);
// The pair has finished growing and its differences can be clicked.
const playing = (page) => waitFor(page, () => window.treeAppreciator && window.treeAppreciator.state.phase === 'playing');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits for `seconds` of game time, read from the game's own clock. On a CPU
// renderer that is much longer than `seconds` on the wall clock.
async function gameSeconds(page, seconds) {
  const until = (await page.evaluate(() => window.treeAppreciator.elapsed)) + seconds;
  await waitFor(page, (target) => window.treeAppreciator.elapsed >= target, 120000, until);
}

// Narrows the window from 1280 by 800 to 420 by 800 (a phone turned upright), and checks
// that both trees are refitted inside it.
async function checkResizeReframes(name, pageOptions) {
  const page = await openPage(pageOptions);
  await playing(page);
  await page.setViewport({ width: 420, height: 800 });
  await gameSeconds(page, 4);
  const boxes = await treeScreenBoxes(page);
  const onScreen = boxes.every((b) => b.minX > -5 && b.maxX < 425 && b.topY > -5 && b.baseY < 805);
  await shot(page, name.replaceAll(' ', '-'));
  report(name, onScreen, JSON.stringify(boxes.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v)])))));
}

// Screen positions of both trunk bases and crown tops.
const treeScreenBoxes = (page) =>
  page.evaluate(() => {
    const { world, left, right } = window.treeAppreciator;
    return [left, right].map((view) => {
      const b = view.grownBounds();
      const base = world.toScreen(view.worldX, 0, 0);
      const top = world.toScreen(view.worldX, b.maxY, 0);
      const leftEdge = world.toScreen(b.minX, b.maxY / 2, 0);
      const rightEdge = world.toScreen(b.maxX, b.maxY / 2, 0);
      return { baseY: base.y, topY: top.y, minX: leftEdge.x, maxX: rightEdge.x };
    });
  });

// Where difference `index` is on the screen, on the tree that has it or on the other one.
const differencePoint = (page, index, onOtherTree = false) =>
  page.evaluate(
    (i, other) => {
      const { state, world } = window.treeAppreciator;
      const difference = state.pair.differences[i];
      const side = (difference.tree === 'left') !== other ? 'left' : 'right';
      const point = world.toScreen(window.treeAppreciator[side].worldX + difference.position[0], difference.position[1], difference.position[2]);
      return { x: point.x, y: point.y, kind: difference.kind };
    },
    index,
    onOtherTree,
  );

// Turns the camera round the trees, at its present distance and height, until it looks at
// difference `index` from the side of the trunk the difference is on, as a player would before
// clicking it.
async function faceDifference(page, index) {
  await page.evaluate((i) => {
    const { state, world } = window.treeAppreciator;
    const [x, , z] = state.pair.differences[i].position;
    const length = Math.hypot(x, z);
    if (length === 0) return;
    const { camera, controls } = world;
    const offset = camera.position.clone().sub(controls.target);
    const across = Math.hypot(offset.x, offset.z);
    camera.position.set(controls.target.x + (across * x) / length, camera.position.y, controls.target.z + (across * z) / length);
    controls.update();
  }, index);
  await gameSeconds(page, 1);
}

// Whether the camera is on the far side of difference `index`'s tree: more than a quarter turn
// round the trunk from the difference.
const behindNow = (page, index) =>
  page.evaluate((i) => {
    const { state, world } = window.treeAppreciator;
    const [x, , z] = state.pair.differences[i].position;
    const camera = world.camera.position;
    const trunkX = window.treeAppreciator[state.pair.differences[i].tree].worldX;
    return x * (camera.x - trunkX) + z * camera.z < 0;
  }, index);

// The camera's turn around the trees, in radians.
const azimuth = (page) => page.evaluate(() => window.treeAppreciator.world.controls.getAzimuthalAngle());

// One drag across the stage, 400 pixels to the right, then a pause for the turn to settle.
async function dragRight(page) {
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 8 });
  await page.mouse.up();
  await gameSeconds(page, 1);
}

const readGame = (page) =>
  page.evaluate(() => {
    const { state, left, right } = window.treeAppreciator;
    return {
      phase: state.phase,
      found: [...state.round.found],
      misses: state.round.misses,
      progress: document.getElementById('progress').getAttribute('aria-label'),
      dots: document.querySelectorAll('#progress i.found').length,
      score: document.getElementById('score').textContent,
      scoreChange: document.getElementById('score-change').textContent,
      pops: window.__pops ?? 0,
      announced: document.getElementById('announce').textContent.trim(),
      announcedRaw: document.getElementById('announce').textContent,
      result: document.getElementById('result').textContent,
      rings: [left.ringsGroup.children.length, right.ringsGroup.children.length],
      // Whether each tree has one ring at each found difference's place, and no other ring.
      ringsAtFinds: [left, right].every((view) => {
        const places = view.ringsGroup.children.map((ring) => ring.position.toArray());
        const wanted = state.round.found.map((index) => state.pair.differences[index].position);
        const near = (a, b) => a.every((value, k) => Math.abs(value - b[k]) < 1e-6);
        const drawn = view.ringsGroup.children.every((ring) => ring.visible && ring.scale.x > 0.1 && ring.material.opacity > 0.5);
        return drawn && places.length === wanted.length && wanted.every((place) => places.some((ring) => near(ring, place)));
      }),
      hintDisabled: document.getElementById('hint').disabled,
    };
  });

// Where the "+100" / "-20" pops up, and the New pair button's ready state with its label. The pop
// must be near the middle of the screen and clear of the top row; the label must be on screen
// and clear of the scoreboard, the sound button and the bottom.
const popAndReady = (page) =>
  page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const pop = rect('#score-change');
    const label = rect('#new-pair .ready-label');
    const topRow = [rect('#scoreboard'), rect('#mute'), rect('#new-pair')];
    // A computed colour that is not see-through: "transparent", or rgba with a low alpha, is not.
    const colourShows = (colour) => colour !== 'transparent' && colour !== 'none' && !(colour.startsWith('rgba') && Number(colour.split(',').at(-1).replace(')', '')) < 0.5);
    // Drawn: displayed, visible, of a real size, and opaque, counting the opacity of every
    // element it sits in (a label in a see-through button is see-through too).
    const drawn = (selector) => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      let opacity = 1;
      for (let node = element; node instanceof Element; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return style.display !== 'none' && style.visibility === 'visible' && opacity === 1 && colourShows(style.color) && box.width >= 20 && box.height >= 10;
    };
    const labelShown = drawn('#new-pair .ready-label');
    return {
      popNearMiddle: Math.abs((pop.left + pop.right) / 2 - window.innerWidth / 2) < window.innerWidth * 0.1 && Math.abs((pop.top + pop.bottom) / 2 - window.innerHeight / 2) < window.innerHeight * 0.2,
      popClearOfTopRow: topRow.every((box) => !overlap(pop, box)),
      ready: document.getElementById('new-pair').classList.contains('ready'),
      // Each filled dot really shows a colour, and the plus is stroked.
      resultShown: document.getElementById('result').textContent !== '' && drawn('#result'),
      scoreboardShown:
        drawn('#scoreboard') && drawn('#score') && drawn('#progress') &&
        // Every dot shows: an empty one by its ring, a filled one by its colour too.
        [...document.querySelectorAll('#progress i')].every((dot) => {
          const style = getComputedStyle(dot);
          const box = dot.getBoundingClientRect();
          const ringShows = parseFloat(style.borderTopWidth) >= 1 && colourShows(style.borderTopColor);
          const fillShows = !dot.classList.contains('found') || style.backgroundColor === 'rgb(109, 154, 76)';
          return style.visibility === 'visible' && style.display !== 'none' && ringShows && fillShows && box.width >= 6;
        }),
      plusShown: drawn('#new-pair svg') && colourShows(getComputedStyle(document.querySelector('#new-pair svg path')).stroke) && parseFloat(getComputedStyle(document.querySelector('#new-pair svg path')).strokeWidth) >= 1,
      // The ready colour is the game's moss green (--moss, #4f6f3a).
      readyGreen: getComputedStyle(document.getElementById('new-pair')).backgroundColor === 'rgb(79, 111, 58)',
      buttonShadow: getComputedStyle(document.getElementById('new-pair')).boxShadow,
      popAnimation: getComputedStyle(document.getElementById('score-change')).animationName,
      pulse: getComputedStyle(document.getElementById('new-pair')).animationName,
      buttonBackground: getComputedStyle(document.getElementById('new-pair')).backgroundColor,
      popOpacity: Number(getComputedStyle(document.getElementById('score-change')).opacity),
      popShowing: document.getElementById('score-change').classList.contains('show'),
      popLoss: document.getElementById('score-change').classList.contains('loss'),
      // The colour that marks the pop-up: rust for a loss, moss for a gain (its text shadow).
      popTone: (() => {
        const shadow = getComputedStyle(document.getElementById('score-change')).textShadow;
        if (shadow.includes('rgb(176, 83, 60)')) return 'loss';
        if (shadow.includes('rgb(79, 111, 58)')) return 'gain';
        return shadow;
      })(),
      // A plus: one upright and one level stroke through the middle (a reload arrow was rejected).
      plusIcon: document.querySelector('#new-pair svg path').getAttribute('d').replace(/\s+/g, ' ').trim() === 'M12 5v14 M5 12h14',
      labelShown,
      labelText: document.querySelector('#new-pair .ready-label').textContent,
      labelPlaced: labelShown && label.left >= 0 && label.top >= 0 && label.right <= window.innerWidth && label.bottom <= window.innerHeight && [...topRow, rect('#bar')].every((box) => !overlap(label, box)),
    };
  });

// Counts each start of the pop-up's animation, so a check can tell a new pop-up from one still
// fading from the click before.
const countPops = (page) =>
  page.evaluate(() => {
    window.__pops = 0;
    document.getElementById('score-change').addEventListener('animationstart', () => window.__pops++);
  });

// A filled dot's colour: the game's bright moss (--moss-bright, #6d9a4c).
const DOT_FILL = 'rgb(109, 154, 76)';
// A dot's fill fades in over 0.3 s after a find; waits (up to 5 s) until every filled dot shows
// its full colour, so a check reads the dots as the player sees them a moment later.
const dotsFilled = (page) =>
  waitFor(page, (fill) => [...document.querySelectorAll('#progress i.found')].every((dot) => getComputedStyle(dot).backgroundColor === fill), 5000, DOT_FILL).catch(() => {});

// Whether the "+100" / "-20" pop-up is really drawn: it fades in over a fraction of a second, so
// this waits (up to 3 s) for it to be displayed, visible, more than half opaque, with text, and
// at least 20 pixels each way.
const popSeen = (page) =>
  waitFor(
    page,
    () => {
      const pop = document.getElementById('score-change');
      const style = getComputedStyle(pop);
      const box = pop.getBoundingClientRect();
      // The text's own colour must not be see-through (rgba with alpha 0, or "transparent").
      const alpha = style.color.startsWith('rgba') ? Number(style.color.split(',').at(-1).replace(')', '')) : 1;
      const textShows = style.color !== 'transparent' && alpha > 0.5;
      return style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0.5 && textShows && pop.textContent.trim() !== '' && box.width >= 20 && box.height >= 20;
    },
    3000,
  )
    .then(() => true)
    .catch(() => false);

// For each difference, whether the trees on screen really show it: what the meshes hold, not
// the plan. An object is a visible mesh on its tree, at its place. A missing branch has every
// leaf of its bough drawn at size 0 and its bark tube shrunk to a line on its tree, and leaves
// and bark there on the other. A recoloured bough has most of its leaves in another colour than
// the same leaves on the other tree. Whether something in front hides a difference is not
// checked here (see farSide).
const drawnDifferences = (page) =>
  page.evaluate(async () => {
    const { branchSubtree } = await import(new URL('src/skeleton.js', location.href).href);
    const { Box3 } = await import('three');
    const { state, left, right } = window.treeAppreciator;
    const views = { left, right };
    const leafScale = (view, k) => Math.hypot(...view.leaves.instanceMatrix.array.slice(k * 16, k * 16 + 3));
    const leafColour = (view, k) => view.leaves.instanceColor.array.slice(k * 3, k * 3 + 3);
    // How wide the bark tube of `branch` is drawn: the largest gap between a ring's first vertex
    // and its others, over the branch's rings.
    const barkWidth = (view, branch) => {
      const position = view.bark.geometry.attributes.position.array;
      const { radial, firstVertex } = view.rings[branch];
      let widest = 0;
      for (let i = 0; i <= view.species.branches[branch].steps; i++) {
        const first = firstVertex + i * (radial + 1);
        for (let j = 1; j <= radial; j++) {
          const v = first + j;
          widest = Math.max(widest, Math.hypot(position[v * 3] - position[first * 3], position[v * 3 + 1] - position[first * 3 + 1], position[v * 3 + 2] - position[first * 3 + 2]));
        }
      }
      return widest;
    };
    // Shown in the scene: the object and every group above it are visible.
    const inScene = (object) => {
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    };
    const treeShown = (view) => inScene(view.bark) && inScene(view.leaves);
    // Every grown leaf is drawn on both trees: the renderer draws only the first leaves.count
    // instances, and the tree has data.leafCount leaves (how many its fullness trait allows).
    const allLeavesDrawn = [left, right].every((view) => view.leaves.count === view.data.leafCount) && left.data.leafCount === right.data.leafCount;
    const bothTreesShown = treeShown(left) && treeShown(right) && allLeavesDrawn;
    return state.pair.differences.map((d) => {
      if (!bothTreesShown) return { kind: d.kind, drawn: false, why: allLeavesDrawn ? 'a tree is hidden' : 'a tree draws fewer leaves than it has' };
      const own = views[d.tree];
      const other = views[d.tree === 'left' ? 'right' : 'left'];
      if (d.attach) {
        const target = [own.worldX + d.position[0], d.position[1], d.position[2]];
        // A mesh three.js really draws: visible itself, inside a visible prop, with a visible,
        // not see-through material and some geometry.
        const materialShows = (material) => [material].flat().some((m) => m.visible && (!m.transparent || m.opacity > 0.2));
        const hasMesh = (prop) => inScene(prop) && prop.children.some((mesh) => mesh.visible && materialShows(mesh.material) && mesh.geometry.attributes.position.count > 0);
        const atPlace = (prop) => {
          const box = new Box3().setFromObject(prop);
          const centre = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2];
          return Math.hypot(...centre.map((v, i) => v - target[i])) < d.radius;
        };
        // Built as the planned kind (a nest where a nest is planned), as well as drawn in place.
        const drawn = own.propsGroup.visible && own.propsGroup.children.some((prop) => prop.userData.kind === d.kind && prop.visible && hasMesh(prop) && atPlace(prop));
        return { kind: d.kind, drawn };
      }
      const onBough = branchSubtree(own.species, d.branch);
      const leaves = [];
      for (let k = 0; k < own.leaves.count; k++) if (onBough[own.species.leaves[k].branch]) leaves.push(k);
      if (d.kind === 'missingBranch') {
        const goneHere = leaves.every((k) => leafScale(own, k) === 0);
        const thereOnOther = leaves.filter((k) => leafScale(other, k) > 0).length;
        const branches = [...onBough.keys()].filter((b) => onBough[b]);
        const barkGoneHere = branches.every((b) => barkWidth(own, b) === 0);
        const barkOnOther = barkWidth(other, d.branch) > 0;
        const drawn = leaves.length > 0 && goneHere && thereOnOther >= 0.9 * leaves.length && barkGoneHere && barkOnOther;
        return { kind: d.kind, leaves: leaves.length, branches: branches.length, barkGoneHere, barkOnOther, drawn };
      }
      const shown = leaves.filter((k) => leafScale(own, k) > 0);
      const recoloured = shown.filter((k) => Math.hypot(...leafColour(own, k).map((v, i) => v - leafColour(other, k)[i])) > 0.02).length;
      return { kind: d.kind, leaves: shown.length, recoloured, drawn: shown.length > 0 && recoloured >= 0.5 * shown.length };
    });
  });

const scenarios = {
  async boot() {
    const page = await openPage();
    await playing(page);
    await shot(page, 'boot');
    const state = await page.evaluate(() => {
      const { left, right, state: game } = window.treeAppreciator;
      const { differences } = game.pair;
      const objects = differences.filter((d) => d.attach).length;
      return {
        kinds: differences.map((d) => d.kind),
        trees: differences.map((d) => d.tree),
        props: left.propsGroup.children.length + right.propsGroup.children.length,
        objects,
        propsVisible: left.propsGroup.visible && right.propsGroup.visible,
        sameSeed: left.species.seed === game.pair.seed && right.species.seed === game.pair.seed,
        // Both trees grow with the pair's own planned genes, not merely the same as each other.
        sameGenes: Object.keys(game.pair.genes).every((key) => left.genes[key] === game.pair.genes[key] && right.genes[key] === game.pair.genes[key]),
        progress: document.getElementById('progress').getAttribute('aria-label'),
        score: document.getElementById('score').textContent,
        // The screen readers' line: live, and not drawn (one pixel, clipped).
        // The js-toys arcade page, one folder up.
        backLink: document.getElementById('arcade').getAttribute('href') === '../index.html' && document.getElementById('arcade').getAttribute('aria-label') === 'Back to Arcade',
        announceLine: (() => {
          const line = document.getElementById('announce');
          const box = line.getBoundingClientRect();
          const style = getComputedStyle(line);
          // Hidden from the eye only: still in the page for screen readers.
          const readable = !line.closest('[aria-hidden="true"]') && style.display !== 'none' && style.visibility === 'visible';
          return readable && line.getAttribute('aria-live') === 'polite' && box.width <= 1 && box.height <= 1 && style.overflow === 'hidden';
        })(),
      };
    });
    const drawn = await drawnDifferences(page);
    // Each tree is really rendered: hiding it changes thousands of pixels of the picture. Both
    // pictures are rendered in one task, so the wind and the light are the same in each.
    const treePixels = await page.evaluate(async () => {
      const THREE = await import('three');
      const { world, left, right } = window.treeAppreciator;
      const { renderer, scene, camera } = world;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(size.x, size.y);
      const grab = () => {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(size.x * size.y * 4);
        renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, pixels);
        renderer.setRenderTarget(null);
        return pixels;
      };
      const counts = [left, right].map((view) => {
        const shown = grab();
        view.group.visible = false;
        const hidden = grab();
        view.group.visible = true;
        let changed = 0;
        for (let i = 0; i < shown.length; i += 4) if (Math.abs(shown[i] - hidden[i]) + Math.abs(shown[i + 1] - hidden[i + 1]) + Math.abs(shown[i + 2] - hidden[i + 2]) > 30) changed++;
        return changed;
      });
      target.dispose();
      return counts;
    });
    const ok =
      treePixels.every((count) => count > 2000) &&
      page.errors.length === 0 && page.outsideRequests.length === 0 && state.kinds.length === 3 && new Set(state.kinds).size === 3 &&
      state.props === state.objects && state.propsVisible && state.sameSeed && state.sameGenes && state.progress === '0 of 3 found' && state.score === '0' && state.announceLine && state.backLink &&
      drawn.every((d) => d.drawn);
    report('boot: one seed, the same traits, 3 differences of 3 kinds drawn, every request to the game server', ok, `${JSON.stringify(state)}; tree pixels ${JSON.stringify(treePixels)}; drawn ${JSON.stringify(drawn)}; errors ${JSON.stringify(page.errors)}; outside requests ${JSON.stringify(page.outsideRequests)}`);
  },

  async fallingLeaves() {
    // Leaves that fall are the same on both trees, so they are never an extra difference: each
    // falling leaf on the left tree has a twin on the right tree, the distance between the trunks
    // along, at the same height and depth, in the same colour.
    const page = await openPage();
    await playing(page);
    await waitFor(page, () => window.treeAppreciator.world.fallingLeaves.leaves.length >= 6, 120000);
    const leaves = await page.evaluate(() => window.treeAppreciator.world.fallingLeaves.leaves.map((leaf) => [leaf.x, leaf.y, leaf.z, leaf.landed, ...leaf.color]));
    const trunksApart = await page.evaluate(() => window.treeAppreciator.right.worldX - window.treeAppreciator.left.worldX);
    // Which tree a leaf fell from is told by its twin, not by the side of the middle it is on:
    // the trees stand so close that a crown can reach past the middle. A left tree's leaf has its
    // twin one trunk distance to the right, a right tree's leaf one to the left.
    const sameColour = (a, b) => a[4] === b[4] && a[5] === b[5] && a[6] === b[6];
    const twinAt = (leaf, shift) => leaves.some((other) => Math.abs(other[0] - leaf[0] - shift) < 1e-6 && other[1] === leaf[1] && other[2] === leaf[2] && other[3] === leaf[3] && sameColour(leaf, other));
    const onLeft = leaves.filter((leaf) => twinAt(leaf, trunksApart));
    const onRight = leaves.filter((leaf) => twinAt(leaf, -trunksApart));
    const withoutTwin = leaves.filter((leaf) => !twinAt(leaf, trunksApart) && !twinAt(leaf, -trunksApart)).length;
    // A new pair stands somewhere else: the leaves of the last pair are gone, and the new pair's
    // leaves are twins at its own trunk distance.
    const newPairTwins = async () => {
      await page.keyboard.press('n');
      await playing(page);
      await waitFor(page, () => window.treeAppreciator.world.fallingLeaves.leaves.length >= 2, 120000);
      return page.evaluate(() => {
        const { left, right, world } = window.treeAppreciator;
        const apart = right.worldX - left.worldX;
        const all = world.fallingLeaves.leaves;
        const sameColour = (a, b) => a.color.every((value, c) => value === b.color[c]);
        const twinAt = (leaf, shift) => all.some((other) => Math.abs(other.x - leaf.x - shift) < 1e-6 && other.y === leaf.y && other.z === leaf.z && sameColour(leaf, other));
        const leftLeaves = all.filter((leaf) => twinAt(leaf, apart));
        const rightLeaves = all.filter((leaf) => twinAt(leaf, -apart));
        const unmatched = all.filter((leaf) => !twinAt(leaf, apart) && !twinAt(leaf, -apart)).length;
        // Every leaf in the simulation is also drawn: one instance each.
        return { count: all.length, drawn: world.fallingLeaves.mesh.count, unmatched, sides: [leftLeaves.length, rightLeaves.length] };
      });
    };
    // A leaf of a recoloured bough has another colour on one tree, so it must not fall at all;
    // an ordinary leaf falls from both. Rare by chance, so asked for directly.
    let dropped = null;
    for (let pair = 0; pair < 12 && !dropped; pair++) {
      if (pair > 0) {
        await page.keyboard.press('n');
        await playing(page);
        await waitFor(page, () => window.treeAppreciator.left.growth >= 1 && window.treeAppreciator.right.growth >= 1);
      }
      dropped = await page.evaluate(() => {
        const { state, left, right, world } = window.treeAppreciator;
        const colour = (view, k) => [0, 1, 2].map((c) => view.data.leafColors[k * 3 + c]).join();
        const shown = (view, k) => Math.hypot(...view.data.leafMatrices.slice(k * 16, k * 16 + 3)) > 0.01;
        let tinted = -1;
        let plain = -1;
        for (let k = 0; k < left.data.leafCount; k++) {
          if (!shown(left, k) || !shown(right, k)) continue;
          if (colour(left, k) !== colour(right, k)) tinted = tinted < 0 ? k : tinted;
          else plain = plain < 0 ? k : plain;
        }
        if (tinted < 0 || plain < 0) return null;
        const leaves = world.fallingLeaves.leaves;
        leaves.length = 0;
        world.fallingLeaves.spawnFrom([left, right], tinted);
        const afterTinted = leaves.length;
        world.fallingLeaves.spawnFrom([left, right], plain);
        return { kinds: state.pair.differences.map((d) => d.kind), afterTinted, afterPlain: leaves.length };
      });
    }
    const tintedKept = dropped !== null && dropped.afterTinted === 0 && dropped.afterPlain === 2;
    // The two leaves just dropped are still lying where this pair stands when the next pair moves in.
    const next = await newPairTwins();
    const nextTwins = next.unmatched === 0 && next.sides[0] === next.sides[1] && next.drawn === next.count;
    const ok = onLeft.length > 0 && onLeft.length === onRight.length && withoutTwin === 0 && tintedKept && nextTwins;
    report('falling leaves are the same on both trees, also after a new pair stands elsewhere', ok, JSON.stringify({ left: onLeft.length, right: onRight.length, withoutTwin, dropped, next }));
  },

  async everyKindDrawn() {
    // New pairs until each of the seven kinds has come up: every one is drawn on the trees.
    // Pairs are random, and an autumn bough, the rarest kind, comes up in about 1 pair in 8. In a
    // simulation of 300 runs, a run of 12 pairs missed some kind in 40 runs, and a run of 40 pairs
    // in 2 runs, so this scenario fails without a fault about 1 time in 150. The loop stops as soon
    // as all seven came up; a kind that never did is reported as that, not as a drawing fault.
    const page = await openPage();
    const kinds = new Map();
    let pairs = 0;
    for (; pairs < 40 && kinds.size < 7; pairs++) {
      if (pairs > 0) await page.keyboard.press('n');
      await playing(page);
      await waitFor(page, () => window.treeAppreciator.left.growth >= 1 && window.treeAppreciator.right.growth >= 1);
      for (const result of await drawnDifferences(page)) {
        if (!kinds.has(result.kind) || !result.drawn) kinds.set(result.kind, result);
      }
    }
    const results = [...kinds.values()];
    const neverCameUp = ['bird', 'nest', 'fruit', 'lantern', 'blossomBough', 'autumnBough', 'missingBranch'].filter((kind) => !kinds.has(kind));
    const detail = neverCameUp.length > 0 ? `never came up in ${pairs} pairs: ${neverCameUp.join(', ')}; ` : `${pairs} pairs; `;
    report('every kind of difference is drawn on the trees', neverCameUp.length === 0 && results.every((r) => r.drawn), detail + JSON.stringify(results));
  },

  async clickFinds() {
    // Click every difference (the second on the tree that has it, the first and third on the other tree):
    // each is found once, ringed on both trees, fills a dot and scores 100, and finding all three
    // ends the round. A miss after the first find costs 20. The score stays for the next pair.
    const page = await openPage();
    await playing(page);
    await countPops(page);
    await page.evaluate(() => {
      const sound = window.treeAppreciator.sound;
      window.__answerSounds = [];
      for (const name of ['correct', 'win']) {
        const play = sound[name].bind(sound);
        sound[name] = (...args) => {
          window.__answerSounds.push(name);
          return play(...args);
        };
      }
    });
    const progress = [];
    let afterMiss = null;
    for (let index = 0; index < 3; index++) {
      await faceDifference(page, index);
      const point = await differencePoint(page, index, index !== 1);
      await page.mouse.click(point.x, point.y);
      const seen = await popSeen(page);
      await dotsFilled(page);
      progress.push({ index, kind: point.kind, seen, ...(await readGame(page)), ...(await popAndReady(page)), answerSounds: await page.evaluate(() => [...window.__answerSounds]) });
      if (index === 0) {
        await page.mouse.click(640, 140);
        afterMiss = { seen: await popSeen(page), ...(await readGame(page)), ...(await popAndReady(page)) };
      }
    }
    const scores = ['100', '180', '280'];
    const missCost = afterMiss.misses === 1 && afterMiss.score === '80' && afterMiss.scoreChange === '-20' && afterMiss.seen && afterMiss.pops === 2 && afterMiss.popLoss && afterMiss.popTone === 'loss' && afterMiss.popNearMiddle && afterMiss.popClearOfTopRow && afterMiss.announced === 'Miss. Score 80.';
    // Every find so far, in order, at its place: a later find never overwrote an earlier one.
    const order = progress.map((step) => step.index);
    await faceDifference(page, 0);
    const again = await differencePoint(page, 0);
    const finalState = await readGame(page);
    // Clicking a found difference once more changes nothing (the round is over, so it is ignored):
    // no count, no new pop-up or announcement, and New pair still asks to be pressed. Game time
    // passes first, so a wrong pop-up would have started.
    await page.mouse.click(again.x, again.y);
    await gameSeconds(page, 1);
    const afterAgain = { ...(await readGame(page)), ...(await popAndReady(page)) };
    const ignored =
      afterAgain.pops === progress[2].pops && afterAgain.announcedRaw === progress[2].announcedRaw && afterAgain.ready && afterAgain.labelShown &&
      afterAgain.result === finalState.result && afterAgain.ringsAtFinds && afterAgain.rings.join() === finalState.rings.join();
    const labels = await page.evaluate(() => window.treeAppreciator.state.pair.differences.map((d) => d.label));
    const ok =
      progress.every((step, i) => step.found.join() === order.slice(0, i + 1).join() && step.seen && step.pops === [1, 3, 4][i] && step.progress === `${i + 1} of 3 found` && step.dots === i + 1 && step.score === scores[i] && step.scoreChange === '+100' && !step.popLoss && step.popTone === 'gain' && step.popNearMiddle && step.popClearOfTopRow && step.ready === (i === 2) && step.readyGreen === (i === 2) && step.labelShown === (i === 2) && step.scoreboardShown && step.plusIcon && step.plusShown && step.answerSounds.join() === ['correct', 'correct', 'win'].slice(0, i + 1).join() &&
          (i === 2 ? step.announced.startsWith(`Found 3 of 3. Score 280.`) && step.announced.endsWith('Press New pair for another.') && step.pulse === 'ready-pulse' : step.announced === `Found ${i + 1} of 3. Score ${scores[i]}.`) &&
          step.rings[0] === i + 1 && step.rings[1] === i + 1 && step.ringsAtFinds) &&
      finalState.phase === 'done' && finalState.hintDisabled && finalState.result === `All 3 noticed: ${labels[0]}, ${labels[1]} and ${labels[2]}.` &&
      afterAgain.misses === 1 && afterAgain.found.length === 3 && afterAgain.score === '280' && ignored && missCost;
    // The New pair button itself starts the next pair: the seed changes and play starts again.
    const oldSeed = await page.evaluate(() => window.treeAppreciator.state.pair.seed);
    await page.click('#new-pair');
    const rightAfterPress = await popAndReady(page);
    await waitFor(page, (seed) => window.treeAppreciator.state.pair.seed !== seed && window.treeAppreciator.state.phase === 'playing', 120000, oldSeed);
    const nextPair = { ...(await readGame(page)), ...(await popAndReady(page)) };
    const internalScore = await page.evaluate(() => window.treeAppreciator.state.score);
    await faceDifference(page, 0);
    const first = await differencePoint(page, 0);
    await page.mouse.click(first.x, first.y);
    const firstFindNext = await readGame(page);
    const kept =
      nextPair.announced === 'New pair. Find the 3 differences.' && nextPair.score === '280' && internalScore === 280 && nextPair.dots === 0 && nextPair.progress === '0 of 3 found' &&
      !nextPair.ready && !nextPair.labelShown && !rightAfterPress.ready && !rightAfterPress.labelShown && !rightAfterPress.popShowing && rightAfterPress.popOpacity < 0.05 &&
      // Drawn as before the round ended: no pulse, not the green it had while ready.
      rightAfterPress.pulse === 'none' && rightAfterPress.buttonBackground === progress[0].buttonBackground && rightAfterPress.buttonBackground !== progress[2].buttonBackground && firstFindNext.score === '380' && firstFindNext.dots === 1;
    const doneLabel = progress[2].labelPlaced && progress[2].labelText === 'New pair';
    report('clicking each difference, on either tree, finds it once, rings it on both trees, scores 100 (shown in the middle; a miss costs 20), and ends the round with New pair asking to be pressed; the score stays for the next pair', ok && kept && doneLabel, JSON.stringify({ progress, afterMiss, finalState, afterAgain, rightAfterPress, nextPair, internalScore, firstFindNext }));
  },

  async doneFits() {
    // When the round is done the result line makes the bar taller; the trees are fitted again
    // above it. Checked on a phone held sideways, where the bar is tallest for the screen, and on
    // an upright phone, where the result wraps. The fit is sized for the front view, as when a
    // pair is planted, so the camera is turned back to the front before measuring: from the
    // side the trees stand one behind the other and the nearer one reaches lower on the screen.
    // The upright phone asks for reduced motion: the ready button then shows a steady ring with
    // no pulse, and the pop-up fades without rising.
    const problems = [];
    const seen = [];
    for (const [width, height] of [[568, 320], [390, 844]]) {
      const page = await openPage({ width, height });
      const reducedMotion = width === 390;
      if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await playing(page);
      for (let index = 0; index < 3; index++) {
        await faceDifference(page, index);
        const point = await differencePoint(page, index);
        await page.mouse.click(point.x, point.y);
      }
      const popShown = await popSeen(page);
      await dotsFilled(page);
      const motion = await popAndReady(page);
      if (!motion.resultShown) problems.push(`${width}x${height}: the result line is not drawn`);
      const backClear = await page.evaluate(() => {
        const a = document.getElementById('arcade').getBoundingClientRect();
        const b = document.getElementById('result').getBoundingClientRect();
        return Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 0.5 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 0.5;
      });
      if (!backClear) problems.push(`${width}x${height}: the Back to Arcade button over the result line`);
      if (!popShown || !motion.popNearMiddle || !motion.popClearOfTopRow || !motion.scoreboardShown) problems.push(`${width}x${height}: pop-up or scoreboard not shown in place ${JSON.stringify({ popShown, middle: motion.popNearMiddle, clear: motion.popClearOfTopRow, scoreboard: motion.scoreboardShown })}`);
      const expected = reducedMotion ? { pulse: 'none', pop: 'score-fade' } : { pulse: 'ready-pulse', pop: 'score-pop' };
      const steadyRing = !reducedMotion || motion.buttonShadow.includes('rgba(109, 154, 76, 0.6)');
      if (motion.pulse !== expected.pulse || motion.popAnimation !== expected.pop || !steadyRing) problems.push(`${width}x${height}: motion ${JSON.stringify({ pulse: motion.pulse, pop: motion.popAnimation, shadow: motion.buttonShadow })}`);
      const state = await readGame(page);
      const ready = await popAndReady(page);
      if (!ready.ready || !ready.labelPlaced) problems.push(`${width}x${height}: New pair label missing, off screen or over the top row or the bottom`);
      await gameSeconds(page, 4);
      await page.evaluate(() => {
        const { camera, controls } = window.treeAppreciator.world;
        const offset = camera.position.clone().sub(controls.target);
        const across = Math.hypot(offset.x, offset.z);
        camera.position.set(controls.target.x, camera.position.y, controls.target.z + across);
        controls.update();
      });
      await gameSeconds(page, 1);
      const barTop = await page.evaluate(() => document.getElementById('bar').getBoundingClientRect().top);
      const boxes = await treeScreenBoxes(page);
      const lowestBase = Math.max(...boxes.map((b) => b.baseY));
      // The finds dismissed the guide, so the crowns must stay below the scoreboard.
      const scoreboardBottom = await page.evaluate(() => document.getElementById('scoreboard').getBoundingClientRect().bottom);
      const highestTop = Math.min(...boxes.map((b) => b.topY));
      if (highestTop < scoreboardBottom - 6) problems.push(`${width}x${height}: a crown under the scoreboard`);
      seen.push({ size: `${width}x${height}`, phase: state.phase, barTop: Math.round(barTop), lowestBase: Math.round(lowestBase), highestTop: Math.round(highestTop), scoreboardBottom: Math.round(scoreboardBottom) });
      if (state.phase !== 'done') problems.push(`${width}x${height}: round not done`);
      if (lowestBase > barTop + 6) problems.push(`${width}x${height}: a tree under the bar`);
    }
    report('when a round is done, the trees are fitted above the taller bar, the New pair label is on screen and clear, and reduced motion stops the pulse', problems.length === 0, JSON.stringify({ problems, seen }));
  },

  async closeTrees() {
    // Each pair stands as close as its crowns allow: the trunks evenly either side of the middle,
    // and the crowns' facing edges (branches plus leaf blades, 0.24 past them) 0.4 apart, or more
    // where an object of a difference reaches further. Checked over five pairs.
    const page = await openPage();
    const pairs = [];
    for (let n = 0; n < 5; n++) {
      if (n > 0) await page.keyboard.press('n');
      await waitFor(page, (count) => window.treeAppreciator.state.pairCount === count && window.treeAppreciator.state.phase === 'playing', 120000, n + 1);
      pairs.push(
        await page.evaluate(() => {
          const { left, right, state } = window.treeAppreciator;
          const leftEdge = left.grownBounds().maxX + 0.24;
          const rightEdge = right.grownBounds().minX - 0.24;
          // Objects reach to their click radius; the facing edge is the furthest of crown and objects.
          const objectsLeft = state.pair.differences.filter((d) => d.attach && d.tree === 'left').map((d) => left.worldX + d.position[0] + d.radius);
          const objectsRight = state.pair.differences.filter((d) => d.attach && d.tree === 'right').map((d) => right.worldX + d.position[0] - d.radius);
          const leftFacing = Math.max(leftEdge, ...objectsLeft);
          const rightFacing = Math.min(rightEdge, ...objectsRight);
          const objectOnInside = leftFacing > leftEdge || rightFacing < rightEdge;
          return { seed: state.pair.seed, trunks: [left.worldX, right.worldX], gap: rightEdge - leftEdge, facingGap: rightFacing - leftFacing, objectOnInside };
        }),
      );
    }
    const wrong = pairs.filter((pair) => {
      const even = Math.abs(pair.trunks[0] + pair.trunks[1]) < 1e-9;
      // The furthest-reaching edges, objects included, are exactly the gap apart.
      const apart = pair.gap >= 0.4 - 1e-6 && Math.abs(pair.facingGap - 0.4) < 1e-6;
      const close = pair.objectOnInside || pair.gap <= 0.4 + 1e-6;
      return !(even && apart && close);
    });
    report('each pair stands as close as its crowns allow, 0.4 apart, never touching', wrong.length === 0, JSON.stringify(pairs.map((pair) => ({ ...pair, trunks: pair.trunks.map((x) => Number(x.toFixed(2))), gap: Number(pair.gap.toFixed(3)), facingGap: Number(pair.facingGap.toFixed(3)) }))));
  },

  async foundAgain() {
    const page = await openPage();
    await playing(page);
    await faceDifference(page, 1);
    const point = await differencePoint(page, 1);
    await countPops(page);
    await page.mouse.click(point.x, point.y);
    // The first find's pop-up has started before its count is read, and the second click gets a
    // moment of game time in which a wrong pop-up would start.
    const firstSeen = await popSeen(page);
    const first = await readGame(page);
    await page.mouse.click(point.x, point.y);
    await gameSeconds(page, 1);
    const state = await readGame(page);
    // The second click changes nothing at all: no new pop-up, no new announcement, the same rings.
    const unchanged = state.pops === first.pops && state.announcedRaw === first.announcedRaw && state.ringsAtFinds && state.rings.join() === first.rings.join();
    report('clicking a found difference again is neither a second find nor a miss, and changes nothing on screen', first.found.length === 1 && firstSeen && first.pops === 1 && unchanged && state.found.length === 1 && state.misses === 0 && state.progress === '1 of 3 found' && state.score === '100', JSON.stringify({ first, state }));
  },

  async misses() {
    const page = await openPage();
    await playing(page);
    // Sky, and open grass between the trees and the bar.
    await countPops(page);
    await page.mouse.click(640, 140);
    const missAtZeroSeen = await popSeen(page);
    const firstMiss = { ...(await readGame(page)), ...(await popAndReady(page)) };
    await page.mouse.click(640, 600);
    const secondMissSeen = await popSeen(page);
    const afterClicks = await readGame(page);
    // The same message twice must still change the live line, or a screen reader stays silent.
    const repeatHeard = afterClicks.announced === 'Miss. Score 0.' && afterClicks.announcedRaw !== firstMiss.announcedRaw;
    // Each miss starts the pop-up again, not only the first.
    const repeatShown = firstMiss.pops === 1 && afterClicks.pops === 2 && secondMissSeen;
    // A drag turns the camera: it is not a click, so it is not a miss, and it moves the view.
    const before = await page.evaluate(() => window.treeAppreciator.world.controls.getAzimuthalAngle());
    await page.mouse.move(500, 300);
    await page.mouse.down();
    await page.mouse.move(600, 300, { steps: 6 });
    await page.mouse.up();
    await gameSeconds(page, 1);
    const afterDrag = await readGame(page);
    const turned = await page.evaluate((angle) => Math.abs(window.treeAppreciator.world.controls.getAzimuthalAngle() - angle), before);
    // A drag that goes out and comes back to where it started, quicker than a click may last, is
    // still a drag. The browser can be slow to deliver the events, so the press's length is read
    // from the page and the drag repeated until one is quick enough to be taken for a click.
    await page.evaluate(() => {
      const canvas = window.treeAppreciator.world.renderer.domElement;
      canvas.addEventListener('pointerdown', (event) => (window.__pressStart = event.timeStamp));
      canvas.addEventListener('pointerup', (event) => (window.__pressLength = event.timeStamp - window.__pressStart));
    });
    let outAndBack = null;
    for (let attempt = 0; attempt < 4 && !outAndBack; attempt++) {
      await page.mouse.move(500, 300);
      await page.mouse.down();
      await page.mouse.move(600, 300);
      await page.mouse.move(500, 300);
      await page.mouse.up();
      await pause(100);
      const pressLength = await page.evaluate(() => window.__pressLength);
      if (pressLength < 450) outAndBack = { pressLength, ...(await readGame(page)) };
    }
    // Not a miss, and not a find either: the round is as the earlier drag left it.
    // A drag that ends over the scoreboard: the scene keeps the pointer, so the press ends there
    // and the next click on the sky still counts (as a miss).
    const board = await page.evaluate(() => {
      const box = document.getElementById('scoreboard').getBoundingClientRect();
      return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    });
    const beforeOffDrag = await readGame(page);
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await page.mouse.move(board.x, board.y, { steps: 6 });
    await page.mouse.up();
    await gameSeconds(page, 1);
    await page.mouse.click(640, 140);
    const afterOffDrag = await readGame(page);
    const offDragThenClick = afterOffDrag.misses === beforeOffDrag.misses + 1;
    const outAndBackNoMiss = outAndBack !== null && outAndBack.misses === 2 && outAndBack.found.length === afterDrag.found.length && outAndBack.score === afterDrag.score;
    // At a score of 0 a miss costs nothing: the score never goes below 0.
    const ok = afterClicks.misses === 2 && afterClicks.score === '0' && afterClicks.scoreChange === 'Miss' && missAtZeroSeen && offDragThenClick && firstMiss.misses === 1 && firstMiss.scoreChange === 'Miss' && firstMiss.announced === 'Miss. Score 0.' && firstMiss.popLoss && firstMiss.popTone === 'loss' && firstMiss.popNearMiddle && firstMiss.popClearOfTopRow && repeatHeard && repeatShown && afterClicks.found.length === 0 && afterDrag.misses === 2 && turned > 0.05 && outAndBackNoMiss;
    report('a click at no difference is a miss; a drag is not, even one that comes back, and turns the trees', ok, JSON.stringify({ firstMiss, afterClicks, missAtZeroSeen, offDragThenClick, afterDrag, turned, outAndBack }));
  },

  async guide() {
    // The guide banner stays up while the trees grow, goes once the player scrolls on the trees
    // during play, stays gone for the next pair, which is framed with only the scoreboard at the
    // top, and is back
    // after a reload. There it goes when a press held from the growing ends in play, and, after
    // another reload, as soon as a press starts in play. The bar's empty result line takes no room.
    const page = await openPage();
    const guideState = () =>
      page.evaluate(() => {
        const banner = document.getElementById('banner');
        const share = banner.getBoundingClientRect().bottom / window.innerHeight;
        const scoreboardShare = document.getElementById('scoreboard').getBoundingClientRect().bottom / window.innerHeight;
        return { scoreboardShare, dismissed: banner.classList.contains('dismissed'), visibility: getComputedStyle(banner).visibility, share, phase: window.treeAppreciator?.state.phase };
      });
    // Records how much of the top each later framing leaves to the banner. The first pair was
    // framed before this runs, with the banner's share of the screen (atStart.share).
    await page.evaluate(() => {
      const world = window.treeAppreciator.world;
      const frameBounds = world.frameBounds;
      window.__covers = [];
      world.frameBounds = (bounds, elapsed, covers) => {
        window.__covers.push(covers);
        return frameBounds(bounds, elapsed, covers);
      };
    });
    // The fade takes 0.6 s; a page drawn on the CPU can take longer to apply it.
    const fadeDone = () => waitFor(page, () => getComputedStyle(document.getElementById('banner')).visibility === 'hidden', 10000).catch(() => {});
    await page.mouse.click(640, 140);
    const whileGrowing = await guideState();
    await playing(page);
    const atStart = await guideState();
    // How far the drawn picture is shifted up, in pixels, once the framing has settled: the
    // camera's view offset, which the renderer draws with. A cover at the top shifts it down by
    // half the cover's height. (The trees' own place on the screen was tried instead; it varies
    // by about 90 pixels from one random pair to the next, more than this shift.)
    const pictureShift = async () => {
      await gameSeconds(page, 3);
      return page.evaluate(() => window.treeAppreciator.world.camera.view.offsetY);
    };
    // What the guide adds below the scoreboard, which stays.
    const guideExtra = (atStart.share - atStart.scoreboardShare) * 800;
    const shiftWithBanner = await pictureShift();
    // The bottom holder's height beyond the Hint button: none while the result line is empty.
    const barAboveRow = await page.evaluate(() => document.getElementById('bar').getBoundingClientRect().height - document.getElementById('hint').getBoundingClientRect().height);
    await page.mouse.move(640, 300);
    await page.mouse.wheel({ deltaY: 100 });
    await fadeDone();
    const afterWheel = await guideState();
    await page.keyboard.press('n');
    await playing(page);
    const nextPair = await guideState();
    const tops = await page.evaluate(() => window.__covers.map((covers) => covers.top));
    // The bar and the scoreboard are the same for both pairs, so the picture of the next pair is
    // shifted up by half of what the guide added (44 pixels at this size).
    const shiftWithoutBanner = await pictureShift();
    await page.reload({ waitUntil: 'networkidle0' });
    // The page's clock is held still during this press, so its length reads as 0: only the rule
    // that a click must start during play keeps it from counting as a click (a miss on the sky).
    await page.evaluate(() => {
      const frozen = performance.now();
      window.__realNow = performance.now.bind(performance);
      performance.now = () => frozen;
    });
    await page.mouse.move(640, 140);
    await page.mouse.down();
    const pressedWhileGrowing = await guideState();
    await playing(page);
    const heldIntoPlay = await guideState();
    await page.mouse.up();
    await page.evaluate(() => (performance.now = window.__realNow));
    await fadeDone();
    const afterRelease = await guideState();
    // The held press was not a click: no miss, no score change.
    const heldNotClick = await readGame(page);
    await page.reload({ waitUntil: 'networkidle0' });
    await playing(page);
    const afterReload = await guideState();
    await page.mouse.down();
    const afterPress = await guideState();
    await page.mouse.up();
    const shownWhileGrowing = whileGrowing.phase === 'growing' && !whileGrowing.dismissed;
    const shownAtStart = !atStart.dismissed && atStart.visibility === 'visible';
    const goneAfterWheel = afterWheel.dismissed && afterWheel.visibility === 'hidden';
    const goneNextPair = nextPair.dismissed && nextPair.visibility === 'hidden';
    const framedFree = guideExtra > 40 && tops.length >= 1 && Math.abs(tops.at(-1) - nextPair.scoreboardShare) < 0.001;
    const centredInFreeSpace = Math.abs(shiftWithoutBanner - shiftWithBanner - guideExtra / 2) < 3;
    const heldPress = pressedWhileGrowing.phase === 'growing' && !heldIntoPlay.dismissed && afterRelease.dismissed && afterRelease.visibility === 'hidden' && heldNotClick.misses === 0 && heldNotClick.score === '0' && heldNotClick.scoreChange === '';
    const backAfterReload = !afterReload.dismissed && afterReload.visibility === 'visible';
    const ok = shownWhileGrowing && shownAtStart && barAboveRow <= 0.5 && goneAfterWheel && goneNextPair && framedFree && centredInFreeSpace && heldPress && backAfterReload && afterPress.dismissed;
    report('the guide shows until the first scroll or press on the trees, stays gone for the next pair, and is back after a reload', ok, JSON.stringify({ whileGrowing, atStart, barAboveRow, afterWheel, nextPair, tops, shiftWithBanner, shiftWithoutBanner, pressedWhileGrowing, heldIntoPlay, afterRelease, heldNotClick, afterReload, afterPress }));
  },

  async turnsAround() {
    // The camera can go all the way round, so the far side can be looked at. Drags in one
    // direction add up past a full turn; the angle the controls report wraps at half a turn, so
    // each drag's step is unwrapped (one drag turns less than half a turn).
    const page = await openPage();
    await playing(page);
    await gameSeconds(page, 3);
    const steps = [];
    let turned = 0;
    let angle = await azimuth(page);
    for (let drag = 0; drag < 8 && Math.abs(turned) < 2 * Math.PI + 0.2; drag++) {
      await dragRight(page);
      const next = await azimuth(page);
      const step = Math.atan2(Math.sin(next - angle), Math.cos(next - angle));
      steps.push(Number(step.toFixed(2)));
      turned += step;
      angle = next;
    }
    const oneWay = steps.every((step) => Math.sign(step) === Math.sign(steps[0]));
    report('drags in one direction turn the camera all the way round', oneWay && Math.abs(turned) > 2 * Math.PI, `steps ${JSON.stringify(steps)}, total ${turned.toFixed(2)} rad`);
  },

  async farSide() {
    // A difference on the far side of its tree from the starting view: the player drags round
    // to its side (real drags, not a camera move) and finds it there.
    const page = await openPage();
    await playing(page);
    let far = -1;
    for (let pair = 0; pair < 6 && far < 0; pair++) {
      if (pair > 0) {
        await page.keyboard.press('n');
        await playing(page);
      }
      for (let index = 0; index < 3 && far < 0; index++) if (await behindNow(page, index)) far = index;
    }
    if (far < 0) {
      report('a difference on the far side is found after dragging round to it', false, 'no pair in 6 had a difference on the far side');
      return;
    }
    let drags = 0;
    while (drags < 6 && (await behindNow(page, far))) {
      await dragRight(page);
      drags++;
    }
    // Clicks through the crown count too, so check the drags really brought the camera round.
    const reachedItsSide = !(await behindNow(page, far));
    const point = await differencePoint(page, far);
    await page.mouse.click(point.x, point.y);
    const afterTurn = await readGame(page);
    const ok = drags > 0 && reachedItsSide && afterTurn.found.includes(far) && afterTurn.misses === 0;
    report('a difference on the far side is found after dragging round to it', ok, JSON.stringify({ far, drags, reachedItsSide, afterTurn }));
  },

  async hint() {
    const page = await openPage();
    await playing(page);
    await page.click('#hint');
    const shown = await page.evaluate(() => {
      const { state, left, right } = window.treeAppreciator;
      const rings = [...left.markerRings, ...right.markerRings].filter((ring) => ring.userData.pulse);
      const near = rings.every((ring) => state.pair.differences.some((d) => Math.hypot(...d.position.map((v, i) => v - ring.position.toArray()[i])) <= d.radius * 1.2));
      return { rings: rings.length, near, misses: state.round.misses, hint: Boolean(state.hint) };
    });
    // The hint fades after a few seconds.
    await gameSeconds(page, 6);
    const gone = await page.evaluate(() => ({ hint: Boolean(window.treeAppreciator.state.hint), rings: window.treeAppreciator.left.ringsGroup.children.length + window.treeAppreciator.right.ringsGroup.children.length }));
    // A hint at difference 0 (the first open one, for a random draw of 0) goes away when 0 is found.
    await page.evaluate(() => {
      const random = Math.random;
      Math.random = () => 0;
      try {
        document.getElementById('hint').click();
      } finally {
        Math.random = random;
      }
    });
    const hintedFirst = await page.evaluate(() => window.treeAppreciator.state.hint?.index);
    await faceDifference(page, 0);
    const first = await differencePoint(page, 0);
    await page.mouse.click(first.x, first.y);
    const afterFindingHinted = await page.evaluate(() => ({ found: [...window.treeAppreciator.state.round.found], hint: Boolean(window.treeAppreciator.state.hint), pulses: [...window.treeAppreciator.left.markerRings].filter((ring) => ring.userData.pulse).length }));
    const hintClears = hintedFirst === 0 && afterFindingHinted.found.includes(0) && !afterFindingHinted.hint && afterFindingHinted.pulses === 0;
    // Find two of the three (0 is found already); then every hint, whatever the random draw, points at the third.
    for (const index of [0, 1]) {
      await faceDifference(page, index);
      const point = await differencePoint(page, index);
      await page.mouse.click(point.x, point.y);
    }
    const afterFinds = [];
    for (const draw of [0, 0.5, 0.99]) {
      afterFinds.push(
        await page.evaluate((value) => {
          const { state } = window.treeAppreciator;
          const random = Math.random;
          Math.random = () => value;
          try {
            document.getElementById('hint').click();
          } finally {
            Math.random = random;
          }
          const open = [0, 1, 2].filter((index) => !state.round.found.includes(index));
          const target = state.pair.differences[state.hint.index];
          const near = Math.hypot(...target.position.map((v, i) => v - state.hint.position[i])) <= target.radius;
          return { found: [...state.round.found], hinted: state.hint.index, open, near };
        }, draw),
      );
    }
    const onlyOpen = afterFinds.every((step) => step.found.length === 2 && step.open.length === 1 && step.hinted === step.open[0] && step.near);
    const ok = shown.rings === 2 && shown.near && shown.misses === 0 && shown.hint && !gone.hint && gone.rings === 0 && hintClears && onlyOpen;
    report('Hint rings an area near a difference that is not found, costs no miss, fades, and goes when that difference is found', ok, JSON.stringify({ shown, gone, hintedFirst, afterFindingHinted, afterFinds }));
  },

  async newPair() {
    const page = await openPage();
    await playing(page);
    const describe = () =>
      page.evaluate(() => {
        const { state, left, right } = window.treeAppreciator;
        return {
          seed: state.pair.seed,
          sameSeed: left.species.seed === state.pair.seed && right.species.seed === state.pair.seed,
          plannedGenes: Object.keys(state.pair.genes).every((key) => left.genes[key] === state.pair.genes[key] && right.genes[key] === state.pair.genes[key]),
          kinds: state.pair.differences.map((d) => d.kind),
          props: left.propsGroup.children.length + right.propsGroup.children.length,
          objects: state.pair.differences.filter((d) => d.attach).length,
          found: state.round.found.length,
          rings: left.ringsGroup.children.length + right.ringsGroup.children.length,
          result: document.getElementById('result').textContent,
        };
      });
    const first = await describe();
    for (let index = 0; index < 3; index++) {
      await faceDifference(page, index);
      const point = await differencePoint(page, index);
      await page.mouse.click(point.x, point.y);
    }
    await page.keyboard.press('Space');
    // Two quick presses and then a click while the trees are changing: each press starts a pair
    // (the second replaces the first before it has grown), the click is ignored until the new
    // pair has grown, and the pair planted is the second one.
    const afterFirstPress = await page.evaluate(() => window.treeAppreciator.state.pair.seed);
    await page.keyboard.press('Space');
    const afterSecondPress = await page.evaluate(() => window.treeAppreciator.state.pair.seed);
    await page.mouse.click(640, 400);
    const early = await readGame(page);
    await playing(page);
    await waitFor(page, () => window.treeAppreciator.right.growth >= 1 && window.treeAppreciator.left.growth >= 1);
    const second = await describe();
    const bothPressesCounted = afterFirstPress !== first.seed && afterSecondPress !== afterFirstPress && second.seed === afterSecondPress;
    const ok =
      early.phase === 'growing' && early.misses === 0 && bothPressesCounted && second.sameSeed && second.plannedGenes && second.found === 0 && second.rings === 0 && second.result === '' &&
      second.props === second.objects && second.kinds.length === 3;
    report('New pair, even twice, brings one consistent fresh pair, clears the rings, and ignores clicks while growing', ok, JSON.stringify({ first, afterFirstPress, afterSecondPress, early, second }));
  },

  async keyboard() {
    const page = await openPage();
    await playing(page);
    const state = () => page.evaluate(() => ({ seed: window.treeAppreciator.state.pair.seed, hint: Boolean(window.treeAppreciator.state.hint), muted: document.getElementById('mute').classList.contains('muted'), soundMuted: window.treeAppreciator.sound.muted }));
    const start = await state();
    await page.keyboard.press('h');
    const hinted = await state();
    await page.keyboard.down('Control');
    await page.keyboard.press('n');
    await page.keyboard.up('Control');
    const ctrl = await state();
    await page.keyboard.press('m');
    const muted = await state();
    // Keyboard layouts where the typed character is no Latin letter: the physical key counts.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '\u044c', code: 'KeyM', bubbles: true })));
    const unmuted = await state();
    // Composition events are ignored.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'KeyN', keyCode: 229, bubbles: true })));
    const composing = await state();
    await page.keyboard.press('n');
    await playing(page);
    const fresh = await state();
    const ok = hinted.hint && ctrl.seed === start.seed && muted.muted && muted.soundMuted && !unmuted.muted && composing.seed === start.seed && fresh.seed !== start.seed && !fresh.hint;
    report('keys: H hints, Ctrl ignored, M mutes (also by key position), composing ignored, N starts a new pair', ok, JSON.stringify({ start, hinted, ctrl, muted, unmuted, composing, fresh }));
  },

  async buttonFocusKeys() {
    // A button reached with Tab, or that a script focused, handles its own Space; after a mouse
    // click the same key belongs to the game, so Space does not stay dead on a clicked button.
    const page = await openPage();
    await playing(page);
    const read = () => page.evaluate(() => ({ seed: window.treeAppreciator.state.pair.seed, hint: Boolean(window.treeAppreciator.state.hint), focused: document.activeElement?.id ?? '' }));
    // New pair comes first in the Tab order (top left), then Hint.
    const tabToHint = async () => {
      for (let i = 0; i < 4 && (await read()).focused !== 'hint'; i++) await page.keyboard.press('Tab');
    };
    const start = await read();
    await tabToHint();
    await page.keyboard.press('Space');
    const viaTab = await read();
    // Click on the scene, then Tab at once: the focus that follows is the keyboard's. The hint is
    // cleared first, so a hint after Space shows that Space pressed the button.
    await page.evaluate(() => {
      window.treeAppreciator.state.hint = null;
      window.treeAppreciator.state.hintUntil = 0;
    });
    await page.mouse.click(400, 400);
    await tabToHint();
    await page.keyboard.press('Space');
    const afterSceneClick = await read();
    // Click the Hint button, wait, then a script moves focus to the sound button: the keyboard's, so
    // Space presses the sound button (it mutes) and starts no new pair.
    await page.click('#hint');
    await pause(300);
    await page.evaluate(() => document.getElementById('mute').focus());
    const mutedBefore = await page.evaluate(() => window.treeAppreciator.sound.muted);
    await page.keyboard.press('Space');
    const viaScript = await read();
    const mutedAfter = await page.evaluate(() => window.treeAppreciator.sound.muted);
    // Click the Hint button, then press Space: the key belongs to the game, which starts a new pair.
    await page.click('#hint');
    await page.keyboard.press('Space');
    await playing(page);
    const afterClick = await read();
    const ok = viaTab.seed === start.seed && viaTab.hint && afterSceneClick.seed === start.seed && afterSceneClick.hint && viaScript.seed === start.seed && !mutedBefore && mutedAfter && afterClick.seed !== start.seed;
    report('Space acts on a Tab-focused or script-focused button but starts a new pair after a mouse click', ok, JSON.stringify({ start, viaTab, afterSceneClick, mutedBefore, viaScript, mutedAfter, afterClick }));
  },

  async keyboardMute() {
    // When the sound starts. A keyboard player tabs to the sound button and mutes, with Space and,
    // on a fresh page, with Enter: no sound plays on the way (Tab starts nothing), and after the
    // key the sound starts muted. On other fresh pages the first action is M (the sound starts,
    // silent), H on the focused sound button (a game key there: the sound starts, and a hint
    // shows), N (the sound starts and a new pair grows), or a click on the scene (the sound
    // starts and the click counts as a miss).
    const results = [];
    for (const action of ['Space', 'Enter', 'M', 'H', 'N', 'click']) {
      const page = await openPage();
      await playing(page);
      const audio = () =>
        page.evaluate(() => {
          const { sound, state } = window.treeAppreciator;
          return { started: Boolean(sound.context), running: sound.context?.state === 'running', gain: sound.master ? sound.master.gain.value : null, muted: sound.muted, focused: document.activeElement?.id ?? '', seed: state.pair.seed, hint: Boolean(state.hint), misses: state.round.misses };
        });
      const tabsToSound = ['Space', 'Enter', 'H'].includes(action);
      if (tabsToSound) for (let i = 0; i < 6 && (await audio()).focused !== 'mute'; i++) await page.keyboard.press('Tab');
      const reached = await audio();
      if (action === 'click') await page.mouse.click(640, 140);
      else await page.keyboard.press(action.length === 1 ? action.toLowerCase() : action);
      const after = await audio();
      // An unmuted start must really play: the engine running and the level up (it starts at 0.8).
      const audible = await waitFor(page, () => window.treeAppreciator.sound.context?.state === 'running' && window.treeAppreciator.sound.master.gain.value > 0.7, 5000)
        .then(() => true)
        .catch(() => false);
      const reachedRight = !tabsToSound || reached.focused === 'mute';
      const mutes = action === 'Space' || action === 'Enter' || action === 'M';
      const outcomes = {
        H: after.hint,
        N: after.seed !== reached.seed,
        click: after.misses === reached.misses + 1,
      };
      const outcomeRight = mutes ? after.muted && after.gain < 0.02 : !after.muted && audible && outcomes[action];
      results.push({ action, ok: reachedRight && !reached.started && after.started && outcomeRight, reached, after, audible });
      await page.close();
    }
    report('the sound starts with the first game key or click on the scene, and a keyboard player can tab to the sound button and mute (Space or Enter), or press M, before any sound plays', results.every((r) => r.ok), JSON.stringify(results));
  },

  async heldKeys() {
    // Holding Enter on a Tab-focused button presses it once, not once per key repeat: New pair
    // starts one pair, and the sound button toggles once.
    const page = await openPage();
    await playing(page);
    await page.evaluate(() => {
      window.__muteClicks = 0;
      document.getElementById('mute').addEventListener('click', () => window.__muteClicks++);
    });
    const read = () => page.evaluate(() => ({ pairs: window.treeAppreciator.state.pairCount, muted: window.treeAppreciator.sound.muted, muteClicks: window.__muteClicks, focused: document.activeElement?.id ?? '' }));
    const holdEnter = async () => {
      await page.keyboard.down('Enter');
      for (let i = 0; i < 4; i++) await page.keyboard.down('Enter'); // repeats, as a held key sends
      await page.keyboard.up('Enter');
      await pause(300);
    };
    for (let i = 0; i < 6 && (await read()).focused !== 'new-pair'; i++) await page.keyboard.press('Tab');
    const before = await read();
    await holdEnter();
    const afterNew = await read();
    for (let i = 0; i < 6 && (await read()).focused !== 'mute'; i++) await page.keyboard.press('Tab');
    await holdEnter();
    const afterMute = await read();
    const ok = before.focused === 'new-pair' && afterNew.pairs === before.pairs + 1 && afterMute.focused === 'mute' && afterMute.muted === true && afterMute.muteClicks === 1;
    report('holding Enter on a focused button presses it once', ok, JSON.stringify({ before, afterNew, afterMute }));
  },

  async suspendedStart() {
    // Some browsers create the audio context suspended even inside a click. Stood in for here by a
    // context that suspends itself when made and reports "suspended" until resumed: the first click
    // on the scene must resume it, so the sound plays.
    // The stand-in counts what happens to it, so the check can tell it was the context the game
    // used, that the game saw it suspended, and that the game resumed it.
    const page = await openPage({
      init: () => {
        const Real = window.AudioContext;
        window.__standIn = { made: 0, resumeCalls: 0, stateSeenSuspended: false };
        window.AudioContext = class extends Real {
          constructor(...args) {
            super(...args);
            this.resumed = false;
            this.isStandIn = true;
            window.__standIn.made++;
            super.suspend();
          }
          get state() {
            const state = this.resumed ? super.state : 'suspended';
            if (state === 'suspended') window.__standIn.stateSeenSuspended = true;
            return state;
          }
          resume() {
            this.resumed = true;
            window.__standIn.resumeCalls++;
            return super.resume();
          }
        };
      },
    });
    await playing(page);
    const before = await page.evaluate(() => ({ ...window.__standIn }));
    await page.mouse.click(640, 140);
    const running = await waitFor(page, () => window.treeAppreciator.sound.context?.state === 'running', 5000)
      .then(() => true)
      .catch(() => false);
    const after = await page.evaluate(() => ({ ...window.__standIn, gameUsesStandIn: window.treeAppreciator.sound.context?.isStandIn === true }));
    const startedSuspended = after.made >= 1 && after.gameUsesStandIn && after.stateSeenSuspended;
    const resumedByClick = before.resumeCalls === 0 && after.resumeCalls >= 1;
    report('a first click resumes sound that the browser started suspended', startedSuspended && resumedByClick && running, JSON.stringify({ running, before, after }));
  },

  async arcadeKey() {
    // A keyboard player tabs to Back to Arcade. Space there does nothing (a link is not pressed with
    // Space) and starts no new pair. Enter follows the link and starts no new pair first: the link's
    // click is caught once to read the game at that moment, then Enter is pressed again for real,
    // and the page goes to the arcade (../index.html, one folder up from the game).
    const page = await openPage();
    await playing(page);
    const read = () => page.evaluate(() => ({ focused: document.activeElement?.id ?? '', pairs: window.treeAppreciator.state.pairCount }));
    for (let i = 0; i < 8 && (await read()).focused !== 'arcade'; i++) await page.keyboard.press('Tab');
    const reached = await read();
    await page.keyboard.press('Space');
    await pause(300);
    const afterSpace = await read();
    await page.evaluate(() => {
      document.getElementById('arcade').addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          window.__pairsAtClick = window.treeAppreciator.state.pairCount;
        },
        { once: true },
      );
    });
    await page.keyboard.press('Enter');
    await pause(300);
    const atClick = await page.evaluate(() => window.__pairsAtClick ?? null);
    const afterCaughtEnter = await read();
    // The page the link leads to is answered with a stand-in: in the js-toys repo it is the real
    // arcade page, which loads its font from another host, and this check judges only the game's
    // own requests.
    const expectedPath = new URL('../index.html', page.url()).pathname;
    let requestedPath = null;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.isInterceptResolutionHandled()) return;
      const leavesGame = request.isNavigationRequest() && request.frame() === page.mainFrame();
      if (!leavesGame) {
        request.continue();
        return;
      }
      requestedPath = new URL(request.url()).pathname;
      request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Arcade stand-in</title>' });
    });
    let navigated = null;
    try {
      [navigated] = await Promise.all([page.waitForNavigation({ timeout: 15000, waitUntil: 'load' }), page.keyboard.press('Enter')]);
    } catch {
      navigated = null;
    }
    const path = requestedPath;
    const noNewPair = afterSpace.pairs === reached.pairs && atClick === reached.pairs && afterCaughtEnter.pairs === reached.pairs;
    const ok = reached.focused === 'arcade' && afterSpace.focused === 'arcade' && noNewPair && navigated !== null && path === expectedPath;
    report('on a Tab-focused Back to Arcade, Space starts nothing and Enter goes to the arcade page', ok, JSON.stringify({ reached, afterSpace, atClick, afterCaughtEnter, path, expectedPath }));
  },

  async hiddenTab() {
    // The sound stops while the page is in a background tab and plays again when it comes back.
    // A hidden tab is stood in for by reporting document.hidden and sending visibilitychange, as
    // the browser does when the player switches tabs.
    const page = await openPage();
    await playing(page);
    await page.mouse.click(640, 140);
    const stateIs = (wanted) =>
      waitFor(page, (state) => window.treeAppreciator.sound.context?.state === state, 5000, wanted)
        .then(() => true)
        .catch(() => false);
    const setHidden = (hidden) =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    const playingAtStart = await stateIs('running');
    await setHidden(true);
    const stoppedWhenHidden = await stateIs('suspended');
    await setHidden(false);
    const playingWhenBack = await stateIs('running');
    const ok = playingAtStart && stoppedWhenHidden && playingWhenBack;
    report('the sound stops in a background tab and plays again when the tab is back', ok, JSON.stringify({ playingAtStart, stoppedWhenHidden, playingWhenBack }));
  },

  async phoneLayout() {
    // A phone and the iPad sizes, upright and sideways, touch only: the bar sits under the trees,
    // every button is big enough for a finger, key labels are hidden, and a tap finds a difference.
    const devices = [];
    for (const [width, height] of [[390, 844], [820, 1180], [1024, 1366], [1180, 820], [1366, 1024]]) {
      const page = await openPage({ width, height, touch: true });
      await playing(page);
      await gameSeconds(page, 4);
      const layout = await page.evaluate(() => {
        const rect = (id) => document.getElementById(id).getBoundingClientRect();
        const bar = rect('bar');
        const banner = rect('banner');
        const buttons = [...document.querySelectorAll('#hint, #new-pair, #mute, #arcade')].map((button) => button.getBoundingClientRect());
        return {
          bar: [bar.left, bar.top, bar.right, bar.bottom].map(Math.round),
          banner: [banner.left, banner.top, banner.right, banner.bottom].map(Math.round),
          buttonsInsideBar: [...document.querySelectorAll('#hint')].every((button) => button.getBoundingClientRect().right <= bar.right + 1 && button.getBoundingClientRect().left >= bar.left - 1),
          // The top row, left to right: New pair, the scoreboard, the sound button, apart.
          topRowInOrder: rect('new-pair').right < rect('scoreboard').left && rect('scoreboard').right < rect('mute').left,
          smallestTarget: Math.round(Math.min(...buttons.map((r) => Math.min(r.width, r.height)))),
          keyLabelsShown: [...document.querySelectorAll('kbd')].some((label) => getComputedStyle(label).display !== 'none'),
          scrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      const boxes = await treeScreenBoxes(page);
      const treesBetween = boxes.every((b) => b.baseY <= layout.bar[1] + 4 && b.topY >= layout.banner[3] - 4 && b.minX > -5 && b.maxX < width + 5);
      await faceDifference(page, 0);
      const point = await differencePoint(page, 0);
      await page.touchscreen.tap(point.x, point.y);
      const tapped = await readGame(page);
      await dotsFilled(page);
      const shown = await popAndReady(page);
      // The buttons take a finger: nothing covers their middle, and a tap on the sound button mutes.
      const reachable = await page.evaluate(() =>
        ['new-pair', 'mute', 'hint', 'arcade'].every((id) => {
          const button = document.getElementById(id);
          const box = button.getBoundingClientRect();
          const top = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
          return top !== null && button.contains(top);
        }),
      );
      const sound = await page.evaluate(() => {
        const box = document.getElementById('mute').getBoundingClientRect();
        return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
      });
      await page.touchscreen.tap(sound.x, sound.y);
      const tapMuted = await page.evaluate(() => window.treeAppreciator.sound.muted);
      // A one-finger swipe across the trees turns them.
      const azimuthBefore = await azimuth(page);
      await page.touchscreen.touchStart(width * 0.3, height * 0.5);
      for (let step = 1; step <= 8; step++) await page.touchscreen.touchMove(width * (0.3 + 0.05 * step), height * 0.5);
      await page.touchscreen.touchEnd();
      await gameSeconds(page, 1);
      const swipeTurned = Math.abs((await azimuth(page)) - azimuthBefore) > 0.1;
      await shot(page, `touch-${width}x${height}`);
      const ok = swipeTurned && shown.scoreboardShown && reachable && tapMuted && layout.buttonsInsideBar && layout.topRowInOrder && layout.smallestTarget >= 44 && !layout.keyLabelsShown && !layout.scrollsSideways && layout.banner[3] < layout.bar[1] && treesBetween && tapped.found.length === 1 && tapped.found[0] === 0;
      devices.push({ size: `${width}x${height}`, ok, reachable, tapMuted, swipeTurned, layout, tapped: tapped.found, trees: boxes.map((b) => [b.minX, b.topY, b.maxX, b.baseY].map(Math.round)) });
      // An open page keeps rendering on the CPU and would slow the next device's load past its
      // time limit.
      await page.close();
    }
    // Failing devices first, so a shortened report still shows them.
    const ordered = [...devices.filter((d) => !d.ok), ...devices.filter((d) => d.ok)];
    report('on a phone and on iPads the bar sits under the trees, every button is at least 44 pixels with no key labels, and a tap finds a difference', devices.every((d) => d.ok), JSON.stringify(ordered));
  },

  async phoneTurn() {
    // An upright phone puts the camera far back, among the hills. Turned all the way round, it
    // stays above the ground and sees the trees over every hill.
    const page = await openPage({ width: 390, height: 844, touch: true });
    await playing(page);
    await gameSeconds(page, 3);
    const problems = [];
    for (let degrees = 0; degrees < 360; degrees += 30) {
      await page.evaluate((angle) => {
        const { camera, controls } = window.treeAppreciator.world;
        const offset = camera.position.clone().sub(controls.target);
        const across = Math.hypot(offset.x, offset.z);
        camera.position.set(controls.target.x + across * Math.sin(angle), camera.position.y, controls.target.z + across * Math.cos(angle));
        controls.update();
      }, (degrees * Math.PI) / 180);
      await gameSeconds(page, 1);
      const view = await page.evaluate(async () => {
        const { groundHeight } = await import(new URL('src/ground.js', location.href).href);
        const { camera, controls } = window.treeAppreciator.world;
        const c = camera.position;
        const t = controls.target;
        let smallestGap = Infinity;
        for (let i = 0; i <= 200; i++) {
          const f = 0.1 + (0.9 * i) / 200;
          const gap = t.y + (c.y - t.y) * f - groundHeight(t.x + (c.x - t.x) * f, t.z + (c.z - t.z) * f);
          smallestGap = Math.min(smallestGap, gap);
        }
        // Where every drawn leaf of both trees lands on the screen, its base and its tip: the
        // share of leaves with both inside the window.
        const { left, right, world: w } = window.treeAppreciator;
        const inside = (p) => p.x >= 0 && p.x <= window.innerWidth && p.y >= 0 && p.y <= window.innerHeight;
        let leaves = 0;
        let onScreen = 0;
        for (const view of [left, right]) {
          for (let k = 0; k < view.data.leafCount; k++) {
            const m = view.data.leafMatrices.subarray(k * 16, k * 16 + 16);
            if (Math.hypot(m[4], m[5], m[6]) === 0) continue;
            const base = w.toScreen(view.worldX + m[12], m[13], m[14]);
            const tip = w.toScreen(view.worldX + m[12] + m[4], m[13] + m[5], m[14] + m[6]);
            leaves++;
            if (inside(base) && inside(tip)) onScreen++;
          }
        }
        return { distance: c.distanceTo(t), height: c.y, ground: groundHeight(c.x, c.z), smallestGap, leavesOnScreen: leaves > 0 ? onScreen / leaves : 0 };
      });
      if (degrees === 270) await shot(page, 'phone-turned');
      const rounded = Object.fromEntries(Object.entries(view).map(([k, v]) => [k, Number(v.toFixed(3))]));
      if (view.smallestGap < 0.6 || view.leavesOnScreen < 1) problems.push({ degrees, ...rounded });
    }
    report('on a phone the camera turned all the way round stays above the hills and keeps every leaf on screen', problems.length === 0, JSON.stringify(problems));
  },

  async mute() {
    // Calls to the storage methods (setItem, removeItem, clear) and to IndexedDB's open are
    // counted, so a write that is undone at once is seen too. A value set through a property
    // (`localStorage.best = 280`) makes no call; test/selfContained.test.js scans the game's code
    // for any use of storage instead.
    const page = await openPage({
      init: () => {
        window.__storageCalls = [];
        for (const name of ['setItem', 'removeItem', 'clear']) {
          const original = Storage.prototype[name];
          Storage.prototype[name] = function (...args) {
            window.__storageCalls.push(name);
            return original.apply(this, args);
          };
        }
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (...args) {
          window.__storageCalls.push('indexedDB.open');
          return open.apply(this, args);
        };
      },
    });
    await playing(page);
    // The button shows the sound's state by its icon (speaker with waves, or with a cross), fully
    // drawn either way, not faded.
    const read = () =>
      page.evaluate(() => {
        const button = document.getElementById('mute');
        // Shown means drawn: displayed, visible, not faded, and of a real size.
        const shown = (selector) => {
          const icon = button.querySelector(selector);
          const style = getComputedStyle(icon);
          const box = icon.getBoundingClientRect();
          const stroke = getComputedStyle(icon.querySelector('path')).stroke;
          const strokeShows = stroke !== 'none' && stroke !== 'transparent' && !(stroke.startsWith('rgba') && Number(stroke.split(',').at(-1).replace(')', '')) < 0.5);
          const strokeWide = parseFloat(getComputedStyle(icon.querySelector('path')).strokeWidth) >= 1;
          return style.display !== 'none' && style.visibility === 'visible' && style.opacity === '1' && strokeShows && strokeWide && box.width >= 16 && box.height >= 16;
        };
        return { cls: button.classList.contains('muted'), pressed: button.getAttribute('aria-pressed'), sound: window.treeAppreciator.sound.muted, onIcon: shown('.icon-sound-on'), offIcon: shown('.icon-sound-off'), opacity: getComputedStyle(button).opacity };
      });
    // The level the sound really plays at: the master gain glides to 0 when muted and back to
    // 0.8 when not (a time constant of 0.1 s), so each is waited for.
    const gainReaches = (test) =>
      waitFor(page, (wanted) => {
        const gain = window.treeAppreciator.sound.master?.gain.value;
        return gain !== undefined && (wanted === 'silent' ? gain < 0.02 : gain > 0.7);
      }, 5000, test)
        .then(() => true)
        .catch(() => false);
    const before = await read();
    await page.click('#mute');
    const muted = { ...(await read()), silent: await gainReaches('silent') };
    await page.click('#mute');
    const back = { ...(await read()), audible: await gainReaches('audible') };
    // No data is stored, whatever the player does: find a difference, miss, hint, start a new pair.
    await faceDifference(page, 0);
    const point = await differencePoint(page, 0);
    await page.mouse.click(point.x, point.y);
    await page.mouse.click(640, 140);
    await page.click('#hint');
    await page.click('#new-pair');
    await playing(page);
    const stored = await page.evaluate(async () => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie, databases: indexedDB.databases ? (await indexedDB.databases()).length : 0, calls: window.__storageCalls }));
    const iconsRight = before.onIcon && !before.offIcon && !muted.onIcon && muted.offIcon && back.onIcon && !back.offIcon && [before, muted, back].every((r) => r.opacity === '1');
    const ok = iconsRight && muted.silent && back.audible && muted.cls && muted.pressed === 'true' && muted.sound && !back.cls && back.pressed === 'false' && !back.sound && stored.local.length === 0 && stored.session.length === 0 && stored.cookie === '' && stored.databases === 0 && stored.calls.length === 0;
    report('the sound button mutes the sound and unmutes it, its icon shows which, and no data is stored by playing', ok, JSON.stringify({ before, muted, back, stored }));
  },

  async layouts() {
    // Wide, short, phone- and iPad-sized windows, upright and sideways: the buttons stay on
    // screen, the scoreboard, the banner, the bar and the corner buttons do not overlap, and the
    // trees are fitted between the banner and the bar.
    const page = await openPage();
    await playing(page);
    const problems = [];
    // A six-digit score, more than any visit is likely to reach (3,334 pairs), so the scoreboard
    // is at its widest. On a 320 pixel phone it fits only with the word "Score" hidden. The score
    // is set in the game and shown by its own drawing: a miss on the sky takes it to 999979.
    await page.evaluate(() => (window.treeAppreciator.state.score = 999999));
    await page.mouse.click(640, 140);
    const wideScore = await page.evaluate(() => document.getElementById('score').textContent);
    if (wideScore !== '999979') problems.push({ size: '1280x800', issues: [`the score shows ${wideScore}, not 999979`] });
    const sizes = [[1280, 800], [1280, 500], [720, 600], [800, 400], [844, 390], [667, 375], [640, 360], [568, 320], [390, 844], [360, 640], [320, 568], [820, 1180], [1024, 1366], [1180, 820], [1366, 1024]];
    for (const [width, height] of sizes) {
      await page.setViewport({ width, height });
      await gameSeconds(page, 3);
      const found = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const bar = rect('#bar');
        const banner = rect('#banner');
        const buttons = [...document.querySelectorAll('#hint, #new-pair, #mute, #arcade')].map((button) => button.getBoundingClientRect());
        const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
        const scoreboard = rect('#scoreboard');
        const corners = [rect('#mute'), rect('#new-pair'), rect('#arcade')];
        return {
          buttonsOverlap: buttons.some((a, i) => buttons.some((b, j) => j > i && overlap(a, b))),
          cornerOverCard: corners.some((corner) => overlap(corner, banner) || overlap(corner, bar) || overlap(corner, scoreboard)),
          // The dots, the word and the number stay inside the scoreboard card.
          scoreOutsideCard: ['#progress', '.score-label', '#score'].some((selector) => {
            const part = rect(selector);
            const hidden = part.width === 0 && part.height === 0;
            return !hidden && (part.left < scoreboard.left - 0.5 || part.right > scoreboard.right + 0.5 || part.top < scoreboard.top - 0.5 || part.bottom > scoreboard.bottom + 0.5);
          }),
          scoreboardOverBanner: overlap(scoreboard, banner),
          scoreboardOffCentre: Math.abs((scoreboard.left + scoreboard.right) / 2 - window.innerWidth / 2) > 2,
          // Left to right: New pair, the scoreboard, the sound button.
          topRowOutOfOrder: !(rect('#new-pair').right < scoreboard.left && scoreboard.right < rect('#mute').left),
          bar: [bar.left, bar.top, bar.right, bar.bottom],
          banner: [banner.left, banner.top, banner.right, banner.bottom],
          // What the trees must stay below: the guide while it shows, else the scoreboard (the
          // miss above that set the score also dismissed the guide).
          topCover: document.getElementById('banner').classList.contains('dismissed') ? scoreboard.bottom : banner.bottom,
          buttonsOutside: buttons.some((r) => r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight),
          smallestTarget: Math.min(...buttons.map((r) => Math.min(r.width, r.height))),
          scrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      const boxes = await treeScreenBoxes(page);
      const issues = [];
      if (found.buttonsOutside) issues.push('a button outside the window');
      if (found.buttonsOverlap) issues.push('two buttons overlap');
      if (found.cornerOverCard) issues.push('a corner button over the scoreboard, the banner or the bar');
      if (found.scoreboardOverBanner) issues.push('the scoreboard over the banner');
      if (found.scoreboardOffCentre) issues.push('the scoreboard is not centred');
      if (found.topRowOutOfOrder) issues.push('the top row is not New pair, scoreboard, sound');
      if (found.scoreOutsideCard) issues.push('the score or the dots outside the scoreboard');
      if (found.scrollsSideways) issues.push('page scrolls sideways');
      if (found.banner[3] > found.bar[1]) issues.push('banner and bar overlap');
      // Touch-sized targets where a phone is held (narrow or short); wide desktop windows may use smaller ones.
      if ((width <= 640 || height <= 480) && found.smallestTarget < 44) issues.push(`a button is ${Math.round(found.smallestTarget)} pixels`);
      for (const [index, b] of boxes.entries()) {
        if (b.topY < found.topCover - 6) issues.push(`tree ${index} under the top row`);
        if (b.baseY > found.bar[1] + 6) issues.push(`tree ${index} under the bar`);
        if (b.minX < -6 || b.maxX > width + 6) issues.push(`tree ${index} outside the window`);
      }
      if (issues.length > 0) problems.push({ size: `${width}x${height}`, issues, bar: found.bar.map(Math.round), banner: found.banner.map(Math.round), trees: boxes.map((b) => [b.minX, b.topY, b.maxX, b.baseY].map(Math.round)) });
    }
    report(`at ${sizes.length} window sizes the buttons are usable and apart, and the trees are fitted between the banner and the bar`, problems.length === 0, JSON.stringify(problems));
  },

  async resize() {
    await checkResizeReframes('resize reframes', {});
  },

  async resizeWithoutObserver() {
    // Older browsers have no ResizeObserver; the game falls back to the window's resize event.
    await checkResizeReframes('resize reframes without ResizeObserver', { init: () => delete window.ResizeObserver });
  },

  async zeroSize() {
    const page = await openPage();
    await gameReady(page);
    await page.evaluate(() => {
      // Hiding the stage is enough: its ResizeObserver reports the 0 by 0 size.
      document.getElementById('stage').style.display = 'none';
    });
    await gameSeconds(page, 1);
    await pause(400);
    const hidden = await page.evaluate(() => {
      const { camera } = window.treeAppreciator.world;
      return { aspect: camera.aspect, projectionFinite: camera.projectionMatrix.elements.every(Number.isFinite) };
    });
    await page.evaluate(() => {
      document.getElementById('stage').style.display = '';
    });
    await gameSeconds(page, 2);
    const camera = await page.evaluate(() => window.treeAppreciator.world.camera.position.toArray());
    const ok = Number.isFinite(hidden.aspect) && hidden.projectionFinite && camera.every(Number.isFinite);
    report('zero-size stage leaves the camera usable', ok, `while hidden ${JSON.stringify(hidden)}; camera ${JSON.stringify(camera.map((v) => Number(v?.toFixed?.(2))))}`);
  },

  async pixelRatio() {
    const page = await openPage({ width: 800, height: 600 });
    await gameReady(page);
    const before = await page.evaluate(() => window.treeAppreciator.world.renderer.getPixelRatio());
    // Same size in CSS pixels, sharper screen: neither the window nor the stage resizes.
    const measure = () => page.evaluate(() => ({ ratio: window.treeAppreciator.world.renderer.getPixelRatio(), canvasWidth: window.treeAppreciator.world.renderer.domElement.width }));
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
    await gameSeconds(page, 1);
    const sharper = await measure();
    // And back again: the watcher must keep watching after its first change.
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
    await gameSeconds(page, 1);
    const back = await measure();
    const ok = before === 1 && sharper.ratio === 2 && sharper.canvasWidth === 1600 && back.ratio === 1 && back.canvasWidth === 800;
    report('the pixel ratio follows moves between screens', ok, `before ${before}, sharper ${JSON.stringify(sharper)}, back ${JSON.stringify(back)}`);
  },

  async bootHidden() {
    const page = await openPage({
      init: () => {
        document.addEventListener('readystatechange', () => {
          if (document.readyState !== 'interactive') return;
          const style = document.createElement('style');
          style.id = 'hide-stage';
          style.textContent = '#stage { display: none !important; }';
          document.head.appendChild(style);
        });
      },
      // With the stage hidden, the network-idle wait never settles; the load event does.
      waitUntil: 'load',
    });
    await waitFor(page, () => window.treeAppreciator);
    await gameSeconds(page, 1);
    const hidden = await page.evaluate(() => {
      const { camera, renderer } = window.treeAppreciator.world;
      return { canvasWidth: renderer.domElement.width, aspect: camera.aspect, projectionFinite: camera.projectionMatrix.elements.every(Number.isFinite) };
    });
    // Show the stage without a window resize event: only the stage's own size changes.
    await page.evaluate(() => {
      document.getElementById('hide-stage').remove();
    });
    await gameReady(page);
    await gameSeconds(page, 4);
    const boxes = await treeScreenBoxes(page);
    const inView = boxes.every((b) => b.minX > -5 && b.maxX < 1285 && b.topY > -5 && b.baseY < 805);
    // Framed for the real screen, not for the square stand-in used while hidden: a fit the check
    // asks the scene for itself (the same trees, and the same share of the screen covered at the
    // top and bottom as the game uses) leaves the camera where it is. (The share of the width the
    // trees span told the two apart while the trees stood 9.2 apart; since each pair stands as
    // close as its crowns allow, a right fit can span as little as a wrong one.)
    const distance = () => page.evaluate(() => window.treeAppreciator.world.camera.position.distanceTo(window.treeAppreciator.world.controls.target));
    const recovered = await distance();
    await page.evaluate(() => {
      const { world, left, right, elapsed } = window.treeAppreciator;
      const bottomOf = (id) => document.getElementById(id).getBoundingClientRect().bottom;
      const guideShown = !document.getElementById('banner').classList.contains('dismissed');
      const top = Math.max(bottomOf('scoreboard'), guideShown ? bottomOf('banner') : 0) / window.innerHeight;
      const bottom = (window.innerHeight - document.getElementById('bar').getBoundingClientRect().top) / window.innerHeight;
      world.frameBounds([left.grownBounds(), right.grownBounds()], elapsed, { top: Math.min(top, 0.5), bottom: Math.min(bottom, 0.5) });
    });
    await gameSeconds(page, 4);
    const refitted = await distance();
    const framed = inView && Math.abs(refitted - recovered) < 0.02 * refitted;
    await shot(page, 'boot-hidden');
    const wasHidden = hidden.canvasWidth === 0;
    const sane = Number.isFinite(hidden.aspect) && hidden.projectionFinite;
    const box = (b) => [b.minX, b.topY, b.maxX, b.baseY].map(Math.round);
    report('a page booted with a hidden stage recovers when it is shown', wasHidden && sane && framed, `while hidden ${JSON.stringify(hidden)}; camera distance ${recovered.toFixed(2)}, refitted ${refitted.toFixed(2)}; trees ${JSON.stringify(boxes.map(box))}`);
  },

  async offline() {
    // Every request outside the game server fails, as on a machine without internet.
    const page = await openPage({
      beforeLoad: async (page) => {
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          const url = request.url();
          const allowed = isGameServer(url) || url.startsWith('data:');
          if (allowed) request.continue();
          else request.abort('internetdisconnected');
        });
      },
    });
    await gameReady(page);
    // The italic face is only fetched when text needs it; ask for it, then every face
    // must have loaded from the game server.
    const faces = await page.evaluate(async () => {
      await document.fonts.load('italic 500 19px "Cormorant Garamond"', 'a');
      await document.fonts.ready;
      return [...document.fonts].map((face) => `${face.family} ${face.style} ${face.status}`);
    });
    const allLoaded = faces.length >= 3 && faces.every((face) => face.endsWith('loaded') && !face.endsWith('unloaded'));
    const ok = page.errors.length === 0 && page.outsideRequests.length === 0 && allLoaded;
    report('the game starts without a network connection, in its own fonts, asking no other host', ok, `fonts ${JSON.stringify(faces)}; errors ${JSON.stringify(page.errors)}; outside requests ${JSON.stringify(page.outsideRequests)}`);
    // A request to another host shows the stand-in is what fails it: one it fails reports
    // ERR_INTERNET_DISCONNECTED, while one it let through would meet the host name block and report
    // ERR_NAME_NOT_RESOLVED. The probe's own console error and request are taken out afterwards, so
    // the runner's network check after this scenario judges only the game's requests (an entry
    // from the game with the same text stays: one copy is taken out per probe entry).
    const PROBE_URL = 'http://offline-probe.invalid/ping';
    const probeErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && message.location().url === PROBE_URL) probeErrors.push(message.text());
    });
    const probe = await page.evaluate((url) => fetch(url, { mode: 'no-cors' }).then((response) => `answered ${response.status}`, (error) => `failed: ${error.message}`), PROBE_URL);
    await pause(500);
    const takeOut = (list, entry) => {
      const index = list.indexOf(entry);
      if (index !== -1) list.splice(index, 1);
    };
    for (const text of probeErrors) takeOut(page.errors, text);
    const probeSeen = page.outsideRequests.includes(PROBE_URL);
    takeOut(page.outsideRequests, PROBE_URL);
    const failedAsOffline = probe.startsWith('failed') && probeErrors.length === 1 && probeErrors[0].includes('ERR_INTERNET_DISCONNECTED');
    report('a request to another host fails as offline, failed by the stand-in', failedAsOffline && probeSeen, JSON.stringify({ probe, probeErrors, probeSeen }));
  },

  async offlineApp() {
    // The installed app (doc/specs/OfflineApp.md): after one visit the service worker holds every
    // file, so with the network cut off a reload still boots the game and a difference can be found.
    const page = await openPage();
    await gameReady(page);
    const controlled = await waitFor(page, () => Boolean(navigator.serviceWorker?.controller), 60000)
      .then(() => true)
      .catch(() => false);
    const manifest = await page.appManifest();
    const manifestErrors = manifest.errors.map((error) => error.message);
    // Offline for the service worker too, and with the browser's ordinary HTTP cache emptied: a
    // worker fetching from either would hide a file missing from its stored copy. A device may
    // have evicted that cache, so only the worker's copy is relied on.
    await page.clearHttpCache();
    const workersCut = await page.setOfflineEverywhere(true);
    // Stop the worker, as when an installed app is launched again: the reload must start a new
    // one, offline, from what was stored.
    await page.stopServiceWorkers();
    for (let waited = 0; waited < 10000 && !page.workerStatuses.includes('stopped'); waited += 100) await pause(100);
    const statusesAtStop = page.workerStatuses.length;
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await playing(page);
    // The worker really stopped, and the reload started it again.
    const statuses = page.workerStatuses;
    const stopped = statuses.slice(0, statusesAtStop).includes('stopped');
    const restarted = statuses.slice(statusesAtStop).includes('running');
    // Workers that start while offline are held and cut off by the driver before they run; every
    // worker present now must be one of those cut off.
    const workersAfter = await page.serviceWorkerIds();
    const cutOff = [...page.cutOffWorkerIds()];
    const noNewWorker = workersAfter.every((id) => cutOff.includes(id));
    // Every file of the reloaded page came through the worker (Chromium sets workerStart then).
    const served = await page.evaluate(() => {
      const fromNetwork = (entry) => entry.workerStart === 0;
      const navigation = performance.getEntriesByType('navigation')[0];
      const files = performance.getEntriesByType('resource').filter((entry) => !entry.name.startsWith('data:') && !entry.name.startsWith('blob:'));
      return { pageThroughWorker: !fromNetwork(navigation), files: files.length, notThroughWorker: files.filter(fromNetwork).map((entry) => entry.name) };
    });
    await faceDifference(page, 0);
    const point = await differencePoint(page, 0);
    const beforeClick = await readGame(page);
    await page.mouse.click(point.x, point.y);
    const afterClick = await readGame(page);
    const scored = afterClick.found.length === 1 && Number(afterClick.score) === Number(beforeClick.score) + 100;
    // Opened as an installed app, Back to Arcade is hidden: the arcade is not part of the app.
    // Chromium cannot be made to report display-mode standalone (its media emulation accepts the
    // setting and ignores it), so this reads the page's stylesheet instead: a rule under exactly
    // that media condition must match the button itself and hide it. The tab view is measured.
    const arcade = await page.evaluate(() => {
      const button = document.getElementById('arcade');
      const mediaRules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((rule) => rule instanceof CSSMediaRule);
      const appRules = mediaRules.filter((rule) => rule.media.mediaText === '(display-mode: standalone)').flatMap((rule) => [...rule.cssRules]);
      return {
        shownInTab: getComputedStyle(button).display !== 'none',
        hiddenAsApp: appRules.some((rule) => button.matches(rule.selectorText) && rule.style.display === 'none'),
      };
    });
    await page.setOfflineEverywhere(false);
    const offlinePlay = workersCut.length >= 1 && stopped && restarted && noNewWorker && served.pageThroughWorker && served.files >= 10 && served.notThroughWorker.length === 0 && scored;
    const ok = controlled && manifestErrors.length === 0 && offlinePlay && arcade.shownInTab && arcade.hiddenAsApp;
    report(
      'after one visit the game boots and plays offline from its service worker, the manifest reads without errors, and the stylesheet hides Back to Arcade in the installed app',
      ok,
      JSON.stringify({ controlled, manifestErrors, workersCut, statuses, cutOff, workersAfter, served, found: afterClick.found, scoreBefore: beforeClick.score, score: afterClick.score, arcade }),
    );
  },

  async lowQuality() {
    // On a sharp screen, low quality must still draw at one pixel per CSS pixel, without shadows.
    const page = await openPage({ query: '?quality=low', scale: 2 });
    await gameReady(page);
    const state = await page.evaluate(() => ({ ratio: window.treeAppreciator.world.renderer.getPixelRatio(), shadows: window.treeAppreciator.world.renderer.shadowMap.enabled }));
    const ok = page.errors.length === 0 && state.ratio === 1 && state.shadows === false;
    report('quality=low boots at pixel ratio 1 without shadows', ok, `${JSON.stringify(state)} errors ${JSON.stringify(page.errors)}`);
  },
};

// A misspelt or renamed scenario must not turn into an empty run that passes.
const unknown = only.filter((name) => !(name in scenarios));
for (const name of unknown) report(name, false, `no scenario of that name; known: ${Object.keys(scenarios).join(', ')}`);

for (const [name, run] of Object.entries(scenarios)) {
  if (only.length && !only.includes(name)) continue;
  try {
    await run();
  } catch (error) {
    report(name, false, `threw: ${error.message.split('\n')[0]}`);
  }
  // Whatever the scenario checked, its pages must not have reached past the game server's
  // origin: no request the listener saw, no connection that failed on a blocked host name
  // (a network error in the console), no link or socket pointing elsewhere.
  const outside = openPages.flatMap((page) => page.outsideRequests);
  const networkErrors = openPages.flatMap((page) => page.errors.filter((error) => /net::ERR_|WebSocket connection/.test(error)));
  // Links and sockets are read from pages still open; a scenario that closes a page
  // early keeps only the request and console checks for it.
  const outsideLinks = [];
  const outsideSockets = [];
  const unreadable = [];
  for (const page of openPages) {
    if (page.isClosed()) continue;
    try {
      const found = await page.evaluate((gameOrigin) => {
        const elsewhere = (url) => !url.startsWith('data:') && new URL(url).origin !== gameOrigin;
        return {
          links: [...document.querySelectorAll('link[href]')].map((link) => link.href).filter(elsewhere),
          sockets: (window.__connections ?? []).filter(elsewhere),
        };
      }, new URL(BASE).origin);
      outsideLinks.push(...found.links);
      outsideSockets.push(...found.sockets);
    } catch (error) {
      unreadable.push(error.message.split('\n')[0]);
    }
  }
  const problems = { outside, networkErrors, outsideLinks, outsideSockets, unreadable };
  if (Object.values(problems).some((list) => list.length > 0)) {
    report(`${name}: connections only to the game server's origin`, false, JSON.stringify(problems));
  }
  openPages.length = 0;
  // Every open page keeps rendering on the CPU; close them so the next scenario runs at speed.
  while (openContexts.length) await openContexts.pop().close().catch(() => {});
}
await browser.close();
const failed = results.filter((line) => line.startsWith('FAIL')).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed > 0 || results.length === 0 ? 1 : 0;
