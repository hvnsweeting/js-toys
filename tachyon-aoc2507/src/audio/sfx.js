const FALLBACK_CHORD = [57, 60, 64, 67, 69];

function frequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

export function createSfx(audioCtx, destination, music = null) {
  const noise = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.18), audioCtx.sampleRate);
  const noiseData = noise.getChannelData(0);
  for (let i = 0; i < noiseData.length; i += 1) noiseData[i] = Math.random() * 2 - 1;
  let activeSplits = 0;

  function tone(note, time, duration, volume, type = 'sine', options = {}) {
    const source = audioCtx.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(frequency(note), time);
    if (options.endNote !== undefined) {
      source.frequency.exponentialRampToValueAtTime(frequency(options.endNote), time + duration);
    }
    const envelope = audioCtx.createGain();
    const attack = options.attack ?? 0.008;
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.linearRampToValueAtTime(volume, time + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = options.cutoff ?? 3000;
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
      options.onEnd?.();
    };
    source.start(time);
    source.stop(time + duration + 0.01);
  }

  function noiseHit(time, duration, volume, cutoff) {
    const source = audioCtx.createBufferSource();
    source.buffer = noise;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    const envelope = audioCtx.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.linearRampToValueAtTime(volume, time + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
    };
    source.start(time);
    source.stop(time + duration + 0.01);
  }

  return {
    place() {
      const now = audioCtx.currentTime;
      tone(72, now, 0.12, 0.09, 'triangle', { endNote: 79 });
      tone(84, now + 0.04, 0.15, 0.045, 'sine');
    },
    remove() {
      tone(64, audioCtx.currentTime, 0.17, 0.08, 'triangle', { endNote: 52 });
    },
    fire() {
      const now = audioCtx.currentTime;
      tone(45, now, 0.45, 0.14, 'sine', { endNote: 69, attack: 0.06 });
      noiseHit(now, 0.17, 0.025, 2400);
    },
    split(column, columnCount) {
      if (activeSplits >= 12) return;
      const chord = music?.currentChord?.();
      const notes = Array.isArray(chord) && chord.length ? chord : FALLBACK_CHORD;
      const width = Math.max(1, Number(columnCount) || 1);
      const position = Math.max(0, Math.min(width - 1, Number(column) || 0));
      const chordIndex = Math.floor(position * notes.length / width);
      const octave = Math.floor(position * 3 / width);
      const note = Math.max(48, Math.min(96, notes[chordIndex] + 12 + octave * 12));
      activeSplits += 1;
      const volume = 0.13 / Math.sqrt(activeSplits);
      tone(note, audioCtx.currentTime, 0.34, volume, 'sine', {
        attack: 0.016, cutoff: 3400, onEnd: () => { activeSplits -= 1; },
      });
    },
    targetLit() {
      const now = audioCtx.currentTime;
      tone(76, now, 0.28, 0.09, 'sine', { attack: 0.018 });
      tone(81, now + 0.06, 0.24, 0.05, 'sine');
    },
    voidHit() {
      const now = audioCtx.currentTime;
      tone(42, now, 0.34, 0.11, 'sawtooth', { endNote: 35, cutoff: 430 });
      noiseHit(now, 0.15, 0.025, 800);
    },
    win(stars) {
      const now = audioCtx.currentTime;
      const count = Math.max(1, Math.min(3, Math.floor(Number(stars) || 1)));
      const notes = [69, 72, 76, 81, 84, 88, 93];
      const length = 3 + count + 1;
      for (let i = 0; i < length; i += 1) {
        tone(notes[i], now + i * 0.14, 0.4 + count * 0.13, 0.085, 'triangle',
          { attack: 0.02, cutoff: 2800 });
      }
    },
    fail() {
      const now = audioCtx.currentTime;
      tone(52, now, 0.38, 0.075, 'sawtooth', { endNote: 45, cutoff: 440, attack: 0.04 });
      tone(45, now + 0.19, 0.45, 0.06, 'triangle', { endNote: 40, cutoff: 360 });
    },
    click() {
      tone(81, audioCtx.currentTime, 0.055, 0.038, 'sine');
    },
    tick() {
      tone(74, audioCtx.currentTime, 0.04, 0.025, 'sine');
    },
  };
}
