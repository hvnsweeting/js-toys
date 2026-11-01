import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MUSIC_TEMPO, PHRASE_BARS, PITCH_RANGES, STEPS_PER_BAR,
  barPlan, scoreEvents } from '../js/musicScore.js';

test('standard check renders and measures music after browser checks', () => {
  const project = fileURLToPath(new URL('..', import.meta.url));
  const commands = execFileSync('make', ['-n', 'check'], { cwd: project, encoding: 'utf8' });
  const browserCheck = commands.lastIndexOf('node tools/browser-check.mjs');
  const musicRender = commands.indexOf('node tools/music-render.mjs');
  assert.ok(browserCheck >= 0 && musicRender > browserCheck,
    'make check runs music measurement after its browser checks');
});

test('the 32 bar plan changes each bar and varies by seed', () => {
  assert.equal(MUSIC_TEMPO, 72);
  assert.ok(PHRASE_BARS >= 32);
  const signatures = Array.from({ length: PHRASE_BARS }, (_, bar) =>
    JSON.stringify(Array.from({ length: STEPS_PER_BAR }, (_, step) =>
      scoreEvents(bar, step, 17))));
  assert.equal(new Set(signatures).size, PHRASE_BARS);
  assert.notDeepEqual(barPlan(2, 17).melodyChoice, barPlan(2, 91).melodyChoice);
  assert.deepEqual(scoreEvents(0, 0, 17), scoreEvents(PHRASE_BARS, 0, 17));
});

test('melody notes fit each bar harmony and all voices fit phone ranges', () => {
  assert.deepEqual(PITCH_RANGES, {
    piano: [261, 1047], pad: [261, 784], bass: [130, 330], box: [523, 1175],
  });
  for (let seed = 1; seed <= 20; seed++) {
    for (let bar = 0; bar < PHRASE_BARS; bar++) {
      const plan = barPlan(bar, seed);
      for (let step = 0; step < STEPS_PER_BAR; step++) {
        for (const event of scoreEvents(bar, step, seed)) {
          const [low, high] = PITCH_RANGES[event.layer];
          assert.ok(event.frequency >= low && event.frequency <= high,
            `${event.layer} ${event.frequency} outside ${low}-${high}`);
          if (event.layer === 'box') {
            assert.ok(plan.chordNotes.includes(event.note) ||
              plan.scale.includes(event.note % 12));
          }
          if (event.layer === 'bass')
            assert.ok(event.frequency * 3 >= 300 && event.frequency * 3 <= 1000,
              'bass third harmonic stays in the phone speaker band');
        }
      }
    }
  }
});

test('instrument entries change across passes', () => {
  const passes = [0, 1, 2, 3].map((pass) =>
    Array.from({ length: 8 }, (_, index) => barPlan(pass * 8 + index).layers.join(',')));
  assert.equal(new Set(passes.map((part) => part.join('|'))).size, 4);
});
