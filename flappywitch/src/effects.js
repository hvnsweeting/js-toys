export const EFFECT_NOTES = {
  puff: [240, 380, .13, 1.4],
  pass: [520, 850, .3, 1.1],
  fly: [950, 1250, .23, 1.3],
  hit: [130, 65, .27, 1.5],
  shield: [600, 320, .4, .75],
};

export function playEffect(context, destination, kind, at = context.currentTime) {
  const [start, end, length, volume] = EFFECT_NOTES[kind];
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = kind === 'hit' ? 'triangle' : 'sine';
  oscillator.frequency.setValueAtTime(start, at);
  oscillator.frequency.exponentialRampToValueAtTime(end, at + length);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + .012);
  gain.gain.linearRampToValueAtTime(volume * .85, at + length * .35);
  gain.gain.exponentialRampToValueAtTime(.001, at + length);
  oscillator.connect(gain).connect(destination);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(at);
  oscillator.stop(at + length + .01);
  return oscillator;
}
