// The browser check and screenshot list must use the same viewport source.
export const touchSizes = [
  [390, 844], [402, 874], [402, 760], [440, 956], [360, 640], [844, 390],
  [820, 1180], [1024, 1366], [1180, 820], [1366, 1024]
];

export const screenshotNames = {
  title: ['title-1280x800', 'select-1280x800', 'help-1280x800'],
  input: [],
  campaign: ['win-1280x800'],
  void: ['void-failure', 'dark-target-failure'],
  blocks: ['block-hits-1280x800', 'block-hits-1280x500', 'block-hits-667x375'],
  rush: ['rush-win'],
  sizes: [
    'game-1280x800', 'game-1100x750', 'game-900x600', 'win-390x844',
    'rush-result-390x844', 'rush-result-844x390',
    ...touchSizes.flatMap(([width, height]) =>
      ['title', 'select', 'help', 'game', 'rush-game', 'result']
          .map(screen => `${screen}-${width}x${height}`))
  ],
  resize: ['resize-390x844'],
  storage: ['storage-failure'],
  'storage-access': [],
  audio: [],
  memory: [],
  touch: ['touch-win-390x844', 'touch-win-1024x1366']
};

export function screenshotsFor(scenarios) {
  return [...new Set(scenarios.flatMap(name => screenshotNames[name]))];
}
import {readdir, rename} from 'node:fs/promises';
import {join} from 'node:path';


export async function publishScreenshots(scenario, staging, shots) {
  const names = screenshotsFor([scenario]);
  const staged = new Set(await readdir(staging));
  for (const name of names) {
    if (!staged.has(`${name}.png`)) throw new Error(`Missing screenshot: ${name}`);
  }
  for (const name of names)
    await rename(join(staging, `${name}.png`), join(shots, `${name}.png`));
}
