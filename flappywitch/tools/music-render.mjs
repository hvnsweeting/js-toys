import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './chromium.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.scratch');
const port = Number(process.env.PORT || 8097);
const base = process.env.BASE_URL || `http://127.0.0.1:${port}/flappywitch/`;
const sampleRate = 22050;
await mkdir(out, { recursive: true });
const browser = await launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
  args: ['--no-sandbox', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
try {
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: 'networkidle0' });
  const render = async (phase, score, seconds, layer = null, highPass = false) => page.evaluate(async args => {
    const { createMusic } = await import(new URL('./src/music.js', document.baseURI));
    const { LOOP_STEPS, musicTempo, scoreEvents } = await import(new URL('./src/musicScore.js', document.baseURI));
    const context = new OfflineAudioContext(1, Math.ceil(args.seconds * args.sampleRate), args.sampleRate);
    let destination = context.destination;
    if (args.highPass) {
      const filter = context.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 250;
      filter.Q.value = .707;
      filter.connect(destination);
      destination = filter;
    }
    const music = createMusic(context, destination, Infinity);
    const stepSeconds = 60 / musicTempo(args.score) / 4;
    for (let step = 0; step * stepSeconds < args.seconds; step++) {
      for (const event of scoreEvents(step % (LOOP_STEPS * 4), args.phase, args.score)) {
        if (!args.layer || event.layer === args.layer) music.renderEvent(event, step * stepSeconds);
      }
    }
    const buffer = await context.startRendering();
    const samples = buffer.getChannelData(0);
    let sum = 0;
    let peak = 0;
    for (const sample of samples) {
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(sum / samples.length);
    const result = { rms, rmsDb: 20 * Math.log10(rms), peak, peakDb: 20 * Math.log10(peak) };
    if (args.returnWav) {
      const bytes = new Uint8Array(samples.length * 2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      result.pcm = btoa(binary);
    }
    if (args.loopAt) {
      const sample = Math.round(args.loopAt * args.sampleRate);
      result.loopJump = Math.abs(samples[sample] - samples[sample - 1]);
      result.loopBefore = samples[sample - 1];
      result.loopAfter = samples[sample];
      let nearbyMaxJump = 0;
      for (let i = sample - 100; i < sample + 100; i++) {
        if (i !== sample) nearbyMaxJump = Math.max(nearbyMaxJump, Math.abs(samples[i] - samples[i - 1]));
      }
      result.nearbyMaxJump = nearbyMaxJump;
    }
    return result;
  }, { phase, score, seconds, layer, highPass, sampleRate, returnWav: !layer && !highPass && seconds <= 30, loopAt: seconds > 30 ? 64 * 4 * 60 / (phase === 'title' ? 100 : 103) : 0 });

  function wav(pcm) {
    const data = Buffer.from(pcm, 'base64');
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(data.length + 36, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
  }

  const renderEffect = async kind => page.evaluate(async args => {
    const { EFFECT_NOTES, playEffect } = await import(new URL('./src/effects.js', document.baseURI));
    const { createMusic } = await import(new URL('./src/music.js', document.baseURI));
    const duration = EFFECT_NOTES[args.kind][2];
    const context = new OfflineAudioContext(1, Math.ceil((duration + .05) * args.sampleRate), args.sampleRate);
    const music = createMusic(context, context.destination, Infinity);
    playEffect(context, music.effectsInput, args.kind, 0);
    const samples = (await context.startRendering()).getChannelData(0);
    let sum = 0;
    let peak = 0;
    const count = Math.floor(duration * args.sampleRate);
    for (let i = 0; i < count; i++) {
      sum += samples[i] * samples[i];
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    return { rmsDb: 20 * Math.log10(Math.sqrt(sum / count)), peakDb: 20 * Math.log10(peak) };
  }, { kind, sampleRate });

  const measurements = {};
  for (const [name, phase, score, seconds] of [['title', 'title', 0, 20], ['play', 'playing', 10, 30]]) {
    const full = await render(phase, score, seconds);
    await writeFile(path.join(out, `music-${name}.wav`), wav(full.pcm));
    delete full.pcm;
    const highPass = await render(phase, score, seconds, null, true);
    const layers = {};
    for (const layer of ['drone', 'box', 'bass', 'tick', 'lead']) {
      if (phase === 'title' && !['drone', 'box'].includes(layer)) continue;
      layers[layer] = await render(phase, score, seconds, layer);
    }
    measurements[name] = { full, highPass, layers };
    const target = name === 'title' ? -18 : -16;
    assert.ok(Math.abs(full.rmsDb - target) <= 3, `${name} full mix reaches its loudness target`);
    assert.ok(full.peakDb < -1, `${name} peak stays below -1 decibel relative to full scale`);
    if (name === 'play') {
      assert.ok(Math.abs(highPass.rmsDb - target) <= 3, 'phone band reaches its loudness target');
      assert.ok(full.rmsDb - highPass.rmsDb <= 4, 'phone band stays within four decibels of full mix');
    }
    console.log(JSON.stringify({ name, full, highPass, layers }, null, 2));
  }
  const boundary = await render('playing', 10, 64 * 4 * 60 / 103 + 1);
  assert.ok(boundary.loopJump < boundary.nearbyMaxJump && boundary.loopJump < .01, 'loop transition stays below nearby sample changes');
  measurements.loopBoundary = boundary;
  const titleBoundary = await render('title', 0, 64 * 4 * 60 / 100 + 1);
  assert.ok(titleBoundary.loopJump < titleBoundary.nearbyMaxJump && titleBoundary.loopJump < .01, 'title loop transition stays below nearby sample changes');
  measurements.titleLoopBoundary = titleBoundary;
  measurements.effects = {};
  for (const kind of ['puff', 'pass', 'fly', 'hit', 'shield']) measurements.effects[kind] = await renderEffect(kind);
  for (const [kind, result] of Object.entries(measurements.effects)) {
    const aboveMusic = result.rmsDb - measurements.play.full.rmsDb;
    result.aboveMusicDb = aboveMusic;
    assert.ok(aboveMusic >= 2.5 && aboveMusic <= 4, `${kind} effect stays near the specified level`);
  }
  measurements.combinedPeak = await page.evaluate(async args => {
    const { createMusic } = await import(new URL('./src/music.js', document.baseURI));
    const { musicTempo, scoreEvents } = await import(new URL('./src/musicScore.js', document.baseURI));
    const { playEffect } = await import(new URL('./src/effects.js', document.baseURI));
    const context = new OfflineAudioContext(1, args.sampleRate * 7, args.sampleRate);
    const music = createMusic(context, context.destination, Infinity);
    const stepSeconds = 60 / musicTempo(10) / 4;
    for (let step = 0; step * stepSeconds < 7; step++) {
      for (const event of scoreEvents(step, 'playing', 10)) music.renderEvent(event, step * stepSeconds);
    }
    for (const [kind, at] of [['pass', 1.2], ['fly', 1.2], ['puff', 2.4], ['shield', 3.6], ['hit', 4.8]]) {
      playEffect(context, music.effectsInput, kind, at);
    }
    const samples = (await context.startRendering()).getChannelData(0);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    return { peak, peakDb: 20 * Math.log10(peak) };
  }, { sampleRate });
  console.log(JSON.stringify({ combinedPeak: measurements.combinedPeak }));
  assert.ok(measurements.combinedPeak.peakDb < -1, 'music and effects do not clip together');
  await writeFile(path.join(out, 'music-measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  console.log(JSON.stringify({ loopBoundary: boundary }, null, 2));
  console.log(JSON.stringify({ titleLoopBoundary: titleBoundary }, null, 2));
} finally {
  await browser.close();
}
