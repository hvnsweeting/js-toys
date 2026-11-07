// Synthesized sound: wind and occasional birdsong behind the answer and win sounds.
// A miss gets a short, quiet tick. No audio files.
// Browsers only allow audio after a user gesture, so everything starts in unlock().

const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];

export class Sound {
  constructor(muted) {
    this.context = null;
    this.master = null;
    this.muted = muted;
    // True while the page is in a background tab or minimised: the sound is paused then.
    this.paused = false;
    this.birdTimer = null;
  }

  unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.context.destination);
      this.startWind();
      this.scheduleBirds();
    }
    // A browser can create the context suspended even during a gesture; this gesture may resume it.
    if (this.context.state === 'suspended' && !this.paused) this.context.resume();
  }

  // Suspend the wind and any scheduled sounds while the page is hidden.
  setPaused(paused) {
    this.paused = paused;
    if (!this.context) return;
    if (paused) {
      this.stopBirds();
      this.context.suspend();
    } else {
      this.context.resume();
      this.scheduleBirds();
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.context.currentTime, 0.1);
    if (muted) this.stopBirds();
    else this.scheduleBirds();
  }

  scheduleBirds() {
    if (!this.context || this.muted || this.paused || this.birdTimer !== null) return;
    this.birdTimer = setTimeout(() => {
      this.birdTimer = null;
      if (this.muted || this.paused) return;
      this.birdsong();
      this.scheduleBirds();
    }, 2500 + Math.random() * 4000);
  }

  stopBirds() {
    if (this.birdTimer === null) return;
    clearTimeout(this.birdTimer);
    this.birdTimer = null;
  }

  birdsong(start = 0) {
    const pitch = 1700 + Math.random() * 300;
    this.tone(pitch, { start, duration: 0.16, volume: 0.025, endFrequency: pitch * 1.4 });
    this.tone(pitch * 1.3, { start: start + 0.19, duration: 0.2, volume: 0.02, endFrequency: pitch * 0.9 });
  }

  startWind() {
    const ctx = this.context;
    // Brown noise: integrated white noise, which sounds like distant wind.
    // The buffer loops, so half a second of extra noise is generated and blended
    // into the start: the loop's last sample then runs straight into its first,
    // with no step to click every four seconds.
    const length = ctx.sampleRate * 4;
    const fade = Math.floor(ctx.sampleRate * 0.5);
    const noise = new Float32Array(length + fade);
    let last = 0;
    for (let i = 0; i < noise.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      noise[i] = last * 3.5;
    }
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      noise[i] = noise[i] * t + noise[length + i] * (1 - t);
    }
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    buffer.getChannelData(0).set(noise.subarray(0, length));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.value = 0.16;
    // A slow wobble in volume and brightness, like gusts.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.07;
    lfo.connect(lfoGain).connect(gain.gain);
    const lfoFilter = ctx.createGain();
    lfoFilter.gain.value = 220;
    lfo.connect(lfoFilter).connect(filter.frequency);
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    lfo.start();
  }

  tone(frequency, { start = 0, duration = 1.2, volume = 0.2, type = 'sine', attack = 0.01, endFrequency } = {}) {
    if (!this.context) return;
    const ctx = this.context;
    const when = ctx.currentTime + start;
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    if (endFrequency) {
      oscillator.frequency.setValueAtTime(frequency, when);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, when + duration);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(volume, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.05);
  }

  // A small rising arpeggio, for each difference found.
  correct() {
    for (let i = 0; i < 3; i++) {
      const frequency = PENTATONIC[2 + i];
      this.tone(frequency, { start: i * 0.09, duration: 1.4, volume: 0.13 });
      this.tone(frequency * 2, { start: i * 0.09, duration: 0.6, volume: 0.03 });
    }
  }

  // A longer phrase and held chord mark the third difference.
  win() {
    for (let i = 0; i < 4; i++) {
      this.tone(PENTATONIC[1 + i], { start: i * 0.12, duration: 0.55, volume: 0.09 });
    }
    for (const frequency of [523.25, 659.25, 783.99]) {
      this.tone(frequency, { start: 0.5, duration: 1.8, volume: 0.07, attack: 0.04 });
    }
    this.birdsong(0.7);
  }

  // A miss: short and quiet rather than low, so it does not sound like a penalty buzzer.
  click() {
    this.tone(880, { duration: 0.12, volume: 0.04, type: 'triangle' });
  }

  grow() {
    this.tone(392, { duration: 1.6, volume: 0.05, attack: 0.5 });
    this.tone(587.33, { start: 0.3, duration: 1.4, volume: 0.04, attack: 0.5 });
  }
}
