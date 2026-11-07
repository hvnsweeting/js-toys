export const MUSIC_TEMPO = 116;
export const STEPS_PER_BAR = 16;
export const PHRASE_BARS = 32;
export const PITCH_RANGES = Object.freeze({
  piano: [261, 1047],
  pad: [261, 784],
  bass: [130, 330],
  box: [523, 1175],
});

// A cheerful, bouncy major/pop progression keeps the arcade puzzle fun and kid-friendly.
const harmony = [
  { name: 'Cmaj', root: 48, notes: [60, 64, 67, 69, 72] },
  { name: 'G6', root: 43, notes: [55, 59, 62, 64, 67] },
  { name: 'Am7', root: 45, notes: [57, 60, 64, 67, 72] },
  { name: 'F6', root: 53, notes: [65, 69, 72, 74, 79] },
  { name: 'Cmaj', root: 48, notes: [60, 64, 67, 72, 76] },
  { name: 'Dm7', root: 50, notes: [62, 65, 69, 72, 76] },
  { name: 'G6', root: 43, notes: [55, 59, 62, 67, 71] },
  { name: 'Cmaj', root: 48, notes: [60, 64, 67, 69, 72] },
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

  const melodyNotes = chord.notes.map((note) => {
    let n = note;
    while (n < 72) n += 12;
    while (n > 84) n -= 12;
    return n;
  }).filter((note, idx, arr) => arr.indexOf(note) === idx);

  const melodyChoice = [0, 1, 2, 3, 4, 5].map((index) =>
    melodyNotes[hash(seed, position, index * 173 + 31) % melodyNotes.length]);

  // Layers vary across the 4 passes to build progression while keeping the lead active.
  let layers;
  if (pass === 0) {
    layers = chordIndex < 4 ? ['piano', 'bass', 'box'] : ['piano', 'pad', 'bass', 'box'];
  } else if (pass === 1) {
    layers = ['piano', 'pad', 'bass', 'box'];
  } else if (pass === 2) {
    layers = chordIndex === 7 ? ['piano', 'pad', 'bass'] : ['piano', 'pad', 'bass', 'box'];
  } else {
    layers = chordIndex >= 6 ? ['piano', 'bass', 'box'] : ['piano', 'pad', 'bass', 'box'];
  }

  return {
    chord: chord.name,
    root: chord.root,
    chordNotes: chord.notes,
    scale: [...scale],
    voicing,
    melodyChoice,
    layers,
    pass,
    position,
  };
}

export function scoreEvents(bar, step, seed = 17) {
  const plan = barPlan(bar, seed);
  const events = [];
  const notes = plan.chordNotes;
  const position = plan.position;

  // 1. Chiptune Arpeggio (piano layer): crisp 16th/8th-note square staccato arpeggios on even steps
  if (plan.layers.includes('piano') && step % 2 === 0) {
    const pianoNotes = notes.map((n) => {
      let note = n;
      while (note < 60) note += 12;
      while (note > 84) note -= 12;
      return note;
    });
    const stepIndex = step / 2;
    const arpIndex = (stepIndex + plan.voicing + position) % pianoNotes.length;
    events.push({
      layer: 'piano',
      frequency: frequency(pianoNotes[arpIndex]),
      duration: 0.18,
      accent: step === 0 ? 0.88 : (step % 4 === 0 ? 0.72 : 0.58),
    });
  }

  // 2. Warm Harmonic Backing (pad layer): gentle chord wash on step 0
  if (plan.layers.includes('pad') && step === 0) {
    const padNotes = notes.map((n) => {
      let note = n;
      while (note < 60) note += 12;
      while (note > 79) note -= 12;
      return note;
    });
    for (const note of [padNotes[0], padNotes[2 % padNotes.length]]) {
      events.push({
        layer: 'pad',
        frequency: frequency(note),
        duration: 1.8,
        accent: 0.62,
      });
    }
  }

  // 3. Bouncy Chip Bass (bass layer): 4-on-the-floor groove on steps 0, 4, 8, 12 + hop on step 14
  const isBassStep = step === 0 || step === 4 || step === 8 || step === 12 ||
    (position % 2 === 1 && step === 14);
  if (plan.layers.includes('bass') && isBassStep) {
    const baseRoot = plan.root < 48 ? plan.root + 12 : plan.root;
    let bassNote;
    if (step === 0 || step === 8) {
      bassNote = baseRoot;
    } else if (step === 4 || step === 12) {
      bassNote = baseRoot <= 55 ? baseRoot + 7 : baseRoot - 5;
    } else {
      // Step 14 playful hop note on alternate bars
      bassNote = baseRoot <= 51 ? baseRoot + 12 : baseRoot + 5;
    }
    events.push({
      layer: 'bass',
      frequency: frequency(bassNote),
      duration: 0.20,
      accent: step === 0 ? 0.95 : 0.72,
    });
  }

  // 4. Playful Lead Melody (box layer): lively chiptune lead
  const melodySteps = [0, 3, 6, 8, 10, 12];
  if (plan.layers.includes('box') && melodySteps.includes(step)) {
    const mIndex = melodySteps.indexOf(step);
    const note = plan.melodyChoice[mIndex % plan.melodyChoice.length];
    events.push({
      layer: 'box',
      frequency: frequency(note),
      note,
      duration: 0.25,
      accent: step === 0 || step === 8 ? 0.92 : 0.74,
    });
  }

  return events;
}
