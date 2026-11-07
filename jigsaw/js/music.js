import { MUSIC_TEMPO, STEPS_PER_BAR, PHRASE_BARS, scoreEvents } from './musicScore.js';

const LOOK_AHEAD = 0.22;
const STEP_SECONDS = 60 / MUSIC_TEMPO / 4;
const LEVELS = { piano: 0.18, pad: 0.085, bass: 0.30, box: 0.19 };

export function createMusic(context, destination = context.destination, render = false) {
  const output = context.createGain();
  output.gain.value = render ? 1 : 0;
  const tone = context.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 4000;
  tone.Q.value = 0.5;
  tone.connect(output).connect(destination);
  const voices = new Set();
  let timer = null;
  let enabled = false;
  let hidden = false;
  let nextStep = 0;
  let nextTime = context.currentTime + 0.06;
  let seed = 17;

  function renderEvent(event, at) {
    const source = context.createOscillator();
    const envelope = context.createGain();
    const duration = event.duration;
    const end = at + duration;
    const isPad = event.layer === 'pad';
    const isPiano = event.layer === 'piano';
    const isBox = event.layer === 'box';

    const attack = isPad ? 0.20 : isPiano ? 0.005 : 0.006;
    const release = isPad ? 0.40 : isPiano ? 0.06 : 0.08;
    const peak = LEVELS[event.layer] * event.accent;

    // Authentic retro 8-bit chiptune waveforms
    source.type = (isBox || isPiano) ? 'square' : 'triangle';

    if (isBox) {
      // Cute quick pitch blip on attack for bouncy chiptune lead feel
      source.frequency.setValueAtTime(event.frequency * 0.98, at);
      source.frequency.linearRampToValueAtTime(event.frequency, at + 0.012);
    } else {
      source.frequency.setValueAtTime(event.frequency, at);
    }

    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(peak, at + attack);
    const sustainRatio = isPad ? 0.65 : isPiano ? 0.40 : isBox ? 0.50 : 0.45;
    envelope.gain.setValueAtTime(peak * sustainRatio, Math.max(at + attack, end - release));
    envelope.gain.linearRampToValueAtTime(0, end);

    source.connect(envelope).connect(tone);
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      voices.delete(source);
    };
    voices.add(source);
    source.start(at);
    source.stop(end + 0.01);

    if (event.layer === 'bass') {
      // Upper partials make the punchy chip bass audible on phone speakers
      const upper = { ...event, frequency: event.frequency * 2, accent: event.accent * 0.28 };
      renderUpper(upper, at);
      renderUpper({ ...event, frequency: event.frequency * 3, accent: event.accent * 0.14 }, at);
    }
  }

  function renderUpper(event, at) {
    const source = context.createOscillator();
    const gain = context.createGain();
    source.type = 'triangle';
    source.frequency.value = event.frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(LEVELS.bass * event.accent, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + event.duration);
    source.connect(gain).connect(tone);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      voices.delete(source);
    };
    voices.add(source);
    source.start(at);
    source.stop(at + event.duration + 0.01);
  }

  function stopVoices() {
    const now = context.currentTime;
    for (const source of voices) {
      try { source.stop(now + 0.01); } catch { /* It already ended. */ }
    }
  }

  function schedule() {
    if (!enabled || hidden || context.state !== 'running') return;
    const now = context.currentTime;
    if (nextTime < now) {
      const skipped = Math.ceil((now + 0.04 - nextTime) / STEP_SECONDS);
      nextStep += skipped;
      nextTime += skipped * STEP_SECONDS;
    }
    while (nextTime < now + LOOK_AHEAD) {
      const bar = Math.floor(nextStep / STEPS_PER_BAR) % PHRASE_BARS;
      const step = nextStep % STEPS_PER_BAR;
      for (const event of scoreEvents(bar, step, seed)) renderEvent(event, nextTime);
      nextStep++;
      nextTime += STEP_SECONDS;
    }
  }

  function setEnabled(value) {
    if (enabled === value) return;
    enabled = value;
    const now = context.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(output.gain.value, now);
    output.gain.linearRampToValueAtTime(value && !hidden ? 1 : 0, now + 0.12);
    if (!value) {
      clearInterval(timer);
      timer = null;
      stopVoices();
      return;
    }
    nextTime = now + 0.06;
    timer = setInterval(schedule, 50);
    schedule();
  }

  function setHidden(value) {
    hidden = value;
    const now = context.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(output.gain.value, now);
    output.gain.linearRampToValueAtTime(value ? 0 : enabled ? 1 : 0, now + 2);
    if (!value) {
      nextTime = now + 0.06;
      schedule();
    }
  }

  function dip() {
    const now = context.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(output.gain.value, now);
    output.gain.linearRampToValueAtTime(0.28, now + 0.08);
    output.gain.linearRampToValueAtTime(enabled && !hidden ? 1 : 0, now + 1.4);
  }

  return {
    setEnabled,
    setHidden,
    dip,
    renderEvent,
    set seed(value) { seed = value >>> 0; },
    get seed() { return seed; },
    get activeVoices() { return voices.size; },
    get hidden() { return hidden; },
    get enabled() { return enabled; },
  };
}
