import puppeteer from 'puppeteer-core';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium-browser',
  headless: 'new',
  args: [
    '--no-sandbox', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog',
    '--allow-file-access-from-files'
  ]
});
try {
  const page = await browser.newPage();
  page.on('console', message => console.log(`console ${message.type()}: ${message.text()}`));
  page.on('pageerror', error => console.log(`pageerror: ${error.stack}`));
  await page.setViewport({width: 1280, height: 800});
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => window.game, {timeout: 30000});
  await page.screenshot({path: 'shots/file-title.png'});
  await page.evaluate(() => game.loadLevel('b5'));
  await page.screenshot({path: 'shots/file-game.png'});
  await page.setViewport({width: 390, height: 844});
  await page.screenshot({path: 'shots/file-phone.png'});
  console.log(await page.evaluate(() => ({screen: game.state.screen, memory: game.memory})));
} finally {
  await browser.close();
}
