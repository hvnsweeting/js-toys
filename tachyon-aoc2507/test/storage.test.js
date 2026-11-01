import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, BACKUP_KEY, emptyProfile, loadProfile, saveProfile, validateProfile
} from '../src/storage.js';

function memory() {
  const data = new Map();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
    key: index => [...data.keys()][index] ?? null,
    get length() { return data.size; }
  };
}
test('invalid fields are recovered and raw data backed up', () => {
  const store = memory();
  const raw = JSON.stringify({stars: {a1: 3, a2: 8, constructor: 2}, volume: 9, muteMusic: 'yes'});
  store.setItem(STORAGE_KEY, raw);
  const profile = loadProfile(store);
  assert.deepEqual(profile.stars, {a1: 3});
  assert.equal(profile.volume, 0.7);
  assert.equal(store.getItem(BACKUP_KEY), raw);
  assert.equal(validateProfile({stars: {a1: 2}}).profile.stars.a1, 2);
});
test('saving from two tabs merges progress and keeps this tab settings', () => {
  const store = memory();
  const first = loadProfile(store);
  const second = loadProfile(store);
  first.stars.a1 = 2;
  first.bestPieces.a1 = 3;
  first.bonusReached.a1 = true;
  first.rushBest = 100;
  assert.equal(saveProfile(store, first), true);
  second.stars.a2 = 1;
  second.bestPieces.a2 = 5;
  second.rushBest = 50;
  second.muteMusic = true;
  assert.equal(saveProfile(store, second), true);
  assert.deepEqual(loadProfile(store).stars, {a1: 2, a2: 1});
  assert.deepEqual(loadProfile(store).bestPieces, {a1: 3, a2: 5});
  assert.deepEqual(loadProfile(store).bonusReached, {a1: true});
  assert.equal(loadProfile(store).rushBest, 100);
  assert.equal(loadProfile(store).muteMusic, true);
  assert.equal(second.stars.a1, 2);
  first.stars.a1 = 1;
  first.bestPieces.a1 = 4;
  assert.equal(saveProfile(store, first), true);
  assert.equal(loadProfile(store).stars.a1, 2);
  assert.equal(loadProfile(store).bestPieces.a1, 3);
});
test('recovery keeps the last three distinct saves when the clock moves backward', () => {
  const store = memory();
  const originalNow = Date.now;
  try {
    for (const [index, time] of [1000, 3000, 2000, 4000, 5000].entries()) {
      Date.now = () => time;
      store.setItem(STORAGE_KEY, `{broken-${index + 1}`);
      loadProfile(store);
      const backups = [...store.data.entries()].filter(([key]) => key.startsWith(BACKUP_KEY));
      assert.ok(backups.length <= 3);
      if (index === 1) assert.deepEqual(backups.map(([, raw]) => raw).sort(),
          ['{broken-1', '{broken-2']);
    }
  } finally {
    Date.now = originalNow;
  }
  const saved = [...store.data.entries()]
      .filter(([key]) => key.startsWith(BACKUP_KEY))
      .map(([, raw]) => raw).sort();
  assert.deepEqual(saved, ['{broken-3', '{broken-4', '{broken-5']);
});
test('backup rotation never deletes or overwrites a copy saved by hand, whatever its name', () => {
  const handNames = [
    BACKUP_KEY, `${BACKUP_KEY}-manual`, `${BACKUP_KEY}-123`, `${BACKUP_KEY}-2`,
    `${BACKUP_KEY}-seq-000000000001`
  ];
  const store = memory();
  for (const name of handNames) store.setItem(name, `hand copy ${name}`);
  for (const index of [1, 2, 3, 4, 5]) {
    store.setItem(STORAGE_KEY, `{broken-${index}`);
    loadProfile(store);
  }
  for (const name of handNames) assert.equal(store.getItem(name), `hand copy ${name}`);
  const generated = [...store.data.entries()]
      .filter(([key]) => key.startsWith(BACKUP_KEY) && !handNames.includes(key))
      .map(([, raw]) => raw).sort();
  assert.deepEqual(generated, ['{broken-3', '{broken-4', '{broken-5']);
});
test('rotation keeps a backup the player wrote over, and ignores a damaged list', () => {
  const store = memory();
  store.setItem(STORAGE_KEY, '{broken-1');
  loadProfile(store);
  store.setItem(BACKUP_KEY, 'hand copy written over our backup');
  store.setItem(`${BACKUP_KEY}-manual`, 'hand copy');
  const damaged = JSON.parse(store.getItem(`${STORAGE_KEY}:backup-list`));
  for (let index = 0; index < 3; index++)
    damaged.push({key: `${BACKUP_KEY}-manual`, value: 'not its value'});
  // Forged entries naming hand copies with their exact values must not get them deleted either,
  // including numbered names this module never writes.
  damaged.push({key: `${BACKUP_KEY}-manual`, value: 'hand copy'});
  for (const name of ['-0', '-1', '-02']) {
    store.setItem(`${BACKUP_KEY}${name}`, `hand copy ${name}`);
    damaged.push({key: `${BACKUP_KEY}${name}`, value: `hand copy ${name}`});
  }
  store.setItem(`${STORAGE_KEY}:backup-list`, JSON.stringify(damaged));
  for (const index of [2, 3, 4, 5]) {
    store.setItem(STORAGE_KEY, `{broken-${index}`);
    loadProfile(store);
  }
  assert.equal(store.getItem(BACKUP_KEY), 'hand copy written over our backup');
  assert.equal(store.getItem(`${BACKUP_KEY}-manual`), 'hand copy');
  for (const name of ['-0', '-1', '-02'])
    assert.equal(store.getItem(`${BACKUP_KEY}${name}`), `hand copy ${name}`);
  const generated = [...store.data.entries()]
      .filter(([key, raw]) => key.startsWith(BACKUP_KEY) && raw.startsWith('{broken'))
      .map(([, raw]) => raw).sort();
  assert.deepEqual(generated, ['{broken-3', '{broken-4', '{broken-5']);
});
test('a failed backup write leaves no unlisted backup and keeps the limit', () => {
  const store = memory();
  const setItem = store.setItem;
  let failNextBackupWrite = false;
  store.setItem = (key, value) => {
    if (failNextBackupWrite && key.startsWith(BACKUP_KEY)) {
      failNextBackupWrite = false;
      throw new Error('Simulated quota error');
    }
    setItem(key, value);
  };
  for (const index of [1, 2, 3, 4, 5, 6]) {
    store.setItem(STORAGE_KEY, `{broken-${index}`);
    failNextBackupWrite = index % 2 === 0;
    try {
      loadProfile(store);
    } catch {
      // A failed backup write may surface; the next load must still keep the store consistent.
    }
  }
  const backups = [...store.data.keys()].filter(key => key.startsWith(BACKUP_KEY));
  assert.ok(backups.length <= 3, `${backups.length} backups`);
  const listed = JSON.parse(store.getItem(`${STORAGE_KEY}:backup-list`)).map(entry => entry.key);
  for (const key of backups) assert.ok(listed.includes(key), `${key} is not listed`);
});
test('a backup that fails to delete stays listed and is retired by a later save', () => {
  const store = memory();
  let failNextRemoval = false;
  const removeItem = store.removeItem.bind(store);
  store.removeItem = key => {
    if (failNextRemoval && key.startsWith(BACKUP_KEY)) {
      failNextRemoval = false;
      throw new Error('Simulated removal error');
    }
    removeItem(key);
  };
  const backupKeys = () => [...store.data.keys()].filter(key => key.startsWith(BACKUP_KEY));
  for (const index of [1, 2, 3]) {
    store.setItem(STORAGE_KEY, `{broken-${index}`);
    loadProfile(store);
  }
  store.setItem(STORAGE_KEY, '{broken-4');
  failNextRemoval = true;
  loadProfile(store);
  assert.equal(failNextRemoval, false, 'the fourth backup tried to retire the first');
  const listed = JSON.parse(store.getItem(`${STORAGE_KEY}:backup-list`)).map(entry => entry.key);
  for (const key of backupKeys()) assert.ok(listed.includes(key), `${key} is not listed`);
  // Loading the same damaged save again adds no new backup, but still retires the extra copy.
  store.setItem(STORAGE_KEY, '{broken-4');
  loadProfile(store);
  assert.equal(backupKeys().length, 3);
});
test('a backup list write that fails after a failed delete still lists every backup', () => {
  const store = memory();
  const backupKeys = () => [...store.data.keys()].filter(key => key.startsWith(BACKUP_KEY));
  for (const index of [1, 2, 3]) {
    store.setItem(STORAGE_KEY, `{broken-${index}`);
    loadProfile(store);
  }
  const removeItem = store.removeItem.bind(store);
  const setItem = store.setItem.bind(store);
  let listWrites = 0;
  store.removeItem = key => {
    if (key.startsWith(BACKUP_KEY)) throw new Error('Simulated removal error');
    removeItem(key);
  };
  store.setItem = (key, value) => {
    // The second list write of this save is the one that would shrink the list.
    if (key === `${STORAGE_KEY}:backup-list` && ++listWrites === 2) throw new Error('Simulated quota error');
    setItem(key, value);
  };
  store.setItem(STORAGE_KEY, '{broken-4');
  listWrites = 0;
  try {
    loadProfile(store);
  } catch {
    // The failed list write may surface; the stored list must still name every backup.
  }
  assert.equal(listWrites, 2, 'the list was written twice');
  const listed = JSON.parse(store.getItem(`${STORAGE_KEY}:backup-list`)).map(entry => entry.key);
  assert.equal(backupKeys().length, 4);
  for (const key of backupKeys()) assert.ok(listed.includes(key), `${key} is not listed`);
});
test('a value colliding with a short hash is still recognised as the player\'s copy', () => {
  const store = memory();
  store.setItem(STORAGE_KEY, '{broken-00006pfs');
  loadProfile(store);
  store.setItem(BACKUP_KEY, '{broken-0000nvja');
  for (const index of [2, 3, 4]) {
    store.setItem(STORAGE_KEY, `{broken-${index}`);
    loadProfile(store);
  }
  assert.equal(store.getItem(BACKUP_KEY), '{broken-0000nvja');
});
test('a win saves after loading a malformed primary from the same store', () => {
  const store = memory();
  store.setItem(STORAGE_KEY, '{broken');
  const profile = loadProfile(store);
  assert.equal(store.getItem(BACKUP_KEY), '{broken');
  profile.stars.a1 = 3;
  assert.equal(saveProfile(store, profile), true);
  assert.equal(loadProfile(store).stars.a1, 3);
});
test('saving backs up an unparseable primary before replacing it', () => {
  const store = memory();
  const raw = '{broken';
  store.setItem(STORAGE_KEY, raw);
  assert.equal(saveProfile(store, emptyProfile()), true);
  assert.notEqual(store.getItem(STORAGE_KEY), raw);
  const backups = [...store.data.entries()].filter(([key]) => key.startsWith(BACKUP_KEY));
  assert.ok(backups.some(([, value]) => value === raw));
});
test('saving backs up a parseable primary with invalid fields before replacing it', () => {
  const store = memory();
  const raw = '{"stars":{"a1":99},"volume":2}';
  store.setItem(STORAGE_KEY, raw);
  const profile = emptyProfile();
  profile.stars.a2 = 1;
  assert.equal(saveProfile(store, profile), true);
  assert.equal(store.getItem(BACKUP_KEY), raw);
  assert.deepEqual(loadProfile(store).stars, {a2: 1});
});
test('an older tab saving a win keeps a newer volume setting', () => {
  const store = memory();
  const first = loadProfile(store);
  const second = loadProfile(store);
  first.volume = 0.2;
  assert.equal(saveProfile(store, first), true);
  second.stars.a1 = 3;
  assert.equal(saveProfile(store, second), true);
  const saved = loadProfile(store);
  assert.equal(saved.volume, 0.2);
  assert.equal(saved.stars.a1, 3);
  assert.equal(second.volume, 0.2);
});
test('settings are merged independently after each save', () => {
  const store = memory();
  const first = loadProfile(store);
  const second = loadProfile(store);
  first.volume = 0.2;
  first.muteMusic = true;
  assert.equal(saveProfile(store, first), true);
  second.muteSfx = true;
  assert.equal(saveProfile(store, second), true);
  first.stars.a1 = 1;
  assert.equal(saveProfile(store, first), true);
  const saved = loadProfile(store);
  assert.equal(saved.volume, 0.2);
  assert.equal(saved.muteMusic, true);
  assert.equal(saved.muteSfx, true);
  assert.equal(saved.stars.a1, 1);
});
test('unparseable data and failed writes do not break play', () => {
  const store = memory();
  store.setItem(STORAGE_KEY, '{oops');
  assert.equal(loadProfile(store).rushBest, 0);
  assert.equal(store.getItem(BACKUP_KEY), '{oops');
  const broken = {
    getItem: () => null,
    setItem: () => {
      throw Error('quota')
    }
  };
  const notes = [];
  assert.equal(saveProfile(broken, loadProfile(store), message => notes.push(message)), false);
  assert.equal(notes.length, 1);
});
