import { createScene } from './scene.js';
import { createMusic } from './music.js';
import { playEffect } from './effects.js';
import { CEILING, FLOOR, PLAYER_Z, FIXED_STEP, activateGate, alignGateSpacing, clamp, collectFirefly, difficulty, fireflyCenter, fixedSteps, gapCenter, gateClearance, gateCleared, gateOverlaps, gateSpacing, hitsGate, hitsWorld, makeGate, medalFor, physicsStep, puffVelocity, readBest, saveBest, scorePassAtClearance, seededRandom, skyPeriod, updateGateTransition, wispAtWitch } from './rules.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || Date.now();
let random = seededRandom(seed);
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const state = { phase: 'title', time: 0, y: .2, velocity: 0, score: 0, best: readBest(storage), shield: false, streak: 0, gates: [], activeGust: 0, gustUntil: 0, lastPuff: -10, invulnerableUntil: 0, deathTime: 0, deathY: 0 };
const cards = { title: $('title-card'), paused: $('pause-card'), over: $('over-card') };
let scene;
let audioContext;
let music;
let effectsBus;
function readSetting(key) {
  try { return storage?.getItem(key) === 'true'; } catch { return false; }
}
function saveSetting(key, value) {
  try { storage?.setItem(key, String(value)); } catch { /* The control still works for this visit. */ }
}
let muted = readSetting('flappy-witch-muted');
let musicMuted = readSetting('flappy-witch-music-muted');
let scheduledEffects = 0;
let lastFrame = performance.now();
let visualTime = 0;
let toastTimer;
let firstPuff = false;
let bestShown = false;
let resumeAt = 0;
let backlog = 0;
let launchPending = false;
let launchTimer;

function nextGate() {
  return state.gates.find(gate => !gate.passed) || null;
}

function showCard(name) {
  for (const [key, card] of Object.entries(cards)) card.classList.toggle('hidden', key !== name);
  $('pause').classList.toggle('hidden', !['playing', 'paused'].includes(state.phase));
  $('arcade-back').classList.toggle('hidden', !['title', 'over'].includes(name));
  $('play-hint').classList.toggle('show', name === '' && !firstPuff);
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 900);
}

function scorePop(points) {
  const element = $('score-pop');
  element.textContent = points === 2 ? '+2 near miss' : '+1';
  element.classList.remove('show');
  void element.offsetWidth;
  element.classList.add('show');
  $('score').classList.remove('bump');
  void $('score').offsetWidth;
  $('score').classList.add('bump');
}

function updateStreak() {
  [...$('streak-dots').children].forEach((dot, index) => dot.classList.toggle('filled', index < state.streak));
  $('streak-dots').setAttribute('aria-label', `Wisps: ${state.streak} of 5`);
  $('shield-icon').classList.toggle('hidden', !state.shield);
}

async function unlockAudio() {
  if (muted) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (audioContext.state === 'running' && !music) {
      effectsBus = audioContext.createGain();
      music = createMusic(audioContext);
      effectsBus.connect(music.effectsInput);
    }
    syncAudio();
  } catch {
    // A blocked audio context must not prevent the gesture from starting play.
  }
}

function syncAudio() {
  if (!music || !audioContext) return;
  effectsBus.gain.setTargetAtTime(muted ? 0 : 1, audioContext.currentTime, .015);
  music.update(state.phase, state.score, muted || musicMuted, document.hidden);
}

function sound(kind) {
  if (muted || !audioContext || audioContext.state !== 'running') return;
  playEffect(audioContext, effectsBus, kind);
  scheduledEffects++;
}

function updateMute() {
  $('sound-icon').innerHTML = muted
    ? '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 12h6l7-6v20l-7-6H4z"/><path d="m22 12 7 8m0-8-7 8"/></svg>'
    : '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 12h6l7-6v20l-7-6H4z"/><path d="M21 11c3 2 3 8 0 10m4-14c5 4 5 14 0 18"/></svg>';
  $('mute').setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  $('mute').title = muted ? 'Unmute sound' : 'Mute sound';
  $('music-icon').textContent = musicMuted ? '♩̸' : '♫';
  $('music-mute').setAttribute('aria-label', musicMuted ? 'Unmute music' : 'Mute music');
  $('music-mute').title = musicMuted ? 'Unmute music' : 'Mute music';
}

function addGate() {
  const previous = state.gates.at(-1);
  const index = previous ? previous.index + 1 : 0;
  const z = previous ? previous.z - gateSpacing(state.score) : -9;
  state.gates.push(makeGate(index, z, state.score, random, previous));
}

function start() {
  clearTimeout(launchTimer);
  launchTimer = undefined;
  launchPending = false;
  $('start').disabled = false;
  $('start').textContent = 'Tap to fly';
  random = seededRandom(seed);
  state.phase = 'playing';
  state.time = 0;
  state.y = .2;
  state.velocity = 0;
  state.score = 0;
  state.streak = 0;
  state.shield = false;
  state.activeGust = 0;
  state.gustUntil = 0;
  state.invulnerableUntil = 0;
  state.lastPuff = -10;
  scene.resetPuff();
  state.gates = [];
  backlog = 0;
  for (let i = 0; i < 5; i++) addGate();
  $('score').textContent = '0';
  $('sky').dataset.period = '0';
  firstPuff = false;
  bestShown = false;
  $('best-banner').classList.remove('show');
  $('countdown').classList.add('hidden');
  updateStreak();
  showCard('');
  puff();
}

function beginRun() {
  if (state.phase !== 'title') { start(); return; }
  if (launchPending) return;
  if (muted || musicMuted || !music || audioContext?.state !== 'running') { start(); return; }
  launchPending = true;
  $('start').disabled = true;
  $('start').textContent = 'The night awakens...';
  // The first gesture unlocks audio; leave the title visible for its opening phrase.
  launchTimer = setTimeout(() => {
    launchTimer = undefined;
    if (document.hidden || state.phase !== 'title') {
      launchPending = false;
      $('start').disabled = false;
      $('start').textContent = 'Tap to fly';
      return;
    }
    start();
  }, 1100);
}

function puff() {
  if (state.phase !== 'playing') return;
  state.velocity = puffVelocity();
  state.lastPuff = state.time;
  firstPuff = true;
  $('play-hint').classList.remove('show');
  sound('puff');
}

function finish() {
  state.phase = 'dying';
  state.deathTime = state.time;
  state.deathY = state.y;
  sound('hit');
  scene.shake();
  state.best = Math.max(state.best, readBest(storage), state.score);
  saveBest(storage, state.best);
  $('final-score').textContent = String(state.score);
  $('best-score').textContent = String(state.best);
  $('medal').textContent = medalFor(state.score);
  showCard('');
}

function takeHit() {
  if (state.time < state.invulnerableUntil) return;
  if (state.shield) {
    state.shield = false;
    state.streak = 0;
    state.invulnerableUntil = state.time + 1;
    const safeReach = scene.witch.collision.vertical + .02;
    state.y = clamp(state.y, FLOOR + safeReach, CEILING - safeReach);
    state.velocity = 1.4;
    scene.shieldBreak(visualTime, state.y);
    sound('shield');
    toast('Glow saved you');
    updateStreak();
    return;
  }
  finish();
}

function advance(dt) {
  if (state.phase === 'dying') {
    state.time += dt;
    if (state.time - state.deathTime >= .8) { state.phase = 'over'; showCard('over'); }
    return;
  }
  if (state.phase !== 'playing') return;
  state.time += dt;
  const gust = state.time < state.gustUntil ? state.activeGust : 0;
  const next = physicsStep(state.y, state.velocity, dt, gust);
  state.y = next.y;
  state.velocity = next.velocity;
  if (hitsWorld(state.y, scene.witch.collision.vertical)) {
    takeHit();
    if (state.phase !== 'playing') return;
  }
  const speed = difficulty(state.score).speed;
  const activeGate = nextGate();
  if (activeGate && !activeGate.active) activateGate(activeGate, state.score, state.time);
  let scoredGate = false;
  for (const gate of state.gates) {
    gate.z += speed * dt;
    updateGateTransition(gate, state.time);
    if (gate.gust && !gate.gustStarted && gate.z >= PLAYER_Z - speed) {
      gate.gustStarted = true;
      state.activeGust = gate.gust;
      state.gustUntil = state.time + .85;
      toast(gate.gust > 0 ? 'Warm gust rises' : 'Cool gust falls');
    }
    if (gate.passed) continue;
    const center = gapCenter(gate, state.time);
    if (gateOverlaps(gate.z, scene.witch.collision.front, scene.witch.collision.back)) {
      if (hitsGate(state.y, center, gate.halfGap, scene.witch.collision.vertical)) {
        gate.hit = true;
        takeHit();
        if (state.phase !== 'playing') return;
      } else if (!gate.hit) {
        const clearance = gateClearance(state.y, center, gate.halfGap, scene.witch.collision.vertical);
        gate.minimumClearance = Math.min(gate.minimumClearance, clearance);
      }
    }
    if (!gate.hit && gate.wispCaught === null && wispAtWitch(gate.z)) {
      gate.wispCaught = Math.abs(state.y - fireflyCenter(gate, state.time)) < .65;
      const fly = collectFirefly(state.streak, state.shield, gate.wispCaught);
      state.streak = fly.streak;
      state.shield = fly.shield;
      updateStreak();
      if (gate.wispCaught) { sound('fly'); scene.sparkle(visualTime, state.y); }
      if (fly.gained) toast('Wisp glow!');
    }
    if (!gateCleared(gate.z, scene.witch.collision.back)) continue;
    gate.passed = true;
    if (gate.hit) continue;
    const previousScore = state.score;
    const result = scorePassAtClearance(state.score, gate.minimumClearance);
    state.score = result.score;
    scoredGate = true;
    $('score').textContent = String(state.score);
    scorePop(state.score - previousScore);
    if (!bestShown && state.score > state.best) {
      bestShown = true;
      $('best-banner').classList.add('show');
      setTimeout(() => $('best-banner').classList.remove('show'), 1300);
    }
    if (result.nearMiss) scene.sparkle(visualTime, state.y);
    sound('pass');
    $('sky').dataset.period = String(skyPeriod(state.score));
  }
  // Reposition queued gates after they all move for this tick, keeping each interval exact.
  if (scoredGate) alignGateSpacing(state.gates, state.score);
  while (state.gates.length && state.gates[0].z > PLAYER_Z + 5) state.gates.shift();
  while (state.gates.length < 5) addGate();
}

function frame(now) {
  const elapsed = Math.max(0, (now - lastFrame) / 1000);
  lastFrame = now;
  const renderSeconds = Math.min(elapsed, .25);
  visualTime += renderSeconds;
  if (state.phase === 'countdown') {
    const remaining = Math.ceil(resumeAt - visualTime);
    $('countdown').textContent = String(Math.max(1, remaining));
    if (visualTime >= resumeAt) {
      state.phase = 'playing';
      $('countdown').classList.add('hidden');
      showCard('');
    }
  }
  if (state.phase === 'playing' || state.phase === 'dying') {
    const steps = fixedSteps(backlog, elapsed);
    backlog = steps.backlog;
    for (let index = 0; index < steps.count; index++) advance(FIXED_STEP);
  } else {
    backlog = 0;
  }
  scene.render(state, visualTime, renderSeconds);
  syncAudio();
  requestAnimationFrame(frame);
}

function resume() {
  if (state.phase !== 'paused') return;
  state.phase = 'countdown';
  resumeAt = visualTime + 3;
  $('countdown').textContent = '3';
  $('countdown').classList.remove('hidden');
  showCard('');
}

async function activePointer(event) {
  if (event.target.closest('button, a, .card:not(#title-card)')) return;
  if (event.pointerType === 'touch') $('hint').textContent = 'Tap anywhere to rise. Find wisps for a second chance.';
  if (state.phase === 'title' || state.phase === 'over') {
    await unlockAudio();
    beginRun();
  } else {
    void unlockAudio();
    puff();
  }
}

function setupInput() {
  document.addEventListener('click', event => {
    const button = event.composedPath().find(node => node instanceof HTMLButtonElement);
    if (event.detail > 0) button?.blur();
  });
  $('stage').addEventListener('pointerup', activePointer);
  $('stage').addEventListener('contextmenu', event => event.preventDefault());
  $('start').addEventListener('click', async () => { await unlockAudio(); beginRun(); });
  $('again').addEventListener('click', async () => { await unlockAudio(); beginRun(); });
  $('pause').addEventListener('click', () => {
    if (state.phase === 'playing') { state.phase = 'paused'; showCard('paused'); }
    else if (state.phase === 'paused') resume();
    void unlockAudio();
  });
  $('resume').addEventListener('click', async () => { await unlockAudio(); resume(); });
  $('mute').addEventListener('click', () => {
    muted = !muted;
    saveSetting('flappy-witch-muted', muted);
    updateMute();
    syncAudio();
    if (!muted) void unlockAudio();
  });
  $('music-mute').addEventListener('click', () => {
    musicMuted = !musicMuted;
    saveSetting('flappy-witch-music-muted', musicMuted);
    updateMute();
    syncAudio();
    if (!musicMuted) void unlockAudio();
  });
  for (const button of [$('mute'), $('music-mute')]) {
    button.addEventListener('click', event => {
      if (event.detail === 0) button.blur();
    });
  }
  document.addEventListener('keydown', async event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (!['Space', 'ArrowUp'].includes(event.code)) return;
    const playingUp = state.phase === 'playing' && event.code === 'ArrowUp';
    if (!playingUp && document.activeElement !== document.body) return;
    event.preventDefault();
    if (state.phase === 'title' || state.phase === 'over') {
      await unlockAudio();
      beginRun();
    } else {
      void unlockAudio();
      puff();
    }
  });
  document.addEventListener('visibilitychange', () => {
    syncAudio();
    if (document.hidden && audioContext?.state === 'running') void audioContext.suspend().catch(() => {});
    if (document.hidden && launchPending) {
      clearTimeout(launchTimer);
      launchTimer = undefined;
      launchPending = false;
      $('start').disabled = false;
      $('start').textContent = 'Tap to fly';
    }
    if (document.hidden && ['playing', 'countdown'].includes(state.phase)) {
      state.phase = 'paused';
      backlog = 0;
      $('countdown').classList.add('hidden');
      showCard('paused');
    }
    if (!document.hidden && audioContext && !muted) void audioContext.resume().then(syncAudio).catch(() => {});
  });
  window.addEventListener('storage', event => {
    if (event.key === 'flappy-witch-muted' || event.key === 'flappy-witch-music-muted' || event.key === null) {
      muted = readSetting('flappy-witch-muted');
      musicMuted = readSetting('flappy-witch-music-muted');
      updateMute();
      syncAudio();
    }
    if (event.key !== 'flappy-witch-best' && event.key !== null) return;
    state.best = readBest(storage);
    if (state.phase === 'over') $('best-score').textContent = String(state.best);
  });
}

try {
  scene = createScene($('canvas-host'), params.get('quality') === 'low', seededRandom(seed ^ 0x9e3779b9));
  for (let i = 0; i < 5; i++) addGate();
  setupInput();
  updateMute();
  updateStreak();
  showCard('title');
  window.game = { state, view: scene, get music() { return { scheduledOscillators: music?.scheduledOscillators ?? 0, activeVoices: music?.activeVoices ?? 0, maxVoices: music?.maxVoices ?? 24, scheduledLayers: music?.scheduledLayers ?? {}, gameOverTransitions: music?.gameOverTransitions ?? 0 }; }, get audio() { return { scheduledEffects }; }, debug: params.has('debug') ? { advance } : undefined, get time() { return state.time; }, get nextGap() {
    const gate = nextGate();
    return gate ? { z: gate.z, center: gapCenter(gate, state.time), halfGap: gate.halfGap } : null;
  }, get seed() { return seed; } };
  requestAnimationFrame(frame);
} catch (error) {
  console.error(error);
  $('error').textContent = 'The witch could not start. Please reload this page.';
  $('error').classList.remove('hidden');
}

if ('serviceWorker' in navigator) {
  let offlineReadyShown = false;
  function checkOfflineReady() {
    const worker = navigator.serviceWorker.controller;
    if (!worker || offlineReadyShown) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = event => {
      channel.port1.close();
      if (!event.data?.ready || offlineReadyShown || state.phase !== 'title') return;
      offlineReadyShown = true;
      const note = $('offline-ready');
      note.classList.remove('hidden');
      setTimeout(() => note.classList.add('hidden'), 3000);
    };
    worker.postMessage({ type: 'offline-ready' }, [channel.port2]);
  }
  navigator.serviceWorker.addEventListener('controllerchange', checkOfflineReady);
  window.addEventListener('load', () => {
    checkOfflineReady();
    if (!navigator.onLine) return;
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Offline app unavailable:', error));
  });
}
