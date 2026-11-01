export const EFFECT_TONES = {
  pick: [330],
  snap: [420],
  join: [310, 390],
  done: [392, 494, 587, 784],
};

export function playEffect(context, kind, at = context.currentTime,
  destination = context.destination) {
  const tones = EFFECT_TONES[kind];
  if (!tones) return;
  tones.forEach((frequency, index) => {
    const start = at + index * (kind === 'done' ? 0.09 : 0.045);
    const peak = kind === 'join' ? 0.37 : kind === 'done' ? 0.205 : 0.49;
    const hold = kind === 'done' ? 0.46 : 0.12;
    const release = kind === 'done' ? 0.6 : 0.18;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === 'done' ? 'sine' : 'triangle';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.setValueAtTime(peak, start + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + release);
    oscillator.connect(gain).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + release + 0.01);
  });
}
