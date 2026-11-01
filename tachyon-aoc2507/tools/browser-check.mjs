import puppeteer from 'puppeteer-core';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../server.mjs';
import {publishScreenshots, touchSizes} from './screenshots.mjs';

const known = [
  'title', 'input', 'campaign', 'void', 'blocks', 'rush', 'sizes', 'resize',
  'storage', 'storage-access', 'audio', 'memory', 'touch'
];
const requested = process.argv.slice(2);
const scenarios = requested.length ? requested : known;
if (!scenarios.length || scenarios.some(name => !known.includes(name))) {
  console.error(`Scenarios: ${known.join(', ')}`);
  process.exit(1);
}
const shotsDir = fileURLToPath(new URL('../shots/', import.meta.url));
await mkdir(shotsDir, {recursive: true});
const stagingDir = await mkdtemp(join(shotsDir, '.run-'));
const server = createServer();
await new Promise(
    (resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
let browser;
const errors = [];

async function newPage(
    context, width = 1280, height = 800, storageFailure = false,
    storageAccessFailure = false, audioFailure = false, viewportOptions = {}) {
  const page = await context.newPage();
  await page.setViewport({width, height, deviceScaleFactor: 1, ...viewportOptions});
  if (storageFailure)
    await page.evaluateOnNewDocument(() => {
      Storage.prototype.setItem = function() {
        throw new Error('Simulated quota error')
      };
    });
  if (storageAccessFailure)
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(window, 'localStorage', {
        get() { throw new Error('Simulated storage access error'); }
      });
    });
  if (audioFailure)
    await page.evaluateOnNewDocument(() => {
      window.__failedAudioResumes = 0;
      const original = AudioContext.prototype.resume;
      AudioContext.prototype.resume = function() {
        if (window.__failedAudioResumes++ === 0)
          return Promise.reject(new Error('Simulated resume error'));
        return original.call(this);
      };
    });
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' || Number(url.port) !== port)
      errors.push(`External request: ${request.url()}`);
  });
  page.on(
      'requestfailed',
      request => errors.push(`Failed request: ${request.url()} ${request.failure()?.errorText}`));
  const cdp = await page.createCDPSession();
  cdp.on('Network.webSocketCreated', event => {
    const url = new URL(event.url);
    if (url.hostname !== '127.0.0.1' || Number(url.port) !== port)
      errors.push(`External socket: ${event.url}`);
  });
  await cdp.send('Network.enable');
  await page.goto(base, {waitUntil: 'domcontentloaded', timeout: 30000});
  await page.waitForFunction(
      () => window.game && window.game.state.screen === 'title', {timeout: 30000});
  return page;
}
async function checkPage(page) {
  const links = await page.evaluate(
      () => [...document.querySelectorAll('link[href]')].map(link => link.href));
  for (const link of links) {
    // Inline data: URLs (the favicon) never reach the network.
    const isInline = new URL(link).protocol === 'data:';
    if (!isInline && new URL(link).hostname !== '127.0.0.1') errors.push(`External link: ${link}`);
  }
  const coveredButtons = await page.evaluate(() => {
    const screen = window.game.state.screen;
    const active = screen === 'game' ? document.querySelector('#hud') :
                                       document.querySelector(`#${screen}-screen`);
    const buttons = [
      document.querySelector('#mute-button'), document.querySelector('#brand-button'),
      ...active.querySelectorAll('button')
    ];
    return buttons.filter(button => {
      if (button.disabled || button.classList.contains('hidden')) return false;
      const rect = button.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const element =
          document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return element !== button && !button.contains(element);
    }).map(button => button.textContent.trim());
  });
  if (coveredButtons.length) throw new Error(`Covered buttons: ${coveredButtons.join(', ')}`);
  const sceneState = await page.evaluate(() => ({
    outside: game.straySceneObjects,
    visibleSparks: game.visibleSparkCount,
    phase: game.state.phase,
  }));
  if (sceneState.outside.length) {
    throw new Error(`Scene objects outside board: ${JSON.stringify(sceneState)}`);
  }
  if (sceneState.phase === 'attract' && sceneState.visibleSparks !== 0) {
    throw new Error(`Unused particles are visible: ${JSON.stringify(sceneState)}`);
  }
}

async function checkTouchControls(page) {
  const problems = await page.evaluate(() => {
    const controls = document.querySelectorAll('button, input, a[href]');
    const issues = [];
    const resultScreen = game.state.screen === 'result';
    for (const control of controls) {
      if (control.closest('.hidden') || getComputedStyle(control).visibility === 'hidden') continue;
      const rect = control.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      // Level and help panels have content reached by user scrolling, so a control that is wholly or
      // partly scrolled out of such a panel is reachable. Result actions must fit without scrolling.
      let outsideScrollPanel = false;
      for (let parent = control.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const scrolls = /(auto|scroll)/.test(style.overflowX + style.overflowY) &&
            (parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth);
        if (!scrolls) continue;
        const bounds = parent.getBoundingClientRect();
        const fullyInside = rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 &&
            rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
        if (!fullyInside) {
          outsideScrollPanel = true;
          break;
        }
      }
      if (outsideScrollPanel && !resultScreen) continue;
      const name = control.id || control.getAttribute('aria-label') || control.textContent.trim();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 ||
          rect.bottom > innerHeight + 1) issues.push(`${name}: outside viewport`);
      if (rect.width < 44 || rect.height < 44) issues.push(`${name}: ${rect.width}x${rect.height}`);
      for (let parent = control.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (!/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY))
          continue;
        const bounds = parent.getBoundingClientRect();
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ||
            rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) {
          issues.push(`${name}: clipped by ${parent.id || parent.className || parent.tagName}`);
          break;
        }
      }
      const top = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight ?
          document.elementFromPoint(x, y) : null;
      if (top !== control && !control.contains(top))
        issues.push(`${name}: covered by ${top?.id || top?.tagName}`);
      if (control.tagName !== 'INPUT' && getComputedStyle(control).touchAction !== 'manipulation')
        issues.push(`${name}: touch action`);
    }
    return issues;
  });
  if (problems.length) throw new Error(`Touch controls: ${problems.join('; ')}`);
}

async function checkResultCard(page) {
  const details = await page.evaluate(() => {
    const {result, level} = game.state;
    let expectedSegments = 0;
    for (let row = 1; row < level.grid.length; row++) {
      const previous = result.beamRows[row - 1];
      for (let col = 0; col < previous.length; col++) {
        if (!previous[col]) continue;
        // A beam runs into an empty cell, a splitter, or up to a block's face.
        const cell = result.grid[row][col];
        if (cell === '.' || cell === '#') expectedSegments++;
        if (cell !== '^') continue;
        expectedSegments++;
        for (const side of [col - 1, col + 1]) {
          const sideCell = result.grid[row][side];
          if (side >= 0 && side < previous.length && (sideCell === '.' || sideCell === '#')) {
            expectedSegments++;
          }
        }
      }
    }
    const card = document.querySelector('.result').getBoundingClientRect();
    const resultButtons = [...document.querySelectorAll('#result-screen button')]
        .filter(button => !button.closest('.hidden'));
    // The card's actions must exist; checking only buttons present would pass without them.
    // Rush offers no Retry, because replaying a solved board would pay its score again.
    const rush = game.state.mode === 'rush';
    const requiredActions = rush ? ['next', 'menu'] : ['next', 'retry', 'menu'];
    const missingResultActions = requiredActions.filter(action =>
        !resultButtons.some(button => button.dataset.action === action));
    if (rush && resultButtons.some(button => button.dataset.action === 'retry'))
      missingResultActions.push('retry hidden in Rush');
    const resultButtonProblems = missingResultActions.map(action => `missing ${action}`).concat(
        resultButtons.filter(button => {
          const bounds = button.getBoundingClientRect();
          const x = bounds.left + bounds.width / 2;
          const y = bounds.top + bounds.height / 2;
          const top = document.elementFromPoint(x, y);
          const insideViewport = bounds.left >= 0 && bounds.top >= 0 &&
              bounds.right <= innerWidth && bounds.bottom <= innerHeight;
          const insideCard = bounds.left >= card.left && bounds.top >= card.top &&
              bounds.right <= card.right && bounds.bottom <= card.bottom;
          return !insideViewport || !insideCard ||
              (top !== button && !button.contains(top));
        }).map(button => button.textContent.trim()));
    const starTextProblems = [...document.querySelectorAll('#star-list div')]
        .filter(row => {
          const style = getComputedStyle(row);
          return row.scrollWidth > row.clientWidth + 1 ||
              row.scrollHeight > row.clientHeight + 1 ||
              ['hidden', 'clip'].includes(style.overflowX) ||
              ['hidden', 'clip'].includes(style.overflowY) ||
              style.textOverflow === 'ellipsis';
        }).map(row => row.textContent.trim());
    const resultHudControlsVisible = [...document.querySelectorAll(
        '#hud [data-piece], #hud [data-action]')]
        .filter(control => control.getClientRects().length &&
            getComputedStyle(control).visibility !== 'hidden')
        .map(control => control.textContent.trim());
    const board = game.boardBounds;
    const overlap = card.left < board.right && card.right > board.left &&
        card.top < board.bottom && card.bottom > board.top;
    const toast = document.querySelector('#toast');
    return {
      screen: game.state.screen,
      revealRow: game.state.revealRow,
      finalRow: level.grid.length - 1,
      drawnSegments: game.beamSegmentCount,
      beam: game.beamDrawState,
      pixels: game.beamPixels(),
      expectedSegments,
      starTextProblems,
      resultButtonProblems,
      resultHudControlsVisible,
      toast: toast.textContent.trim(),
      visibleToast: toast.classList.contains('visible'),
      overlap,
      board,
      card: {left: card.left, right: card.right, top: card.top, bottom: card.bottom},
    };
  });
  if (details.screen !== 'result' || details.revealRow !== details.finalRow ||
      details.drawnSegments !== details.expectedSegments ||
      !details.beam.visible || !details.beam.inScene || details.beam.opacity <= 0 ||
      details.beam.drawCount <= 0 ||
      details.beam.drawCount !== details.expectedSegments || details.visibleToast ||
      details.overlap || details.starTextProblems.length ||
      details.resultHudControlsVisible.length || details.resultButtonProblems.length) {
    throw new Error(`Incomplete or covered result: ${JSON.stringify(details)}`);
  }
  const pixels = details.pixels;
  const expectedSamples = Math.min(details.expectedSegments, 60);
  const horizontalSamples = pixels?.samples.filter(segment => segment.kind === 'horizontal');
  // Where another glowing object (the source orb's halo, over the first segment) already
  // saturates the beam-hidden render, no difference can show; such samples are skipped, but at
  // most two, so a missing beam cannot hide behind this rule.
  const saturatedWithoutBeam = index => pixels.hidden[index].color[1] >= 210;
  const skipped = pixels ? pixels.samples.filter((segment, index) => saturatedWithoutBeam(index)) : [];
  const dimSamples = pixels ? pixels.samples.filter((segment, index) => !saturatedWithoutBeam(index) &&
      (segment.color[1] < 90 || segment.color[1] <= pixels.hidden[index].color[1] + 45)) : [];
  if (!pixels || pixels.total !== details.expectedSegments ||
      pixels.samples.length !== expectedSamples || pixels.hidden.length !== expectedSamples ||
      (pixels.horizontal < 60 && horizontalSamples.length !== pixels.horizontal) ||
      skipped.length > 2 || dimSamples.length) {
    throw new Error(`Beam segments lack visible pixels: ${JSON.stringify(pixels)}`);
  }
}
async function checkRushTimer(page) {
  const detail = await page.evaluate(() => {
    const timer = document.querySelector('#rush-timer');
    const timerBounds = timer.getBoundingClientRect();
    const score = document.querySelector('#rush-score');
    const scoreBounds = score.getBoundingClientRect();
    const card = document.querySelector('.result').getBoundingClientRect();
    const x = timerBounds.left + timerBounds.width / 2;
    const y = timerBounds.top + timerBounds.height / 2;
    const top = document.elementFromPoint(x, y);
    const scoreTop = document.elementFromPoint(
        scoreBounds.left + scoreBounds.width / 2, scoreBounds.top + scoreBounds.height / 2);
    return {
      timer: timer.textContent,
      score: score.textContent,
      overlap: card.left < timerBounds.right && card.right > timerBounds.left &&
          card.top < timerBounds.bottom && card.bottom > timerBounds.top,
      scoreOverlap: card.left < scoreBounds.right && card.right > scoreBounds.left &&
          card.top < scoreBounds.bottom && card.bottom > scoreBounds.top,
      covered: top !== timer && !timer.contains(top),
      scoreCovered: scoreTop !== score && !score.contains(scoreTop),
      scoreInsideViewport: scoreBounds.left >= 0 && scoreBounds.top >= 0 &&
          scoreBounds.right <= innerWidth && scoreBounds.bottom <= innerHeight
    };
  });
  if (!detail.timer || !detail.score || detail.overlap || detail.scoreOverlap || detail.covered ||
      detail.scoreCovered || !detail.scoreInsideViewport)
    throw new Error(`Rush timer is hidden: ${JSON.stringify(detail)}`);
}
// ResizeObserver refits the board after layout and before the next paint, so measure what is painted.
// Every beam that runs into a block must light a point just outside the block's face and must not
// light a point just inside it. The board must have at least one beam falling onto a block and one
// splitter side branch running into a block.
async function checkBlockHits(page, label) {
  const pixels = await page.evaluate(() => game.blockHitPixels());
  const problems = [];
  if (!pixels) problems.push('no probe result');
  const samples = pixels?.samples ?? [];
  const hits = samples.filter(sample => sample.kind === 'outside');
  for (const direction of ['vertical', 'side']) {
    if (!hits.some(sample => sample.direction === direction)) problems.push(`no ${direction} block hit`);
  }
  samples.forEach((sample, index) => {
    const shown = sample.color[1];
    const hidden = pixels.hidden[index].color[1];
    if (sample.kind === 'missing block') problems.push(`no block mesh at ${sample.row},${sample.col}`);
    if (sample.kind === 'outside' && (shown < 90 || shown <= hidden + 45))
      problems.push(`beam stops short of block ${sample.row},${sample.col}: ${shown} vs ${hidden}`);
    if (sample.kind === 'inside' && shown > hidden + 20)
      problems.push(`beam runs into block ${sample.row},${sample.col}: ${shown} vs ${hidden}`);
  });
  const faceGaps = pixels?.faceGaps ?? [];
  if (faceGaps.length !== hits.length) problems.push(`${faceGaps.length} face gaps for ${hits.length} hits`);
  for (const gap of faceGaps) {
    if (!(gap < .02)) problems.push(`a beam ends ${gap.toFixed(3)} board units from its block face`);
  }
  if (problems.length) throw new Error(`Block hits at ${label}: ${problems.join('; ')}`);
}
async function nextPaintedFrame(page) {
  // A requestAnimationFrame callback runs before that frame's layout and ResizeObserver delivery;
  // the second callback runs only after the first frame has been laid out, observed and painted.
  await page.evaluate(() => new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function checkBoardFit(page) {
  await nextPaintedFrame(page);
  const details = await page.evaluate(() => {
    const hudElement = document.querySelector('#hud');
    const hudHidden = hudElement.classList.contains('hidden');
    return {
      bounds: game.boardBounds,
      hud: hudHidden ? null : hudElement.getBoundingClientRect().toJSON(),
      info: document.querySelector('#hud-info').getBoundingClientRect().toJSON(),
      topbarBottom: document.querySelector('#topbar').getBoundingClientRect().bottom,
      width: innerWidth,
      height: innerHeight,
    };
  });
  const {bounds, hud, info, topbarBottom, width, height} = details;
  if (!bounds || Object.values(bounds).some(value => !Number.isFinite(value))) {
    throw new Error(`Invalid board bounds: ${JSON.stringify(details)}`);
  }
  // The text strip is either a band under the top bar or, on short landscape screens, a right-hand
  // column; the board must clear it either way, and clear the button bar.
  const infoAtRight = info.width > 0 && info.left > width / 2;
  const infoBand = info.width > 0 && !infoAtRight;
  const topLimit = infoBand ? info.bottom : topbarBottom;
  const rightLimit = infoAtRight ? info.left : width;
  const bottomLimit = hud && !infoAtRight ? hud.top : height;
  const clipped = bounds.left < -3 || bounds.right > rightLimit + 3 ||
      bounds.top < topLimit - 3 || bounds.bottom > bottomLimit + 3;
  const tooSmall = bounds.right - bounds.left < width * (width < 700 ? .65 : .3);
  if (clipped || tooSmall) throw new Error(`Board framing failed: ${JSON.stringify(details)}`);
}
async function checkPortraitPanelFit(page, panelSelector) {
  await nextPaintedFrame(page);
  const details = await page.evaluate(selector => ({
    board: game.boardBounds,
    panel: document.querySelector(selector).getBoundingClientRect().toJSON(),
    topbarBottom: document.querySelector('#topbar').getBoundingClientRect().bottom,
    width: innerWidth,
  }), panelSelector);
  const {board, panel, topbarBottom, width} = details;
  if (!board || board.bottom > panel.top - 4 || board.top < topbarBottom - 4 ||
      board.left < -4 || board.right > width + 4 || board.right - board.left < width * .45)
    throw new Error(`Portrait panel framing failed: ${JSON.stringify(details)}`);
}
async function checkLevelTileText(page) {
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.level-buttons button')]
      .filter(button => button.scrollWidth > button.clientWidth + 1 ||
          button.querySelector('strong').scrollWidth > button.querySelector('strong').clientWidth + 1)
      .map(button => button.textContent.trim()));
  if (overflow.length) throw new Error(`Level tile text overflow: ${overflow.join(', ')}`);
}
async function checkLandscapeHudFit(page) {
  await nextPaintedFrame(page);
  const details = await page.evaluate(() => ({
    board: game.boardBounds,
    hud: document.querySelector('#hud').getBoundingClientRect().toJSON(),
    topbarBottom: document.querySelector('#topbar').getBoundingClientRect().bottom,
    height: innerHeight,
  }));
  const {board, hud, topbarBottom, height} = details;
  if (!board || board.bottom - board.top < height * .6 ||
      board.right > hud.left - 4 || board.top < topbarBottom - 4 ||
      board.bottom > height + 4 || hud.top < topbarBottom - 1)
    throw new Error(`Landscape HUD framing failed: ${JSON.stringify(details)}`);
}
async function checkSidePanelFit(page, panelSelector) {
  await nextPaintedFrame(page);
  const details = await page.evaluate(selector => ({
    bounds: game.boardBounds,
    panelRight: document.querySelector(selector).getBoundingClientRect().right,
    topbarBottom: document.querySelector('#topbar').getBoundingClientRect().bottom,
    width: innerWidth,
    height: innerHeight,
  }), panelSelector);
  const {bounds, panelRight, topbarBottom, width, height} = details;
  const clipped = !bounds || bounds.left < panelRight - 4 || bounds.right > width + 4 ||
      bounds.top < topbarBottom - 4 || bounds.bottom > height + 4;
  if (clipped) throw new Error(`Side panel framing failed: ${JSON.stringify(details)}`);
}
async function shot(page, name) {
  const before = await page.evaluate(() => game.clock);
  await page.waitForFunction(start => game.clock > start + .05, {timeout: 60000}, before);
  await page.screenshot({path: join(stagingDir, `${name}.png`)});
}
async function tapControl(page, selector) {
  const point = await page.$eval(selector, element => {
    const rect = element.getBoundingClientRect();
    return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
  });
  await page.touchscreen.tap(point.x, point.y);
}

async function checkTouchAudioControls(page) {
  await tapControl(page, '#audio-settings-button');
  await page.waitForFunction(
      () => game.audioReady && game.audioState === 'running', {timeout: 30000});
  await checkTouchControls(page);
  const beforeMusic = await page.$eval('#music-enabled', input => input.checked);
  await tapControl(page, '#music-enabled');
  const afterMusic = await page.$eval('#music-enabled', input => input.checked);
  if (beforeMusic === afterMusic) throw new Error('Music switch did not respond to touch');
  const beforeEffects = await page.$eval('#effects-enabled', input => input.checked);
  await tapControl(page, '#effects-enabled');
  const afterEffects = await page.$eval('#effects-enabled', input => input.checked);
  if (beforeEffects === afterEffects) throw new Error('Effects switch did not respond to touch');
  const volumeBefore = await page.$eval('#master-volume', input => Number(input.value));
  const rangePoint = await page.$eval('#master-volume', input => {
    const rect = input.getBoundingClientRect();
    const fraction = Number(input.value) < .5 ? .75 : .25;
    return {x: rect.left + rect.width * fraction, y: rect.top + rect.height / 2};
  });
  await page.touchscreen.tap(rangePoint.x, rangePoint.y);
  const volumeAfter = await page.$eval('#master-volume', input => Number(input.value));
  if (Math.abs(volumeAfter - volumeBefore) < .2)
    throw new Error(`Volume did not respond to touch: ${volumeBefore} to ${volumeAfter}`);
  await tapControl(page, '#audio-settings-button');
  const soundState = () => page.$eval('#mute-button', button => ({
    pressed: button.getAttribute('aria-pressed'),
    wavesShown: getComputedStyle(button.querySelector('.sound-waves')).display !== 'none',
    crossShown: getComputedStyle(button.querySelector('.sound-cross')).display !== 'none',
  }));
  const soundBefore = await soundState();
  await tapControl(page, '#mute-button');
  const soundAfter = await soundState();
  // The icon itself must flip: waves while sound plays, a cross while muted, never both.
  const iconFlipped = soundBefore.wavesShown !== soundAfter.wavesShown &&
      soundBefore.crossShown !== soundAfter.crossShown &&
      soundAfter.wavesShown !== soundAfter.crossShown;
  if (soundBefore.pressed === soundAfter.pressed || !iconFlipped)
    throw new Error(`Mute did not respond to touch: ${JSON.stringify({soundBefore, soundAfter})}`);
}

async function touchPlaythrough(page, width, height) {
  await checkTouchControls(page);
  await tapControl(page, '#title-screen [data-action="play"]');
  await page.waitForFunction(() => game.state.screen === 'select');
  await checkTouchControls(page);
  await tapControl(page, '#select-screen .level-buttons button');
  await page.waitForFunction(() => game.state.screen === 'game');
  await checkBoardFit(page);
  await checkTouchControls(page);
  const hint = await page.$eval('#pointer-hint', element => element.textContent);
  if (!hint.startsWith('Tap')) throw new Error(`Touch hint was ${hint}`);
  const boardGesture = await page.evaluate(() => {
    const stage = document.querySelector('#stage');
    const menu = new MouseEvent('contextmenu', {bubbles: true, cancelable: true});
    const selection = new Event('selectstart', {bubbles: true, cancelable: true});
    stage.dispatchEvent(menu);
    stage.dispatchEvent(selection);
    return {
      menuBlocked: menu.defaultPrevented,
      selectionBlocked: selection.defaultPrevented,
      touchAction: getComputedStyle(stage).touchAction,
      callout: getComputedStyle(stage).getPropertyValue('-webkit-touch-callout'),
      calloutSupported: CSS.supports('-webkit-touch-callout', 'none')
    };
  });
  if (!boardGesture.menuBlocked || !boardGesture.selectionBlocked ||
      boardGesture.touchAction !== 'none' ||
      (boardGesture.calloutSupported && boardGesture.callout !== 'none')) {
    throw new Error(`Board long press is unprotected: ${JSON.stringify(boardGesture)}`);
  }
  const point = await page.evaluate(() => {
    const piece = game.state.level.solution[0];
    return game.cellScreenPosition(piece.row, piece.col);
  });
  if (!point) throw new Error('Touch cell has no projected position');
  // A drag that starts on a cell, and a second finger on a cell, must not edit the board.
  await page.touchscreen.touchStart(point.x, point.y);
  await page.touchscreen.touchMove(point.x + 40, point.y + 30);
  await page.touchscreen.touchEnd();
  if (await page.evaluate(() => game.state.placements.length) !== 0)
    throw new Error('A touch drag placed a piece');
  const touchClient = await page.createCDPSession();
  const firstFinger = {x: point.x - 60, y: point.y - 60, id: 1};
  const secondFinger = {x: point.x, y: point.y, id: 2};
  await touchClient.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [firstFinger]});
  await touchClient.send('Input.dispatchTouchEvent',
      {type: 'touchStart', touchPoints: [firstFinger, secondFinger]});
  await touchClient.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: [firstFinger]});
  await touchClient.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await touchClient.detach();
  if (await page.evaluate(() => game.state.placements.length) !== 0)
    throw new Error('A second finger placed a piece');
  // A second finger on a button, not on the board, must also cancel the pending board tap.
  const buttonPoint = await page.$eval('#fire-button', button => {
    const rect = button.getBoundingClientRect();
    return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
  });
  const buttonClient = await page.createCDPSession();
  const boardFinger = {x: point.x, y: point.y, id: 1};
  const buttonFinger = {x: buttonPoint.x, y: buttonPoint.y, id: 2};
  await buttonClient.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [boardFinger]});
  await buttonClient.send('Input.dispatchTouchEvent',
      {type: 'touchStart', touchPoints: [boardFinger, buttonFinger]});
  await buttonClient.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: [buttonFinger]});
  await buttonClient.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await buttonClient.detach();
  if (await page.evaluate(() => game.state.placements.length) !== 0)
    throw new Error('A board press stayed active after a second finger on a button');
  // Releasing the button finger may have fired; wait for that run to end before the next taps.
  await page.evaluate(() => {
    if (game.state.phase === 'running') game.skipAnimation();
  });
  await page.touchscreen.tap(point.x, point.y);
  if (await page.evaluate(() => game.state.placements.length) !== 1)
    throw new Error('Touch did not place a piece');
  await page.touchscreen.tap(point.x, point.y);
  if (await page.evaluate(() => game.state.placements.length) !== 0)
    throw new Error('Touch did not remove the placed piece');
  await page.touchscreen.tap(point.x, point.y);
  await tapControl(page, '#fire-button');
  await page.waitForFunction(() => game.state.phase === 'running');
  await tapControl(page, '#fire-button');
  await page.waitForFunction(() => game.state.screen === 'result');
  await checkResultCard(page);
  await checkTouchControls(page);
  await shot(page, `touch-win-${width}x${height}`);
}
async function withPage(
    name, task, width = 1280, height = 800, storageFailure = false,
    storageAccessFailure = false, audioFailure = false, viewportOptions = {}) {
  const context = await browser.createBrowserContext();
  try {
    const page = await newPage(
        context, width, height, storageFailure, storageAccessFailure, audioFailure, viewportOptions);
    if (!storageAccessFailure) {
      const savedKeys = await page.evaluate(() => Object.keys(localStorage));
      if (savedKeys.length) throw new Error(`${name} started with saved data: ${savedKeys.join(', ')}`);
    }
    await task(page);
    await checkPage(page);
    console.log(`PASS ${name}`);
  } finally {
    await context.close();
  }
}

try {
  browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    args: [
      '--no-sandbox', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'
    ]
  });
  for (const name of scenarios) {
    const errorsBefore = errors.length;
    if (name === 'title')
      await withPage(name, async page => {
        await page.waitForFunction(
            () => Number(document.querySelector('#attract-splits').textContent) === 21 &&
                Number(document.querySelector('#attract-timelines').textContent) === 40,
            {timeout: 180000});
        const geometries = await page.evaluate(() => game.memory.geometries);
        if (geometries < 10) throw new Error(`Attract board did not render: ${geometries}`);
        if (await page.evaluate(() => game.visibleSparkCount) !== 0)
          throw new Error('Uninitialized particles are visible on title screen');
        const titlePixels = await page.evaluate(async () => {
          const canvas = document.querySelector('#stage canvas');
          for (let attempt = 0; attempt < 120; attempt++) {
            const pixels = canvas.inspectTitlePixels(game.state.result, game.clock);
            if (pixels) return pixels;
            await new Promise(requestAnimationFrame);
          }
          return null;
        });
        if (!titlePixels || titlePixels.samples.length !== 4 || titlePixels.hidden.length !== 4 ||
            titlePixels.samples.some((sample, index) =>
              sample.color[1] < 90 || sample.color[1] <= titlePixels.hidden[index].color[1] + 45)) {
          throw new Error(`Attract board lacks visible beam or source pixels: ${
            JSON.stringify(titlePixels)}`);
        }
        await checkSidePanelFit(page, '.title-panel');
        const best = await page.evaluate(() => {
          localStorage.setItem('tachyon-cascade-v1', JSON.stringify({rushBest: 42}));
          window.dispatchEvent(new StorageEvent('storage', {key: 'tachyon-cascade-v1'}));
          return document.querySelector('#rush-best').textContent;
        });
        if (!best.includes('42')) throw new Error(`Title best score did not refresh: ${best}`);
        await shot(page, 'title-1280x800');
        await page.click('[data-action="play"]');
        if (await page.evaluate(() => game.state.screen) !== 'select') {
          throw new Error('Play did not open level select');
        }
        await checkSidePanelFit(page, '.selection-panel');
        await shot(page, 'select-1280x800');
        await page.click('#select-screen [data-action="menu"]');
        await page.click('[data-action="help"]');
        if (await page.evaluate(() => game.state.screen) !== 'help') {
          throw new Error('How to play did not open');
        }
        await checkSidePanelFit(page, '.help');
        await shot(page, 'help-1280x800');
        await page.click('#help-screen [data-action="play"]');
        if (await page.evaluate(() => game.state.screen) !== 'select') {
          throw new Error("Let's play did not open level select");
        }
      });
    if (name === 'input')
      await withPage(name, async page => {
        const musicEnabled = await page.$eval('#music-enabled', element => element.checked);
        await page.keyboard.down('Shift');
        await page.keyboard.press('M');
        await page.keyboard.up('Shift');
        if (await page.$eval('#music-enabled', element => element.checked) !== musicEnabled)
          throw new Error('Shift-modified mute shortcut changed audio settings');
        await page.evaluate(() => game.loadLevel('a1'));
        // Cell positions are valid only after the board is refitted under the new HUD.
        await nextPaintedFrame(page);
        const point = await page.evaluate(() => game.cellScreenPosition(3, 4));
        if (!point) throw new Error('Editable cell has no screen position');
        await page.mouse.move(point.x, point.y);
        const hover = await page.evaluate(() => game.hover);
        if (hover?.row !== 3 || hover?.col !== 4 || hover?.allowed !== true) {
          throw new Error(`Hover selected the wrong cell: ${JSON.stringify(hover)}`);
        }
        for (const [index, [action, trigger]] of [
          ['Space', () => page.keyboard.press('Space')],
          ['F', () => page.keyboard.press('f')],
          ['Fire', () => page.evaluate(() => document.querySelector('#fire-button').click())],
        ].entries()) {
          await page.evaluate(() => game.loadLevel('a1'));
          await nextPaintedFrame(page);
          const fresh = await page.evaluate(() => game.cellScreenPosition(3, 4));
          await page.mouse.move(fresh.x + index + 1, fresh.y + 1);
          if (await page.evaluate(() => game.hover?.row) !== 3)
            throw new Error(`${action} setup has no hover preview`);
          await trigger();
          if (await page.evaluate(() => game.hover) !== null)
            throw new Error(`${action} left a hover preview during the run`);
        }
        await page.evaluate(() => game.loadLevel('b3'));
        await nextPaintedFrame(page);
        const selectionPoint = await page.evaluate(() => game.cellScreenPosition(6, 5));
        await page.mouse.move(selectionPoint.x, selectionPoint.y);
        await page.keyboard.press('2');
        const blockHover = await page.evaluate(() => game.hover);
        if (blockHover?.kind !== 'block' || blockHover?.row !== 6 || blockHover?.col !== 5)
          throw new Error(`Block shortcut left the prior preview: ${JSON.stringify(blockHover)}`);
        await page.evaluate(() => document.querySelector('[data-piece="splitter"]').click());
        const splitterHover = await page.evaluate(() => game.hover);
        if (splitterHover?.kind !== 'splitter' || splitterHover?.row !== 6 || splitterHover?.col !== 5)
          throw new Error(`Inventory selection left the prior preview: ${JSON.stringify(splitterHover)}`);
        await page.evaluate(() => game.loadLevel('a1'));
        await nextPaintedFrame(page);
        await page.mouse.move(point.x, point.y);
        await page.mouse.click(point.x, point.y, {button: 'middle'});
        if (await page.evaluate(() => game.state.placements.length) !== 0) {
          throw new Error('Middle click edited the board');
        }
        // A press that began during a run is not an edit, even when the run ends before release.
        await page.evaluate(() => game.fire());
        await page.mouse.down();
        await page.evaluate(() => game.skipAnimation());
        await page.mouse.up();
        if (await page.evaluate(() => game.state.placements.length) !== 0) {
          throw new Error('A press begun during a run edited the board');
        }
        // A press begun while editing and held through a failed run (fired from the keyboard) is
        // not an edit when it is released back in the editing phase.
        await page.mouse.down();
        await page.keyboard.press('Space');
        await page.evaluate(() => game.skipAnimation());
        await page.waitForFunction(() => game.state.phase === 'editing', {timeout: 30000});
        await page.mouse.up();
        if (await page.evaluate(() => game.state.placements.length) !== 0) {
          throw new Error('A press held through a run edited the board');
        }
        // A press that wanders over the text strip and comes back to its cell is a drag, not a tap.
        const stripPoint = await page.$eval('#hud-info', strip => {
          const rect = strip.getBoundingClientRect();
          return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
        });
        await page.mouse.down();
        await page.mouse.move(stripPoint.x, stripPoint.y, {steps: 4});
        await page.mouse.move(point.x, point.y, {steps: 4});
        await page.mouse.up();
        if (await page.evaluate(() => game.state.placements.length) !== 0) {
          throw new Error('A drag over the text strip edited the board');
        }
        await page.mouse.click(point.x, point.y);
        if (await page.evaluate(() => game.state.placements.length) !== 1) {
          throw new Error('Mouse click did not place a splitter');
        }
        await page.mouse.click(point.x, point.y, {button: 'right'});
        if (await page.evaluate(() => game.state.placements.length) !== 0) {
          throw new Error('Right click did not remove a splitter');
        }
        await page.evaluate(({x, y}) => {
          document.querySelector('#stage').dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerType: 'touch', clientX: x, clientY: y,
          }));
        }, point);
        const hint = await page.$eval('#pointer-hint', element => element.textContent);
        if (!hint.startsWith('Tap')) throw new Error(`Touch hint did not update: ${hint}`);
      });
    if (name === 'campaign')
      await withPage(name, async page => {
        await page.evaluate(() => {
          const practice = game.loadLevel('a3');
          game.place(practice.solution[0].row, practice.solution[0].col, 'splitter');
          game.fire();
          const blocked = game.place(practice.solution[1].row, practice.solution[1].col, 'splitter');
          if (blocked || game.state.placements.length !== 1) {
            throw new Error('Editing was allowed while the beam moved');
          }
          const level = game.loadLevel('a1');
          for (const piece of level.solution) game.place(piece.row, piece.col, piece.kind);
          game.fire();
        });
        await page.waitForFunction(() => game.state.phase === 'running', {timeout: 30000});
        await page.evaluate(() => game.fire());
        await page.waitForFunction(() => game.state.screen === 'result', {timeout: 30000});
        const stars = await page.$$eval('#star-list .earned', items => items.length);
        if (stars !== 3) throw new Error(`Expected 3 stars, got ${stars}`);
        await checkResultCard(page);
        await checkBoardFit(page);
        await shot(page, 'win-1280x800');
        await page.evaluate(() => {
          const level = game.loadLevel('a5');
          for (const piece of level.solution) game.place(piece.row, piece.col, piece.kind);
          game.fire();
          game.skipAnimation();
        });
        await page.click('[data-action="next"]');
        const locked = await page.evaluate(() => ({
          screen: game.state.screen,
          button: [...document.querySelectorAll('#level-grid button')]
                      .find(button => button.textContent.includes('B1'))?.disabled,
        }));
        if (locked.screen !== 'select' || locked.button !== true) {
          throw new Error(`Sector lock was bypassed: ${JSON.stringify(locked)}`);
        }
        const refreshed = await page.evaluate(() => {
          const key = 'tachyon-cascade-v1';
          const profile = JSON.parse(localStorage.getItem(key));
          profile.stars.a2 = 1;
          profile.stars.a3 = 1;
          localStorage.setItem(key, JSON.stringify(profile));
          window.dispatchEvent(new StorageEvent('storage', {key}));
          const buttons = [...document.querySelectorAll('#level-grid button')];
          return {
            unlocked: !buttons.find(button => button.textContent.includes('B1')).disabled,
            stars: buttons.find(button => button.textContent.includes('A2')).querySelector('small')
                       .textContent,
          };
        });
        if (!refreshed.unlocked || !refreshed.stars.includes('★'))
          throw new Error(`Level selection did not refresh: ${JSON.stringify(refreshed)}`);
      });
    if (name === 'void')
      await withPage(name, async page => {
        // Wait until the highlight has run for a moment, so the zoom is the one the player sees.
        async function failureAfterRun(levelId) {
          const started = await page.evaluate(id => {
            game.loadLevel(id);
            game.fire();
            game.skipAnimation();
            return game.clock;
          }, levelId);
          await page.waitForFunction(start => game.clock > start + .4, {timeout: 60000}, started);
          return page.evaluate(() => ({
            phase: game.state.phase,
            toast: document.querySelector('#toast').textContent,
            marks: game.failureMarks,
          }));
        }
        const voidRun = await failureAfterRun('c1');
        const voidMark = voidRun.marks.find(mark => mark.col === 3);
        if (voidRun.phase !== 'editing' || !voidRun.toast.includes('red void') ||
            /column/i.test(voidRun.toast) || voidMark?.kind !== 'void' || !(voidMark.zoom >= 1.25))
          throw new Error(`Void feedback missing: ${JSON.stringify(voidRun)}`);
        await checkBoardFit(page);
        await shot(page, 'void-failure');

        // With no pieces, First Light leaves both gold targets dark; both must be highlighted.
        const darkRun = await failureAfterRun('a1');
        const targetCols = await page.evaluate(() => [...game.state.level.detectors]
            .flatMap((kind, col) => kind === 'T' ? [col] : []));
        const darkCols = darkRun.marks.filter(mark => mark.kind === 'dark' && mark.zoom >= 1.25)
            .map(mark => mark.col);
        if (!darkRun.toast.includes('gold target is dark') || /column/i.test(darkRun.toast) ||
            darkCols.length !== darkRun.marks.length ||
            JSON.stringify(darkCols) !== JSON.stringify(targetCols))
          throw new Error(`Dark target feedback missing: ${JSON.stringify(darkRun)}`);
        await shot(page, 'dark-target-failure');
        const marksAfterEdit = await page.evaluate(() => {
          const piece = game.state.level.solution[0];
          game.place(piece.row, piece.col, piece.kind);
          return game.failureMarks.length;
        });
        if (marksAfterEdit !== 0) throw new Error('Failure highlights stayed after an edit');
      });
    if (name === 'blocks')
      await withPage(name, async page => {
        // A solver solution of Narrow Escape (c4), not its stored one: the splitter at row 12,
        // column 8 sends a side branch into the block beside it, and the block at column 3 catches
        // a falling beam.
        await page.evaluate(() => {
          game.loadLevel('c4');
          const pieces = [
            {row: 12, col: 8, kind: 'splitter'}, {row: 12, col: 7, kind: 'block'},
            {row: 12, col: 5, kind: 'splitter'}, {row: 12, col: 3, kind: 'block'},
          ];
          for (const piece of pieces) game.place(piece.row, piece.col, piece.kind);
          game.fire();
          game.skipAnimation();
        });
        await page.waitForFunction(() => game.state.screen === 'result', {timeout: 30000});
        await nextPaintedFrame(page);
        await checkResultCard(page);
        await checkBlockHits(page, '1280x800');
        await shot(page, 'block-hits-1280x800');
        // Squeezed or stretched rows change the blocks' size in board units, so after a resize the
        // beam ends must move with them. 1280x500 squeezes rows; 667x375 stretches them.
        for (const [width, height, squeezed] of [[1280, 500, true], [667, 375, false]]) {
          await page.setViewport({width, height, deviceScaleFactor: 1});
          await nextPaintedFrame(page);
          await nextPaintedFrame(page);
          const rowScale = await page.evaluate(() => game.boardRowScale);
          const scaled = squeezed ? rowScale < .8 : rowScale > 1.2;
          if (!scaled) throw new Error(`Rows were not ${squeezed ? 'squeezed' : 'stretched'} at ${width}x${height}: ${rowScale}`);
          await checkBlockHits(page, `${width}x${height} after resize`);
          await shot(page, `block-hits-${width}x${height}`);
        }
      });
    if (name === 'rush')
      await withPage(name, async page => {
        await page.evaluate(() => {
          game.startRush(42);
          localStorage.setItem('tachyon-cascade-v1', JSON.stringify({rushBest: 9999}));
          window.dispatchEvent(new StorageEvent('storage', {key: 'tachyon-cascade-v1'}));
          if (!document.querySelector('#rush-score').textContent.includes('best 9999'))
            throw new Error('Rush HUD did not refresh after a storage event');
          for (const piece of game.state.level.solution)
            game.place(piece.row, piece.col, piece.kind);
          game.fire();
          game.skipAnimation();
        });
        const details = await page.evaluate(() => ({
                                              screen: game.state.screen,
                                              score: game.state.rushScore,
                                              time: game.state.rushTime
                                            }));
        if (details.screen !== 'result' || details.score <= 0 || details.time <= 180)
          throw new Error(`Rush did not score: ${JSON.stringify(details)}`);
        await checkResultCard(page);
        await checkBoardFit(page);
        await shot(page, 'rush-win');
        await page.evaluate(() => { game.state.rushTime = .2; });
        await page.waitForFunction(() => game.state.screen === 'select', {timeout: 30000});
        await page.evaluate(() => {
          game.startRush(42);
          for (const piece of game.state.level.solution)
            game.place(piece.row, piece.col, piece.kind);
          game.fire();
          game.state.rushTime = .001;
          game.state.runSeconds = 100;
        });
        await page.waitForFunction(() => game.state.screen === 'select', {timeout: 30000});
        if (await page.evaluate(() => game.state.rushScore) !== 0)
          throw new Error('Expired Rush run awarded a win');
        await page.evaluate(() => {
          for (const finish of [() => game.fire(), () => game.skipAnimation()]) {
            game.startRush(42);
            for (const piece of game.state.level.solution)
              game.place(piece.row, piece.col, piece.kind);
            game.fire();
            game.state.rushTime = .001;
            // A stalled frame lets a tap reach the finish path after the wall-clock deadline.
            const until = performance.now() + 20;
            while (performance.now() < until) {
            }
            finish();
            if (game.state.screen !== 'select' || game.state.rushScore !== 0)
              throw new Error('Expired Rush run scored from a skip path');
          }
        });
      });
    if (name === 'sizes') {
      for (const [width, height] of [[1280, 800], [1100, 750], [900, 600]]) {
        await withPage(`${name}-${width}x${height}`, async page => {
          await page.evaluate(() => game.loadLevel('b5'));
          await page.waitForFunction(
              () => document.querySelector('#hud').getBoundingClientRect().height > 0);
          await checkBoardFit(page);
          await shot(page, `game-${width}x${height}`);
        }, width, height);
      }
      for (const [width, height] of touchSizes) {
        const isPad = width >= 820 && height >= 820;
        const viewport = {hasTouch: true, isMobile: true, deviceScaleFactor: isPad ? 2 : 1};
        await withPage(`${name}-${width}x${height}-touch`, async page => {
          await checkTouchControls(page);
          await checkTouchAudioControls(page);
          if (width > 700) {
            if (height > width) await checkPortraitPanelFit(page, '.title-panel');
            else await checkSidePanelFit(page, '.title-panel');
          }
          await shot(page, `title-${width}x${height}`);
          await tapControl(page, '#title-screen [data-action="play"]');
          await checkTouchControls(page);
          await checkLevelTileText(page);
          await shot(page, `select-${width}x${height}`);
          if (width > 700) {
            if (height > width) await checkPortraitPanelFit(page, '.selection-panel');
            else await checkSidePanelFit(page, '.selection-panel');
          }
          await tapControl(page, '#select-screen [data-action="menu"]');
          await tapControl(page, '#title-screen [data-action="help"]');
          await checkTouchControls(page);
          await shot(page, `help-${width}x${height}`);
          if (width > 700) {
            if (height > width) await checkPortraitPanelFit(page, '.help');
            else await checkSidePanelFit(page, '.help');
          }
          await page.evaluate(() => game.loadLevel('b5'));
          await checkBoardFit(page);
          if (width > height && height <= 500) await checkLandscapeHudFit(page);
          await checkTouchControls(page);
          await shot(page, `game-${width}x${height}`);
          await page.evaluate(() => game.startRush(42));
          await checkBoardFit(page);
          if (width > height && height <= 500) await checkLandscapeHudFit(page);
          await checkTouchControls(page);
          await shot(page, `rush-game-${width}x${height}`);
          // Rush has no Skip button: the owner removed it so Fire fits on phone screens.
          if (await page.$('[data-action="skip"]')) throw new Error('Rush still shows a Skip button');
          await page.evaluate(() => {
            const level = game.loadLevel('a1');
            for (const piece of level.solution) game.place(piece.row, piece.col, piece.kind);
            game.fire();
            game.skipAnimation();
          });
          await checkResultCard(page);
          await checkTouchControls(page);
          await shot(page, `result-${width}x${height}`);
          if (width === 390) await shot(page, 'win-390x844');
          if ((width === 390 && height === 844) || (width === 844 && height === 390)) {
            await page.evaluate(() => {
              game.startRush(42);
              for (const piece of game.state.level.solution)
                game.place(piece.row, piece.col, piece.kind);
              game.fire();
              game.skipAnimation();
            });
            await checkRushTimer(page);
            await checkTouchControls(page);
            await shot(page, `rush-result-${width}x${height}`);
          }
        }, width, height, false, false, false, viewport);
      }
    }
    if (name === 'touch')
      for (const [width, height] of [[390, 844], [1024, 1366]]) {
        const viewport = {
          hasTouch: true,
          isMobile: true,
          deviceScaleFactor: width >= 820 ? 2 : 1
        };
        await withPage(`${name}-${width}x${height}`, async page => {
          await touchPlaythrough(page, width, height);
        }, width, height, false, false, false, viewport);
      }
    if (name === 'resize')
      await withPage(name, async page => {
        await page.evaluate(() => game.loadLevel('c5'));
        await page.setViewport({width: 390, height: 844, deviceScaleFactor: 1});
        await page.waitForFunction(
            () => document.querySelector('#stage canvas').width === 390, {timeout: 30000});
        await checkBoardFit(page);
        await shot(page, 'resize-390x844');
      });
    if (name === 'storage')
      await withPage(name, async page => {
        await page.evaluate(() => {
          const level = game.loadLevel('a1');
          for (const piece of level.solution) game.place(piece.row, piece.col, piece.kind);
          game.fire();
          game.skipAnimation();
        });
        if (await page.evaluate(() => game.state.screen) !== 'result')
          throw new Error('Storage failure blocked win');
        await checkResultCard(page);
        const saveStatus = await page.$eval('#result-save-status', element => element.textContent);
        if (!saveStatus.includes('could not be saved'))
          throw new Error(`Storage failure status missing: ${saveStatus}`);
        await checkBoardFit(page);
        await shot(page, 'storage-failure');
      }, 900, 600, true);
    if (name === 'storage-access')
      await withPage(name, async page => {
        if (await page.$eval('#boot-error', element => !element.classList.contains('hidden')))
          throw new Error('Storage property access blocked boot');
      }, 1280, 800, false, true);
    if (name === 'audio')
      await withPage(name, async page => {
        await page.click('[data-action="play"]');
        await page.waitForFunction(
            () => window.__failedAudioResumes > 0 && !game.audioLoading,
            {timeout: 30000});
        if (await page.evaluate(() => game.audioReady))
          throw new Error('Audio was ready after the simulated resume failure');
        await page.keyboard.press('q');
        await page.waitForFunction(() => game.audioReady, {timeout: 30000});
        await page.evaluate(async () => {
          await game.suspendAudio();
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForFunction(() => game.audioState === 'running', {timeout: 30000});
        await page.click('#audio-settings-button');
        await page.click('#music-enabled');
        const audioChoices = () => page.evaluate(() => ({
          music: document.querySelector('#music-enabled').checked,
          effects: document.querySelector('#effects-enabled').checked,
        }));
        const expected = {music: false, effects: true};
        if (JSON.stringify(await audioChoices()) !== JSON.stringify(expected))
          throw new Error('Music and Effects did not start in the requested state');
        await page.click('#audio-settings-button');
        for (const [method, toggle] of [
          ['icon', () => page.click('#mute-button')],
          ['keyboard', () => page.keyboard.press('m')],
        ]) {
          await toggle();
          const muted = await audioChoices();
          if (muted.music || muted.effects)
            throw new Error(`${method} did not mute both audio choices: ${JSON.stringify(muted)}`);
          await toggle();
          const restored = await audioChoices();
          if (JSON.stringify(restored) !== JSON.stringify(expected))
            throw new Error(`${method} lost separate audio choices: ${JSON.stringify(restored)}`);
        }
        await page.click('#mute-button');
        await page.reload({waitUntil: 'domcontentloaded'});
        await page.waitForFunction(() => window.game?.state.screen === 'title');
        await page.click('#mute-button');
        const afterReload = await audioChoices();
        if (JSON.stringify(afterReload) !== JSON.stringify({music: true, effects: true}))
          throw new Error(`Unmute after reload did not enable both choices: ${JSON.stringify(afterReload)}`);
      }, 1280, 800, false, false, true);
    if (name === 'memory')
      await withPage(name, async page => {
        const samples = [];
        for (let index = 0; index < 10; index++) {
          const before = await page.evaluate(() => game.clock);
          await page.evaluate(() => game.loadLevel('c5'));
          await page.waitForFunction(
              start => game.clock > start + .05, {timeout: 60000}, before);
          samples.push(await page.evaluate(() => game.memory));
        }
        const geometries = samples.slice(2).map(sample => sample.geometries);
        const textures = samples.slice(2).map(sample => sample.textures);
        if (Math.max(...geometries) - Math.min(...geometries) > 3 ||
            Math.max(...textures) - Math.min(...textures) > 3) {
          throw new Error(`Renderer memory grew: ${JSON.stringify(samples)}`);
        }
        console.log(`Renderer memory: ${JSON.stringify(samples.at(-1))}`);
      });
    if (errors.length > errorsBefore) throw new Error(errors.slice(errorsBefore).join('\n'));
    await publishScreenshots(name, stagingDir, shotsDir);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Browser check passed: ${scenarios.length} scenarios`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(stagingDir, {recursive: true, force: true});
}
