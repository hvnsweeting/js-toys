// Renders the app icons: the pumpkin emoji (vendor/emoji/emoji_u1f383.svg, from Google's Noto
// Emoji, Apache License 2.0) on the game's cream paper colour, with headless Chromium
// (tools/chromium.mjs, no package from npm). Run it after changing the picture, then
// `node tools/stamp-sw.mjs`, because the icons are among the files the service worker stores:
//
//   node tools/make-icons.mjs
//
// CHROME_PATH names the browser (default /usr/bin/chromium-browser).
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './chromium.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMOJI = path.join(ROOT, 'vendor/emoji/emoji_u1f383.svg');
const BACKGROUND = '#fbf7ec';
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
const browser = await launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
// Every PNG is rendered into a new folder of this run's own before any final file is replaced, so
// a failed render leaves the old set whole. The renames that follow are one at a time: a failure
// part way through them (a full disk, say) can still leave a mix. The folder goes either way.
const rendered = mkdtempSync(path.join(ROOT, 'icons', '.render-'));
try {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  for (const [name, size] of OUTPUTS) {
    const emojiSize = Math.round(size * EMOJI_SHARE);
    const margin = (size - emojiSize) / 2;
    const html = `<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:${BACKGROUND}}img{position:absolute;left:${margin}px;top:${margin}px;width:${emojiSize}px;height:${emojiSize}px}</style><img src="${emojiUrl}">`;
    await page.setViewport({ width: size, height: size });
    await page.goto(`data:text/html;base64,${Buffer.from(html).toString('base64')}`, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(rendered, name) });
  }
  for (const [name, size] of OUTPUTS) {
    renameSync(path.join(rendered, name), path.join(ROOT, 'icons', name));
    console.log(`icons/${name} ${size}x${size}`);
  }
} finally {
  rmSync(rendered, { recursive: true, force: true });
  await browser.close();
}
