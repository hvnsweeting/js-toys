import test from 'node:test';
import assert from 'node:assert/strict';
import {accessStorage, shortcutAllowed, wallSeconds} from '../src/runtime.js';

test('Rush elapsed time uses the full wall interval', () => {
  assert.equal(wallSeconds(1500, 0), 1.5);
  assert.equal(wallSeconds(100, 200), 0);
  assert.equal(Math.max(0, 180 - wallSeconds(181000, 0)), 0);
});

test('shortcuts ignore every modifier and key repeats', () => {
  const event = {ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false};
  assert.equal(shortcutAllowed(event), true);
  for (const key of Object.keys(event)) {
    assert.equal(shortcutAllowed({...event, [key]: true}), false, key);
  }
});

test('storage property access errors return an empty-storage fallback', () => {
  const notes = [];
  const storage = accessStorage(() => { throw new Error('blocked'); }, note => notes.push(note));
  assert.equal(storage, null);
  assert.equal(notes.length, 1);
  assert.equal(accessStorage(() => ({getItem: () => null}), () => {}).getItem(), null);
});
