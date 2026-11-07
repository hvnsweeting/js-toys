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

test('the 32 bar plan changes each bar and varies by seed at upbeat tempo', () => {
  assert.equal(MUSIC_TEMPO, 116);
  assert.ok(PHRASE_BARS >= 32);
  const signatures = Array.from({ length: PHRASE_BARS }, (_, bar) =>
    JSON.stringify(Array.from({ length: STEPS_PER_BAR }, (_, step) =>
      scoreEvents(bar, step, 17))));
  assert.equal(new Set(signatures).size, PHRASE_BARS);
  assert.notDeepEqual(barPlan(2, 17).melodyChoice, barPlan(2, 91).melodyChoice);
  assert.deepEqual(scoreEvents(0, 0, 17), scoreEvents(PHRASE_BARS, 0, 17));
});

test('melody choices have at least 4 notes and cheerful pop harmony', () => {
  for (let bar = 0; bar < PHRASE_BARS; bar++) {
    const plan = barPlan(bar, 17);
    assert.ok(plan.melodyChoice.length >= 4, 'melody choice has at least 4 notes per bar');
    for (const note of plan.melodyChoice) {
      assert.ok(note >= 72 && note <= 84, `melody note ${note} in high chiptune register [72..84]`);
    }
  }
  const chordNames = [0, 1, 2, 3, 4, 5, 6, 7].map((b) => barPlan(b, 17).chord);
  assert.deepEqual(chordNames, ['Cmaj', 'G6', 'Am7', 'F6', 'Cmaj', 'Dm7', 'G6', 'Cmaj']);
});

test('chiptune patterns have crisp staccato durations and active lead steps', () => {
  for (let bar = 0; bar < 8; bar++) {
    const plan = barPlan(bar, 17);
    const barEvents = Array.from({ length: STEPS_PER_BAR }, (_, step) => scoreEvents(bar, step, 17)).flat();
    const pianoEvents = barEvents.filter((e) => e.layer === 'piano');
    const bassEvents = barEvents.filter((e) => e.layer === 'bass');
    assert.ok(pianoEvents.length >= 6, `bar ${bar} has active chiptune arpeggio steps`);
    for (const e of pianoEvents) {
      assert.ok(e.duration <= 0.25, `piano duration ${e.duration} is crisp staccato arpeggio`);
    }
    assert.ok(bassEvents.length >= 4, `bar ${bar} has bouncy bassline`);
    for (const e of bassEvents) {
      assert.ok(e.duration <= 0.3, `bass duration ${e.duration} is staccato`);
    }
    if (plan.layers.includes('box')) {
      const boxEvents = barEvents.filter((e) => e.layer === 'box');
      assert.ok(boxEvents.length >= 4, `box lead plays at least 4 melody steps in bar ${bar}`);
      for (const e of boxEvents) {
        assert.ok(e.duration <= 0.35, `box duration ${e.duration} is crisp chiptune lead`);
      }
    }
  }
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
