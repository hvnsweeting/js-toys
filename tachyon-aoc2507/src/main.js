import {AOC_EXAMPLE, simulate, checkWin, computeStars} from './sim.js';
import {levels, levelById} from './levels.js';
import {generateRushLevel} from './generator.js';
import {emptyProfile, loadProfile, saveProfile, STORAGE_KEY} from './storage.js';
import {showToast, clearToast, showScreen, renderSelection, renderHud, renderResult} from './ui.js';
import {createScene} from './render/scene.js';
import {accessStorage, shortcutAllowed, wallSeconds} from './runtime.js';
import {rushWinScore, rushTimeAfterElapsed} from './rush.js';

const touchCapable = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const state = {
  screen: 'title',
  mode: 'campaign',
  phase: 'attract',
  level: null,
  placements: [],
  selected: 'splitter',
  result: null,
  revealRow: 0,
  clock: 0,
  runSeconds: 0,
  pointerType: touchCapable ? 'touch' : 'mouse',
  rushSeed: 0,
  rushDepth: 0,
  rushTime: 180,
  rushScore: 0
};
let profile;
let view;
let music;
let sfx;
let audioContext;
let musicGain;
let effectsGain;
let audioLoading = false;
let lastFrame = performance.now();
let storage;
let mouse = {x: 0, y: 0};
let lastAttractRow = -1;
let lastAudioPointerUp = -Infinity;
let muteRestore = null;
const example = {
  id: 'example',
  name: 'The original manifold',
  grid: AOC_EXAMPLE,
  detectors: '.'.repeat(15),
  inventory: {splitter: 0, block: 0},
  par: 0
};
const exampleResult = simulate(example);

function coveredArea(mode) {
  const hud = document.getElementById('hud');
  const hudInfo = document.getElementById('hud-info');
  const hudHeight = hud.classList.contains('hidden') ? 0 : hud.getBoundingClientRect().height;
  const infoBounds = hudInfo.getBoundingClientRect();
  const infoVisible = !hudInfo.classList.contains('hidden');
  const shortLandscape = window.innerWidth > window.innerHeight && window.innerHeight <= 500;
  // On short landscape screens the text and buttons share a right-hand column; elsewhere the text
  // is a strip under the top bar and the buttons a bar along the bottom.
  const infoHeight = infoVisible && !shortLandscape ? infoBounds.height : 0;
  const columnWidth = infoVisible && shortLandscape ? window.innerWidth - infoBounds.left : 0;
  document.documentElement.style.setProperty('--hud-height', `${hudHeight}px`);
  document.documentElement.style.setProperty('--hud-info-height', `${infoHeight}px`);
  const title = document.querySelector('.title-panel');
  const selection = document.querySelector('.selection-panel');
  const help = document.querySelector('.help');
  const portraitPanel = window.innerWidth > 700 && window.innerHeight > window.innerWidth;
  if (portraitPanel && (mode === 'title' || mode === 'select' || mode === 'help')) {
    const panel = mode === 'title' ? title : mode === 'select' ? selection : help;
    return {left: 0, right: 0, top: 0, bottom: window.innerHeight - panel.getBoundingClientRect().top + 12};
  }
  if (shortLandscape && mode === 'game') return {left: 0, right: columnWidth, top: 0, bottom: 0};
  if (shortLandscape && mode === 'result') {
    const card = document.querySelector('.result').getBoundingClientRect();
    return {left: card.right + 12, right: columnWidth, top: 0, bottom: 0};
  }
  if (mode === 'game') return {left: 0, top: infoHeight, bottom: hudHeight};
  if (mode === 'result') {
    const card = document.querySelector('.result').getBoundingClientRect();
    if (window.innerWidth <= 700) return {left: 0, top: infoHeight, bottom: card.height + 12};
    return {left: card.right + 24, top: infoHeight, bottom: 0};
  }
  if (window.innerWidth <= 700) return {left: 0, bottom: 0};
  if (mode === 'title') return {left: title.getBoundingClientRect().right + 24, bottom: 0};
  if (mode === 'select') return {left: selection.getBoundingClientRect().right + 24, bottom: 0};
  if (mode === 'help') return {left: help.getBoundingClientRect().right + 24, bottom: 0};
  return {left: 0, bottom: 0};
}

async function ensureAudio() {
  if (audioLoading) return;
  audioLoading = true;
  try {
    if (audioContext && music && sfx) {
      if (audioContext.state === 'suspended') await audioContext.resume();
      return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    audioContext = new Context();
    musicGain = audioContext.createGain();
    effectsGain = audioContext.createGain();
    musicGain.connect(audioContext.destination);
    effectsGain.connect(audioContext.destination);
    applyVolume();
    await audioContext.resume();
    const [musicModule, sfxModule] =
        await Promise.all([import('./audio/music.js'), import('./audio/sfx.js')]);
    music = musicModule.createMusic(audioContext, musicGain);
    sfx = sfxModule.createSfx(audioContext, effectsGain, music);
    music.start();
    updateMusic();
  } catch (error) {
    console.warn('Audio is unavailable:', error.message);
    try {
      music?.stop();
    } catch {
    }
    try {
      await audioContext?.close();
    } catch {
    }
    audioContext = null;
    musicGain = null;
    effectsGain = null;
    music = null;
    sfx = null;
  } finally {
    audioLoading = false;
  }
}
function onAudioGesture(event) {
  const now = performance.now();
  if (event.type === 'pointerup') lastAudioPointerUp = now;
  if ((event.type === 'touchend' || event.type === 'click') &&
      now - lastAudioPointerUp < 500) return;
  ensureAudio();
}
function effect(name, ...arguments_) {
  try {
    sfx?.[name]?.(...arguments_);
  } catch {
  }
}
function updateMusic() {
  music?.setIntensity(state.mode === 'rush' ? 1 : state.screen === 'title' ? .2 : .55);
}
function applyVolume() {
  if (musicGain) musicGain.gain.value = profile.muteMusic ? 0 : profile.volume * .7;
  if (effectsGain) effectsGain.gain.value = profile.muteSfx ? 0 : profile.volume * .9;
  const muted = profile.muteMusic && profile.muteSfx;
  const muteButton = document.getElementById('mute-button');
  muteButton.classList.toggle('muted', muted);
  muteButton.setAttribute('aria-pressed', String(muted));
  muteButton.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  muteButton.title = muted ? 'Unmute sound (M)' : 'Mute sound (M)';
  document.getElementById('music-enabled').checked = !profile.muteMusic;
  document.getElementById('effects-enabled').checked = !profile.muteSfx;
  document.getElementById('master-volume').value = String(profile.volume);
}
function save(notify = showToast) {
  if (storage) return saveProfile(storage, profile, notify);
  notify('Progress could not be saved. Storage may be full or disabled.');
  return false;
}
function toggleMute() {
  if (profile.muteMusic && profile.muteSfx) {
    profile.muteMusic = muteRestore?.music ?? false;
    profile.muteSfx = muteRestore?.effects ?? false;
    muteRestore = null;
  } else {
    muteRestore = {music: profile.muteMusic, effects: profile.muteSfx};
    profile.muteMusic = true;
    profile.muteSfx = true;
  }
  applyVolume();
  save();
}
function refreshGhost() {
  const hovered = view.ghostCell();
  if (!hovered) return;
  view.setGhost(
      hovered.row, hovered.col, state.selected,
      allowed(hovered.row, hovered.col, state.selected));
}
function switchScreen(name) {
  state.screen = name;
  showScreen(name);
  document.getElementById('audio-settings').classList.add('hidden');
  view.setViewMode(name);
  updateMusic();
  if (name === 'select') renderSelection(profile, loadLevel);
  if (name === 'game' || name === 'result') renderHud(state, profile);
  else document.getElementById('top-status').textContent = 'AOC 2025 · DAY 7';
}
function showTitle() {
  state.mode = 'campaign';
  state.phase = 'attract';
  state.level = example;
  state.placements = [];
  state.result = exampleResult;
  state.revealRow = 0;
  state.runSeconds = 0;
  lastAttractRow = -1;
  view.setLevel(example);
  view.setBeam(exampleResult, 0);
  switchScreen('title');
  document.getElementById('attract-splits').textContent = '0';
  document.getElementById('attract-timelines').textContent = '0';
  document.getElementById('rush-best').textContent = `Best Rush score: ${profile.rushBest}`;
}
// Counts runs and level loads. A board tap edits only if none happened between its press and its
// release, so a press held through a run (fired from the keyboard) cannot edit after it.
let editSession = 0;
function loadLevel(id) {
  const level = typeof id === 'string' ? levelById[id] : id;
  if (!level) throw new Error(`Unknown level: ${id}`);
  editSession++;
  state.level = level;
  state.mode = level.id.startsWith('rush-') ? 'rush' : 'campaign';
  state.phase = 'editing';
  state.placements = [];
  state.selected = level.inventory.splitter ? 'splitter' : 'block';
  state.result = null;
  state.revealRow = -1;
  view.setLevel(level);
  view.setGhost(null);
  switchScreen('game');
  renderHud(state, profile);
  return level;
}
function used(kind) {
  return state.placements.filter(piece => piece.kind === kind).length;
}
function allowed(row, col, kind) {
  const level = state.level;
  if (!level || row <= 0 || row >= level.grid.length || col < 0 || col >= level.grid[0].length)
    return false;
  if (row === 1 && col === level.grid[0].indexOf('S')) return false;
  if (level.grid[row][col] !== '.' ||
      state.placements.some(piece => piece.row === row && piece.col === col))
    return false;
  return used(kind) < level.inventory[kind];
}
function canEdit() {
  if (state.screen !== 'game') return false;
  if (state.phase === 'running') {
    showToast('The beam is moving. Fire again to skip, then edit.');
    return false;
  }
  if (state.phase !== 'editing') return false;
  return true;
}
function clearResult() {
  state.result = null;
  state.revealRow = -1;
  view.setBeam(null, 0);
}
function place(row, col, kind = state.selected) {
  if (!canEdit()) return false;
  if (!allowed(row, col, kind)) {
    showToast('That cell is fixed, protected, or the inventory is empty.');
    return false;
  }
  state.placements.push({row, col, kind});
  clearResult();
  view.setPlacements(state.placements);
  renderHud(state, profile);
  effect('place');
  return true;
}
function remove(row, col) {
  if (!canEdit()) return false;
  const index = state.placements.findIndex(piece => piece.row === row && piece.col === col);
  if (index < 0) {
    showToast('Fixed crystals cannot be removed.');
    return false;
  }
  state.placements.splice(index, 1);
  clearResult();
  view.setPlacements(state.placements);
  renderHud(state, profile);
  effect('remove');
  return true;
}
function reset() {
  if (!canEdit()) return;
  state.placements = [];
  clearResult();
  view.setPlacements([]);
  renderHud(state, profile);
  effect('remove');
}
function undo() {
  if (!canEdit()) return;
  if (!state.placements.length) {
    showToast('There is no piece to undo.');
    return;
  }
  state.placements.pop();
  clearResult();
  view.setPlacements(state.placements);
  renderHud(state, profile);
  effect('remove');
}
function fire() {
  if (state.screen !== 'game') return;
  if (state.phase === 'running') {
    skipAnimation();
    return;
  }
  if (state.phase !== 'editing') return;
  editSession++;
  state.result = simulate(state.level, state.placements);
  state.phase = 'running';
  state.revealRow = 0;
  state.runSeconds = 0;
  view.setGhost(null);
  view.setBeam(state.result, 0);
  renderHud(state, profile);
  effect('fire');
}
function finishRun() {
  if (state.phase !== 'running') return;
  if (state.mode === 'rush') {
    const now = performance.now();
    const outcome = rushTimeAfterElapsed(state.rushTime, now, lastFrame);
    state.rushTime = outcome.time;
    lastFrame = now;
    if (outcome.expired) {
      endRush();
      return;
    }
  }
  state.revealRow = state.level.grid.length - 1;
  view.setBeam(state.result, state.revealRow);
  clearToast();
  const outcome = checkWin(state.level, state.result);
  if (!outcome.won) {
    state.phase = 'editing';
    showToast(outcome.reason);
    view.feedback('fail', state.clock, outcome.failures);
    const hitVoid = outcome.failures.some(failure => failure.kind === 'void');
    effect(hitVoid ? 'voidHit' : 'fail');
    renderHud(state, profile);
    return;
  }
  state.phase = 'won';
  view.feedback('win', state.clock);
  const stars = computeStars(state.level, state.result, state.placements.length);
  let saved = true;
  if (state.mode === 'campaign') {
    const id = state.level.id;
    profile.bestPieces[id] = Math.min(profile.bestPieces[id] ?? Infinity, state.placements.length);
    if (stars[2]) profile.bonusReached[id] = true;
    profile.stars[id] = 1 + Number(profile.bestPieces[id] <= state.level.par) +
        Number(profile.bonusReached[id] === true);
    saved = save(() => {});
  } else {
    const gain = rushWinScore(state.level, state.placements.length);
    state.rushScore += gain;
    state.rushTime += 20;
    profile.rushBest = Math.max(profile.rushBest, state.rushScore);
    saved = save(() => {});
  }
  effect('targetLit');
  effect('win', stars.filter(Boolean).length);
  renderResult(state.level, state.result, state.placements, stars, state.mode, !saved);
  if (state.mode === 'campaign') {
    const next = levels[levels.findIndex(level => level.id === state.level.id) + 1];
    if (!next || !sectorUnlocked(next.sector)) {
      document.querySelector('[data-action="next"]').textContent = 'Level select';
    }
  }
  switchScreen('result');
}
function skipAnimation() {
  if (state.phase === 'running') finishRun();
}
function startRush(seed = Math.floor(Math.random() * 0xffffffff)) {
  state.rushSeed = seed >>> 0;
  state.rushDepth = 0;
  state.rushTime = 180;
  state.rushScore = 0;
  loadLevel(generateRushLevel(state.rushSeed, 0));
  state.mode = 'rush';
  renderHud(state, profile);
  updateMusic();
  lastFrame = performance.now();
}
function sectorUnlocked(sector) {
  if (sector === 'A') return true;
  const previous = sector === 'B' ? 'A' : 'B';
  const solved = levels.filter(
      level => level.sector === previous && (profile.stars[level.id] ?? 0) > 0);
  return solved.length >= 4;
}
function nextLevel() {
  if (state.mode === 'rush') {
    state.rushDepth++;
    loadLevel(generateRushLevel(state.rushSeed, state.rushDepth));
    state.mode = 'rush';
    renderHud(state, profile);
    return;
  }
  const index = levels.findIndex(level => level.id === state.level.id);
  if (index >= levels.length - 1) {
    switchScreen('select');
    return;
  }
  const next = levels[index + 1];
  if (!sectorUnlocked(next.sector)) {
    switchScreen('select');
    showToast(`Solve four Sector ${state.level.sector} levels to unlock Sector ${next.sector}.`);
    return;
  }
  loadLevel(next.id);
}
function endRush() {
  state.phase = 'ended';
  state.mode = 'campaign';
  showToast(`Time! Final score: ${state.rushScore}.`);
  switchScreen('select');
}
function onAction(action) {
  effect('click');
  if (action === 'play') switchScreen('select');
  if (action === 'rush') startRush();
  if (action === 'help') switchScreen('help');
  if (action === 'menu') showTitle();
  if (action === 'next') nextLevel();
  // Rush boards are not replayed: a solved board already paid its score and time.
  if (action === 'retry' && state.mode !== 'rush') loadLevel(state.level.id);
  if (action === 'fire') fire();
  if (action === 'undo') undo();
  if (action === 'reset') reset();
}

function frame() {
  const now = performance.now();
  const previousFrame = lastFrame;
  const wallDelta = wallSeconds(now, lastFrame);
  const delta = Math.min(.1, wallDelta);
  lastFrame = now;
  state.clock += delta;
  if (state.screen === 'title') {
    const cycle = (state.clock % 7) / 7;
    const row = Math.min(example.grid.length - 1, Math.floor(cycle * example.grid.length));
    if (row !== lastAttractRow) {
      lastAttractRow = row;
      view.setBeam(exampleResult, row);
      const splits = exampleResult.splitEvents.filter(item => item.row <= row).length;
      const timelines = exampleResult.beamRows[row].reduce((sum, count) => sum + count, 0);
      document.getElementById('attract-splits').textContent = splits;
      document.getElementById('attract-timelines').textContent = timelines;
    }
  }
  if (state.mode === 'rush' && (state.screen === 'game' || state.screen === 'result')) {
    state.rushTime = rushTimeAfterElapsed(state.rushTime, now, previousFrame).time;
    document.getElementById('rush-timer').textContent =
        `${Math.floor(Math.ceil(state.rushTime) / 60)}:${
            String(Math.ceil(state.rushTime) % 60).padStart(2, '0')}`;
    if (!state.rushTime) endRush();
  }
  if (state.phase === 'running' && state.screen === 'game') {
    state.runSeconds += delta;
    const row = Math.min(state.level.grid.length - 1, Math.floor(state.runSeconds * 12));
    if (row > state.revealRow) {
      for (const event of state.result.splitEvents.filter(
               item => item.row > state.revealRow && item.row <= row)) {
        view.splitWave(event.row, event.col, state.clock);
        effect('split', event.col, state.level.grid[0].length);
      }
      state.revealRow = row;
      view.setBeam(state.result, row);
      renderHud(state, profile);
      if (row === state.level.grid.length - 1) finishRun();
    }
  }
  view.render(state.clock, mouse);
  requestAnimationFrame(frame);
}

// The visual viewport is the part of the page not covered by browser toolbars or the keyboard.
function syncAppHeight() {
  const viewport = window.visualViewport;
  // While pinch-zoomed the visual viewport is a magnified part of the page, not the screen space
  // left by the toolbar; keep the last unzoomed height so zooming does not shrink the game.
  const zoomed = viewport && Math.abs(viewport.scale - 1) > .01;
  if (zoomed) return;
  const visibleHeight = viewport?.height ?? window.innerHeight;
  if (!visibleHeight) return;
  document.documentElement.style.setProperty('--app-height', `${Math.round(visibleHeight)}px`);
}

function boot() {
  syncAppHeight();
  window.visualViewport?.addEventListener('resize', syncAppHeight);
  window.addEventListener('resize', syncAppHeight);
  try {
    storage = accessStorage(() => localStorage, showToast);
    profile = storage ? loadProfile(storage, showToast) : emptyProfile();
    view = createScene(document.getElementById('stage'), coveredArea);
    showTitle();
    applyVolume();
    document.documentElement.classList.toggle('touch-capable', touchCapable);
    document.addEventListener('pointerup', onAudioGesture, {passive: true});
    document.addEventListener('touchend', onAudioGesture, {passive: true});
    document.addEventListener('click', onAudioGesture);
    document.addEventListener('keydown', ensureAudio);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && audioContext) ensureAudio();
    });
    document.addEventListener('pointerdown', event => {
      if (!event.pointerType) return;
      state.pointerType = event.pointerType;
      if (state.screen === 'game') renderHud(state, profile);
    }, {passive: true});
    document.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.action) onAction(button.dataset.action);
      if (button.dataset.piece) {
        state.selected = button.dataset.piece;
        refreshGhost();
        renderHud(state, profile);
        effect('click');
      }
      if (event.detail > 0) button.blur();
    });
    document.getElementById('mute-button').addEventListener('click', toggleMute);
    document.getElementById('audio-settings-button').addEventListener('click', () => {
      document.getElementById('audio-settings').classList.toggle('hidden');
      effect('click');
    });
    document.getElementById('music-enabled').addEventListener('change', event => {
      profile.muteMusic = !event.target.checked;
      muteRestore = null;
      applyVolume();
      save();
    });
    document.getElementById('effects-enabled').addEventListener('change', event => {
      profile.muteSfx = !event.target.checked;
      muteRestore = null;
      applyVolume();
      save();
    });
    document.getElementById('master-volume').addEventListener('input', event => {
      profile.volume = Number(event.target.value);
      applyVolume();
      save();
    });
    const stage = document.getElementById('stage');
    stage.addEventListener('pointermove', event => {
      const pointerType = event.pointerType || 'mouse';
      if (pointerType !== state.pointerType) {
        state.pointerType = pointerType;
        if (state.screen === 'game') renderHud(state, profile);
      }
      mouse = {
        x: (event.clientX / window.innerWidth - .5) * 2,
        y: (event.clientY / window.innerHeight - .5) * 2
      };
      if (state.screen !== 'game' || state.phase !== 'editing') {
        view.setGhost(null);
        return;
      }
      const hit = view.pick(event.clientX, event.clientY);
      view.setGhost(
          hit?.row, hit?.col, state.selected,
          hit ? allowed(hit.row, hit.col, state.selected) : false);
    });
    stage.addEventListener('pointerleave', () => view.setGhost(null));
    // A cell changes on release of a tap, not on contact: a second finger, a pinch or a drag
    // must not place or remove pieces. A tap is the primary pointer moving at most 10 px, with
    // the left button (or a touch or pen) to place or remove, or the right button to remove.
    let press = null;
    // Any other pointer going down anywhere, even on a button, cancels the pending board tap.
    document.addEventListener('pointerdown', event => {
      if (press && event.pointerId !== press.id) press = null;
    }, {capture: true});
    stage.addEventListener('pointerdown', event => {
      if (state.screen !== 'game') return;
      state.pointerType = event.pointerType || 'mouse';
      const editButton = event.button === 0 || event.button === 2;
      // A press that began while a beam was running is not an edit, even if the run ends before
      // the release.
      const editable = state.phase === 'editing';
      if (!event.isPrimary || !editButton || !editable) {
        press = null;
        return;
      }
      press = {id: event.pointerId, x: event.clientX, y: event.clientY, farthest: 0,
        rightButton: event.button === 2, session: editSession};
    });
    // Track the press anywhere on the page: a drag that wanders over a panel and comes back to the
    // same cell is still a drag.
    document.addEventListener('pointermove', event => {
      if (!press || event.pointerId !== press.id) return;
      const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      press.farthest = Math.max(press.farthest, distance);
    });
    stage.addEventListener('pointercancel', () => {
      press = null;
    });
    stage.addEventListener('pointerup', event => {
      const tap = press;
      press = null;
      if (!tap || event.pointerId !== tap.id || tap.farthest > 10) return;
      if (state.screen !== 'game' || tap.session !== editSession) return;
      const hit = view.pick(tap.x, tap.y);
      if (!hit) return;
      if (tap.rightButton ||
          state.placements.some(piece => piece.row === hit.row && piece.col === hit.col))
        remove(hit.row, hit.col);
      else
        place(hit.row, hit.col, state.selected);
    });
    stage.addEventListener('contextmenu', event => event.preventDefault());
    stage.addEventListener('selectstart', event => event.preventDefault());
    document.addEventListener('keydown', event => {
      if (!shortcutAllowed(event)) return;
      const key = event.key.toLowerCase();
      const textControl = event.target instanceof HTMLElement &&
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);
      if (key === 'm' && !textControl) {
        toggleMute();
        return;
      }
      if (key === 'escape') {
        showTitle();
        return;
      }
      if (event.target instanceof HTMLElement &&
          ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target.tagName))
        return;
      if (key === '1' || key === '2') {
        if (state.screen !== 'game') return;
        const kind = key === '1' ? 'splitter' : 'block';
        if (!state.level.inventory[kind]) {
          showToast(`No ${kind}s are available in this level.`);
          return;
        }
        state.selected = kind;
        refreshGhost();
        renderHud(state, profile);
      }
      if (key === ' ' || key === 'f') {
        event.preventDefault();
        fire();
      }
      if (key === 'r') reset();
      if (key === 'z') undo();
    });
    window.addEventListener('storage', event => {
      if (event.key === STORAGE_KEY || event.key === null) {
        profile = storage ? loadProfile(storage, showToast) : emptyProfile();
        muteRestore = null;
        applyVolume();
        if (state.screen === 'select') renderSelection(profile, loadLevel);
        if (state.screen === 'game' || state.screen === 'result') renderHud(state, profile);
        if (state.screen === 'title')
          document.getElementById('rush-best').textContent =
              `Best Rush score: ${profile.rushBest}`;
      }
    });
    window.game = {
      state,
      sim: simulate,
      loadLevel,
      place,
      remove,
      fire,
      skipAnimation,
      startRush,
      levels,
      cellScreenPosition(row, col) {
        return view.cellScreenPosition(row, col);
      },
      get hover() {
        return view.ghostCell();
      },
      get clock() {
        return state.clock;
      },
      get memory() {
        return view.memory();
      },
      get boardBounds() {
        return view.boardBounds();
      },
      get boardRowScale() {
        return view.boardRowScale();
      },
      get beamSegmentCount() {
        return view.beamSegmentCount();
      },
      get beamDrawState() {
        return view.beamDrawState();
      },
      beamPixels() {
        return view.beamPixels(state.result, state.clock, mouse);
      },
      blockHitPixels() {
        return view.blockHitPixels(state.result, state.clock, mouse);
      },
      get audioReady() {
        return Boolean(audioContext && music && sfx);
      },
      get audioLoading() {
        return audioLoading;
      },
      get audioState() {
        return audioContext?.state ?? 'unavailable';
      },
      suspendAudio() {
        return audioContext?.suspend();
      },
      get straySceneObjects() {
        return view.straySceneObjects();
      },
      get visibleSparkCount() {
        return view.unusedSparkCount();
      },
      get failureMarks() {
        return view.failureMarks();
      },
      get voidFlashColumns() {
        return view.failureMarks().filter(mark => mark.kind === 'void').map(mark => mark.col);
      }
    };
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    const panel = document.getElementById('boot-error');
    panel.classList.remove('hidden');
    panel.textContent = `Tachyon Cascade could not start: ${error.message}`;
  }
}
boot();
