import assert from 'node:assert/strict';
import { appendFile, copyFile, lstat, mkdir, readdir, rm, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './chromium.mjs';
import { checkAndPrune, expiredRuns, generatedRunName, viewportSummary } from './shot-runs.mjs';
import { gameRoutes } from './game-routes.mjs';
import { startObservedServer, unexpectedBlockedRequests } from './observed-server.mjs';
import { closeResources } from './close-resources.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishedShots = process.env.SHOTS_DIR || path.join(root, 'shots');
const shots = path.join(publishedShots, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const reportDirectory = process.env.SHOTS_DIR || path.join(root, '.scratch');
const pruneReport = path.join(reportDirectory, 'shots-prune-report.json');
const pruneHistory = path.join(reportDirectory, 'shots-prune-history.jsonl');
const port = Number(process.env.PORT || 8097);
const base = process.env.BASE_URL || `http://127.0.0.1:${port}/flappywitch/`;
const own = new URL(base);
const routes = gameRoutes(base);
const matrix = [
  ['phone-390x844', 390, 844, true], ['phone-360x640', 360, 640, true],
  ['phone-844x390', 844, 390, true], ['ipad-820x1180', 820, 1180, true],
  ['ipad-1024x1366', 1024, 1366, true], ['ipad-1180x820', 1180, 820, true],
  ['ipad-1366x1024', 1366, 1024, true], ['desktop-1280x800', 1280, 800, false],
];
const failures = [];
let assertions = 0;
let viewportPasses = 0;

async function allocatedBytes(target) {
  const info = await lstat(target);
  let bytes = info.blocks * 512;
  if (info.isDirectory()) {
    for (const name of await readdir(target)) bytes += await allocatedBytes(path.join(target, name));
  }
  return bytes;
}

async function freeBytes(target) {
  const info = await statfs(target);
  return info.bavail * info.bsize;
}

async function pruneShotRuns() {
  await mkdir(publishedShots, { recursive: true });
  const entries = await readdir(publishedShots, { withFileTypes: true });
  const runs = entries.filter(entry => entry.isDirectory() && generatedRunName(entry.name))
    .map(entry => entry.name).sort().reverse();
  const deleted = [];
  for (const name of expiredRuns(entries)) {
    const target = path.join(publishedShots, name);
    deleted.push({ path: target, allocatedBytes: await allocatedBytes(target) });
  }
  const beforeFreeBytes = await freeBytes(publishedShots);
  await mkdir(path.dirname(pruneReport), { recursive: true });
  const run = path.basename(shots);
  await appendFile(pruneHistory, JSON.stringify({ run, stage: 'planned', deleted, beforeFreeBytes }) + '\n');
  await writeFile(pruneReport, JSON.stringify({ deleted, beforeFreeBytes, afterFreeBytes: null }, null, 2) + '\n');
  for (const item of deleted) await rm(item.path, { recursive: true });
  const afterFreeBytes = await freeBytes(publishedShots);
  const report = { deleted, beforeFreeBytes, afterFreeBytes };
  await appendFile(pruneHistory, JSON.stringify({ run, stage: 'completed', afterFreeBytes }) + '\n');
  await writeFile(pruneReport, JSON.stringify(report, null, 2) + '\n');
  console.log(`Kept the newest ${Math.min(runs.length, 5)} screenshot runs; removed ${deleted.length} older runs`);
}

function sameHost(url) {
  const other = new URL(url);
  const expectedPort = own.port || (own.protocol === 'https:' ? '443' : '80');
  const actualPort = other.port || (other.protocol === 'wss:' || other.protocol === 'https:' ? '443' : '80');
  return other.hostname === own.hostname && actualPort === expectedPort;
}

async function visibleControls(page, label, touch) {
  const controls = await page.evaluate(() => {
    return [...document.querySelectorAll('button, #arcade-back')].filter(button => button.getClientRects().length > 0).map(button => {
      const box = button.getBoundingClientRect();
      const atCenter = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { id: button.id, left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        width: box.width, height: box.height, uncovered: button.contains(atCenter) };
    });
  });
  assert.ok(controls.length >= 2, `${label}: controls found`);
  const backExpected = label.endsWith(' title') || label.endsWith(' over');
  assert.equal(controls.some(control => control.id === 'arcade-back'), backExpected, `${label}: arcade link visibility`);
  assertions++;
  for (const button of controls) {
    assert.ok(button.left >= 0 && button.top >= 0 && button.right <= page.viewport().width && button.bottom <= page.viewport().height, `${label}: ${button.id} in viewport`);
    if (touch) assert.ok(button.width >= 44 && button.height >= 44, `${label}: ${button.id} touch size`);
    assert.ok(button.uncovered, `${label}: ${button.id} is unobstructed`);
    assertions += touch ? 3 : 2;
  }
}

async function waitForGameTime(page, target) {
  await page.waitForFunction(goal => window.game && (window.game.time >= goal || window.game.state.phase === 'over'), { timeout: 120000, polling: 'raf' }, target);
}

async function projectedOpening(page, label) {
  const projected = await page.evaluate(async () => {
    const THREE = await import('three');
    const { state, view } = window.game;
    const upcoming = state.gates.filter(item => !item.passed).slice(0, 2);
    function box(gate) {
      const visual = view.gateVisuals.get(gate.index);
      visual.group.updateMatrixWorld(true);
      const points = [];
      for (const x of [-1.6, 1.6]) {
        for (const y of [-gate.halfGap, gate.halfGap]) {
          const point = visual.group.localToWorld(new THREE.Vector3(x, y, .535)).project(view.camera);
          points.push({ x: (point.x + 1) / 2, y: (1 - point.y) / 2 });
        }
      }
      return {
        left: Math.min(...points.map(point => point.x)),
        right: Math.max(...points.map(point => point.x)),
        top: Math.min(...points.map(point => point.y)),
        bottom: Math.max(...points.map(point => point.y)),
      };
    }
    return upcoming.map(box);
  });
  assert.equal(projected.length, 2, `${label}: two upcoming gates are drawn`);
  const [bounds, following] = projected;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  assert.ok(bounds.left >= 0 && bounds.right <= 1, `${label}: opening horizontal position ${JSON.stringify(bounds)}`);
  assert.ok(bounds.top >= 0 && bounds.bottom <= 1, `${label}: opening vertical position ${JSON.stringify(bounds)}`);
  assert.ok(width > .035, `${label}: opening width ${width}`);
  assert.ok(height > .045, `${label}: opening height ${height}`);
  assert.ok(following.left < 1 && following.right > 0 && following.top < 1 && following.bottom > 0,
    `${label}: gate after next is partly visible ${JSON.stringify(following)}`);
  assertions += 6;
  return bounds;
}

async function projectedWitch(page, label, width, height) {
  const bounds = await page.evaluate(async () => {
    const THREE = await import('three');
    const { camera, witch } = window.game.view;
    witch.group.updateMatrixWorld(true);
    const points = [];
    witch.solid.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const point = new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld).project(camera);
            points.push({ x: (point.x + 1) / 2, y: (1 - point.y) / 2 });
          }
        }
      }
    });
    return {
      left: Math.min(...points.map(point => point.x)),
      right: Math.max(...points.map(point => point.x)),
      top: Math.min(...points.map(point => point.y)),
      bottom: Math.max(...points.map(point => point.y)),
    };
  });
  const heightPercent = (bounds.bottom - bounds.top) * 100;
  const minimum = width < 600 && height > width ? 9 : 12;
  assert.ok(heightPercent >= minimum, `${label}: witch ${heightPercent.toFixed(1)}% of viewport height, minimum ${minimum}%`);
  assert.ok(bounds.left >= 0 && bounds.right <= 1 && bounds.top >= 0 && bounds.bottom <= 1,
    `${label}: witch inside viewport ${JSON.stringify(bounds)}`);
  assertions += 2;
  console.log(`${label}: witch ${heightPercent.toFixed(1)}% of viewport height`);
}

async function projectedStartingGate(page, label) {
  const extent = await page.evaluate(async () => {
    const THREE = await import('three');
    const camera = window.game.view.camera;
    const gate = window.game.state.gates[0];
    const projectY = y => (1 - new THREE.Vector3(0, gate.baseY + y, gate.z).project(camera).y) / 2;
    return { top: projectY(5.1), bottom: projectY(-5.1) };
  });
  assert.ok(extent.top > .18 && extent.top < .33, `${label}: starting gate top ${extent.top}`);
  assert.ok(extent.bottom > .6 && extent.bottom < .76, `${label}: starting gate bottom ${extent.bottom}`);
  assertions += 2;
}

async function playByTouch(page, label, width, height) {
  const startBox = await page.$eval('#start', button => {
    const box = button.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await page.touchscreen.tap(startBox.x, startBox.y);
  await page.waitForFunction(() => window.game.state.phase === 'playing');
  await waitForGameTime(page, .05);
  await visibleControls(page, `${label} playing`, true);
  await projectedOpening(page, label);
  await projectedWitch(page, label, width, height);
  let attempts = 0;
  const recent = [];
  while (attempts++ < 180) {
    const snapshot = await page.evaluate(() => ({
      time: window.game.time, score: window.game.state.score, y: window.game.state.y,
      velocity: window.game.state.velocity, phase: window.game.state.phase,
      center: window.game.nextGap?.center ?? 0,
      nextIndex: window.game.state.gates.find(gate => !gate.passed)?.index ?? -1,
    }));
    if (snapshot.score >= 3 && snapshot.nextIndex >= 3) break;
    recent.push(snapshot);
    if (recent.length > 12) recent.shift();
    assert.equal(snapshot.phase, 'playing', `${label}: run ended before a scored gate ${JSON.stringify(recent)}`);
    const belowTarget = snapshot.y < snapshot.center - .05;
    const headingDown = snapshot.velocity < .1;
    if (belowTarget && headingDown) await page.touchscreen.tap(width / 2, height * .72);
    await waitForGameTime(page, snapshot.time + .08);
  }
  const scored = await page.evaluate(() => window.game.state.score);
  assert.ok(scored >= 3, `${label}: touch play reached score three`);
  assertions++;
  const picture = await page.evaluate(() => {
    const view = window.game.view;
    const location = view.witch.group.position.clone().project(view.camera);
    return { x: (location.x + 1) / 2, y: (1 - location.y) / 2, gates: view.visibleGateCount };
  });
  assert.ok(picture.x > .1 && picture.x < .42, `${label}: witch sits in the left third`);
  assert.ok(picture.gates >= 2, `${label}: at least two upcoming gates drawn`);
  assertions += 2;
  await projectedOpening(page, `${label} after score three`);
  await projectedWitch(page, `${label} after score three`, width, height);
  const clearedGateVisuals = await page.evaluate(() => {
    const { state, view } = window.game;
    return state.gates.filter(gate => gate.passed).map(gate => view.gateVisuals.get(gate.index)?.group.visible ?? false);
  });
  assert.ok(clearedGateVisuals.length > 0 && clearedGateVisuals.every(visible => !visible),
    `${label}: cleared gates do not cover the next opening`);
  assertions++;
  if (label === 'phone-390x844') {
    const openings = await page.evaluate(() => window.game.state.gates.filter(gate => !gate.passed).slice(0, 3).map(gate => ({ gate: gate.index + 1, center: gate.baseY })));
    console.log(`Phone play openings: ${JSON.stringify(openings)}`);
  }
  await page.screenshot({ path: path.join(shots, `${label}-play.png`) });
  const pauseBox = await page.$eval('#pause', button => {
    const box = button.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await page.touchscreen.tap(pauseBox.x, pauseBox.y);
  assert.equal(await page.evaluate(() => window.game.state.phase), 'paused');
  await visibleControls(page, `${label} paused`, true);
  const resumeBox = await page.$eval('#resume', button => {
    const box = button.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await page.touchscreen.tap(resumeBox.x, resumeBox.y);
  assert.equal(await page.evaluate(() => window.game.state.phase), 'countdown');
  assert.equal(await page.$eval('#countdown', node => node.textContent), '3');
  const frozenTime = await page.evaluate(() => window.game.state.time);
  await page.waitForFunction(() => document.querySelector('#countdown').textContent === '2', { timeout: 120000, polling: 'raf' });
  assert.equal(await page.evaluate(() => window.game.state.time), frozenTime, `${label}: physics waits during resume countdown`);
  await page.waitForFunction(() => document.querySelector('#countdown').textContent === '1', { timeout: 120000, polling: 'raf' });
  assert.equal(await page.evaluate(() => window.game.state.time), frozenTime, `${label}: physics stays paused at one`);
  await page.waitForFunction(() => window.game.state.phase === 'playing', { timeout: 120000, polling: 'raf' });
  assertions += 4;
  await page.waitForFunction(() => window.game.state.phase === 'over', { timeout: 120000, polling: 'raf' });
  const deathVisual = await page.evaluate(() => ({ y: window.game.view.witch.group.position.y, light: window.game.view.witch.light.intensity, cloak: window.game.view.witch.cloakMaterial.color.r }));
  assert.ok(deathVisual.y < -3.6, `${label}: witch remains at water after death`);
  assert.ok(deathVisual.light < 1, `${label}: witch remains dim after death`);
  assert.ok(deathVisual.cloak < .3, `${label}: cloak remains dim after death`);
  assertions += 3;
  await visibleControls(page, `${label} over`, true);
  await page.screenshot({ path: path.join(shots, `${label}-over.png`) });
}

async function regressionChecks(browser) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await page.goto(`${base}?seed=42&quality=low&debug=1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.game?.debug);
    const title = await page.$eval('#title-card h1', heading => {
      const box = heading.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await page.touchscreen.tap(title.x, title.y);
    await page.waitForFunction(() => window.game.state.phase === 'playing');
    assertions++;
    const score = await page.$eval('#score', element => {
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await page.evaluate(() => { window.game.state.velocity = 0; });
    await page.touchscreen.tap(score.x, score.y);
    await page.waitForFunction(() => window.game.state.velocity > 2, { timeout: 3000 });
    assertions++;
    const dots = await page.$eval('#streak-dots', element => {
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await page.evaluate(() => { window.game.state.velocity = 0; });
    await page.touchscreen.tap(dots.x, dots.y);
    await page.waitForFunction(() => window.game.state.velocity > 2, { timeout: 3000 });
    assertions++;

    const spacing = await page.evaluate(async () => {
      const rules = await import(new URL('./src/rules.js', document.baseURI));
      const state = window.game.state;
      const initial = state.gates[0].z - state.gates[1].z;
      function passAt(score, halfGap, y) {
        state.phase = 'playing';
        state.score = score;
        state.time = 0;
        state.y = y;
        state.velocity = 0;
        state.shield = false;
        state.invulnerableUntil = 0;
        state.activeGust = 0;
        state.gustUntil = 0;
        state.streak = 0;
        document.querySelector('#toast').classList.remove('show');
        const gate = rules.makeGate(20, rules.PLAYER_Z, score, rules.seededRandom(1));
        gate.baseY = 0;
        gate.halfGap = halfGap;
        gate.gust = 0;
        const next = rules.makeGate(21, gate.z - rules.gateSpacing(score), score, rules.seededRandom(2), gate);
        next.gust = 0;
        state.gates = [gate, next];
        window.game.debug.advance(rules.FIXED_STEP);
        gate.z = rules.PLAYER_Z + rules.GATE_FRONT + rules.WITCH_BACK + .02;
        window.game.debug.advance(rules.FIXED_STEP);
        const popups = [...document.querySelectorAll('#score-pop.show, #toast.show')].map(element => element.textContent);
        return { score: state.score, distance: state.gates[0].z - state.gates[1].z, popups };
      }
      return { initial, ordinary: passAt(19, 2, 0), nearMiss: passAt(19, 1, .5) };
    });
    assert.ok(Math.abs(spacing.initial - 7.4) < 1e-6);
    assert.equal(spacing.ordinary.score, 20);
    assert.ok(Math.abs(spacing.ordinary.distance - 6.29) < 1e-6);
    assert.equal(spacing.nearMiss.score, 21);
    assert.ok(Math.abs(spacing.nearMiss.distance - 6.29) < 1e-6);
    assert.deepEqual(spacing.nearMiss.popups, ['+2 near miss'], 'near miss creates exactly one popup');
    assertions += 6;

    const gateOutcomes = await page.evaluate(async () => {
      const rules = await import(new URL('./src/rules.js', document.baseURI));
      const state = window.game.state;
      function newGate(z, halfGap = 2) {
        state.phase = 'playing';
        state.time = 0;
        state.score = 0;
        state.y = 0;
        state.velocity = 0;
        state.shield = false;
        state.streak = 0;
        state.invulnerableUntil = 0;
        state.activeGust = 0;
        state.gustUntil = 0;
        const gate = rules.makeGate(0, z, 0, rules.seededRandom(3));
        gate.baseY = 0;
        gate.fireflyY = 0;
        gate.halfGap = halfGap;
        gate.gust = 0;
        state.gates = [gate];
        return gate;
      }
      function step(gate, y, z) {
        state.y = y;
        state.velocity = 0;
        gate.z = z;
        window.game.debug.advance(rules.FIXED_STEP);
      }
      function wispPath(atCrossing, atClearance) {
        const crossing = rules.PLAYER_Z - rules.WISP_DEPTH_OFFSET;
        const gate = newGate(crossing - .02);
        step(gate, atCrossing, crossing - .02);
        const recorded = gate.wispCaught;
        step(gate, atClearance, rules.PLAYER_Z + rules.GATE_FRONT + rules.WITCH_BACK + .02);
        return { recorded, streak: state.streak, passed: gate.passed };
      }
      function nearPath(first, second) {
        const gate = newGate(rules.PLAYER_Z, 1);
        step(gate, first, rules.PLAYER_Z);
        step(gate, second, rules.PLAYER_Z + .9);
        step(gate, 0, rules.PLAYER_Z + rules.GATE_FRONT + rules.WITCH_BACK + .02);
        return { score: state.score, minimum: gate.minimumClearance, passed: gate.passed };
      }
      function afterOverlap() {
        const gate = newGate(rules.PLAYER_Z, 1);
        step(gate, 0, rules.PLAYER_Z);
        step(gate, .5, rules.PLAYER_Z + rules.GATE_FRONT + rules.WITCH_BACK - .03);
        step(gate, 0, rules.PLAYER_Z + rules.GATE_FRONT + rules.WITCH_BACK + .02);
        return state.score;
      }
      function shieldHit() {
        const gate = newGate(rules.PLAYER_Z, 1);
        state.shield = true;
        state.streak = 4;
        step(gate, 1.8, rules.PLAYER_Z);
        return { phase: state.phase, shield: state.shield, streak: state.streak, hit: gate.hit,
          label: document.querySelector('#streak-dots').getAttribute('aria-label'),
          filled: document.querySelectorAll('#streak-dots .filled').length };
      }
      return { toward: wispPath(.9, 0), away: wispPath(0, .9),
        early: nearPath(.5, 0), late: nearPath(0, .5), after: afterOverlap(), shield: shieldHit() };
    });
    assert.deepEqual(gateOutcomes.toward, { recorded: false, streak: 0, passed: true });
    assert.deepEqual(gateOutcomes.away, { recorded: true, streak: 1, passed: true });
    for (const path of [gateOutcomes.early, gateOutcomes.late]) {
      assert.equal(path.score, 2);
      assert.ok(path.minimum >= 0 && path.minimum < .27);
      assert.equal(path.passed, true);
    }
    assert.equal(gateOutcomes.after, 1, 'height changes after overlap do not earn a near miss');
    assert.deepEqual(gateOutcomes.shield, { phase: 'playing', shield: false, streak: 0, hit: true,
      label: 'Wisps: 0 of 5', filled: 0 });
    assertions += 10;

    const regressions = await page.evaluate(async () => {
      const rules = await import(new URL('./src/rules.js', document.baseURI));
      const THREE = await import('three');
      const game = window.game;
      function flight(frameSeconds, frames) {
        let backlog = 0;
        let flightState = { y: 0, velocity: 3.6 };
        for (let frame = 0; frame < frames; frame++) {
          const steps = rules.fixedSteps(backlog, frameSeconds);
          backlog = steps.backlog;
          for (let step = 0; step < steps.count; step++) {
            flightState = rules.physicsStep(flightState.y, flightState.velocity, rules.FIXED_STEP);
          }
        }
        return flightState;
      }
      function collision(sign, outside) {
        const state = game.state;
        const witch = game.view.witch;
        witch.group.rotation.set(.03, 0, sign * .27);
        witch.group.updateMatrixWorld(true);
        const bounds = new THREE.Box3();
        bounds.setFromObject(witch.solid);
        const drawnReach = Math.max(bounds.max.y - witch.group.position.y, witch.group.position.y - bounds.min.y);
        const gate = rules.makeGate(6, rules.PLAYER_Z, 0, rules.seededRandom(7));
        gate.baseY = 0;
        gate.halfGap = 1.48;
        state.gates = [gate];
        state.phase = 'playing';
        state.time = 0;
        state.score = 0;
        state.shield = false;
        state.velocity = 0;
        state.invulnerableUntil = 0;
        const boundary = gate.halfGap - (witch.collision.vertical - rules.COLLISION_FORGIVENESS);
        state.y = sign * (boundary + (outside ? .01 : -.01));
        game.debug.advance(rules.FIXED_STEP);
        return { phase: state.phase, drawnReach, collisionReach: witch.collision.vertical };
      }
      function depth() {
        const state = game.state;
        const gate = rules.makeGate(6, rules.PLAYER_Z + rules.GATE_FRONT + rules.WITCH_BACK - .05, 0, rules.seededRandom(7));
        gate.baseY = 0;
        state.gates = [gate];
        state.phase = 'playing';
        state.time = 0;
        state.score = 0;
        state.y = 0;
        state.velocity = 0;
        game.debug.advance(rules.FIXED_STEP);
        const before = { score: state.score, passed: gate.passed };
        gate.z = rules.PLAYER_Z + rules.GATE_FRONT + rules.WITCH_BACK + .01;
        game.debug.advance(rules.FIXED_STEP);
        return { before, after: { score: state.score, passed: gate.passed }, retained: state.gates.includes(gate) };
      }
      function shakeDecay() {
        const view = game.view;
        view.witch.group.rotation.z = 0;
        view.shake();
        for (let frame = 0; frame < 5; frame++) view.render(game.state, frame * .02, .02);
        const fast = view.shakeAmount;
        const fastTilt = view.witch.group.rotation.z;
        view.witch.group.rotation.z = 0;
        view.shake();
        for (let frame = 0; frame < 2; frame++) view.render(game.state, frame * .05, .05);
        return { fast, slow: view.shakeAmount, fastTilt, slowTilt: view.witch.group.rotation.z };
      }
      return { fast: flight(.016, 125), slow: flight(.05, 40),
        insideUpper: collision(1, false), outsideUpper: collision(1, true),
        insideLower: collision(-1, false), outsideLower: collision(-1, true), depth: depth(), shake: shakeDecay() };
    });
    assert.ok(Math.abs(regressions.fast.y - regressions.slow.y) < 1e-6);
    assert.ok(Math.abs(regressions.fast.velocity - regressions.slow.velocity) < 1e-6);
    assert.equal(regressions.insideUpper.phase, 'playing');
    assert.equal(regressions.insideLower.phase, 'playing');
    assert.equal(regressions.outsideUpper.phase, 'dying');
    assert.equal(regressions.outsideLower.phase, 'dying');
    for (const edge of [regressions.insideUpper, regressions.insideLower, regressions.outsideUpper, regressions.outsideLower]) {
        assert.ok(edge.drawnReach > .4 && edge.drawnReach <= edge.collisionReach + 1e-9);
    }
    assert.deepEqual(regressions.depth.before, { score: 0, passed: false });
    assert.ok(regressions.depth.after.score >= 1 && regressions.depth.after.passed);
    assert.equal(regressions.depth.retained, true);
    assert.ok(regressions.shake.fast > 0 && regressions.shake.fast < .05);
    assert.ok(Math.abs(regressions.shake.fast - regressions.shake.slow) < 1e-9);
    assert.ok(Math.abs(regressions.shake.fastTilt) > 0);
    assert.ok(Math.abs(regressions.shake.fastTilt - regressions.shake.slowTilt) < 1e-9);
    assertions += 17;

    const playingHide = await page.evaluate(() => {
      const state = window.game.state;
      window.testHidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.testHidden });
      state.phase = 'playing';
      window.testHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      const phase = state.phase;
      window.testHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      return phase;
    });
    assert.equal(playingHide, 'paused');
    await page.click('#resume');
    await page.waitForFunction(() => window.game.state.phase === 'countdown');
    const countdownHide = await page.evaluate(() => {
      window.testHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      return { phase: window.game.state.phase, hiddenCountdown: document.querySelector('#countdown').classList.contains('hidden') };
    });
    assert.deepEqual(countdownHide, { phase: 'paused', hiddenCountdown: true });
    assertions += 2;
    console.log('PASS touch, physics, edge, depth, and visibility regressions');
  } finally {
    await page.close();
  }
}

async function caughtWispVisualCheck(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}?seed=42&quality=low&debug=1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.game?.debug);
    const visual = await page.evaluate(async () => {
      const rules = await import(new URL('./src/rules.js', document.baseURI));
      const { state, view, debug } = window.game;
      const gate = rules.makeGate(30, rules.PLAYER_Z - rules.WISP_DEPTH_OFFSET - .02, 0, rules.seededRandom(3));
      gate.baseY = 0;
      gate.fireflyY = 0;
      gate.halfGap = 2;
      gate.gust = 0;
      state.gates = [gate];
      state.phase = 'playing';
      state.time = 0;
      state.y = 0;
      state.velocity = 0;
      debug.advance(rules.FIXED_STEP);
      view.render(state, 1, rules.FIXED_STEP);
      const mesh = view.gateVisuals.get(gate.index).fly;
      return { caught: gate.wispCaught, gateVisible: mesh.parent.visible, wispVisible: mesh.visible };
    });
    assert.deepEqual(visual, { caught: true, gateVisible: true, wispVisible: false },
      'caught wisp mesh is hidden in the first rendered frame');
    assertions++;
    console.log('PASS caught wisp visual');
  } finally {
    await page.close();
  }
}

async function restartSparksCheck(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}?seed=42&quality=low`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.game);
    await page.click('#start');
    await page.waitForFunction(() => window.game.state.phase === 'playing');
    await page.waitForFunction(() => window.game.view.sparkMeshes.length === 6, { timeout: 1000 });
    assertions++;
    await page.waitForFunction(() => window.game.state.phase === 'over', { timeout: 15000 });
    const ended = await page.evaluate(() => ({ lastPuff: window.game.state.lastPuff, sparks: window.game.view.sparkMeshes.length }));
    assert.deepEqual(ended, { lastPuff: 0, sparks: 0 }, 'first run ends without another puff');
    assertions++;
    await page.click('#again');
    await page.waitForFunction(() => window.game.state.phase === 'playing');
    const sparks = await page.evaluate(async () => {
      const THREE = await import('three');
      const { view } = window.game;
      view.camera.updateMatrixWorld(true);
      return view.sparkMeshes.map(mesh => {
        const point = mesh.getWorldPosition(new THREE.Vector3()).project(view.camera);
        return { visible: Boolean(mesh.parent && mesh.visible && mesh.scale.x > 0),
          x: (point.x + 1) / 2, y: (1 - point.y) / 2, z: point.z };
      });
    });
    assert.ok(sparks.length > 0 && sparks.every(spark => spark.visible), 'opening sparks remain visible after Play again');
    assert.ok(sparks.some(spark => spark.x >= 0 && spark.x <= 1 && spark.y >= 0 && spark.y <= 1 && spark.z >= -1 && spark.z <= 1),
      'an opening spark projects inside the viewport');
    assertions++;
    console.log('PASS opening sparks after Play again');
  } finally {
    await page.close();
  }
}

async function audioResumeFailureCheck(browser) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.evaluateOnNewDocument(() => {
      window.AudioContext = class {
        state = 'suspended';
        resume() { return Promise.reject(new Error('resume blocked')); }
      };
      window.addEventListener('unhandledrejection', event => {
        window.audioUnhandled = event.reason?.message || String(event.reason);
      });
    });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await page.goto(`${base}?seed=42&quality=low`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.game);
    const start = await page.$eval('#start', button => {
      const box = button.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await page.touchscreen.tap(start.x, start.y);
    await page.waitForFunction(() => window.game.state.phase === 'playing');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => window.audioUnhandled), undefined);
    assertions += 3;
    console.log('PASS rejected audio resume');
  } finally {
    await page.close();
  }
}

async function musicSchedulerCheck(browser) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await page.goto(`${base}?seed=42&quality=low`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.game);
    assert.equal(await page.evaluate(() => window.game.music.scheduledOscillators), 0, 'no music before gesture');
    await page.click('#start');
    await page.waitForFunction(() => window.game.state.phase === 'playing');
    await page.waitForFunction(() => window.game.music.scheduledOscillators >= 4, { timeout: 5000 });
    const playing = await page.evaluate(() => window.game.music);
    assert.ok(playing.activeVoices <= playing.maxVoices);
    await page.click('#mute');
    await page.evaluate(() => { window.game.state.velocity = 0; });
    const muteLabel = await page.$eval('#mute', button => button.getAttribute('aria-label'));
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'pointer click restores body focus');
    await page.keyboard.press('Space');
    assert.ok(await page.evaluate(() => window.game.state.velocity > 0), 'Space lifts the witch after a mute click');
    assert.equal(await page.$eval('#mute', button => button.getAttribute('aria-label')), muteLabel, 'Space does not toggle mute again');
    await page.click('#mute');
    await page.focus('#pause');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'mute', 'Tab reaches the mute button');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#mute', button => button.getAttribute('aria-label')), 'Unmute sound', 'Enter changes sound once');
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'keyboard activation restores game focus');
    await page.evaluate(() => { window.game.state.velocity = 0; });
    await page.keyboard.press('Space');
    assert.ok(await page.evaluate(() => window.game.state.velocity > 0), 'Space flies after keyboard mute activation');
    assert.equal(await page.$eval('#mute', button => button.getAttribute('aria-label')), 'Unmute sound', 'Space does not toggle sound again');
    await page.focus('#mute');
    await page.evaluate(() => { window.game.state.velocity = 0; });
    await page.keyboard.press('ArrowUp');
    assert.ok(await page.evaluate(() => window.game.state.velocity > 0), 'Up flies with mute button focused');
    assert.equal(await page.$eval('#mute', button => button.getAttribute('aria-label')), 'Unmute sound', 'Up does not toggle sound');
    await page.keyboard.press('Space');
    assert.equal(await page.$eval('#mute', button => button.getAttribute('aria-label')), 'Mute sound', 'Space activates a focused button once');
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'Space activation restores game focus');
    assertions += 9;
    await page.click('#music-mute');
    // Same focus rule as #mute: a pointer click must hand focus back so Space still flies.
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'music mute click restores body focus');
    const musicMuteLabel = await page.$eval('#music-mute', button => button.getAttribute('aria-label'));
    await page.evaluate(() => { window.game.state.velocity = 0; });
    await page.keyboard.press('Space');
    assert.ok(await page.evaluate(() => window.game.state.velocity > 0), 'Space lifts the witch after a music mute click');
    assert.equal(await page.$eval('#music-mute', button => button.getAttribute('aria-label')), musicMuteLabel, 'Space does not toggle music mute again');
    await new Promise(resolve => setTimeout(resolve, 300));
    const muted = await page.evaluate(() => window.game.music.scheduledOscillators);
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(await page.evaluate(() => window.game.music.scheduledOscillators), muted, 'music only mute stops scheduling');
    await page.click('#music-mute');
    await page.waitForFunction(before => window.game.music.scheduledOscillators > before, { timeout: 5000 }, muted);
    await page.focus('#mute');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'music-mute', 'Tab reaches the music button');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#music-mute', button => button.getAttribute('aria-label')), 'Unmute music', 'Enter changes music once');
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'keyboard music activation restores game focus');
    await page.evaluate(() => { window.game.state.velocity = 0; });
    await page.keyboard.press('Space');
    assert.ok(await page.evaluate(() => window.game.state.velocity > 0), 'Space flies after keyboard music activation');
    assert.equal(await page.$eval('#music-mute', button => button.getAttribute('aria-label')), 'Unmute music', 'Space does not toggle music again');
    await page.click('#music-mute');
    assertions += 5;
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    const hidden = await page.evaluate(() => ({ count: window.game.music.scheduledOscillators, phase: window.game.state.phase }));
    assert.equal(hidden.phase, 'paused', 'hidden page pauses play');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(await page.evaluate(() => window.game.music.scheduledOscillators), hidden.count, 'hidden page stops scheduling');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.click('#resume');
    await page.waitForFunction(() => window.game.state.phase === 'playing', { timeout: 10000 });
    await page.waitForFunction(before => window.game.music.scheduledOscillators > before, { timeout: 5000 }, hidden.count);
    await page.click('#pause');
    await new Promise(resolve => setTimeout(resolve, 300));
    const paused = await page.evaluate(() => window.game.music.scheduledOscillators);
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(await page.evaluate(() => window.game.music.scheduledOscillators), paused, 'pause stops scheduling');
    const stored = await page.evaluate(() => ({ sound: localStorage.getItem('flappy-witch-muted'), music: localStorage.getItem('flappy-witch-music-muted') }));
    assert.equal(stored.music, 'false');
    await page.click('#music-mute');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#music-mute', button => button.getAttribute('aria-label')), 'Unmute music');
    assertions += 19;
    console.log('PASS music scheduler, mute, pause, and hidden state');
  } finally {
    await page.close();
  }
}

async function musicVoiceCapCheck(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}?quality=low`, { waitUntil: 'networkidle0' });
    const result = await page.evaluate(async () => {
      const { createMusic } = await import(new URL('./src/music.js', document.baseURI));
      const context = new OfflineAudioContext(1, 22050, 22050);
      const music = createMusic(context, context.destination, 3);
      for (let index = 0; index < 5; index++) {
        music.renderEvent({ layer: 'box', frequency: 587.33, duration: .1, accent: 1 }, .01);
      }
      const during = { active: music.activeVoices, scheduled: music.scheduledOscillators, cap: music.maxVoices };
      await context.startRendering();
      return { during, after: music.activeVoices };
    });
    assert.deepEqual(result.during, { active: 3, scheduled: 3, cap: 3 }, 'voices beyond the injected cap are rejected');
    assert.equal(result.after, 0, 'all voices leave the active set after ending');
    assertions += 2;
    console.log('PASS overlapping music voice cap and source cleanup');
  } finally {
    await page.close();
  }
}

async function fullMuteAndGameOverCheck(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}?seed=42&quality=low`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.game);
    if (await page.$eval('#music-mute', button => button.getAttribute('aria-label')) === 'Unmute music') {
      await page.click('#music-mute');
    }
    await page.click('#start');
    await page.waitForFunction(() => window.game.music.scheduledLayers.box > 0);
    const titleMusic = await page.evaluate(() => ({ phase: window.game.state.phase, layers: window.game.music.scheduledLayers }));
    assert.equal(titleMusic.phase, 'title', 'first gesture keeps the title visible for its cue');
    assert.ok(titleMusic.layers.drone > 0 && titleMusic.layers.box > 0, 'title cue has drone and music box');
    assert.equal(titleMusic.layers.bass, 0, 'title cue has no bass');
    assert.equal(titleMusic.layers.tick, 0, 'title cue has no percussion');
    await page.waitForFunction(() => window.game.state.phase === 'playing');
    await page.waitForFunction(() => window.game.music.scheduledLayers.bass > 0);
    await page.click('#mute');
    const before = await page.evaluate(() => ({ music: window.game.music.scheduledOscillators, effects: window.game.audio.scheduledEffects }));
    await page.mouse.click(200, 500);
    await new Promise(resolve => setTimeout(resolve, 300));
    const after = await page.evaluate(() => ({ music: window.game.music.scheduledOscillators, effects: window.game.audio.scheduledEffects }));
    assert.deepEqual(after, before, 'full mute stops music and effects');
    assert.equal(await page.evaluate(() => localStorage.getItem('flappy-witch-muted')), 'true');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#mute', button => button.getAttribute('aria-label')), 'Unmute sound');
    assert.equal(await page.evaluate(() => window.game.music.scheduledOscillators), 0, 'stored mute prevents title audio');
    await page.click('#mute');
    await page.waitForFunction(() => window.game.music.scheduledOscillators > 0);
    await page.click('#start');
    await page.waitForFunction(() => window.game.state.phase === 'playing');
    const droneBefore = await page.evaluate(() => window.game.music.scheduledLayers.drone);
    await page.evaluate(() => { window.game.state.phase = 'dying'; window.game.state.deathTime = window.game.state.time; });
    await page.waitForFunction(() => window.game.music.gameOverTransitions === 1);
    const dying = await page.evaluate(() => window.game.music);
    assert.ok(dying.scheduledLayers.drone > droneBefore, 'game over schedules an immediate drone');
    assert.ok(dying.activeVoices > 0, 'game over drone remains active');
    await page.evaluate(() => { window.game.state.phase = 'over'; });
    await new Promise(resolve => setTimeout(resolve, 150));
    const over = await page.evaluate(() => window.game.music);
    assert.equal(over.gameOverTransitions, 1, 'dying to over keeps one filter sweep');
    assert.ok(over.activeVoices > 0, 'drone continues into over');
    assertions += 13;
    console.log('PASS full mute persistence and game-over drone');
  } finally {
    await page.close();
  }
}

async function hiddenTitleCueCheck(browser) {
  const page = await browser.newPage();
  try {
    await page.evaluateOnNewDocument(() => {
      const originalSet = window.setTimeout.bind(window);
      const originalClear = window.clearTimeout.bind(window);
      const launchId = 987654321;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay !== 1100) return originalSet(callback, delay, ...args);
        window.deferredLaunch = { canceled: false, fire() { if (!this.canceled) callback(...args); } };
        return launchId;
      };
      window.clearTimeout = id => {
        if (id === launchId) window.deferredLaunch.canceled = true;
        else originalClear(id);
      };
    });
    await page.goto(`${base}?seed=42&quality=low`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.game);
    if (await page.$eval('#music-mute', button => button.getAttribute('aria-label')) === 'Unmute music') {
      await page.click('#music-mute');
    }
    await page.click('#start');
    await page.waitForFunction(() => document.querySelector('#start').disabled);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      window.deferredLaunch.fire();
    });
    assert.equal(await page.evaluate(() => window.deferredLaunch.canceled), true, 'hidden cue cancels the deferred callback');
    assert.equal(await page.evaluate(() => window.game.state.phase), 'title', 'hidden title cue does not start a run');
    assert.equal(await page.$eval('#start', button => button.disabled), false, 'Start is available after return');
    await page.click('#start');
    await page.waitForFunction(() => window.game.state.phase === 'playing' || document.querySelector('#start').disabled, { timeout: 15000 });
    await page.evaluate(() => { if (window.game.state.phase === 'title') window.deferredLaunch.fire(); });
    await page.waitForFunction(() => window.game.state.phase === 'playing', { timeout: 15000 });
    assertions += 4;
    console.log('PASS hidden title cue cancellation');
  } finally {
    await page.close();
  }
}

async function subpathCheck() {
  const gameUrl = routes.gameUrl;
  const health = await fetch(gameUrl);
  assert.equal(health.status, 200, `subpath server available at ${gameUrl}`);
  await mkdir(shots, { recursive: true });
  const browser = await launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${own.hostname}`],
  });
  try {
    for (const [label, width, height, touch] of [matrix[0], matrix.at(-1)]) {
      const page = await browser.newPage();
      const requests = [];
      const arcadeNavigations = [];
      const errors = [];
      let visitingGame = true;
      let allowArcadeNavigation = false;
      page.on('request', request => {
        if (allowArcadeNavigation && request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          arcadeNavigations.push(request.url());
          // The arcade page owns its later asset requests after this document navigation.
          visitingGame = false;
          return;
        }
        if (!visitingGame) return;
        if (request.url().startsWith('http')) requests.push(request.url());
      });
      page.on('response', response => {
        if (visitingGame && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (visitingGame && message.type() === 'error') errors.push(message.text()); });
      try {
        await page.setViewport({ width, height, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
        await page.goto(gameUrl.href, { waitUntil: 'networkidle0', timeout: 120000 });
        await page.waitForFunction(() => window.game?.view && document.querySelector('canvas')?.width > 0);
        await visibleControls(page, `${label} title`, touch);
        await page.screenshot({ path: path.join(shots, `${label}-subpath-title.png`) });
        assert.ok(requests.length >= 4, `${label}: game assets requested`);
        for (const url of requests) {
          const requested = new URL(url);
          assert.ok(sameHost(url) && requested.pathname.startsWith(routes.gamePath), `${label}: request stayed in game path: ${url}`);
        }
        assert.deepEqual(errors, [], `${label}: game loaded without errors`);
        assertions += requests.length + 2;

        await page.focus('#arcade-back');
        await page.keyboard.press('Space');
        assert.equal(await page.evaluate(() => window.game.state.phase), 'title', `${label}: Space on arcade link does not start play`);
        assertions++;
        if (touch) {
          allowArcadeNavigation = true;
          const [navigation] = await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#arcade-back')]);
          assert.equal(navigation.status(), 200, 'title arcade document loaded');
          assert.equal(arcadeNavigations.length, 1, 'title caused one arcade navigation');
          assert.ok(sameHost(arcadeNavigations[0]) && new URL(arcadeNavigations[0]).pathname === routes.arcadePath, 'title link opens this arcade');
          assert.ok(sameHost(page.url()) && new URL(page.url()).pathname === routes.arcadePath, 'title remains on this arcade');
          assertions += 4;
          allowArcadeNavigation = false;
          visitingGame = true;
          requests.length = 0;
          errors.length = 0;
          await page.goto(gameUrl.href, { waitUntil: 'networkidle0', timeout: 120000 });
          await page.waitForFunction(() => window.game?.view);
          await playByTouch(page, label, width, height);
        } else {
          await page.click('#start');
          await page.waitForFunction(() => window.game.state.phase === 'playing', { timeout: 120000 });
          await visibleControls(page, `${label} playing`, false);
          await page.waitForFunction(() => window.game.state.phase === 'over', { timeout: 120000, polling: 'raf' });
          await visibleControls(page, `${label} over`, false);
          await page.screenshot({ path: path.join(shots, `${label}-subpath-over.png`) });
        }
        assert.deepEqual(errors, [], `${label}: play loaded without errors`);
        for (const url of requests) {
          const requested = new URL(url);
          assert.ok(sameHost(url) && requested.pathname.startsWith(routes.gamePath), `${label}: request stayed in game path: ${url}`);
        }
        assertions += requests.length + 1;
        allowArcadeNavigation = true;
        const [navigation] = await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#arcade-back')]);
        assert.equal(navigation.status(), 200, `${label}: arcade document loaded`);
        assert.equal(arcadeNavigations.length, touch ? 2 : 1, `${label}: one arcade navigation from game over`);
        const destination = arcadeNavigations.at(-1);
        assert.ok(sameHost(destination) && new URL(destination).pathname === routes.arcadePath, `${label}: game over link opens this arcade`);
        assert.ok(sameHost(page.url()) && new URL(page.url()).pathname === routes.arcadePath, `${label}: game over remains on this arcade`);
        assertions += 4;
        console.log(`PASS ${label} subpath`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`PASS subpath, ${assertions} assertions; screenshots in ${shots}`);
}

async function offlineAppCheck() {
  const server = await startObservedServer(root, routes.gamePath);
  const heldIcon = server.holdFile(`${routes.gamePath}icons/icon-maskable-512.png`);
  const offlineBase = new URL(routes.gamePath, server.base);
  let browser;
  let context;
  let page;
  try {
    browser = await launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog',
        `--proxy-server=${server.proxy}`, '--proxy-bypass-list=<-loopback>',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
    });
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await page.goto(`${offlineBase}?seed=42&quality=low`, { waitUntil: 'load', timeout: 120000 });
    await heldIcon.waitForRequest();
    const beforeInstall = await page.evaluate(() => ({ controlled: Boolean(navigator.serviceWorker?.controller),
      noteVisible: getComputedStyle(document.querySelector('#offline-ready')).display !== 'none' }));
    assert.deepEqual(beforeInstall, { controlled: false, noteVisible: false }, 'offline note waits for the complete cache');
    assertions++;
    heldIcon.release();
    await page.waitForFunction(() => window.game?.view && navigator.serviceWorker?.controller &&
      getComputedStyle(document.querySelector('#offline-ready')).display !== 'none', { timeout: 60000 });
    const readyNote = await page.evaluate(() => {
      const note = document.querySelector('#offline-ready');
      const noteBox = note.getBoundingClientRect();
      const controls = [...document.querySelectorAll('button, #arcade-back')].filter(control => control.getClientRects().length);
      return { text: note.textContent, live: note.getAttribute('aria-live'),
        overlapsControl: controls.some(control => {
          const box = control.getBoundingClientRect();
          return noteBox.left < box.right && noteBox.right > box.left && noteBox.top < box.bottom && noteBox.bottom > box.top;
        }) };
    });
    assert.deepEqual(readyNote, { text: 'Ready to play offline', live: 'polite', overlapsControl: false });
    assertions++;
    const manifest = await page.appManifest();
    assert.deepEqual(manifest.errors, [], 'Chromium reads the app manifest without errors');
    assertions++;
    assert.ok(server.forwardedPaths.filter(file => file.startsWith(routes.gamePath)).length >= 4,
      'online game files passed through the controllable proxy');
    assertions++;

    await page.clearHttpCache();
    const workerCount = await page.setOfflineEverywhere(true);
    assert.ok(workerCount >= 1, 'the service worker target is offline too');
    assertions++;
    server.begin();
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.game?.view && document.querySelector('canvas')?.width > 0, { timeout: 60000 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#offline-ready')).display !== 'none', { timeout: 60000 });
    assertions++;
    assert.ok((await page.verifyOfflineWorkers()) >= 1, 'every current service worker is cut off');
    assertions++;
    const resources = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const files = performance.getEntriesByType('resource').filter(entry => !entry.name.startsWith('data:') && !entry.name.startsWith('blob:'));
      return {
        navigationFromWorker: navigation.workerStart > 0,
        count: files.length,
        missed: files.filter(entry => entry.workerStart === 0).map(entry => entry.name),
      };
    });
    assert.ok(resources.navigationFromWorker, 'the offline reload came through the service worker');
    assert.ok(resources.count >= 10, 'the offline reload loaded the game assets');
    assert.deepEqual(resources.missed, [], 'every offline resource came through the service worker');
    assertions += 3;

    const arcade = await page.evaluate(() => {
      const link = document.querySelector('#arcade-back');
      const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
      const hiddenAsApp = rules.filter(rule => rule instanceof CSSMediaRule && rule.media.mediaText === '(display-mode: standalone)')
        .flatMap(rule => [...rule.cssRules])
        .some(rule => link.matches(rule.selectorText) && rule.style.display === 'none');
      return { shownInTab: getComputedStyle(link).display !== 'none', hiddenAsApp };
    });
    assert.deepEqual(arcade, { shownInTab: true, hiddenAsApp: true });
    assertions++;

    await playByTouch(page, 'offline app', 390, 844);
    assert.ok((await page.verifyOfflineWorkers()) >= 1, 'workers remain cut off during play');
    assertions++;
    const offlineRequests = await server.end();
    assert.deepEqual(offlineRequests, [], 'the static server received no game-file requests while offline');
    assertions++;
    assert.deepEqual(unexpectedBlockedRequests(server.blockedRequests, routes.gamePath), [],
      'the proxy blocked no game-file request except Chromium checking the service worker script');
    assertions++;
    const score = await page.evaluate(() => window.game.state.score);
    assert.ok(score >= 3, 'touch play scored gates while offline');
    assertions++;
    console.log(`PASS offline app: ${resources.count} resources from worker, score ${score}`);
  } finally {
    if (page) await page.setOfflineEverywhere(false).catch(() => {});
    await closeResources([page, context, browser, server]);
  }
}

if (process.argv.includes('--subpath')) {
  await checkAndPrune(subpathCheck, pruneShotRuns);
  process.exit(0);
}

if (process.argv.includes('--hidden-title')) {
  const browser = await launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
  try { await hiddenTitleCueCheck(browser); } finally { await browser.close(); }
  process.exit(0);
}

if (process.argv.includes('--offline-app')) {
  await mkdir(shots, { recursive: true });
  await checkAndPrune(offlineAppCheck, pruneShotRuns);
  process.exit(0);
}

try {
const health = await fetch(base);
assert.equal(health.status, 200, `game server available at ${base}`);
await mkdir(shots, { recursive: true });
const browser = await launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
  args: ['--no-sandbox', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${own.hostname}`],
});
try {
  for (const [label, width, height, touch] of matrix) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (!sameHost(request.url())) errors.push(`External request: ${request.url()}`); });
    page.on('workercreated', worker => {
      worker.client.on('Network.webSocketCreated', event => {
        if (!sameHost(event.url)) errors.push(`External worker socket: ${event.url}`);
      });
      worker.client.send('Network.enable').catch(error => errors.push(`Worker network monitor: ${error.message}`));
    });
    const client = await page.createCDPSession();
    client.on('Network.webSocketCreated', event => {
      if (!sameHost(event.url)) errors.push(`External socket: ${event.url}`);
    });
    await client.send('Network.enable');
    try {
      await page.setViewport({ width, height, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
      await page.goto(`${base}?seed=42&quality=low`, { waitUntil: 'networkidle0', timeout: 120000 });
      await page.waitForFunction(() => window.game && document.querySelector('canvas'));
      assert.ok(await page.evaluate(() => document.querySelector('canvas').width > 0));
      assertions++;
      const layout = await page.evaluate(() => {
        const label = document.querySelector('#score-label').getBoundingClientRect();
        const number = document.querySelector('#score').getBoundingClientRect();
        return { labelBottom: label.bottom, numberTop: number.top, bats: window.game.view.batCount };
      });
      assert.ok(layout.numberTop >= layout.labelBottom + 3, `${label}: score label clears number`);
      assert.ok(layout.bats > 0 && layout.bats <= 2, `${label}: low quality has at most two bats`);
      assertions += 2;
      await visibleControls(page, `${label} title`, touch);
      if (width / height < .8) await projectedStartingGate(page, label);
      await page.screenshot({ path: path.join(shots, `${label}-title.png`) });
      if (label === 'phone-390x844') {
        const titlePicture = await page.evaluate(() => {
          const point = window.game.view.witch.group.position.clone().project(window.game.view.camera);
          return { x: (point.x + 1) / 2, y: (1 - point.y) / 2, cardTop: document.querySelector('#title-card').getBoundingClientRect().top / innerHeight,
            gates: window.game.view.gateGroups.length, firstGateZ: window.game.view.gateGroups[0].position.z };
        });
        assert.ok(titlePicture.x > .1 && titlePicture.x < .42, 'title witch is left of center');
        assert.ok(titlePicture.y < titlePicture.cardTop, 'title witch shows above card');
        assert.ok(titlePicture.gates >= 2, 'title gates are drawn behind card');
        await page.waitForFunction(before => window.game.view.gateGroups[0].position.z > before + .12, { timeout: 120000, polling: 'raf' }, titlePicture.firstGateZ);
        assertions += 4;
      }
      if (label === 'phone-390x844' || label === 'ipad-820x1180') await playByTouch(page, label, width, height);
      if (label !== 'phone-390x844' && label !== 'ipad-820x1180') {
        const start = await page.$eval('#start', button => {
          const box = button.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        });
        if (touch) await page.touchscreen.tap(start.x, start.y);
        else await page.mouse.click(start.x, start.y);
        await page.waitForFunction(() => window.game.state.phase === 'playing');
        await waitForGameTime(page, .05);
        await visibleControls(page, `${label} playing`, touch);
        await projectedOpening(page, label);
        await projectedWitch(page, label, width, height);
        await page.screenshot({ path: path.join(shots, `${label}-play.png`) });
      }
      const externalLinks = await page.evaluate(() => [...document.querySelectorAll('link[href], script[src], img[src]')].map(node => node.href || node.src).filter(url => url && !url.startsWith('data:')));
      for (const url of externalLinks) assert.ok(sameHost(url), `${label}: no external link ${url}`);
      assertions += externalLinks.length;
      assert.deepEqual(errors, [], `${label}: browser errors`);
      assertions++;
      console.log(`PASS ${label}`);
      viewportPasses++;
    } catch (error) {
      failures.push(`${label}: ${error.stack || error}`);
      console.error(`FAIL ${label}: ${error.message}`);
    } finally {
      await client.detach();
      await page.close();
    }
  }
  if (process.env.BROWSER_CHECK_TEST_LATE_FAILURE === '1') {
    failures.push('injected non-viewport failure');
  }
  try {
    await regressionChecks(browser);
  } catch (error) {
    failures.push(`regressions: ${error.stack || error}`);
    console.error(`FAIL regressions: ${error.message}`);
  }
  try {
    await caughtWispVisualCheck(browser);
  } catch (error) {
    failures.push(`caught wisp visual: ${error.stack || error}`);
    console.error(`FAIL caught wisp visual: ${error.message}`);
  }
  try {
    await restartSparksCheck(browser);
  } catch (error) {
    failures.push(`restart sparks: ${error.stack || error}`);
    console.error(`FAIL restart sparks: ${error.message}`);
  }
  try {
    await audioResumeFailureCheck(browser);
  } catch (error) {
    failures.push(`audio resume: ${error.stack || error}`);
    console.error(`FAIL audio resume: ${error.message}`);
  }
  try {
    await musicSchedulerCheck(browser);
  } catch (error) {
    failures.push(`music scheduler: ${error.stack || error}`);
    console.error(`FAIL music scheduler: ${error.message}`);
  }
  try {
    await musicVoiceCapCheck(browser);
  } catch (error) {
    failures.push(`music voice cap: ${error.stack || error}`);
    console.error(`FAIL music voice cap: ${error.message}`);
  }
  try {
    await fullMuteAndGameOverCheck(browser);
  } catch (error) {
    failures.push(`full mute and game over: ${error.stack || error}`);
    console.error(`FAIL full mute and game over: ${error.message}`);
  }
  try {
    await hiddenTitleCueCheck(browser);
  } catch (error) {
    failures.push(`hidden title cue: ${error.stack || error}`);
    console.error(`FAIL hidden title cue: ${error.message}`);
  }
  try {
    await offlineAppCheck();
  } catch (error) {
    failures.push(`offline app: ${error.stack || error}`);
    console.error(`FAIL offline app: ${error.message}`);
  }
  const storagePage = await browser.newPage();
  try {
    await storagePage.evaluateOnNewDocument(() => {
      Storage.prototype.getItem = () => { throw new Error('storage blocked'); };
      Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
    });
    await storagePage.goto(`${base}?seed=42&quality=low`, { waitUntil: 'networkidle0' });
    await storagePage.waitForFunction(() => window.game);
    assert.equal(await storagePage.evaluate(() => window.game.state.best), 0);
    assertions++;
    console.log('PASS blocked storage boot');
  } catch (error) {
    failures.push(`blocked storage: ${error.stack || error}`);
    console.error(`FAIL blocked storage: ${error.message}`);
  } finally {
    await storagePage.close();
  }
  const resizePage = await browser.newPage();
  try {
    await resizePage.setViewport({ width: 1180, height: 820, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await resizePage.goto(`${base}?seed=42&quality=low`, { waitUntil: 'networkidle0' });
    await resizePage.waitForFunction(() => window.game);
    const startPoint = await resizePage.$eval('#start', button => {
      const box = button.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await resizePage.touchscreen.tap(startPoint.x, startPoint.y);
    await resizePage.waitForFunction(() => window.game.state.phase === 'playing');
    await resizePage.setViewport({ width: 820, height: 1180, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await resizePage.waitForFunction(() => document.querySelector('canvas').clientWidth === 820 && document.querySelector('canvas').clientHeight === 1180);
    await visibleControls(resizePage, 'tablet resize playing', true);
    await resizePage.screenshot({ path: path.join(shots, 'ipad-resize-playing.png') });
    assertions++;
    console.log('PASS tablet resize during play');
  } catch (error) {
    failures.push(`tablet resize: ${error.stack || error}`);
    console.error(`FAIL tablet resize: ${error.message}`);
  } finally {
    await resizePage.close();
  }
} finally {
  await browser.close();
}
console.log(viewportSummary(viewportPasses, matrix.length, assertions));
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  await mkdir(publishedShots, { recursive: true });
  for (const name of await readdir(shots)) {
    if (name.endsWith('.png')) await copyFile(path.join(shots, name), path.join(publishedShots, name));
  }
  console.log(`Published screenshots from ${shots}`);
}
} finally {
  await pruneShotRuns();
}
