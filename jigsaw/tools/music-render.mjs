import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch } from './chromium.mjs';

const output = path.resolve('.scratch');
const base = process.env.BASE_URL || 'http://127.0.0.1:8097/jigsaw/';
const sampleRate = 22050;
await mkdir(output, { recursive: true });
const browser = await launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
  args: ['--no-sandbox', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
try {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle0' });
  const result = await page.evaluate(async ({ sampleRate }) => {
    const { createMusic } = await import(new URL('./js/music.js', document.baseURI));
    const { scoreEvents, MUSIC_TEMPO, STEPS_PER_BAR } = await import(new URL('./js/musicScore.js', document.baseURI));
    const { playEffect } = await import(new URL('./js/effects.js', document.baseURI));
    const levels = (samples, count = samples.length) => {
      let sum = 0, peak = 0;
      for (let index = 0; index < count; index++) {
        const value = samples[index];
        sum += value * value;
        peak = Math.max(peak, Math.abs(value));
      }
      const rms = Math.sqrt(sum / count);
      return { rms, rmsDb: 20 * Math.log10(rms), peak,
        peakDb: 20 * Math.log10(peak) };
    };
    const context = new OfflineAudioContext(1, sampleRate * 30, sampleRate);
    const music = createMusic(context, context.destination, true);
    const stepSeconds = 60 / MUSIC_TEMPO / 4;
    for (let step = 0; step * stepSeconds < 30; step++) {
      const bar = Math.floor(step / STEPS_PER_BAR);
      for (const event of scoreEvents(bar, step % STEPS_PER_BAR, 17))
        music.renderEvent(event, step * stepSeconds);
    }
    const samples = (await context.startRendering()).getChannelData(0);
    const musicLevels = levels(samples);
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < samples.length; index++)
      view.setInt16(index * 2, Math.round(Math.max(-1, Math.min(1, samples[index])) * 32767), true);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 16384)
      binary += String.fromCharCode(...bytes.subarray(index, index + 16384));
    const effects = {};
    for (const kind of ['pick', 'snap', 'join', 'done']) {
      const duration = kind === 'done' ? 0.89 : kind === 'join' ? 0.24 : 0.19;
      const effectContext = new OfflineAudioContext(1, Math.ceil(sampleRate * duration), sampleRate);
      playEffect(effectContext, kind, 0);
      const effectSamples = (await effectContext.startRendering()).getChannelData(0);
      effects[kind] = levels(effectSamples, Math.floor(sampleRate * duration));
      effects[kind].aboveMusicDb = effects[kind].rmsDb - musicLevels.rmsDb;
    }
    return { music: musicLevels, effects, pcm: btoa(binary) };
  }, { sampleRate });
  const pcm = Buffer.from(result.pcm, 'base64');
  delete result.pcm;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  await writeFile(path.join(output, 'music-30s.wav'), Buffer.concat([header, pcm]));
  await writeFile(path.join(output, 'music-measurements.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  assert.ok(Math.abs(result.music.rmsDb + 18) <= 3, 'music 30 second RMS near -18 dBFS');
  assert.ok(result.music.peakDb < -1, 'music peak below -1 dBFS');
  for (const [kind, effect] of Object.entries(result.effects))
    assert.ok(effect.aboveMusicDb >= 3 && effect.aboveMusicDb <= 4,
      `${kind} effect 3 to 4 dB above music`);
} finally {
  await browser.close();
}
