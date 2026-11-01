import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

export async function createMutationScratch(root) {
  const parent = path.join(root, '.scratch');
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, 'mutation-'));
}
