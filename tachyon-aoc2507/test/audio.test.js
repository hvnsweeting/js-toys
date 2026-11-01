import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusic } from '../src/audio/music.js';
import { createSfx } from '../src/audio/sfx.js';

class AudioParamStub {
  value = 0;
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}

class NodeStub {
  constructor(context) {
    this.context = context;
    this.gain = new AudioParamStub();
    this.frequency = new AudioParamStub();
    this.detune = new AudioParamStub();
    this.delayTime = new AudioParamStub();
    this.connected = false;
    this.disconnected = false;
    context.nodes.push(this);
  }
  connect() { this.connected = true; }
  disconnect() { this.disconnected = true; }
  start() { this.context.starts += 1; }
  stop() { this.context.stops += 1; }
  finish() { this.onended?.(); }
}

class AudioContextStub {
  constructor() {
    this.currentTime = 1;
    this.sampleRate = 8000;
    this.state = 'running';
    this.nodes = [];
    this.starts = 0;
    this.stops = 0;
  }
  createGain() { return new NodeStub(this); }
  createOscillator() { return new NodeStub(this); }
  createBufferSource() { return new NodeStub(this); }
  createBiquadFilter() { return new NodeStub(this); }
  createDelay() { return new NodeStub(this); }
  createConvolver() { return new NodeStub(this); }
  createBuffer(channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }
  finishSources() {
    for (const node of this.nodes) if (node.onended) node.finish();
  }
}


// Fails on an empty list as well: if audio stopped connecting nodes, `every` alone would pass.
function assertConnectedNodesReleased(context) {
  const connected = context.nodes.filter(node => node.connected);
  assert.ok(connected.length > 0, 'audio should connect nodes');
  assert.ok(connected.every(node => node.disconnected), 'every connected node is disconnected');
}

test('music schedules notes and can stop then start again without connected nodes', () => {
  const context = new AudioContextStub();
  const destination = new NodeStub(context);
  const music = createMusic(context, destination);
  music.setIntensity(0.75);
  music.start();
  assert.equal(music.isPlaying, true);
  assert.ok(context.starts > 0, 'lookahead scheduler should start sources');
  const chord = music.currentChord();
  assert.ok(chord.length >= 3, 'split effects follow the chord, so it must hold notes');
  assert.ok(chord.every(note => Number.isInteger(note) && note >= 30 && note <= 100));
  music.stop();
  context.finishSources();
  assert.equal(music.isPlaying, false);
  assertConnectedNodesReleased(context);
  const firstStartCount = context.starts;
  music.start();
  assert.ok(context.starts > firstStartCount);
  music.stop();
  context.finishSources();
  assertConnectedNodesReleased(context);
});

test('suspended context waits, then resumes from current time', async () => {
  const context = new AudioContextStub();
  context.state = 'suspended';
  const music = createMusic(context, new NodeStub(context));
  music.start();
  assert.equal(context.starts, 0);
  context.currentTime = 100;
  context.state = 'running';
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.ok(context.starts > 0);
  assert.ok(context.starts < 30, 'resuming should not schedule a backlog');
  music.stop();
  context.finishSources();
});

test('sound effects clean up and split supports the far columns', () => {
  const context = new AudioContextStub();
  const destination = new NodeStub(context);
  const music = { currentChord: () => [57, 60, 64, 69] };
  const effects = createSfx(context, destination, music);
  // Each split, at either edge column, must start its own tone.
  effects.split(0, 15);
  const startsAfterLeftSplit = context.starts;
  assert.ok(startsAfterLeftSplit > 0, 'split at column 0 starts a tone');
  effects.split(14, 15);
  assert.ok(context.starts > startsAfterLeftSplit, 'split at the last column starts a tone');
  effects.win(3);
  effects.fail();
  effects.place();
  effects.remove();
  effects.fire();
  effects.targetLit();
  effects.voidHit();
  effects.click();
  effects.tick();
  assert.ok(context.starts > 10);
  context.finishSources();
  assertConnectedNodesReleased(context);
});
