export const STEPS_PER_BAR = 16;
export const BARS = 16;
export const LOOP_STEPS = STEPS_PER_BAR * BARS;
export const BASE_TEMPO = 100;

// D harmonic minor. Each four-bar phrase ends on A so the next phrase has a gentle pull.
const roots = [146.83, 174.61, 116.54, 110];
const boxNotes = [
  [587.33, 698.46, 880, 698.46],
  [698.46, 880, 1108.73, 880],
  [466.16, 587.33, 698.46, 587.33],
  [440, 554.37, 659.26, 554.37],
];
const leadNotes = [
  [587.33, 554.37, 440, 587.33],
  [698.46, 659.26, 554.37, 698.46],
  [587.33, 466.16, 440, 349.23],
  [440, 554.37, 659.26, 587.33],
];

export function musicLayers(phase, score = 0) {
  if (phase === 'paused' || phase === 'countdown' || phase === 'hidden') return [];
  if (phase === 'title') return ['drone', 'box'];
  if (phase === 'over' || phase === 'dying') return ['drone'];
  if (phase !== 'playing') return [];
  return score >= 10 ? ['drone', 'box', 'bass', 'tick', 'lead'] : ['drone', 'box', 'bass', 'tick'];
}

export function musicTempo(score = 0) {
  return BASE_TEMPO + 12 * Math.min(1, Math.max(0, score) / 40);
}

export function scoreEvents(step, phase, score = 0) {
  const layers = musicLayers(phase, score);
  const bar = Math.floor(step / STEPS_PER_BAR);
  const beat = step % STEPS_PER_BAR;
  const phrase = bar % 4;
  const pass = Math.floor(bar / BARS);
  const events = [];
  if (beat === 0 && layers.includes('drone')) {
    events.push({ layer: 'drone', frequency: roots[phrase] / 2, duration: 2.4, accent: phrase === 0 ? 1 : .83 });
  }
  if (layers.includes('box') && beat % 2 === 0 && !(beat === 14 && bar % 4 === 3)) {
    const index = (beat / 2 + (bar % 2 ? 1 : 0)) % 4;
    events.push({ layer: 'box', frequency: boxNotes[phrase][index], duration: .55,
      accent: beat % 4 === 0 ? 1 : .72 });
  }
  if (layers.includes('bass') && (beat === 0 || beat === 8)) {
    events.push({ layer: 'bass', frequency: roots[phrase] / 2, duration: .38, accent: beat === 0 ? 1 : .72 });
  }
  if (layers.includes('tick') && beat % 4 === 0) {
    events.push({ layer: 'tick', frequency: beat === 0 || beat === 8 ? 1100 : 1450,
      duration: .055, accent: beat === 0 ? 1 : .62 });
  }
  // The lead plays on alternate passes, always entering on beats 0, 4, 8 and 12; later
  // returns rotate which lead note each of those beats picks, so the tune varies.
  if (layers.includes('lead') && pass % 2 === 0 && beat % 4 === 0 && bar % 4 !== 3) {
    const index = (beat / 4 + Math.floor(pass / 2)) % 4;
    events.push({ layer: 'lead', frequency: leadNotes[phrase][index], duration: .72, accent: .85 });
  }
  return events;
}
