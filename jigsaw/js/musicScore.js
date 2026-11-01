export const MUSIC_TEMPO = 72;
export const STEPS_PER_BAR = 16;
export const PHRASE_BARS = 32;
export const PITCH_RANGES = Object.freeze({
  piano: [261, 1047],
  pad: [261, 784],
  bass: [130, 330],
  box: [523, 1175],
});

// MIDI notes keep the harmony readable while frequency conversion stays in one place.
const harmony = [
  { name: 'Fmaj9', root: 53, notes: [65, 69, 72, 76, 79] },
  { name: 'Em7', root: 52, notes: [64, 67, 71, 74, 79] },
  { name: 'Dm9', root: 50, notes: [62, 65, 69, 72, 76] },
  { name: 'Cmaj9', root: 48, notes: [60, 64, 67, 71, 74] },
  { name: 'Am7', root: 45, notes: [57, 60, 64, 67, 72] },
  { name: 'G6add9', root: 43, notes: [55, 59, 62, 64, 69] },
  { name: 'Fmaj9', root: 53, notes: [65, 69, 72, 76, 79] },
  { name: 'Cmaj9', root: 48, notes: [60, 64, 67, 71, 74] },
];
const scale = new Set([0, 2, 4, 5, 7, 9, 11]);
const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
function hash(seed, bar, salt) {
  let value = (seed ^ Math.imul(bar + 1, 0x9e3779b1) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return value >>> 0;
}

export function barPlan(bar, seed = 17) {
  const position = ((bar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
  const chordIndex = position % harmony.length;
  const pass = Math.floor(position / harmony.length);
  const chord = harmony[chordIndex];
  const voicing = (pass + hash(seed, chordIndex, 19) % 4) % 4;
  const melodyNotes = chord.notes.map((note) => note < 72 ? note + 12 : note)
    .filter((note) => note >= 72 && note <= 84);
  const melodyChoice = [0, 1, 2].map((index) =>
    melodyNotes[hash(seed, position, index * 173 + 31) % melodyNotes.length]);
  const melodyOn = (chordIndex + pass) % 4 !== 3;
  const layers = ['piano', 'pad', 'bass'];
  if (melodyOn) layers.push('box');
  return { chord: chord.name, root: chord.root, chordNotes: chord.notes,
    scale: [...scale], voicing, melodyChoice, layers, pass };
}

export function scoreEvents(bar, step, seed = 17) {
  const plan = barPlan(bar, seed);
  const events = [];
  const notes = plan.chordNotes;
  if (step === 0 || step === 8) {
    const index = (plan.voicing + (step === 8 ? 2 : 0)) % 4;
    for (const note of [notes[index], notes[(index + 2) % 5], notes[4]]) {
      events.push({ layer: 'piano', frequency: frequency(note < 60 ? note + 12 : note), duration: 1.25,
        accent: step === 0 ? 1 : 0.62 });
    }
  }
  if (step === 4 + (bar % 8)) {
    events.push({ layer: 'piano', frequency: frequency(notes[plan.voicing] < 60 ?
      notes[plan.voicing] + 12 : notes[plan.voicing]), duration: 0.55, accent: 0.34 });
  }
  if (step === 0) {
    for (const note of [notes[1], notes[3]])
      events.push({ layer: 'pad', frequency: frequency(note < 60 ? note + 12 : note), duration: 3.2, accent: 1 });
  }
  if (step === 0 || step === 10) {
    const note = plan.root + 5 + (step === 10 ? 4 : 0);
    events.push({ layer: 'bass', frequency: frequency(note), duration: 0.48,
      accent: step === 0 ? 1 : 0.65 });
  }
  if (plan.layers.includes('box') && [2, 6, 12].includes(step)) {
    const index = [2, 6, 12].indexOf(step);
    events.push({ layer: 'box', frequency: frequency(plan.melodyChoice[index]),
      note: plan.melodyChoice[index], duration: 0.8, accent: index === 0 ? 0.85 : 0.65 });
  }
  return events;
}
