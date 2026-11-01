import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const recoveryMarker = 'needs-recovery';

async function fileHash(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

// Keep old icons until every new image is rendered and checked. On replacement failure, attempt
// to restore moved icons. If restoration fails, retain the backup for recovery on the next run.
export async function replaceIconSet(staging, destination, names, move = rename) {
  const backup = path.join(staging, 'backup');
  await mkdir(backup);
  const marker = path.join(staging, recoveryMarker);
  const expected = {};
  for (const name of names) expected[name] = await fileHash(path.join(staging, name));
  await writeFile(marker, JSON.stringify(expected));
  const movedOld = [];
  try {
    for (const name of names) {
      await move(path.join(destination, name), path.join(backup, name));
      movedOld.push(name);
      await move(path.join(staging, name), path.join(destination, name));
    }
  } catch (error) {
    const failedRestores = [];
    for (const name of movedOld.reverse()) {
      try {
        await move(path.join(backup, name), path.join(destination, name));
      } catch (restoreError) {
        failedRestores.push(`${name}: ${restoreError.message}`);
      }
    }
    if (failedRestores.length) {
      const failure = new Error(`${error.message}; icon backup remains in ${staging}; restore failed: ${failedRestores.join(', ')}`);
      failure.recoveryStaging = staging;
      throw failure;
    }
    await rm(marker, { force: true });
    throw error;
  }
  try {
    await rm(marker);
  } catch (error) {
    error.recoveryStaging = staging;
    throw error;
  }
}

export async function createIconStaging(root) {
  const scratch = path.join(root, '.scratch');
  await mkdir(scratch, { recursive: true });
  for (const entry of await readdir(scratch, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('icons-')) continue;
    const staging = path.join(scratch, entry.name);
    const marker = path.join(staging, recoveryMarker);
    try {
      await access(marker);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const backup = path.join(staging, 'backup');
    let names;
    try { names = await readdir(backup); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    let expected;
    try { expected = JSON.parse(await readFile(marker, 'utf8')); } catch { expected = null; }
    const entries = expected && typeof expected === 'object' ? Object.entries(expected) : [];
    const complete = entries.length > 0 && await Promise.all(entries.map(async ([name, hash]) => {
      try { return await fileHash(path.join(root, 'icons', name)) === hash; } catch { return false; }
    })).then(matches => matches.every(Boolean));
    if (!complete) {
      for (const name of names) {
        await rename(path.join(backup, name), path.join(root, 'icons', name));
      }
    }
    await rm(staging, { recursive: true });
  }
  return mkdtemp(path.join(scratch, 'icons-'));
}
