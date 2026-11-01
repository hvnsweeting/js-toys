export const STORAGE_KEY = 'tachyon-cascade-v1';
export const LEGACY_TIMELINE_KEY = 'tachyon-timeline-lab-v1';
export const BACKUP_KEY = `${STORAGE_KEY}-backup`;
const BACKUP_LIMIT = 3;
const settingsBaseline = new WeakMap();

function rememberSettings(profile) {
  settingsBaseline.set(profile, {
    muteMusic: profile.muteMusic,
    muteSfx: profile.muteSfx,
    volume: profile.volume
  });
  return profile;
}

export function emptyProfile() {
  return rememberSettings({
    stars: {},
    bestPieces: {},
    bonusReached: {},
    rushBest: 0,
    muteMusic: false,
    muteSfx: false,
    volume: 0.7
  });
}

function validRecords(value, upperBound) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(
      ([key, number]) => /^(?:[abc][1-5]|t[1-6])$/.test(key) && Number.isInteger(number) && number >= 0 &&
          number <= upperBound));
}

export function validateProfile(raw) {
  const clean = emptyProfile();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {profile: clean, changed: true};
  clean.stars = validRecords(raw.stars, 3);
  clean.bestPieces = validRecords(raw.bestPieces, 999);
  if (raw.bonusReached && typeof raw.bonusReached === 'object' &&
      !Array.isArray(raw.bonusReached)) {
    clean.bonusReached = Object.fromEntries(
        Object.entries(raw.bonusReached)
            .filter(([key, value]) => /^(?:[abc][1-5]|t[1-6])$/.test(key) && value === true));
  }
  if (Number.isInteger(raw.rushBest) && raw.rushBest >= 0) clean.rushBest = raw.rushBest;
  if (typeof raw.muteMusic === 'boolean') clean.muteMusic = raw.muteMusic;
  if (typeof raw.muteSfx === 'boolean') clean.muteSfx = raw.muteSfx;
  if (typeof raw.volume === 'number' && Number.isFinite(raw.volume) && raw.volume >= 0 &&
      raw.volume <= 1)
    clean.volume = raw.volume;
  return {profile: clean, changed: JSON.stringify(clean) !== JSON.stringify(raw)};
}

export function loadProfile(storage, notify = () => {}) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    notify('Progress cannot be read in this browser.');
    return emptyProfile();
  }
  if (raw === null) return emptyProfile();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const {profile, changed} = validateProfile(parsed);
  if (changed) {
    try {
      backupRaw(storage, raw);
    } catch {
      notify('The old save could not be backed up.');
    }
  }
  return rememberSettings(profile);
}

// The backups this module wrote, oldest first, each with the exact value written. Rotation
// deletes a key only while it still holds exactly that value and only under a name this module
// writes (BACKUP_KEY, or BACKUP_KEY-<n> for n of 2 or more, without leading zeros), so a copy saved
// by hand under another name, or written over one of our keys, is never removed, even if this list
// is damaged. A list edited to name one of our keys with that key's exact value can still get that
// copy removed; only code on this origin can write such a list. Backups
// are small profiles, so keeping a second copy of each in the list costs little. The list's own
// name does not start with BACKUP_KEY.
const BACKUP_LIST_KEY = `${STORAGE_KEY}:backup-list`;

function stillOurs(storage, entry) {
  return storage.getItem(entry.key) === entry.value;
}

function isBackupName(key) {
  const suffix = key.slice(BACKUP_KEY.length);
  return key.startsWith(BACKUP_KEY) && (suffix === '' || /^-([2-9]|[1-9][0-9]+)$/.test(suffix));
}

function readBackupList(storage) {
  let listed;
  try {
    listed = JSON.parse(storage.getItem(BACKUP_LIST_KEY) ?? '[]');
  } catch {
    listed = [];
  }
  if (!Array.isArray(listed)) return [];
  const seen = new Set();
  return listed.filter(entry => {
    const wellFormed = entry && typeof entry.key === 'string' && typeof entry.value === 'string' &&
        isBackupName(entry.key);
    if (!wellFormed || seen.has(entry.key) || !stillOurs(storage, entry)) return false;
    seen.add(entry.key);
    return true;
  });
}

// Deletes the oldest listed backups beyond BACKUP_LIMIT. The list shrinks only after the deletes,
// and a backup stays listed if its delete throws, so the list never misses a backup that still
// exists, and the next backup (even of a value already backed up) retries the delete.
function retireOldBackups(storage, backups) {
  const extra = backups.length - BACKUP_LIMIT;
  if (extra <= 0) return;
  const notRemoved = [];
  for (const entry of backups.slice(0, extra)) {
    if (!stillOurs(storage, entry)) continue;
    try {
      storage.removeItem(entry.key);
    } catch {
      notRemoved.push(entry);
    }
  }
  storage.setItem(BACKUP_LIST_KEY, JSON.stringify([...notRemoved, ...backups.slice(extra)]));
}

function backupRaw(storage, raw) {
  const backups = readBackupList(storage);
  if (backups.some(entry => entry.value === raw)) {
    retireOldBackups(storage, backups);
    return;
  }
  // Never overwrite an existing key: it may be a backup from a lost list, or the player's copy.
  let key = BACKUP_KEY;
  for (let number = 2; storage.getItem(key) !== null; number++) key = `${BACKUP_KEY}-${number}`;
  const previous = JSON.stringify(backups);
  backups.push({key, value: raw});
  // The list is written first, so a backup never exists without being listed. If the backup write
  // then fails, the old list goes back.
  storage.setItem(BACKUP_LIST_KEY, JSON.stringify(backups));
  try {
    storage.setItem(key, raw);
  } catch (error) {
    storage.setItem(BACKUP_LIST_KEY, previous);
    throw error;
  }
  retireOldBackups(storage, backups);
}

function mergeRecords(current, stored, choose) {
  const merged = {...stored};
  for (const [key, value] of Object.entries(current)) {
    merged[key] = key in merged ? choose(value, merged[key]) : value;
  }
  return merged;
}

export function saveProfile(storage, profile, notify = () => {}) {
  const {profile: clean} = validateProfile(profile);
  const baseline = settingsBaseline.get(profile);
  try {
    const raw = storage.getItem(STORAGE_KEY);
    let stored = emptyProfile();
    if (raw !== null) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      const validated = validateProfile(parsed);
      if (validated.changed) backupRaw(storage, raw);
      stored = validated.profile;
    }
    const merged = {
      ...clean,
      stars: mergeRecords(clean.stars, stored.stars, Math.max),
      bestPieces: mergeRecords(clean.bestPieces, stored.bestPieces, Math.min),
      bonusReached: {...stored.bonusReached, ...clean.bonusReached},
      rushBest: Math.max(clean.rushBest, stored.rushBest)
    };
    // A progress save should keep settings changed by another tab since this profile was loaded.
    for (const setting of ['muteMusic', 'muteSfx', 'volume']) {
      if (baseline && clean[setting] === baseline[setting]) merged[setting] = stored[setting];
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(merged));
    Object.assign(profile, merged);
    rememberSettings(profile);
    return true;
  } catch {
    notify('Progress could not be saved. Storage may be full or disabled.');
    return false;
  }
}

export function importTimelineProgress(storage, profile, notify = () => {}) {
  let raw;
  try {
    raw = storage.getItem(LEGACY_TIMELINE_KEY);
  } catch {
    return false;
  }
  const completed = Number(raw);
  if (raw === null || !Number.isInteger(completed) || completed < 1 || completed > 6)
    return false;
  let changed = false;
  for (let index = 1; index <= completed; index++) {
    const id = `t${index}`;
    if ((profile.stars[id] ?? 0) > 0) continue;
    profile.stars[id] = 1;
    changed = true;
  }
  if (changed) saveProfile(storage, profile, notify);
  return changed;
}
