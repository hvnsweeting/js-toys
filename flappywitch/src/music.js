import { LOOP_STEPS, musicLayers, musicTempo, scoreEvents } from './musicScore.js';

const MAX_VOICES = 24;
const LOOK_AHEAD = .22;

export function createMusic(context, destination = context.destination, maxVoices = MAX_VOICES) {
  const bus = context.createGain();
  bus.gain.value = 1.15;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -13;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = .003;
  compressor.release.value = .15;
  const output = context.createGain();
  output.gain.value = .75;
  const tone = context.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 8000;
  bus.connect(tone).connect(compressor).connect(output).connect(destination);
  const layerGains = Object.fromEntries(['drone', 'box', 'bass', 'tick', 'lead'].map(name => {
    const gain = context.createGain();
    gain.connect(bus);
    return [name, gain];
  }));
  const noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * .07), context.sampleRate);
  const noise = noiseBuffer.getChannelData(0);
  let noiseSeed = 17;
  for (let i = 0; i < noise.length; i++) {
    noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
    noise[i] = (noiseSeed / 2147483648 - 1) * (1 - i / noise.length);
  }
  const voices = new Map();
  let timer;
  let phase = 'title';
  let score = 0;
  let muted = false;
  let hidden = false;
  let nextStep = 0;
  let nextTime = context.currentTime + .04;
  let scheduledOscillators = 0;
  let gameOverTransitions = 0;
  const scheduledLayers = Object.fromEntries(Object.keys(layerGains).map(layer => [layer, 0]));

  function voice(layer, frequency, start, duration, accent) {
    if (voices.size >= maxVoices) return;
    const source = layer === 'tick' ? context.createBufferSource() : context.createOscillator();
    const envelope = context.createGain();
    const end = start + duration;
    const levels = { drone: .105, box: .24, bass: .18, tick: .09, lead: .19 };
    const peak = levels[layer] * accent;
    if (layer === 'tick') {
      source.buffer = noiseBuffer;
    } else {
      source.type = layer === 'box' || layer === 'bass' ? 'triangle' : 'sine';
      source.frequency.setValueAtTime(frequency, start);
      if (layer === 'lead') {
        source.frequency.setValueAtTime(frequency * .965, start);
        source.frequency.linearRampToValueAtTime(frequency, start + .09);
        for (let i = 1; i <= 5; i++) {
          source.detune.linearRampToValueAtTime(i % 2 ? 11 : -11, start + i * .12);
        }
      }
    }
    const attack = layer === 'drone' ? .22 : layer === 'tick' ? .003 : .012;
    const release = layer === 'drone' ? .28 : .08;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(peak, start + attack);
    if (layer === 'drone') {
      envelope.gain.setValueAtTime(peak, end - release);
    } else {
      envelope.gain.exponentialRampToValueAtTime(.001, Math.max(start + attack + .01, end - release));
    }
    envelope.gain.linearRampToValueAtTime(0, end);
    const filter = layer === 'drone' || layer === 'tick' ? context.createBiquadFilter() : null;
    if (filter) {
      filter.type = layer === 'tick' ? 'bandpass' : 'lowpass';
      filter.frequency.setValueAtTime(layer === 'tick' ? frequency : 1250, start);
      if (layer === 'drone') {
        filter.frequency.linearRampToValueAtTime(1800, start + duration / 2);
        filter.frequency.linearRampToValueAtTime(1100, end);
      }
      source.connect(filter).connect(envelope);
    } else {
      source.connect(envelope);
    }
    envelope.connect(layerGains[layer]);
    source.onended = () => {
      source.disconnect();
      filter?.disconnect();
      envelope.disconnect();
      voices.delete(source);
    };
    voices.set(source, { layer, envelope, start });
    scheduledLayers[layer]++;
    if (layer !== 'tick') scheduledOscillators++;
    source.start(start);
    source.stop(end + .01);
  }

  function renderEvent(event, at) {
    voice(event.layer, event.frequency, at, event.duration, event.accent);
    // Upper partials keep the pedal and bass audible on small speakers.
    if (event.layer === 'drone' || event.layer === 'bass') {
      voice(event.layer, event.frequency * 4, at, event.duration, event.accent * .8);
      voice(event.layer, event.frequency * 8, at, event.duration, event.accent * .55);
    }
  }

  function fadeOut() {
    const now = context.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime(0, now, .035);
    for (const [source, { envelope, start }] of voices) {
      if (start <= now) releaseEnvelope(envelope, now, .025);
      try { source.stop(start > now ? now + .01 : now + .15); } catch { /* A finished voice is already stopping. */ }
    }
    nextTime = now + .2;
  }

  function releaseEnvelope(envelope, now, seconds) {
    const gain = envelope.gain;
    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
    else {
      const level = gain.value;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(level, now);
    }
    gain.setTargetAtTime(0, now, seconds);
  }

  function enterGameOver() {
    gameOverTransitions++;
    const now = context.currentTime;
    for (const [source, { layer, envelope, start }] of voices) {
      if (layer === 'drone') continue;
      if (start <= now) releaseEnvelope(envelope, now, .07);
      try { source.stop(start > now ? now + .01 : now + .4); } catch { /* A finished voice is already stopping. */ }
    }
    // Start a pedal immediately so the filter sweep has an audible source.
    nextStep = Math.floor(nextStep / 16) * 16;
    nextTime = now + .03;
    tone.frequency.cancelScheduledValues(now);
    tone.frequency.setValueAtTime(8000, now);
    tone.frequency.exponentialRampToValueAtTime(550, now + 1.1);
  }

  function schedule() {
    if (muted || hidden || !musicLayers(phase, score).length || context.state !== 'running') return;
    const now = context.currentTime;
    const stepSeconds = 60 / musicTempo(score) / 4;
    // Skip missed steps by audio-clock time instead of slowing the score after a busy frame.
    if (nextTime < now) {
      const missed = Math.ceil((now + .04 - nextTime) / stepSeconds);
      nextStep = (nextStep + missed) % (LOOP_STEPS * 4);
      nextTime += missed * stepSeconds;
    }
    while (nextTime < now + LOOK_AHEAD) {
      for (const event of scoreEvents(nextStep, phase, score)) renderEvent(event, nextTime);
      nextStep = (nextStep + 1) % (LOOP_STEPS * 4);
      nextTime += stepSeconds;
    }
  }

  function update(nextPhase, nextScore, nextMuted, nextHidden) {
    const wasSilent = muted || hidden || !musicLayers(phase, score).length;
    const willBeSilent = nextMuted || nextHidden || !musicLayers(nextPhase, nextScore).length;
    const gameOverPhase = phase === 'dying' || phase === 'over';
    const nextGameOverPhase = nextPhase === 'dying' || nextPhase === 'over';
    const changedPhase = phase !== nextPhase && !(gameOverPhase && nextGameOverPhase);
    phase = nextPhase;
    score = nextScore;
    muted = nextMuted;
    hidden = nextHidden;
    if (willBeSilent) {
      if (!wasSilent) fadeOut();
      clearInterval(timer);
      timer = undefined;
      return;
    }
    if (!gameOverPhase && nextGameOverPhase && !wasSilent) {
      enterGameOver();
    } else if (changedPhase || wasSilent) {
      fadeOut();
      bus.gain.setTargetAtTime(1.15, context.currentTime + .04, .15);
      const now = context.currentTime;
      tone.frequency.cancelScheduledValues(now);
      tone.frequency.setTargetAtTime(nextGameOverPhase ? 550 : 8000, now, .15);
    }
    if (!timer) timer = setInterval(schedule, 50);
    schedule();
  }

  return { update, schedule, renderEvent, effectsInput: compressor, get scheduledOscillators() { return scheduledOscillators; },
    get scheduledLayers() { return { ...scheduledLayers }; }, get toneFrequency() { return tone.frequency.value; },
    get gameOverTransitions() { return gameOverTransitions; },
    get activeVoices() { return voices.size; }, get maxVoices() { return maxVoices; } };
}
