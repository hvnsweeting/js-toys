import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sound } from '../src/sound.js';

test('bird calls sweep upward then downward and stay softer than a find', () => {
  const sound = new Sound(false);
  const notes = [];
  sound.tone = (frequency, options) => notes.push({ frequency, ...options });

  sound.birdsong();

  assert.equal(notes.length, 2);
  assert.ok(notes[0].endFrequency > notes[0].frequency);
  assert.ok(notes[1].endFrequency < notes[1].frequency);
  assert.ok(notes.every((note) => note.volume <= 0.025 && note.duration <= 0.2));
});

test('the win phrase is longer than the ordinary find sound', () => {
  const sound = new Sound(false);
  const notes = [];
  sound.tone = (frequency, options) => notes.push({ frequency, ...options });

  sound.correct();
  const ordinary = notes.splice(0);
  sound.win();

  assert.ok(notes.some((note) => note.duration >= 1.8));
  assert.ok(notes.length > ordinary.length);
  assert.ok(notes.some((note) => note.endFrequency > note.frequency));
});

test('a delayed bird call sweeps only after its scheduled start', () => {
  const sound = new Sound(false);
  const frequencyEvents = [];
  sound.context = {
    currentTime: 10,
    createOscillator() {
      return {
        frequency: {
          setValueAtTime: (...args) => frequencyEvents.push(['start', ...args]),
          exponentialRampToValueAtTime: (...args) => frequencyEvents.push(['end', ...args]),
        },
        connect(next) { return next; },
        start() {},
        stop() {},
      };
    },
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect(next) { return next; },
      };
    },
  };
  sound.master = {};

  sound.tone(1800, { start: 0.7, duration: 0.2, endFrequency: 2400 });

  assert.deepEqual(frequencyEvents, [
    ['start', 1800, 10.7],
    ['end', 2400, 10.899999999999999],
  ]);
});

test('birds stop on mute or background and restart when sound resumes', (t) => {
  const scheduled = new Map();
  let nextTimer = 1;
  t.mock.method(globalThis, 'setTimeout', (callback) => {
    const id = nextTimer++;
    scheduled.set(id, callback);
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', (id) => scheduled.delete(id));

  const sound = new Sound(false);
  sound.context = { currentTime: 0, suspend() {}, resume() {} };
  sound.master = { gain: { setTargetAtTime() {} } };
  let calls = 0;
  sound.birdsong = () => calls++;

  sound.scheduleBirds();
  sound.scheduleBirds();
  assert.equal(scheduled.size, 1);
  sound.setMuted(true);
  assert.equal(scheduled.size, 0);
  sound.setMuted(false);
  assert.equal(scheduled.size, 1);
  sound.setPaused(true);
  assert.equal(scheduled.size, 0);
  sound.setPaused(false);
  assert.equal(scheduled.size, 1);

  const [id, callback] = [...scheduled][0];
  scheduled.delete(id);
  callback();
  assert.equal(calls, 1);
  assert.equal(scheduled.size, 1);
  sound.stopBirds();
  assert.equal(scheduled.size, 0);
});
