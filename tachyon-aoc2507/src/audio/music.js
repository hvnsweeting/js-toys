// Tachyon Cascade score: 48 bars at 96 beats per minute, then repeat.
const TEMPO = 96;
const STEP_SECONDS = 60 / TEMPO / 4;
const STEPS_PER_BAR = 16;
const BARS_PER_SECTION = 12;
const CHORDS = {
  Am: [57, 60, 64, 69], F: [53, 57, 60, 65],
  C: [55, 60, 64, 67], G: [55, 59, 62, 67],
  Dm: [53, 57, 62, 65], Bb: [53, 58, 62, 65],
  E: [52, 56, 59, 64],
};
const SECTIONS = [
  { name: 'A', chords: ['Am', 'F', 'C', 'G'], melody: 'answer' },
  { name: 'B', chords: ['Dm', 'Am', 'Bb', 'E'], melody: 'question' },
  { name: "A'", chords: ['Am', 'F', 'C', 'G'], melody: 'answer' },
  { name: 'C', chords: ['F', 'G', 'Am', 'E'], melody: 'rise' },
];
const ARPEGGIO_STEPS = [0, null, 1, null, 2, null, 1, null, 3, null, 2, null, 1, null, 2, null];
const BASS_STEPS = [0, null, null, null, null, null, null, null, 0, null, null, null, 2, null, null, null];
const KICK_STEPS = [1, 0, 0, 0, 0, 0, 0, 0, 0.65, 0, 0, 0, 0, 0, 0, 0];
const HAT_STEPS = [0, 0, 0.25, 0, 0, 0, 0.34, 0, 0, 0, 0.25, 0, 0, 0, 0.34, 0];
const CLAP_STEPS = [0, 0, 0, 0, 0.33, 0, 0, 0, 0, 0, 0, 0, 0.33, 0, 0, 0];
// Each phrase leaves room for split effects. Values are MIDI pitches; null is a rest.
const MELODIES = {
  answer: [69, null, null, null, 72, null, null, null, 76, null, 74, null, 72, null, null, null,
    null, null, 69, null, 72, null, null, null, 69, null, null, null, 67, null, null, null],
  question: [74, null, null, null, 77, null, null, null, 76, null, null, null, 74, null, null, null,
    null, null, 72, null, null, null, 69, null, 68, null, null, null, 71, null, null, null],
  rise: [72, null, null, null, 74, null, null, null, 76, null, null, null, 79, null, null, null,
    null, null, 76, null, 74, null, null, null, 72, null, null, null, 71, null, null, null],
};

function frequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function impulseResponse(context) {
  const length = Math.floor(context.sampleRate * 1.6);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const decay = (1 - i / length) ** 2.5;
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  return buffer;
}

function noiseBuffer(context) {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.2), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function createMusic(audioCtx, destination) {
  let playing = false;
  let timer = null;
  let stepIndex = 0;
  let nextStepTime = 0;
  let lastScheduledChord = CHORDS.Am;
  let graph = null;
  const voices = new Set();
  const noise = noiseBuffer(audioCtx);
  const impulse = impulseResponse(audioCtx);

  function createGraph() {
    const master = audioCtx.createGain();
    master.gain.value = 0.18;
    master.connect(destination);
    const pad = audioCtx.createGain();
    const arp = audioCtx.createGain();
    const bass = audioCtx.createGain();
    const drums = audioCtx.createGain();
    const lead = audioCtx.createGain();
    for (const layer of [pad, arp, bass, drums, lead]) layer.connect(master);
    pad.gain.value = 0.68;
    arp.gain.value = 0;
    bass.gain.value = 0;
    drums.gain.value = 0;
    lead.gain.value = 0;

    const delay = audioCtx.createDelay(0.6);
    delay.delayTime.value = 0.31;
    const feedback = audioCtx.createGain();
    feedback.gain.value = 0.22;
    const delayReturn = audioCtx.createGain();
    delayReturn.gain.value = 0.14;
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(delayReturn);
    delayReturn.connect(master);
    const reverb = audioCtx.createConvolver();
    reverb.buffer = impulse;
    const reverbReturn = audioCtx.createGain();
    reverbReturn.gain.value = 0.13;
    reverb.connect(reverbReturn);
    reverbReturn.connect(master);
    return { master, pad, arp, bass, drums, lead, delay, feedback, delayReturn, reverb, reverbReturn };
  }

  function track(sources, nodes) {
    const voice = { sources, nodes };
    voices.add(voice);
    let remaining = sources.length;
    for (const source of sources) {
      source.onended = () => {
        remaining -= 1;
        if (remaining !== 0) return;
        for (const node of nodes) node.disconnect();
        voices.delete(voice);
      };
    }
  }

  function oscillator(note, type, start, duration, amount, layer, options = {}) {
    const envelope = audioCtx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(amount, start + (options.attack ?? 0.012));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = options.cutoff ?? 2700;
    envelope.connect(filter);
    filter.connect(layer);
    if (options.delay) filter.connect(graph.delay);
    if (options.reverb) filter.connect(graph.reverb);
    const sources = [];
    for (const detune of options.detunes ?? [0]) {
      const source = audioCtx.createOscillator();
      source.type = type;
      source.frequency.setValueAtTime(frequency(note), start);
      source.detune.value = detune;
      source.connect(envelope);
      source.start(start);
      source.stop(start + duration + 0.02);
      sources.push(source);
    }
    track(sources, [envelope, filter, ...sources]);
  }

  function pad(chord, time) {
    for (const note of chord) {
      oscillator(note - 12, 'sawtooth', time, 2.8, 0.043, graph.pad,
        { attack: 0.45, cutoff: 680, detunes: [-6, 6], reverb: true });
    }
  }

  function kick(time, strength) {
    const source = audioCtx.createOscillator();
    source.type = 'sine';
    source.frequency.setValueAtTime(115, time);
    source.frequency.exponentialRampToValueAtTime(43, time + 0.16);
    const envelope = audioCtx.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.linearRampToValueAtTime(0.33 * strength, time + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
    source.connect(envelope);
    envelope.connect(graph.drums);
    source.start(time);
    source.stop(time + 0.25);
    track([source], [source, envelope]);
  }

  function noiseHit(time, strength, duration, cutoff) {
    const source = audioCtx.createBufferSource();
    source.buffer = noise;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    const envelope = audioCtx.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.linearRampToValueAtTime(strength, time + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(graph.drums);
    source.start(time);
    source.stop(time + duration + 0.01);
    track([source], [source, filter, envelope]);
  }

  function playStep(time, index) {
    const bar = Math.floor(index / STEPS_PER_BAR) % (SECTIONS.length * BARS_PER_SECTION);
    const beatStep = index % STEPS_PER_BAR;
    const sectionIndex = Math.floor(bar / BARS_PER_SECTION);
    const section = SECTIONS[sectionIndex];
    const chord = CHORDS[section.chords[bar % 4]];
    lastScheduledChord = chord;
    if (beatStep === 0) pad(chord, time);

    const arpIndex = ARPEGGIO_STEPS[beatStep];
    if (arpIndex !== null) {
      const note = chord[arpIndex] + 12;
      oscillator(note, 'triangle', time, 0.22, 0.12, graph.arp,
        { cutoff: 2100, delay: true });
    }
    const bassIndex = BASS_STEPS[beatStep];
    if (bassIndex !== null) {
      oscillator(chord[bassIndex] - 24, 'sine', time, 0.4, 0.28, graph.bass,
        { cutoff: 400, attack: 0.01 });
    }
    if (KICK_STEPS[beatStep]) kick(time, KICK_STEPS[beatStep]);
    if (HAT_STEPS[beatStep]) noiseHit(time, HAT_STEPS[beatStep], 0.065, 7000);
    if (CLAP_STEPS[beatStep]) noiseHit(time, CLAP_STEPS[beatStep], 0.13, 1400);

    // A melodic phrase answers once every four bars, so gameplay notes remain audible.
    const phraseBar = bar % 4;
    const isFirstIntroduction = sectionIndex === 0 && bar < 4;
    const isMelodyBar = phraseBar < 2 && !isFirstIntroduction;
    if (isMelodyBar) {
      const phrase = MELODIES[section.melody];
      const note = phrase[phraseBar * STEPS_PER_BAR + beatStep];
      if (note !== null) oscillator(note, 'triangle', time, 0.43, 0.11, graph.lead,
        { attack: 0.03, cutoff: 1800, delay: true, reverb: true });
    }
  }

  function schedule() {
    if (!playing) return;
    if (audioCtx.state !== 'running') {
      nextStepTime = audioCtx.currentTime + 0.06;
      timer = setTimeout(schedule, 25);
      return;
    }
    if (nextStepTime < audioCtx.currentTime - STEP_SECONDS) {
      nextStepTime = audioCtx.currentTime + 0.06;
    }
    while (nextStepTime < audioCtx.currentTime + 0.12) {
      playStep(nextStepTime, stepIndex);
      stepIndex = (stepIndex + 1) % (SECTIONS.length * BARS_PER_SECTION * STEPS_PER_BAR);
      nextStepTime += STEP_SECONDS;
    }
    timer = setTimeout(schedule, 25);
  }

  function setIntensity(value) {
    if (!graph) return;
    const intensity = Math.max(0, Math.min(1, Number(value) || 0));
    const now = audioCtx.currentTime;
    const targets = [
      [graph.arp, Math.min(1, intensity * 2) * 0.35],
      [graph.bass, Math.min(1, intensity * 2) * 0.55],
      [graph.drums, Math.max(0, intensity * 2 - 1) * 0.46],
      [graph.lead, Math.max(0, intensity * 2 - 1) * 0.44],
    ];
    for (const [layer, target] of targets) {
      layer.gain.cancelScheduledValues(now);
      layer.gain.setTargetAtTime(target, now, 0.18);
    }
  }

  let intensity = 0;
  return {
    start() {
      if (playing) return;
      graph = createGraph();
      playing = true;
      stepIndex = 0;
      nextStepTime = audioCtx.currentTime + 0.05;
      this.setIntensity(intensity);
      schedule();
    },
    stop() {
      if (!playing) return;
      playing = false;
      clearTimeout(timer);
      timer = null;
      for (const voice of voices) {
        for (const source of voice.sources) {
          try { source.stop(); } catch { /* A source may already have ended. */ }
        }
        for (const node of voice.nodes) node.disconnect();
      }
      voices.clear();
      for (const node of Object.values(graph)) node.disconnect();
      graph = null;
    },
    setIntensity(value) {
      intensity = Math.max(0, Math.min(1, Number(value) || 0));
      setIntensity(intensity);
    },
    currentChord() {
      return [...lastScheduledChord];
    },
    get isPlaying() { return playing; },
  };
}
