import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_TEMPO, BARS, LOOP_STEPS, musicLayers, musicTempo, scoreEvents } from '../src/musicScore.js';

test('music phases and score gates select the intended layers', () => {
  assert.deepEqual(musicLayers('title'), ['drone', 'box']);
  assert.deepEqual(musicLayers('playing', 9), ['drone', 'box', 'bass', 'tick']);
  assert.deepEqual(musicLayers('playing', 10), ['drone', 'box', 'bass', 'tick', 'lead']);
  assert.deepEqual(musicLayers('dying', 30), ['drone']);
  assert.deepEqual(musicLayers('over', 30), ['drone']);
  for (const phase of ['paused', 'countdown', 'hidden']) assert.deepEqual(musicLayers(phase, 30), []);
});

test('tempo rises to a twelve percent cap', () => {
  assert.equal(BASE_TEMPO, 100);
  assert.equal(musicTempo(-5), 100);
  assert.equal(musicTempo(20), 106);
  assert.equal(musicTempo(40), 112);
  assert.equal(musicTempo(90), 112);
});

test('sixteen-bar score has recurring phrases and alternate-pass lead', () => {
  assert.equal(BARS, 16);
  assert.equal(LOOP_STEPS, 256);
  assert.deepEqual(scoreEvents(0, 'title').map(event => event.layer), ['drone', 'box']);
  assert.deepEqual(scoreEvents(0, 'playing', 0).map(event => event.layer), ['drone', 'box', 'bass', 'tick']);
  assert.ok(scoreEvents(0, 'playing', 10).some(event => event.layer === 'lead'));
  assert.ok(!scoreEvents(LOOP_STEPS, 'playing', 10).some(event => event.layer === 'lead'));
  assert.ok(scoreEvents(LOOP_STEPS * 2, 'playing', 10).some(event => event.layer === 'lead'));
  const gameOverEvents = scoreEvents(0, 'over', 20);
  assert.ok(gameOverEvents.length > 0, 'game over has a drone event');
  assert.ok(gameOverEvents.every(event => event.layer === 'drone'));
  for (let step = 0; step < LOOP_STEPS * 4; step++) {
    for (const event of scoreEvents(step, 'playing', 20)) {
      assert.ok(event.frequency >= 50 && event.frequency <= 1500);
      assert.ok(event.duration > 0 && event.accent > 0);
    }
  }
});

test('each layer plays the composed notes across two bars', () => {
  const notes = Object.fromEntries(musicLayers('playing', 10).map(layer => [layer, []]));
  for (let step = 0; step < 32; step++) {
    for (const event of scoreEvents(step, 'playing', 10)) notes[event.layer].push(event.frequency);
  }
  assert.deepEqual(notes.drone, [73.415, 87.305]);
  assert.deepEqual(notes.box, [
    587.33, 698.46, 880, 698.46, 587.33, 698.46, 880, 698.46,
    880, 1108.73, 880, 698.46, 880, 1108.73, 880, 698.46,
  ]);
  assert.deepEqual(notes.bass, [73.415, 73.415, 87.305, 87.305]);
  assert.deepEqual(notes.tick, [1100, 1450, 1100, 1450, 1100, 1450, 1100, 1450]);
  assert.deepEqual(notes.lead, [587.33, 554.37, 440, 587.33, 698.46, 659.26, 554.37, 698.46]);
});

test('alternate passes omit and then vary the lead phrase', () => {
  const leadNotes = start => Array.from({ length: 32 }, (_, offset) => scoreEvents(start + offset, 'playing', 10))
    .flatMap(events => events.filter(event => event.layer === 'lead').map(event => event.frequency));
  assert.deepEqual(leadNotes(0), [587.33, 554.37, 440, 587.33, 698.46, 659.26, 554.37, 698.46]);
  assert.deepEqual(leadNotes(LOOP_STEPS), []);
  assert.deepEqual(leadNotes(LOOP_STEPS * 2), [554.37, 440, 587.33, 587.33, 659.26, 554.37, 698.46, 698.46]);
});
