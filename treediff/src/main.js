// Wires the world, the two trees, the game rules and the page together.
//
// One screen. Two trees grow from one seed; they differ in three places. The player clicks each
// difference on either tree. A click on a difference marks it with a ring on both trees and
// scores points; a click on anything else is a miss and costs a few. "New pair" starts again.
//
// Phases: growing (the trees are being planted: shrinking, then growing), playing, done.

import { createWorld, TREE_SPACING } from './world.js';
import { TreeView } from './treeView.js';
import { makePair, createRound, registerClick, isComplete, scoreAfter, trunkOffset, trunkReach } from './game.js';
import { DIFFERENCES, editFor, objectsFor, findDifferenceAt } from './differences.js';
import { randomSeed, clamp } from './random.js';
import { Sound } from './sound.js';

const $ = (id) => document.getElementById(id);

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    // Release the probe at once: browsers cap the number of live WebGL contexts.
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

function showStartError() {
  for (const element of [$('banner'), $('bar'), $('mute'), $('new-pair'), $('scoreboard')]) element.classList.add('hidden');
  $('webgl-error').classList.remove('hidden');
}

// A press that moves less than this many pixels and ends within this many milliseconds is a click;
// anything else is the player turning the trees.
const CLICK_MOVE = 6;
const CLICK_TIME = 500;
const FOUND_COLOUR = '#7ccf4a';
const HINT_COLOUR = '#ffd166';
const HINT_SECONDS = 5;

// Keep a copy of the game's files, so after one visit it also starts with no internet
// (doc/specs/OfflineApp.md). Registered after the page has loaded, so the copying does not slow
// the first start. Where service workers are not available (the game served over plain HTTP to
// another machine, or a browser that blocks them), the game plays online as before.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn(`The offline copy is not available: ${error.message}`));
  });
}

if (!webglAvailable()) {
  showStartError();
} else {
  try {
    boot();
  } catch (error) {
    // A renderer can still fail after the probe (driver limits, lost context);
    // a message beats a page with buttons that do not respond.
    console.error(error);
    showStartError();
  }
}

function boot() {
  const sound = new Sound(false);
  const world = createWorld($('stage'));
  const left = new TreeView(world.scene, -TREE_SPACING);
  const right = new TreeView(world.scene, TREE_SPACING);
  const views = { left, right };
  // Where each trunk stands; changed for each pair by placePair().
  const treeX = { left: -TREE_SPACING, right: TREE_SPACING };

  const state = {
    phase: 'growing',
    pair: null,
    round: null,
    pairCount: 0,
    // Points over the whole visit, across pairs; not saved.
    score: 0,
    hint: null,
    hintUntil: 0,
    transition: 0,
  };
  let elapsed = 0;
  let muted = false;
  // The guide banner says what to do. It stays up only until the player first presses on, lets go
  // of, or zooms the trees during play, and does not come back until the page is loaded again.
  let guideShown = true;

  // ---------------------------------------------------------------- trees

  // How much of the screen the top row (scoreboard, and the guide banner below it while shown)
  // and the bar (bottom) cover. The trees are fitted into what is left.
  function covers() {
    const scoreboard = $('scoreboard').getBoundingClientRect();
    const banner = $('banner').getBoundingClientRect();
    const bar = $('bar').getBoundingClientRect();
    if (bar.width === 0) return {};
    const topBottom = guideShown ? Math.max(scoreboard.bottom, banner.bottom) : scoreboard.bottom;
    return {
      top: clamp(topBottom / window.innerHeight, 0, 0.5),
      bottom: clamp((window.innerHeight - bar.top) / window.innerHeight, 0, 0.5),
    };
  }

  // Shrinks whatever is planted, then grows the new pair. Returns false if a newer planting
  // started meanwhile, so callers can drop stale follow-up work.
  async function plantPair(pair) {
    const id = ++state.transition;
    if (left.growth > 0 || right.growth > 0) {
      await Promise.all([left.growTo(0, 2.6), right.growTo(0, 2.6)]);
      if (id !== state.transition) return false;
    }
    for (const side of ['left', 'right']) {
      views[side].setTree(pair.seed, pair.genes, 0, editFor(pair.differences, side));
      views[side].setProps(objectsFor(pair.differences, side));
    }
    placePair(pair);
    world.frameBounds([left.grownBounds(), right.grownBounds()], elapsed, covers());
    sound.grow();
    await Promise.all([left.growTo(1, 0.55), right.growTo(1, 0.55)]);
    return id === state.transition;
  }

  // A tree's branch bounds measured from its own trunk.
  function trunkBounds(side) {
    const view = views[side];
    const bounds = view.grownBounds();
    return { minX: bounds.minX - view.worldX, maxX: bounds.maxX - view.worldX };
  }

  // Stands the two trees as close as their crowns allow (see trunkOffset in game.js). Called while
  // both are shrunk to nothing, so they never visibly jump.
  function placePair(pair) {
    const offset = trunkOffset(trunkReach(trunkBounds('left'), pair.differences, 'left'), trunkReach(trunkBounds('right'), pair.differences, 'right'));
    treeX.left = -offset;
    treeX.right = offset;
    left.setX(-offset);
    right.setX(offset);
    world.fallingLeaves.clear();
  }

  // Fits both trees on screen again, for example after the window changed shape.
  function reframe() {
    const hasSize = window.innerWidth > 0 && window.innerHeight > 0;
    if (!left.species || !right.species || !hasSize) return;
    world.frameBounds([left.grownBounds(), right.grownBounds()], elapsed, covers());
  }

  // ---------------------------------------------------------------- the pair

  async function newPair() {
    state.hint = null;
    state.hintUntil = 0;
    const pair = makePair(Math.random, randomSeed);
    state.pair = pair;
    state.round = createRound(pair);
    state.phase = 'growing';
    refreshRings();
    // The light changes with every pair: morning, golden hour, dusk, dawn...
    world.setPalette(1 + state.pairCount++);
    $('result').textContent = '';
    $('new-pair').classList.remove('ready');
    // A "+100" from the last find of the previous pair must not float over the new one.
    $('score-change').classList.remove('show');
    // The last round's "Press New pair for another" is no longer true.
    announce('The trees are growing.');
    render();

    const planted = await plantPair(pair);
    if (!planted || state.pair !== pair) return;
    state.phase = 'playing';
    announce(`New pair. Find the ${DIFFERENCES} differences.`);
    render();
  }

  // The rings on both trees: one around every difference found, and the hint's pulsing ring.
  function refreshRings() {
    const rings = state.round.found.map((index) => {
      const { position, radius } = state.pair.differences[index];
      return { position, radius, color: FOUND_COLOUR };
    });
    if (state.hint) rings.push({ position: state.hint.position, radius: state.hint.radius, color: HINT_COLOUR, pulse: true });
    for (const view of [left, right]) view.setRings(rings);
  }

  function click(clientX, clientY) {
    if (state.phase !== 'playing') return;
    const hit = findDifferenceAt(state.pair.differences, world.rayAt(clientX, clientY), treeX);
    const outcome = registerClick(state.round, hit ? hit.index : null);
    const before = state.score;
    state.score = scoreAfter(state.score, outcome);
    if (outcome === 'found') {
      showScoreChange(`+${state.score - before}`, false);
      announce(`Found ${state.round.found.length} of ${DIFFERENCES}. Score ${state.score}.`);
      // A hint pointing at what was just found has done its job.
      if (state.hint && state.hint.index === hit.index) clearHint();
      refreshRings();
      if (isComplete(state.round)) {
        sound.win();
        finish();
      } else {
        sound.correct();
      }
    } else if (outcome === 'miss') {
      // At a score of 0 a miss costs nothing, but the player still sees that it was a miss.
      const lost = before - state.score;
      showScoreChange(lost > 0 ? `-${lost}` : 'Miss', true);
      announce(`Miss. Score ${state.score}.`);
      sound.click();
    }
    render();
  }

  function finish() {
    state.phase = 'done';
    clearHint();
    const names = state.pair.differences.map((difference) => difference.label);
    const list = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    $('result').textContent = `All ${DIFFERENCES} noticed: ${list}.`;
    announce(`Found ${DIFFERENCES} of ${DIFFERENCES}. Score ${state.score}. All ${DIFFERENCES} noticed: ${list}. Press New pair for another.`);
    // Point the player at what to do next: the New pair button pulses (or shows a steady ring
    // under reduced motion), with its name under it.
    $('new-pair').classList.add('ready');
    // The result line makes the bar taller, so the trees are fitted again above it. The round is
    // over, so the camera can glide back to show the whole pair with its rings.
    reframe();
  }

  // A faint pulsing ring near one difference that is not found yet: an area, not the exact spot.
  function showHint() {
    if (state.phase !== 'playing') return;
    const open = state.pair.differences.filter((_, index) => !state.round.found.includes(index));
    const difference = open[Math.floor(Math.random() * open.length)];
    const position = difference.position.map((value) => value + (Math.random() - 0.5) * difference.radius);
    state.hint = { position, radius: difference.radius * 1.8, index: state.pair.differences.indexOf(difference) };
    state.hintUntil = elapsed + HINT_SECONDS;
    refreshRings();
  }

  // A large "+100", "-20" or "Miss" in the middle of the screen, rising and fading (only fading
  // when the player asks for reduced motion).
  function showScoreChange(text, isLoss) {
    const label = $('score-change');
    label.textContent = text;
    label.classList.toggle('loss', isLoss);
    // Restart the animation: removing the class and reading the layout lets it play again.
    label.classList.remove('show');
    void label.offsetWidth;
    label.classList.add('show');
  }

  // Screen readers hear each find and miss, the score and what to do at the end of a round from
  // this hidden live line, since the dots' label and the score's text change without being read
  // out, and the pop-up is hidden from them. (The guide's instruction line is live too.)
  // A screen reader reads a live line only when its text changes, so a repeated message (a second
  // "Miss. Score 0.") gets a no-break space added or removed at the end to make it differ.
  function announce(text) {
    const line = $('announce');
    const same = line.textContent.trim() === text;
    line.textContent = same && !line.textContent.endsWith('\u00a0') ? `${text}\u00a0` : text;
  }

  function clearHint() {
    if (!state.hint) return;
    state.hint = null;
    state.hintUntil = 0;
    if (state.round) refreshRings();
  }

  // ---------------------------------------------------------------- page

  // The guide's line under its title. It is gone before a round can be done, since finding a
  // difference takes a press on the trees.
  const INSTRUCTION = {
    growing: 'The trees are growing...',
    playing: `These two trees differ in ${DIFFERENCES} places. Click each difference. Drag to turn the trees, scroll to zoom.`,
  };

  function render() {
    const round = state.round;
    $('instruction').textContent = INSTRUCTION[state.phase] ?? '';
    const dots = $('progress').children;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('found', i < round.found.length);
    $('progress').setAttribute('aria-label', `${round.found.length} of ${DIFFERENCES} found`);
    $('score').textContent = String(state.score);
    $('hint').disabled = state.phase !== 'playing';
  }

  // The trees are not framed again here: the camera would glide away while the player is aiming
  // or dragging. The next pair is framed with only the scoreboard at the top.
  function dismissGuide() {
    if (!guideShown || state.phase !== 'playing') return;
    guideShown = false;
    $('banner').classList.add('dismissed');
  }

  function setMuted(value) {
    muted = value;
    sound.setMuted(muted);
    $('mute').classList.toggle('muted', muted);
    $('mute').setAttribute('aria-pressed', String(muted));
  }

  // ---------------------------------------------------------------- input

  const canvas = world.renderer.domElement;
  const presses = new Map();
  canvas.addEventListener('pointerdown', (event) => {
    dismissGuide();
    // Only a press that starts during play can be a click: one held from the growing would score
    // on a pair the player could not yet play.
    const startedInPlay = state.phase === 'playing';
    presses.set(event.pointerId, { x: event.clientX, y: event.clientY, time: performance.now(), farthest: 0, spoiled: presses.size > 0 || !startedInPlay, pair: state.pair });
    // A second finger (pinch, two-finger turn) spoils the press of the first as well.
    if (presses.size > 1) for (const press of presses.values()) press.spoiled = true;
  });
  // The farthest a press went, not where it ended: a quick drag out and back turned the trees.
  canvas.addEventListener('pointermove', (event) => {
    const press = presses.get(event.pointerId);
    if (press) press.farthest = Math.max(press.farthest, Math.hypot(event.clientX - press.x, event.clientY - press.y));
  });
  canvas.addEventListener('pointerup', (event) => {
    // A press held from the growing into play is not a click, but the player has started.
    dismissGuide();
    const press = presses.get(event.pointerId);
    presses.delete(event.pointerId);
    // A press that began on another pair (New pair pressed with a key meanwhile) is not a click.
    if (!press || press.spoiled || press.pair !== state.pair) return;
    const farthest = Math.max(press.farthest, Math.hypot(event.clientX - press.x, event.clientY - press.y));
    if (farthest < CLICK_MOVE && performance.now() - press.time < CLICK_TIME) click(event.clientX, event.clientY);
  });
  canvas.addEventListener('pointercancel', (event) => presses.delete(event.pointerId));
  canvas.addEventListener('wheel', dismissGuide, { passive: true });

  // Space and Enter belong to a focused button when the player reached it with the keyboard
  // (it is how they press it), and to the game when they clicked it. The browser's own
  // :focus-visible cannot tell the two apart: it also matches a clicked button as soon as a key
  // is pressed on it. So each focus change is classified here: focus that lands on the button
  // just pressed with the pointer is a click's; any other (Tab, a script, a screen reader)
  // counts as keyboard. A press resets the state, since a browser that does not focus buttons
  // on click (Safari) fires no focus event for it.
  let pointerDownAt = -Infinity;
  let pointerDownButton = null;
  let focusReachedByKeyboard = true;
  window.addEventListener('pointerdown', (event) => {
    pointerDownAt = event.timeStamp;
    pointerDownButton = event.target instanceof Element ? event.target.closest('button, a') : null;
    focusReachedByKeyboard = false;
    // The sound needs a user gesture before it can start. A press on the sound button waits for
    // its click handler, which sets the mute choice first, so a game muted by its first click
    // never plays a burst of wind.
    const onMuteButton = event.target instanceof Element && event.target.closest('#mute');
    if (!onMuteButton) sound.unlock();
  });
  window.addEventListener('focusin', (event) => {
    const byClick = event.target === pointerDownButton && event.timeStamp - pointerDownAt <= 100;
    focusReachedByKeyboard = !byClick;
  });

  // The key a press means: the typed letter or digit, or, on a layout where that is not a
  // Latin letter or a digit (Cyrillic), the physical key's name.
  function gameKey(event) {
    // Key events that are part of composing a character (dead keys, input methods) have no meaning
    // to the game, whatever the key position.
    if (event.isComposing || event.keyCode === 229 || event.key === 'Dead' || event.key === 'Process') return '';
    if (/^[a-z0-9]$/i.test(event.key)) return event.key.toLowerCase();
    const byCode = event.code.match(/^Digit([0-9])$|^Key([A-Z])$/);
    if (byCode) return (byCode[1] ?? byCode[2]).toLowerCase();
    return event.key.toLowerCase();
  }

  // A Space key press that the game took must not also click a focused button when the key
  // is released (some browsers do that even after keydown was cancelled).
  let spaceTaken = false;

  window.addEventListener('keydown', (event) => {
    // Browser shortcuts (Ctrl+D, Cmd+1...) and auto-repeat of a held key are not game keys.
    const isShortcut = event.ctrlKey || event.metaKey || event.altKey;
    if (isShortcut) return;
    // A held key repeats: not a new game action, and on a focused button not a new press either
    // (Enter would start pair after pair, or toggle the sound on and off).
    if (event.repeat) {
      if (event.target instanceof HTMLButtonElement) event.preventDefault();
      return;
    }
    const key = gameKey(event);
    if (key === 'm') {
      // The mute choice is set before the sound starts, so a first M starts it silent: the browser
      // lets audio start only during a key press or click, and a later M must be able to unmute.
      setMuted(!muted);
      sound.unlock();
      return;
    }
    // Only a game key (H, N, Space, Enter) starts the background sound, as any press on the scene
    // does, even while the trees grow (M above starts it muted). Tab and the like only move around
    // the page, so a keyboard player can reach the sound button and mute
    // before hearing anything; Space or Enter on that button waits for its click handler, which
    // sets the mute choice first.
    const isGameKey = key === 'h' || key === 'n' || key === ' ' || key === 'enter';
    const onMuteButton = event.target instanceof Element && event.target.closest('#mute');
    const pressesMuteButton = onMuteButton && (key === ' ' || key === 'enter');
    if (isGameKey && !pressesMuteButton) sound.unlock();
    if (key === 'h') {
      showHint();
      return;
    }
    if (key === ' ' || key === 'enter' || key === 'n') {
      // On a control reached with the keyboard, Space and Enter are its own: they press a button,
      // and Enter follows the Back to Arcade link.
      const onControl = event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement;
      if (key !== 'n' && onControl && focusReachedByKeyboard) return;
      event.preventDefault();
      spaceTaken = key === ' ';
      newPair();
    }
  });

  // No sound from a background tab: pause it while the page is hidden.
  document.addEventListener('visibilitychange', () => sound.setPaused(document.hidden));

  // A key released in another window sends no keyup here.
  window.addEventListener('blur', () => {
    spaceTaken = false;
    // A touch that began before focus moved may never report its end here.
    presses.clear();
  });

  window.addEventListener('keyup', (event) => {
    if (event.key !== ' ' || !spaceTaken) return;
    spaceTaken = false;
    event.preventDefault();
  });

  $('hint').addEventListener('click', showHint);
  $('new-pair').addEventListener('click', newPair);
  $('mute').addEventListener('click', () => {
    setMuted(!muted);
    sound.unlock();
  });

  // The stage changed shape (rotation, split screen, shown after being hidden):
  // fit the trees again once the resizing has settled.
  let resizeTimer = 0;
  const reframeSoon = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(reframe, 150);
  };
  if (window.ResizeObserver) new ResizeObserver(reframeSoon).observe($('stage'));
  else window.addEventListener('resize', reframeSoon);

  // ---------------------------------------------------------------- loop

  let last = performance.now();
  function frame(now) {
    // The first frame's timestamp can be earlier than `last`, so the step is never negative.
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    elapsed += dt;
    if (state.hint && elapsed > state.hintUntil) clearHint();
    left.update(dt);
    right.update(dt);
    world.update(dt, elapsed, [left, right]);
    world.render();
    requestAnimationFrame(frame);
  }

  world.setPalette(1, true);
  newPair();
  requestAnimationFrame(frame);

  // Exposed for automated checks and for curious players in the console. `elapsed` is game
  // time in seconds; frames advance it by at most 0.05 s, so it runs slower than the clock
  // when the renderer is slow.
  window.treeAppreciator = {
    state,
    sound,
    world,
    left,
    right,
    get elapsed() {
      return elapsed;
    },
  };
}
