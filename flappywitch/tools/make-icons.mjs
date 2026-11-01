// Renders the app icons: the pumpkin emoji (vendor/emoji/emoji_u1f383.svg, from Google's Noto
// Emoji, Apache License 2.0) on the game's dark purple colour, with headless Chromium
// (tools/chromium.mjs, no package from npm). Run it after changing the picture, then
// `node tools/stamp-sw.mjs`, because the icons are among the files the service worker stores:
//
//   node tools/make-icons.mjs
//
// CHROME_PATH names the browser (default /usr/bin/chromium-browser).
import { readFileSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './chromium.mjs';
import { createIconStaging, replaceIconSet } from './icon-files.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMOJI = path.join(ROOT, 'vendor/emoji/emoji_u1f383.svg');
const BACKGROUND = '#1d162e';
// The emoji fills the middle 72 percent: inside the middle 80 percent that a maskable icon must
// keep its picture in, so one picture serves every icon.
const EMOJI_SHARE = 0.72;
const OUTPUTS = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
];

// Shown as an <img>, so the SVG's own scripts (it has none) could not run either.
const emojiUrl = `data:image/svg+xml;base64,${readFileSync(EMOJI).toString('base64')}`;
export async function makeIcons({ root = ROOT, launchBrowser = launch, move = rename } = {}) {
  const staging = await createIconStaging(root);
  let browser;
  let keepStaging = false;
  let pendingError;
  try {
    browser = await launchBrowser({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    for (const [name, size] of OUTPUTS) {
      const emojiSize = Math.round(size * EMOJI_SHARE);
      const margin = (size - emojiSize) / 2;
      const html = `<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:${BACKGROUND}}img{position:absolute;left:${margin}px;top:${margin}px;width:${emojiSize}px;height:${emojiSize}px}</style><img src="${emojiUrl}">`;
      await page.setViewport({ width: size, height: size });
      await page.goto(`data:text/html;base64,${Buffer.from(html).toString('base64')}`, { waitUntil: 'load' });
      const output = path.join(staging, name);
      await page.screenshot({ path: output });
      const bytes = readFileSync(output);
      if (bytes.subarray(1, 4).toString('latin1') !== 'PNG' || bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size) {
        throw new Error(`Invalid icon: ${name}`);
      }
      console.log(`icons/${name} ${size}x${size}`);
    }
    await replaceIconSet(staging, path.join(root, 'icons'), OUTPUTS.map(([name]) => name), move);
  } catch (error) {
    pendingError = error;
    keepStaging = error.recoveryStaging === staging;
    throw error;
  } finally {
    try {
      if (browser) await browser.close();
    } catch (error) {
      if (pendingError) pendingError.cause = error;
      else throw error;
    } finally {
      if (!keepStaging) await rm(staging, { recursive: true, force: true });
    }
  }
}

const runAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (runAsScript) await makeIcons();
