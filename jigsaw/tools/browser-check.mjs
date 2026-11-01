import { launch } from "./chromium.mjs";
import nodeAssert from "node:assert/strict";
let checks = 0;
const assert = new Proxy(nodeAssert, {
  get(target, name) {
    const value = target[name];
    if (typeof value !== "function") return value;
    return (...args) => {
      checks++;
      return value(...args);
    };
  },
});
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
const url = new URL(process.env.BASE_URL || "http://127.0.0.1:8097/jigsaw/");
url.searchParams.set("seed", "173");
const origin = url.origin;
const section = process.env.BROWSER_CHECK_SECTION || 'all';
if (!['all', 'viewports', 'scenarios', 'integration', 'offline', 'regressions'].includes(section))
  throw Error(`Unknown browser check section: ${section}`);
const sizes = [
  { name: "phone-portrait", width: 390, height: 844, touch: true },
  { name: "small-phone", width: 360, height: 640, touch: true },
  { name: "phone-landscape", width: 844, height: 390, touch: true },
  { name: "ipad-portrait", width: 820, height: 1180, touch: true },
  { name: "large-ipad-portrait", width: 1024, height: 1366, touch: true },
  { name: "ipad-landscape", width: 1180, height: 820, touch: true },
  { name: "large-ipad-landscape", width: 1366, height: 1024, touch: true },
  { name: "desktop", width: 1280, height: 800, touch: false },
];
const shots = path.resolve("shots"),
  scratch = path.resolve(".scratch");
await mkdir(shots, { recursive: true });
await mkdir(scratch, { recursive: true });
await promisify(execFile)("python3", ["tools/make_orientation_fixtures.py", scratch]);
const photoPaths = [];
for (const shape of ["portrait", "landscape"]) {
  const width = shape === "portrait" ? 300 : 500,
    height = shape === "portrait" ? 500 : 300;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="50%" height="100%" fill="#ff0000"/>
      <rect x="50%" width="50%" height="100%" fill="#0000ff"/>
      <circle cx="${width / 2}" cy="${height / 2}" r="40" fill="#00ff00"/>
    </svg>
  `;
  const file = path.join(scratch, `check-${shape}.svg`);
  await writeFile(file, svg);
  photoPaths.push(file);
}
const largePhotoPath = path.join(scratch, "check-large.png");
const largePhoto = Buffer.alloc(24);
largePhoto.writeUInt32BE(0x89504e47, 0);
largePhoto.writeUInt32BE(10000, 16);
largePhoto.writeUInt32BE(8000, 20);
await writeFile(largePhotoPath, largePhoto);
const largeWebpPath = path.join(scratch, "check-large.webp");
const largeWebp = Buffer.alloc(30);
largeWebp.write("RIFF", 0);
largeWebp.write("WEBPVP8X", 8);
largeWebp[24] = 0x0f;
largeWebp[25] = 0x27;
largeWebp[27] = 0x3f;
largeWebp[28] = 0x1f;
await writeFile(largeWebpPath, largeWebp);
const lateJpegPath = path.join(scratch, "check-late-frame.jpg");
const metadata = Buffer.alloc(65537);
metadata[0] = 0xff;
metadata[1] = 0xe1;
metadata.writeUInt16BE(65535, 2);
const frame = Buffer.alloc(19);
frame[0] = 0xff;
frame[1] = 0xc0;
frame.writeUInt16BE(17, 2);
frame.writeUInt16BE(4000, 5);
frame.writeUInt16BE(5000, 7);
await writeFile(lateJpegPath, Buffer.concat([Buffer.from([0xff, 0xd8]),
  ...Array(17).fill(metadata), frame]));
const viewBoxPhotoPath = path.join(scratch, "check-viewbox.svg");
await writeFile(viewBoxPhotoPath,
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">' +
  '<rect width="300" height="200" fill="blue"/></svg>');
process.env.TMPDIR = scratch;
const browser = await launch({
  executablePath: "/usr/bin/chromium-browser",
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=gl-egl",
    "--ignore-gpu-blocklist",
    "--disable-gpu-watchdog",
  ],
});
let screenshots = 0;
async function makePage(size, inject = null, ...injectArgs) {
  const pageUrl = size.url || url.href;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({
    width: size.width,
    height: size.height,
    hasTouch: size.touch,
    isMobile: size.touch,
  });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const target = new URL(request.url());
    if (!["http:", "https:"].includes(target.protocol)) return;
    if (request.method() !== "GET")
      errors.push(`Unexpected request method: ${request.method()}`);
    if (target.host !== new URL(pageUrl).host)
      errors.push(`External request: ${target.href}`);
  });
  if (inject) await page.evaluateOnNewDocument(inject, ...injectArgs);
  await page.goto(pageUrl, { waitUntil: "networkidle0" });
  await page.waitForFunction(
    () =>
      window.jigsaw && document.querySelectorAll(".picture-tile").length === 21,
  );
  // Each scenario owns one page and one context. Releasing the context also removes its storage.
  page.close = async () => {
    await context.close();
    const { browserContextIds } = await browser.connection.send('Target.getBrowserContexts');
    assert.ok(!browserContextIds.includes(context.id), 'browser context was not removed');
  };
  return { page, errors };
}
async function checkErrors(errors) {
  assert.deepEqual(errors, []);
}
async function loosePiecesHalfVisible(page) {
  return page.evaluate(() => {
    return jigsaw.state.pieces.filter((piece) => !piece.locked)
      .every((piece) => jigsaw.debug.visibleFraction(piece.id) >= 0.5);
  });
}
function installPhotoDatabaseFailure(kind) {
  window.__photoDatabaseClosed = 0;
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const db = {
          objectStoreNames: { contains: () => true },
          close() { window.__photoDatabaseClosed++; },
          transaction() {
            const item = {};
            const transaction = {
              objectStore: () => ({
                put: () => item,
                get: () => item,
              }),
            };
            setTimeout(() => {
              if (kind === "abort") transaction.onabort?.();
              else item.onerror?.();
            }, 0);
            return transaction;
          },
        };
        const request = { result: db };
        setTimeout(() => {
          if (kind === "blocked") request.onblocked?.();
          else if (kind === "open-error") request.onerror?.();
          else request.onsuccess?.();
        }, 0);
        return request;
      },
    },
  });
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  screenshots++;
}
async function controls(page, selector, expected, required = []) {
  const result = await page.evaluate((selector) => {
    const controls = [...document.querySelectorAll(selector)].filter((node) => {
      const style = getComputedStyle(node);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        node.getClientRects().length > 0
      );
    });
    const initial = controls.map((node) => {
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const inside = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
      const hit = inside ? document.elementFromPoint(x, y) : null;
      const pictureTile = node.matches("#chooser .picture-tile");
      let scrollReason = null;
      if (pictureTile && !inside)
        scrollReason = "picture tile below the scrollable chooser viewport";
      const grid = pictureTile ? node.closest(".picture-grid").getBoundingClientRect() : null;
      if (pictureTile && (y < grid.top || y >= grid.bottom))
        scrollReason = "picture tile clipped by the scrollable chooser grid";
      if (pictureTile && hit?.closest(".chooser-footer"))
        scrollReason = "picture tile covered by the chooser footer";
      return {
        scrollReason,
        width: rect.width,
        height: rect.height,
        horizontal: rect.left >= 0 && rect.right <= innerWidth,
        inside,
        hit: hit === node || node.contains(hit),
        blocker: hit?.outerHTML.slice(0, 160) || "none",
        labelInside: !node.matches('.toolbar .tool') || (() => {
          const label = node.querySelector('small').getBoundingClientRect();
          return label.left >= 0 && label.right <= innerWidth &&
            label.top >= 0 && label.bottom <= innerHeight;
        })(),
        labelBottom: node.matches('.toolbar .tool') ?
          node.querySelector('small').getBoundingClientRect().bottom : null,
        viewportHeight: innerHeight,
      };
    });
    return controls.map((node, index) => {
      node.scrollIntoView({ block: "center", inline: "center" });
      const rect = node.getBoundingClientRect(),
        x = rect.left + rect.width / 2,
        y = rect.top + rect.height / 2,
        hit = document.elementFromPoint(x, y);
      return {
        label: node.id || node.dataset.count || node.textContent.trim().slice(0, 20),
        width: rect.width,
        height: rect.height,
        initial: initial[index],
        inside: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight,
        hit: hit === node || node.contains(hit),
      };
    });
  }, selector);
  assert.equal(result.length, expected,
    `${selector} control count: ${result.map((item) => item.label).join(', ')}`);
  for (const label of required) {
    const control = result.find((item) => item.label === label);
    assert.ok(control, `${label} missing from ${selector}`);
    assert.ok(control.inside, `${label} outside viewport`);
    assert.ok(control.hit, `${label} blocked`);
  }
  const scrollExceptions = result.filter((item) => item.initial.scrollReason)
    .map((item) => `${item.label}: ${item.initial.scrollReason}`);
  if (scrollExceptions.length)
    console.log(`Initial offscreen chooser tiles: ${scrollExceptions.length}`);
  for (const item of result) {
    assert.ok(item.initial.width > 0 && item.initial.height > 0,
      `${item.label} missing before scrolling`);
    assert.ok(item.initial.horizontal, `${item.label} outside horizontal viewport`);
    assert.ok(item.initial.labelInside,
      `${item.label} label bottom ${item.initial.labelBottom} exceeds viewport ${item.initial.viewportHeight}`);
    if (!item.initial.scrollReason) {
      assert.ok(item.initial.inside, `${item.label} not initially on screen`);
      assert.ok(item.initial.hit,
        `${item.label} initially blocked by ${item.initial.blocker}`);
    }
    assert.ok(item.inside, `${item.label} outside viewport`);
    assert.ok(item.hit, `${item.label} blocked`);
    if (
      await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)
    ) {
      assert.ok(
        item.width >= 44 && item.height >= 44,
        `${item.label} below touch target size: ${item.width}x${item.height}`,
      );
    }
  }
}
async function musicButton(page, id) {
  const result = await page.$eval(`#${id}`, (node) => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2,
      box.top + box.height / 2);
    return { width: box.width, height: box.height,
      inside: box.left >= 0 && box.right <= innerWidth && box.top >= 0 &&
        box.bottom <= innerHeight, hit: node === hit || node.contains(hit),
      label: node.querySelector('small').textContent,
      name: node.getAttribute('aria-label') };
  });
  assert.equal(result.label, 'Music');
  assert.ok(result.inside && result.hit, `${id} outside or covered`);
  assert.ok(result.width >= 44 && result.height >= 44, `${id} too small`);
  assert.ok(['Mute music', 'Unmute music'].includes(result.name));
}
async function toggleMusic(page, id) {
  const before = await page.$eval(`#${id}`, (node) => node.getAttribute('aria-label'));
  await page.locator(`#${id}`).click();
  const after = await page.$eval(`#${id}`, (node) => ({
    name: node.getAttribute('aria-label'),
    focused: document.activeElement === node,
  }));
  assert.notEqual(after.name, before, `${id} did not toggle music`);
  assert.ok(after.focused, `${id} lost keyboard focus`);
  await page.locator(`#${id}`).click();
  assert.equal(await page.$eval(`#${id}`, (node) =>
    node.getAttribute('aria-label')), before);
}
async function tapSelector(page, selector) {
  const point = await page.evaluate((value) => {
    const element = document.querySelector(value);
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, clear: hit === element || element.contains(hit) };
  }, selector);
  assert.ok(point?.clear, `${selector} is not reachable by touch`);
  await page.touchscreen.tap(point.x, point.y);
}
async function start(page, count = 32, picture = "great-wave", touch = false) {
  const countSelector = `#chooser [data-count="${count}"]`;
  const pictureSelector = `[data-picture="${picture}"]`;
  if (touch) {
    await tapSelector(page, countSelector);
    await tapSelector(page, pictureSelector);
  } else {
    await page.locator(countSelector).click();
    await page.locator(pictureSelector).click();
  }
  try {
    await page.waitForFunction(
      (expected) =>
        window.jigsaw.state?.screen === "play" &&
        window.jigsaw.state.count === expected,
      { timeout: 30000 },
      count,
    );
  } catch (error) {
    const detail = await page.evaluate(() => ({
      screen: jigsaw.state?.screen,
      picture: jigsaw.state?.pictureId,
      count: jigsaw.state?.count,
      message: document.querySelector('#chooser-message').textContent,
      dialog: document.querySelector('#replace-dialog').open,
    }));
    throw new Error(`start ${picture} at ${count}: ${JSON.stringify(detail)}`, { cause: error });
  }
  await page.waitForFunction(() => document.querySelector("#table").width > 0, {
    timeout: 30000,
  });
  await page.waitForFunction(() => Boolean(jigsaw.debug.pick(0)), { timeout: 30000 });
}
async function drag(page, from, to, touch) {
  if (touch) {
    await page.touchscreen.touchStart(from.x, from.y);
    await page.touchscreen.touchMove(to.x, to.y);
    await page.touchscreen.touchEnd();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
  }
}
async function place(page, id, touch) {
  let locked = false;
  for (let attempt = 0; attempt < 3 && !locked; attempt++) {
    const pair = await page.evaluate((id) => jigsaw.debug.pick(id), id);
    assert.ok(pair, `piece ${id} has no visible grab point`);
    await drag(page, pair.current, pair.correct, touch);
    locked = await page.evaluate(
      (id) => jigsaw.state.pieces.find((piece) => piece.id === id).locked,
      id,
    );
  }
  assert.ok(locked, `piece ${id} did not lock after three drags`);
}
async function photoScenario(page, file, name) {
  await page.locator("#play-back").click();
  await page.waitForFunction(() => jigsaw.state?.screen === "chooser");
  const input = await page.$("#photo-input");
  await input.uploadFile(file);
  await page.waitForSelector("#crop-screen:not(.hidden)");
  await shot(page, `${name}-crop`);
  await controls(page, "#crop-screen button, #crop-screen input:not([hidden])", 7,
    ["crop-back", "crop-start"]);
  await musicButton(page, 'crop-music');
  await toggleMusic(page, 'crop-music');
  await page.$eval("#crop-zoom", (input) => {
    input.value = "1.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const before = await page.evaluate(
    () => document.querySelector("#crop-canvas")._frame.crop.x,
  );
  const box = await page.$eval("#crop-canvas", (canvas) => {
    const r = canvas.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await drag(page, { x: box.x, y: box.y }, { x: box.x - 45, y: box.y }, true);
  const after = await page.evaluate(
    () => document.querySelector("#crop-canvas")._frame.crop.x,
  );
  assert.notEqual(after, before, "crop did not move");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#crop-start").click();
  await page.waitForFunction(
    () => jigsaw.state?.screen === "play" && jigsaw.state.pictureId === "photo",
  );
  assert.ok(
    await page.evaluate(
      () => jigsaw.state.crop.x === 0 && jigsaw.state.crop.width > 0,
    ),
  );
  const sourceSize = await page.evaluate(() => ({
    width: jigsaw.debug.image.naturalWidth || jigsaw.debug.image.width,
    height: jigsaw.debug.image.naturalHeight || jigsaw.debug.image.height,
  }));
  assert.ok(sourceSize.width > 0 && sourceSize.height > 0);
  const cropPixel = await page.evaluate(() => {
    const img = jigsaw.debug.image,
      canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return [
      ...ctx.getImageData(
        Math.floor(canvas.width * 0.45),
        Math.floor(canvas.height * 0.1),
        1,
        1,
      ).data,
    ];
  });
  assert.ok(
    cropPixel[2] > cropPixel[0],
    `crop did not select the moved photo region: ${cropPixel}`,
  );
}
try {
  if (['all', 'integration', 'regressions'].includes(section)) {
    const samePainting = await makePage(sizes[7]);
    try {
      await start(samePainting.page);
      await place(samePainting.page, 0, false);
      await samePainting.page.locator('#play-back').click();
      const saved = await samePainting.page.evaluate(() =>
        JSON.parse(localStorage.getItem('jigsaw.v1')).game);
      assert.ok(saved.pieces.find((piece) => piece.id === 0).locked);
      await samePainting.page.locator('[data-picture="great-wave"]').click();
      await samePainting.page.waitForFunction(() => jigsaw.state?.screen === 'play');
      assert.equal(await samePainting.page.$eval('#replace-dialog', (node) => node.open), false);
      assert.deepEqual(await samePainting.page.evaluate(() => jigsaw.state.pieces
        .map(({ id, x, y, group, locked }) => ({ id, x, y, group, locked }))), saved.pieces,
      'choosing the same painting and count did not resume progress');
      await samePainting.page.locator('#play-back').click();
      await samePainting.page.locator('#chooser [data-count="64"]').click();
      await samePainting.page.locator('[data-picture="great-wave"]').click();
      await samePainting.page.waitForFunction(() =>
        document.querySelector('#replace-dialog').open);
      assert.equal(await samePainting.page.$eval('#replace-dialog p', (node) => node.textContent),
        'Start a new puzzle? Your unfinished one will be replaced.');
      assert.equal(await samePainting.page.evaluate(() => jigsaw.storage.game.count), 32);
      await samePainting.page.locator('#replace-cancel').click();
      assert.equal(await samePainting.page.evaluate(() => jigsaw.storage.game.count), 32);
      await samePainting.page.locator('[data-picture="great-wave"]').click();
      await samePainting.page.waitForFunction(() => document.querySelector('#replace-dialog').open);
      await samePainting.page.locator('#replace-start').click();
      await samePainting.page.waitForFunction(() => jigsaw.state?.count === 64 &&
        jigsaw.state.screen === 'play');
      await checkErrors(samePainting.errors);
    } finally {
      await samePainting.page.close();
    }

    const zoomPage = await makePage(sizes[1]);
    try {
      await start(zoomPage.page, 128);
      await zoomPage.page.locator('#fit-button').click();
      const fittedScale = await zoomPage.page.evaluate(() => jigsaw.state.view.scale);
      await zoomPage.page.locator('#zoom-out').click();
      const zoomedScale = await zoomPage.page.evaluate(() => jigsaw.state.view.scale);
      assert.ok(zoomedScale <= fittedScale + 0.000001,
        `Zoom out increased scale after Fit: ${fittedScale} to ${zoomedScale}`);
      await checkErrors(zoomPage.errors);
    } finally {
      await zoomPage.page.close();
    }

    const peekPage = await makePage(sizes[7]);
    try {
      await start(peekPage.page);
      const button = await peekPage.page.$eval('#peek-button', (node) => {
        const box = node.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });
      await peekPage.page.mouse.move(button.x, button.y);
      await peekPage.page.mouse.down();
      assert.ok(await peekPage.page.$eval('#peek-overlay', (node) =>
        !node.classList.contains('hidden')));
      await peekPage.page.mouse.move(20, 20);
      await peekPage.page.mouse.up();
      await peekPage.page.waitForFunction(() =>
        document.querySelector('#peek-overlay').classList.contains('hidden'),
      { timeout: 4000 });
      await peekPage.page.evaluate(() => {
        document.querySelector('#peek-button').dispatchEvent(new PointerEvent('pointerdown'));
        window.dispatchEvent(new Event('blur'));
      });
      assert.ok(await peekPage.page.$eval('#peek-overlay', (node) =>
        node.classList.contains('hidden')), 'Peek stayed visible after blur');
      await checkErrors(peekPage.errors);
    } finally {
      await peekPage.page.close();
    }

    for (const value of [null, 17, 'text', []]) {
      const storagePage = await makePage(sizes[7], (storedValue) =>
        localStorage.setItem('jigsaw.v1', JSON.stringify(storedValue)), value);
      try {
        await start(storagePage.page);
        assert.equal(await storagePage.page.evaluate(() =>
          JSON.parse(localStorage.getItem('jigsaw.v1')).game.pictureId), 'great-wave',
        `saving failed after loading ${JSON.stringify(value)}`);
        await checkErrors(storagePage.errors);
      } finally {
        await storagePage.page.close();
      }
    }
    console.log('round 13 regressions: pass');
  }
  const arcade = await fetch(new URL('../', url)),
    arcadeHtml = await arcade.text();
  assert.equal(arcade.status, 200);
  assert.ok(
    arcadeHtml.includes("card-jigsaw") &&
      arcadeHtml.includes("./jigsaw/index.html"),
  );
  if (section === 'all' || section === 'viewports') {
    const croppedPeek = await makePage(sizes[7]);
    try {
      await start(croppedPeek.page, 32, 'sunflowers');
      const pixels = await croppedPeek.page.evaluate(async () => {
        const crop = jigsaw.state.crop;
        const manifest = await (await fetch('pictures/manifest.json')).json();
        const source = new Image();
        source.src = manifest.find((item) => item.id === 'sunflowers').file;
        await source.decode();
        const peek = document.querySelector('#peek-image');
        await peek.decode();
        const surface = (picture, cropped) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 64;
          const context = canvas.getContext('2d');
          if (cropped)
            context.drawImage(picture, crop.x, crop.y, crop.width, crop.height,
              0, 0, 64, 64);
          else context.drawImage(picture, 0, 0, 64, 64);
          return context;
        };
        const expected = surface(source, true);
        const actual = surface(peek, false);
        const original = surface(source, false);
        const difference = (left, right) => {
          let total = 0;
          for (const x of [1, 62]) for (const y of [8, 24, 40, 56]) {
            const first = left.getImageData(x, y, 1, 1).data;
            const second = right.getImageData(x, y, 1, 1).data;
            for (let channel = 0; channel < 3; channel++)
              total += Math.abs(first[channel] - second[channel]);
          }
          return total / 24;
        };
        return { crop, actualDifference: difference(expected, actual),
          originalDifference: difference(expected, original) };
      });
      assert.ok(pixels.crop.x > 0 || pixels.crop.y > 0,
        'Sunflowers did not require cropping');
      assert.ok(pixels.originalDifference > 4,
        `crop fixture does not distinguish the original: ${JSON.stringify(pixels)}`);
      assert.ok(pixels.actualDifference < pixels.originalDifference / 2,
        `Peek edges differ from the puzzle crop: ${JSON.stringify(pixels)}`);
      await checkErrors(croppedPeek.errors);
    } finally {
      await croppedPeek.page.close();
    }
  }
  if (section === 'all' || section === 'viewports') for (const size of sizes) {
    const { page, errors } = await makePage(size);
    try {
      await shot(page, `${size.name}-chooser`);
      assert.equal(await page.evaluate(() => jigsaw.music), null,
        'audio was created before a gesture');
      await musicButton(page, 'chooser-music');
      await toggleMusic(page, 'chooser-music');
      if (size.touch && (size.name.includes('phone') || size.name.includes('ipad'))) {
        const tileDetails = await page.evaluate(async () => {
          const pictures = await (await fetch('pictures/manifest.json')).json();
          return [...document.querySelectorAll('.picture-tile[data-picture]')]
            .filter((tile) => tile.dataset.picture !== 'photo')
            .map((tile) => {
              const item = pictures.find((picture) => picture.id === tile.dataset.picture);
              const image = tile.querySelector('img').getBoundingClientRect();
              const title = tile.querySelector('strong');
              const artist = tile.querySelector('.tile-copy span');
              const textReachable = [title, artist].every((node) => {
                node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
                const box = node.getBoundingClientRect();
                const tileBox = tile.getBoundingClientRect();
                const gridBox = document.querySelector('.picture-grid').getBoundingClientRect();
                const x = box.left + box.width / 2;
                const y = box.top + box.height / 2;
                const hit = document.elementFromPoint(x, y);
                return box.top >= gridBox.top && box.bottom <= gridBox.bottom &&
                  box.left >= tileBox.left && box.right <= tileBox.right &&
                  box.top >= tileBox.top && box.bottom <= tileBox.bottom &&
                  x >= 0 && x < innerWidth && y >= 0 && y < innerHeight &&
                  tile.contains(hit);
              });
              return {
                id: tile.dataset.picture,
                imageHeight: image.height,
                imageWidth: image.width,
                title: title.textContent,
                artist: artist.textContent,
                textVisible: getComputedStyle(title).display !== 'none' &&
                  getComputedStyle(artist).display !== 'none' &&
                  title.getBoundingClientRect().height > 0 &&
                  artist.getBoundingClientRect().height > 0,
                textReachable,
                expectedTitle: item?.title,
                expectedArtist: item?.artist,
              };
            });
        });
        assert.equal(tileDetails.length, 20);
        for (const tile of tileDetails) {
          assert.ok(tile.imageHeight >= 110 &&
            tile.imageHeight >= tile.imageWidth * 0.4,
          `${size.name} ${tile.id} image is too small: ${tile.imageWidth}x${tile.imageHeight}`);
          assert.ok(tile.textVisible, `${size.name} ${tile.id} text is hidden`);
          assert.ok(tile.textReachable, `${size.name} ${tile.id} text is clipped or covered`);
          assert.equal(tile.title, tile.expectedTitle);
          assert.equal(tile.artist, tile.expectedArtist);
        }
      }
      if (["phone-portrait", "small-phone", "ipad-portrait", "large-ipad-portrait"].includes(size.name)) {
        await page.evaluate(() => {
          document.querySelector('[data-picture="sierra-nevada"]')
            .scrollIntoView({ block: 'center', inline: 'nearest' });
        });
        // The whole page scrolls; the gallery has no scroll area of its own.
        const selectedVisible = await page.evaluate(() => {
          const tile = document.querySelector('[data-picture="sierra-nevada"]');
          const grid = document.querySelector('.picture-grid');
          const tileBox = tile.getBoundingClientRect();
          return {
            visible: tileBox.top >= 0 && tileBox.bottom <= innerHeight,
            pageScrolled: window.scrollY > 0,
            gridScrolls: grid.scrollHeight > grid.clientHeight + 1,
            tile: { top: tileBox.top, bottom: tileBox.bottom },
            viewport: innerHeight,
          };
        });
        assert.ok(selectedVisible.visible && selectedVisible.pageScrolled && !selectedVisible.gridScrolls,
          `${size.name} last tile is reached by page scroll: ${JSON.stringify(selectedVisible)}`);
        await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); });
        await shot(page, `${size.name}-chooser-bottom`);
      }
      await page.evaluate(() => document.querySelector('[data-picture="sierra-nevada"]')
        .scrollIntoView({ block: 'end', inline: 'nearest' }));
      const countReachable = await page.evaluate(() => {
        const control = document.querySelector('.chooser-count');
        const button = control.querySelector('[data-count="64"]');
        const box = button.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        return box.top >= 0 && box.bottom <= innerHeight &&
          control.contains(document.elementFromPoint(x, y));
      });
      assert.ok(countReachable, `${size.name} piece count is not reachable at the last tile`);
      // The tile checks above scroll the page; the controls check starts from the top.
      await page.evaluate(() => { window.scrollTo(0, 0); });
      await controls(page, "#chooser button:not([hidden]), #chooser a", 27,
        ["32", "64", "128"]);
      await start(page, 32, 'great-wave', size.touch);
      const heading = await page.evaluate(() => {
        const title = document.querySelector('#play-title');
        const box = title.getBoundingClientRect();
        const stage = document.querySelector('#stage').getBoundingClientRect();
        const name = title.querySelector('.heading-name');
        const artist = title.querySelector('.heading-artist');
        return {
          text: title.textContent,
          inside: box.left >= 0 && box.right <= innerWidth && box.top >= 0,
          aboveBoard: box.bottom <= stage.top,
          separate: Boolean(name && artist),
          artistSmaller: name && artist &&
            parseFloat(getComputedStyle(artist).fontSize) < parseFloat(getComputedStyle(name).fontSize),
          oneLine: getComputedStyle(title).whiteSpace === 'nowrap' &&
            getComputedStyle(title).textOverflow === 'ellipsis' &&
            getComputedStyle(title).overflow === 'hidden' &&
            title.offsetHeight <= parseFloat(getComputedStyle(title).fontSize) * 1.5,
        };
      });
      assert.equal(heading.text, 'The Great Wave, Katsushika Hokusai');
      assert.ok(heading.separate && heading.artistSmaller && heading.oneLine,
        `${size.name} play heading needs a smaller artist on one line`);
      assert.ok(heading.inside && heading.aboveBoard,
        `${size.name} title is outside the top bar or covers the board`);
      const layout = await page.evaluate(() => {
        const stage = document.querySelector("#stage").getBoundingClientRect();
        const [cols, rows] = jigsaw.state.grid;
        return {
          width: cols * jigsaw.state.view.scale,
          height: rows * jigsaw.state.view.scale,
          stageHeight: stage.height,
        };
      });
      if (size.width < size.height && size.width <= 390) {
        assert.ok(
          layout.width >= size.width * 0.85,
          `${size.name} board too narrow: ${layout.width}`,
        );
      }
      if (size.width < size.height && size.width > 390) {
        assert.ok(
          layout.width >= size.width * 0.65,
          `${size.name} board below 65% of viewport width: ${layout.width}`,
        );
      }
      if (size.width > size.height) {
        assert.ok(
          layout.height >= layout.stageHeight * 0.45,
          `${size.name} board too short: ${layout.height}`,
        );
      }
      await shot(page, `${size.name}-play`);
      assert.equal(await page.evaluate(() => jigsaw.music?.seed),
        await page.evaluate(() => jigsaw.state.seed),
        'live score seed differs from puzzle seed');
      await musicButton(page, 'play-music');
      await toggleMusic(page, 'play-music');
      await controls(
        page,
        "#play-screen .play-header button, #play-screen .toolbar button",
        10,
        ["play-back", "sound-button", "edges-button", "guide-button",
          "peek-button", "zoom-in", "zoom-out", "fit-button", "menu-button", "play-music"],
      );
      for (let id = 0; id < 32; id++) await place(page, id, size.touch);
      await page.waitForFunction(
        () =>
          jigsaw.state.screen === "done" &&
          !document.querySelector("#done-card").classList.contains("hidden"),
      );
      assert.ok(
        await page.evaluate(() =>
          Number.isFinite(jigsaw.storage.best["great-wave|32"]),
        ),
      );
      const doneLayout = await page.evaluate(() => {
        const stage = document.querySelector("#stage").getBoundingClientRect();
        const card = document
          .querySelector("#done-card")
          .getBoundingClientRect();
        const [cols, rows] = jigsaw.state.grid;
        const view = jigsaw.state.view;
        const board = {
          left: stage.left + view.x,
          top: stage.top + view.y,
          right: stage.left + view.x + cols * view.scale,
          bottom: stage.top + view.y + rows * view.scale,
        };
        const overlaps =
          board.left < card.right &&
          board.right > card.left &&
          board.top < card.bottom &&
          board.bottom > card.top;
        return { overlaps, board, card: { left: card.left, top: card.top } };
      });
      assert.equal(
        doneLayout.overlaps,
        false,
        `${size.name} card overlaps board`,
      );
      await shot(page, `${size.name}-done`);
      await musicButton(page, 'play-music');
      await toggleMusic(page, 'play-music');
      await controls(page, "#done-card button", 2, ["again-button", "done-new"]);
      const doneHeading = await page.$eval('#done-title', (node) => {
        const name = node.querySelector('.heading-name');
        const artist = node.querySelector('.heading-artist');
        return {
          text: node.textContent,
          separate: Boolean(name && artist),
          artistSmaller: name && artist &&
            parseFloat(getComputedStyle(artist).fontSize) < parseFloat(getComputedStyle(name).fontSize),
          oneLine: getComputedStyle(node).whiteSpace === 'nowrap' &&
            getComputedStyle(node).textOverflow === 'ellipsis' &&
            getComputedStyle(node).overflow === 'hidden' &&
            node.offsetHeight <= parseFloat(getComputedStyle(node).fontSize) * 1.5,
        };
      });
      assert.equal(doneHeading.text, 'The Great Wave, Katsushika Hokusai');
      assert.ok(doneHeading.separate && doneHeading.artistSmaller && doneHeading.oneLine,
        `${size.name} done heading needs a smaller artist on one line`);
      await photoScenario(
        page,
        photoPaths[
          size.name === "phone-landscape" ||
          size.name === "ipad-landscape" ||
          size.name === "large-ipad-landscape"
            ? 1
            : 0
        ],
        size.name,
      );
      await checkErrors(errors);
      console.log(`${size.name}: pass`);
    } finally {
      await page.close();
    }
  }
  if (section === 'all' || section === 'scenarios') {
  const musicSave = await makePage(sizes[0]);
  try {
    await musicSave.page.keyboard.press('Tab');
    assert.equal(await musicSave.page.evaluate(() => jigsaw.music), null,
      'Tab created audio before a game action');
    await musicSave.page.locator('#chooser-music').click();
    assert.equal(await musicSave.page.$eval('#chooser-music', (node) =>
      node.getAttribute('aria-label')), 'Unmute music');
    await musicSave.page.reload({ waitUntil: 'networkidle0' });
    await musicSave.page.waitForFunction(() => window.jigsaw);
    assert.equal(await musicSave.page.$eval('#chooser-music', (node) =>
      node.getAttribute('aria-label')), 'Unmute music');
    await musicSave.page.locator('#chooser-music').click();
    await musicSave.page.waitForFunction(() => jigsaw.music?.enabled);
    await musicSave.page.waitForFunction(() => jigsaw.music?.activeVoices > 0,
      { timeout: 15000 });
    await musicSave.page.keyboard.press('Space');
    assert.equal(await musicSave.page.evaluate(() => document.activeElement?.id),
      'chooser-music');
    await musicSave.page.waitForFunction(() => jigsaw.music?.activeVoices === 0);
    assert.equal(await musicSave.page.evaluate(() => jigsaw.music.enabled), false);
    await start(musicSave.page);
    await musicSave.page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('jigsaw.v1'));
      saved.game.pictureId = 'tiger';
      localStorage.setItem('jigsaw.v1', JSON.stringify(saved));
    });
    await musicSave.page.reload({ waitUntil: 'networkidle0' });
    await musicSave.page.waitForFunction(() => window.jigsaw);
    assert.ok(await musicSave.page.$eval('#continue-card', (node) =>
      node.classList.contains('hidden')));
    await checkErrors(musicSave.errors);
  } finally {
    await musicSave.page.close();
  }
  const rotated = await makePage(sizes[0]);
  try {
    await start(rotated.page);
    await rotated.page.setViewport({
      width: 844,
      height: 390,
      hasTouch: true,
      isMobile: true,
    });
    await rotated.page.waitForFunction(() => {
      const stage = document.querySelector("#stage");
      return (
        Math.abs(jigsaw.state.layoutWidth - stage.clientWidth) < 1 &&
        Math.abs(jigsaw.state.layoutHeight - stage.clientHeight) < 1
      );
    });
    await rotated.page.locator("#fit-button").click();
    const rotationFits = await rotated.page.evaluate(() => {
      const stage = document.querySelector("#stage");
      const [cols, rows] = jigsaw.state.grid;
      const view = jigsaw.state.view;
      const boardFits =
        view.x >= 0 &&
        view.y >= 0 &&
        view.x + cols * view.scale <= stage.clientWidth &&
        view.y + rows * view.scale <= stage.clientHeight;
      const pieceFits = jigsaw.state.pieces.every((piece) => {
        const left = view.x + piece.x * view.scale;
        const top = view.y + piece.y * view.scale;
        return (
          left >= 0 &&
          top >= 0 &&
          left + view.scale <= stage.clientWidth &&
          top + view.scale <= stage.clientHeight
        );
      });
      return boardFits && pieceFits;
    });
    assert.ok(rotationFits, "portrait to landscape rotation clipped the table");
    await checkErrors(rotated.errors);
    console.log("rotation fit: pass");
  } finally {
    await rotated.page.close();
  }
  const { page, errors } = await makePage(sizes[1]);
  try {
    await start(page, 128);
    await page.locator("#edges-button").click();
    const initialScale = await page.evaluate(() => jigsaw.state.view.scale);
    await page.locator("#zoom-in").click();
    await page.locator("#zoom-in").click();
    assert.ok(
      await page.evaluate(
        (initial) => jigsaw.state.view.scale > initial * 1.5,
        initialScale,
      ),
    );
    let placed = 0;
    for (let id = 0; id < 128 && placed < 5; id++) {
      const pair = await page.evaluate((id) => jigsaw.debug.pick(id), id);
      if (!pair) continue;
      const visible = await page.evaluate((pair) => {
        const r = document.querySelector("#table").getBoundingClientRect();
        return [pair.current, pair.correct].every(
          (p) =>
            p.x > r.left + 8 &&
            p.x < r.right - 8 &&
            p.y > r.top + 8 &&
            p.y < r.bottom - 8,
        );
      }, pair);
      if (!visible) continue;
      await drag(page, pair.current, pair.correct, true);
      if (
        await page.evaluate(
          (id) => jigsaw.state.pieces.find((p) => p.id === id).locked,
          id,
        )
      )
        placed++;
    }
    assert.ok(placed >= 5, `128 piece touch placement: ${placed}/5`);
    await shot(page, "small-phone-128-zoom");
    await page.locator("#edges-button").click();
    assert.equal(
      await page.$eval("#edges-button small", (node) => node.textContent),
      "Edges",
    );
    await page.locator("#guide-button").click();
    assert.equal(
      await page.$eval("#guide-button", (node) =>
        node.getAttribute("aria-pressed"),
      ),
      "true",
    );
    await page.locator("#sound-button").click();
    assert.equal(
      await page.$eval("#sound-button", (node) =>
        node.getAttribute("aria-label"),
      ),
      "Sound off",
    );
    await page.locator("#peek-button").click();
    assert.ok(
      await page.$eval(
        "#peek-overlay",
        (node) => !node.classList.contains("hidden"),
      ),
    );
    await page.locator("#menu-button").click();
    await controls(page, "#menu button", 2, ["shuffle-button", "new-button"]);
    const beforeShuffle = await page.evaluate(() =>
      jigsaw.state.pieces.filter((p) => !p.locked).map((p) => [p.x, p.y]),
    );
    await page.locator("#shuffle-button").click();
    const afterShuffle = await page.evaluate(() =>
      jigsaw.state.pieces.filter((p) => !p.locked).map((p) => [p.x, p.y]),
    );
    assert.notDeepEqual(afterShuffle, beforeShuffle);
    await checkErrors(errors);
  } finally {
    await page.close();
  }
  const catalog = await makePage(sizes[7]);
  try {
    catalog.page.on("dialog", (dialog) => dialog.accept());
    const pictures = await catalog.page.$$eval(
      ".picture-tile[data-picture]",
      (tiles) =>
        tiles
          .map((tile) => tile.dataset.picture)
          .filter((id) => id !== "photo"),
    );
    assert.equal(pictures.length, 20);
    const pictureManifest = await catalog.page.evaluate(async () =>
      (await (await fetch('pictures/manifest.json')).json()));
    for (const picture of pictures)
      for (const count of [32, 64, 128]) {
        await start(catalog.page, count, picture);
        assert.ok(
          await catalog.page.evaluate(
            ({ picture, count }) =>
              jigsaw.state.pictureId === picture &&
              jigsaw.state.pieces.length === count,
            { picture, count },
          ),
        );
        const item = pictureManifest.find((entry) => entry.id === picture);
        assert.equal(await catalog.page.$eval('#play-title', (node) => node.textContent),
          `${item.title}, ${item.artist}`);
        await catalog.page.locator("#play-back").click();
        await catalog.page.waitForFunction(
          () => jigsaw.state.screen === "chooser",
        );
      }
    for (const file of photoPaths)
      for (const count of [32, 64, 128]) {
        const input = await catalog.page.$("#photo-input");
        await input.uploadFile(file);
        await catalog.page.waitForSelector("#crop-screen:not(.hidden)");
        await catalog.page
          .locator(`#crop-screen [data-count="${count}"]`)
          .click();
        await catalog.page.$eval("#crop-zoom", (input) => {
          input.value = "1.5";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const crop = await catalog.page.evaluate(
          () => document.querySelector("#crop-canvas")._frame.crop,
        );
        assert.ok(crop.width > 0 && crop.height > 0);
        await catalog.page.locator("#crop-start").click();
        await catalog.page.waitForFunction(
          (count) =>
            jigsaw.state?.screen === "play" && jigsaw.state.count === count,
          { timeout: 30000 },
          count,
        );
        assert.equal(
          await catalog.page.evaluate(() => jigsaw.state.pictureId),
          "photo",
        );
        await catalog.page.locator("#play-back").click();
        await catalog.page.waitForFunction(
          () => jigsaw.state.screen === "chooser",
        );
      }
    await checkErrors(catalog.errors);
    console.log("picture and photo combinations: pass");
  } finally {
    await catalog.page.close();
  }
  const edgePage = await makePage(sizes[7]);
  try {
    await start(edgePage.page, 128);
    const icons = await edgePage.page.evaluate(() => [
      document.querySelector("#edges-button svg").innerHTML,
      document.querySelector("#guide-button svg").innerHTML,
    ]);
    assert.notEqual(icons[0], icons[1], "Edges and Guide need distinct icons");
    let interiorBeforeRest;
    for (const [action, name] of [
      [1, "desktop-edges"],
      [2, "desktop-rest"],
    ]) {
      await edgePage.page.locator("#edges-button").click();
      if (action === 1) {
        assert.equal(await edgePage.page.$eval('#edges-button small',
          (node) => node.textContent), 'Rest');
        await edgePage.page.reload({ waitUntil: 'networkidle0' });
        await edgePage.page.waitForFunction(() => window.jigsaw &&
          !document.querySelector('#continue-card').classList.contains('hidden'));
        await edgePage.page.locator('#continue-button').click();
        await edgePage.page.waitForFunction(() => jigsaw.state?.screen === 'play');
        assert.equal(await edgePage.page.$eval('#edges-button small',
          (node) => node.textContent), 'Rest', 'reload reset the helper phase');
        interiorBeforeRest = await edgePage.page.evaluate(() => {
          const [cols, rows] = jigsaw.state.grid;
          return jigsaw.state.pieces.filter((piece) => {
            const x = piece.id % cols, y = Math.floor(piece.id / cols);
            return x > 0 && y > 0 && x < cols - 1 && y < rows - 1;
          }).map((piece) => [piece.id, piece.x, piece.y]);
        });
      } else {
        const interiorAfterRest = await edgePage.page.evaluate(() => {
          const [cols, rows] = jigsaw.state.grid;
          return jigsaw.state.pieces.filter((piece) => {
            const x = piece.id % cols, y = Math.floor(piece.id / cols);
            return x > 0 && y > 0 && x < cols - 1 && y < rows - 1;
          }).map((piece) => [piece.id, piece.x, piece.y]);
        });
        assert.notDeepEqual(interiorAfterRest, interiorBeforeRest,
          'Rest did not gather interior pieces after reload');
      }
      const visibility = await edgePage.page.evaluate(() => {
        const rect = document.querySelector("#table").getBoundingClientRect(),
          scale = jigsaw.state.view.scale;
        return jigsaw.state.pieces.map((piece) => {
          const center = jigsaw.debug.piece(piece.id).current,
            margin = 0.76 * scale;
          return (
            center.x - margin >= rect.left &&
            center.x + margin <= rect.right &&
            center.y - margin >= rect.top &&
            center.y + margin <= rect.bottom
          );
        });
      });
      assert.ok(
        visibility.every(Boolean),
        `Edge action ${action} clipped a piece`,
      );
      const row = await edgePage.page.evaluate((action) => {
        const [cols, rows] = jigsaw.state.grid;
        return jigsaw.state.pieces
          .filter((piece) => {
            const x = piece.id % cols,
              y = Math.floor(piece.id / cols),
              border = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
            return action === 1 ? border : !border;
          })
          .map((piece) => piece.y);
      }, action);
      assert.ok(row.length > 0 && new Set(row.map((y) => y.toFixed(3))).size > 1,
        `Edge action ${action} did not wrap into rows`);
      await shot(edgePage.page, name);
    }
    const helperFrame = await edgePage.page.evaluate(() => ({
      bounds: { ...jigsaw.state.tableBounds }, scale: jigsaw.state.view.scale,
    }));
    for (let cycle = 1; cycle <= 5; cycle++) {
      await edgePage.page.reload({ waitUntil: "networkidle0" });
      await edgePage.page.waitForFunction(() => window.jigsaw &&
        !document.querySelector("#continue-card").classList.contains("hidden"));
      await edgePage.page.locator("#continue-button").click();
      await edgePage.page.waitForFunction(() => jigsaw.state?.screen === "play");
      await edgePage.page.locator('#edges-button').click();
      await edgePage.page.locator('#edges-button').click();
      await edgePage.page.locator('#fit-button').click();
      const frame = await edgePage.page.evaluate(() => ({
        bounds: { ...jigsaw.state.tableBounds }, scale: jigsaw.state.view.scale,
      }));
      assert.deepEqual(frame.bounds, helperFrame.bounds,
        `helper reload cycle ${cycle} changed table bounds`);
      assert.ok(Math.abs(frame.scale - helperFrame.scale) < 0.000001,
        `helper reload cycle ${cycle} changed Fit scale`);
    }
    await edgePage.page.locator('#play-back').click();
    await edgePage.page.evaluate(() => {
      const record = JSON.parse(localStorage.getItem('jigsaw.v1'));
      delete record.game.gatherRest;
      localStorage.setItem('jigsaw.v1', JSON.stringify(record));
    });
    await edgePage.page.reload({ waitUntil: 'networkidle0' });
    await edgePage.page.waitForFunction(() => window.jigsaw &&
      !document.querySelector('#continue-card').classList.contains('hidden'));
    await edgePage.page.locator('#continue-button').click();
    await edgePage.page.waitForFunction(() => jigsaw.state?.screen === 'play');
    assert.equal(await edgePage.page.$eval('#edges-button small',
      (node) => node.textContent), 'Edges', 'old save has no helper phase');
    await checkErrors(edgePage.errors);
    console.log("Edge helper layout: pass");
  } finally {
    await edgePage.page.close();
  }
  for (const size of [sizes[0], sizes[1]]) {
    const mobileEdges = await makePage(size);
    try {
      await start(mobileEdges.page, 128);
      for (let action = 1; action <= 2; action++) {
        await mobileEdges.page.locator("#edges-button").click();
        const visible = await mobileEdges.page.evaluate((action) => {
          const [cols, rows] = jigsaw.state.grid,
            rect = document.querySelector("#table").getBoundingClientRect(),
            margin = 0.76 * jigsaw.state.view.scale;
          return jigsaw.state.pieces
            .filter((piece) => {
              const x = piece.id % cols,
                y = Math.floor(piece.id / cols),
                border = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
              return action === 1 ? border : !border;
            })
            .every((piece) => {
              const point = jigsaw.debug.piece(piece.id).current;
              return (
                point.x - margin >= rect.left &&
                point.x + margin <= rect.right &&
                point.y - margin >= rect.top &&
                point.y + margin <= rect.bottom
              );
            });
        }, action);
        assert.ok(
          visible,
          `${size.name} helper action ${action} hid a selected piece`,
        );
        await shot(
          mobileEdges.page,
          `${size.name}-${action === 1 ? "edges" : "rest"}`,
        );
      }
      await checkErrors(mobileEdges.errors);
      console.log(`${size.name} Edge helper: pass`);
    } finally {
      await mobileEdges.page.close();
    }
  }
  for (const size of [sizes[1], sizes[7]]) {
    const fitted = await makePage(size);
    try {
      await start(fitted.page, 128);
      await fitted.page.locator("#edges-button").click();
      await fitted.page.locator("#fit-button").click();
      assert.ok(await loosePiecesHalfVisible(fitted.page),
        `${size.name} Fit hid a loose piece`);
      await fitted.page.reload({ waitUntil: "networkidle0" });
      await fitted.page.waitForFunction(() => window.jigsaw &&
        !document.querySelector("#continue-card").classList.contains("hidden"));
      await fitted.page.locator("#continue-button").click();
      await fitted.page.waitForFunction(() => jigsaw.state?.screen === "play");
      assert.ok(await loosePiecesHalfVisible(fitted.page),
        `${size.name} resume hid a loose piece`);
      const covered = await fitted.page.evaluate(() => {
        const lower = jigsaw.state.pieces[0];
        const upper = jigsaw.state.pieces[jigsaw.state.pieces.length - 1];
        upper.x = lower.x;
        upper.y = lower.y;
        return jigsaw.debug.visibleFraction(lower.id);
      });
      assert.ok(covered < 0.5,
        `${size.name} drawing order did not detect a covered piece: ${covered}`);
      await shot(fitted.page, `${size.name}-edges-resume`);
      await checkErrors(fitted.errors);
    } finally {
      await fitted.page.close();
    }
  }
  const discardPage = await makePage(sizes[7]);
  try {
    discardPage.page.on("dialog", (dialog) => dialog.accept());
    await start(discardPage.page);
    await discardPage.page.locator("#play-back").click();
    await discardPage.page.locator("#discard-button").click();
    await start(discardPage.page);
    const stored = await discardPage.page.evaluate(
      () => JSON.parse(localStorage.getItem("jigsaw.v1")).game,
    );
    assert.ok(
      stored && stored.pieces.length === 32,
      "new identical puzzle was not stored",
    );
    await discardPage.page.reload();
    await discardPage.page.waitForFunction(() => window.jigsaw);
    assert.ok(
      await discardPage.page.$eval(
        "#continue-card",
        (node) => !node.classList.contains("hidden"),
      ),
    );
    await checkErrors(discardPage.errors);
    console.log("discard and same-seed restart: pass");
  } finally {
    await discardPage.page.close();
  }
  for (const control of ["#discard-button", "#new-button", "#done-new"]) {
    const discarded = await makePage(sizes[7]);
    try {
      discarded.page.on("dialog", (dialog) => dialog.accept());
      await start(discarded.page);
      if (control === "#discard-button") {
        await discarded.page.locator("#play-back").click();
      } else if (control === "#new-button") {
        await discarded.page.locator("#menu-button").click();
      } else {
        for (let id = 0; id < 32; id++) await place(discarded.page, id, false);
        await discarded.page.waitForFunction(() => jigsaw.state?.screen === "done");
      }
      await discarded.page.locator(control).click();
      await discarded.page.waitForFunction(() =>
        !document.querySelector("#chooser").classList.contains("hidden"));
      assert.equal(await discarded.page.evaluate(() => jigsaw.state), null,
        `${control} kept the discarded puzzle in memory`);
      await discarded.page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await discarded.page.reload({ waitUntil: "networkidle0" });
      await discarded.page.waitForFunction(() => window.jigsaw);
      assert.ok(await discarded.page.$eval("#continue-card", (node) =>
        node.classList.contains("hidden")),
      `${control} restored a discarded puzzle after reload`);
      await checkErrors(discarded.errors);
      console.log(`${control} discard and reload: pass`);
    } finally {
      await discarded.page.close();
    }
  }
  const hiddenPage = await makePage(sizes[0]);
  try {
    await start(hiddenPage.page);
    await place(hiddenPage.page, 0, true);
    await place(hiddenPage.page, 1, true);
    await hiddenPage.page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const stored = await hiddenPage.page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("jigsaw.v1")).game.pieces.filter(
          (piece) => piece.locked,
        ).length,
    );
    assert.equal(stored, 2);
    await checkErrors(hiddenPage.errors);
    console.log("rapid hide save: pass");
  } finally {
    await hiddenPage.page.close();
  }
  const audioPage = await makePage(sizes[7], () => {
    window.__startedTones = 0;
    if (window.OscillatorNode) {
      const original = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (...args) {
        window.__startedTones++;
        return original.apply(this, args);
      };
    }
  });
  try {
    await start(audioPage.page);
    const pair = await audioPage.page.evaluate(() => jigsaw.debug.piece(0));
    await audioPage.page.mouse.move(pair.current.x, pair.current.y);
    await audioPage.page.mouse.down();
    assert.ok(
      await audioPage.page.evaluate(() => window.__startedTones > 0),
      "first pickup did not play its tick",
    );
    await audioPage.page.mouse.up();
    await checkErrors(audioPage.errors);
    console.log("first pickup sound: pass");
  } finally {
    await audioPage.page.close();
  }
  const resume = await makePage(sizes[0]);
  try {
    await start(resume.page);
    await place(resume.page, 0, true);
    const pair = await resume.page.evaluate(() => {
      const scale = jigsaw.state.view.scale,
        rect = document.querySelector("#table").getBoundingClientRect();
      for (let id = 1; id < 31; id++) {
        if (id % jigsaw.state.grid[0] === jigsaw.state.grid[0] - 1) continue;
        const from = jigsaw.debug.piece(id).current,
          other = jigsaw.debug.piece(id + 1).current,
          to = { x: other.x - scale, y: other.y };
        if (
          [from, to].every(
            (p) =>
              p.x > rect.left + 12 &&
              p.x < rect.right - 12 &&
              p.y > rect.top + 12 &&
              p.y < rect.bottom - 12,
          )
        )
          return { id, otherId: id + 1, from, to };
      }
      return null;
    });
    assert.ok(pair, "no visible group pair");
    await drag(resume.page, pair.from, pair.to, true);
    const grouped = await resume.page.evaluate(
      (pair) =>
        jigsaw.state.pieces.find((p) => p.id === pair.id).group ===
        jigsaw.state.pieces.find((p) => p.id === pair.otherId).group,
      pair,
    );
    assert.ok(grouped, "neighbours did not join");
    const beforeMove = await resume.page.evaluate(
      (pair) =>
        [pair.id, pair.otherId].map((id) => {
          const p = jigsaw.state.pieces.find((p) => p.id === id);
          return { x: p.x, y: p.y };
        }),
      pair,
    );
    const groupFrom = await resume.page.evaluate(
      (pair) => jigsaw.debug.piece(pair.id).current,
      pair,
    );
    await drag(
      resume.page,
      groupFrom,
      { x: groupFrom.x + 18, y: groupFrom.y + 12 },
      true,
    );
    const afterMove = await resume.page.evaluate(
      (pair) =>
        [pair.id, pair.otherId].map((id) => {
          const p = jigsaw.state.pieces.find((p) => p.id === id);
          return { x: p.x, y: p.y };
        }),
      pair,
    );
    assert.ok(
      afterMove.every(
        (p, i) =>
          Math.abs(p.x - beforeMove[i].x) > 0.05 &&
          Math.abs(p.y - beforeMove[i].y) > 0.05,
      ),
      "joined group did not move together",
    );
    await new Promise((resolve) => setTimeout(resolve, 1150));
    const before = await resume.page.evaluate(() => ({
      pieces: jigsaw.state.pieces
        .map(({ id, x, y, group, locked }) => ({ id, x, y, group, locked }))
        .sort((a, b) => a.id - b.id),
      elapsed:
        jigsaw.state.elapsed +
        (jigsaw.state.runAt
          ? (performance.now() - jigsaw.state.runAt) / 1000
          : 0),
    }));
    await resume.page.reload();
    await resume.page.waitForFunction(() => window.jigsaw);
    await resume.page.locator("#continue-button").click();
    await resume.page.waitForFunction(() => jigsaw.state?.screen === "play");
    const after = await resume.page.evaluate(() => ({
      pieces: jigsaw.state.pieces
        .map(({ id, x, y, group, locked }) => ({ id, x, y, group, locked }))
        .sort((a, b) => a.id - b.id),
      elapsed: jigsaw.state.elapsed,
    }));
    assert.deepEqual(after.pieces, before.pieces);
    assert.ok(
      after.elapsed > 0 && Math.abs(after.elapsed - before.elapsed) < 1,
    );
      await checkErrors(resume.errors);
  } finally {
    await resume.page.close();
  }
  const photoResume = await makePage(sizes[0]);
  try {
    const input = await photoResume.page.$("#photo-input");
    await input.uploadFile(photoPaths[0]);
    await photoResume.page.waitForSelector("#crop-screen:not(.hidden)");
    await photoResume.page.locator("#crop-start").click();
    await photoResume.page.waitForFunction(
      () =>
        jigsaw.state?.screen === "play" && jigsaw.state.pictureId === "photo",
    );
    await place(photoResume.page, 0, true);
    await photoResume.page.locator("#play-back").click();
    await photoResume.page.reload();
    await photoResume.page.waitForFunction(() => window.jigsaw);
    await photoResume.page.locator("#continue-button").click();
    await photoResume.page.waitForFunction(
      () =>
        jigsaw.state?.screen === "play" && jigsaw.state.pictureId === "photo",
    );
    assert.ok(
      await photoResume.page.evaluate(
        () => jigsaw.state.pieces.find((p) => p.id === 0).locked,
      ),
    );
    for (let id = 1; id < 32; id++) await place(photoResume.page, id, true);
    await photoResume.page.waitForFunction(
      () => jigsaw.state.screen === "done",
    );
    await photoResume.page.evaluate(() => {
      const open = indexedDB.open.bind(indexedDB);
      let delayed = false;
      indexedDB.open = (...args) => {
        const request = open(...args);
        if (delayed) return request;
        delayed = true;
        window.__photoCleanupDelayed = true;
        return new Proxy(request, {
          get(target, name) { return Reflect.get(target, name, target); },
          set(target, name, value) {
            if (name === "onsuccess")
              target.onsuccess = (event) => setTimeout(() => value(event), 1000);
            else Reflect.set(target, name, value, target);
            return true;
          },
        });
      };
    });
    await photoResume.page.locator("#play-music").click();
    await photoResume.page.waitForFunction(() => window.__photoCleanupDelayed);
    assert.ok(await photoResume.page.evaluate(() => window.__photoCleanupDelayed),
      "preference write did not start photo cleanup");
    await photoResume.page.locator("#again-button").click();
    assert.ok(await photoResume.page.evaluate(() =>
      document.querySelector("#again-button").disabled),
    "replay completed before the delayed cleanup");
    await photoResume.page.locator("#play-music").click();
    await photoResume.page.waitForFunction(
      () =>
        jigsaw.state?.screen === "play" && jigsaw.state.pictureId === "photo",
    );
    assert.equal(
      await photoResume.page.evaluate(
        () => jigsaw.state.pieces.filter((p) => p.locked).length,
      ),
      0,
    );
    await place(photoResume.page, 0, true);
    await photoResume.page.reload({ waitUntil: "networkidle0" });
    await photoResume.page.waitForFunction(() => window.jigsaw &&
      !document.querySelector("#continue-card").classList.contains("hidden"));
    await photoResume.page.locator("#continue-button").click();
    await photoResume.page.waitForFunction(() => jigsaw.state?.screen === "play" &&
      jigsaw.state.pictureId === "photo");
    assert.ok(await photoResume.page.evaluate(() =>
      jigsaw.state.pieces.find((piece) => piece.id === 0).locked),
    "photo replay did not resume its moved piece");
    await checkErrors(photoResume.errors);
    console.log("photo resume and replay: pass");
  } finally {
    await photoResume.page.close();
  }
  const photoReadFailure = await makePage(sizes[7]);
  try {
    await photoReadFailure.page.$("#photo-input").then((input) =>
      input.uploadFile(photoPaths[0]));
    await photoReadFailure.page.waitForSelector("#crop-screen:not(.hidden)");
    await photoReadFailure.page.locator("#crop-start").click();
    await photoReadFailure.page.waitForFunction(() => jigsaw.state?.screen === "play");
    await place(photoReadFailure.page, 0, false);
    const savedHash = await photoReadFailure.page.evaluate(() =>
      jigsaw.storage.game.photoHash);
    await photoReadFailure.page.evaluateOnNewDocument(() => {
      if (sessionStorage.getItem("failed-save-read")) return;
      sessionStorage.setItem("failed-save-read", "1");
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (key === "jigsaw.v1") throw Error("Temporary read failure");
        return original.call(this, key);
      };
    });
    await photoReadFailure.page.reload({ waitUntil: "networkidle0" });
    await photoReadFailure.page.waitForFunction(() => window.jigsaw);
    const savedRecord = await photoReadFailure.page.evaluate(() =>
      localStorage["jigsaw.v1"]);
    await photoReadFailure.page.locator('#chooser [data-count="64"]').click();
    await photoReadFailure.page.locator("#chooser-music").click();
    assert.equal(await photoReadFailure.page.evaluate(() =>
      localStorage["jigsaw.v1"]), savedRecord,
    "preferences overwrote the unread photo save");
    await photoReadFailure.page.reload({ waitUntil: "networkidle0" });
    await photoReadFailure.page.waitForFunction(() => window.jigsaw &&
      !document.querySelector("#continue-card").classList.contains("hidden"));
    await photoReadFailure.page.locator("#continue-button").click();
    await photoReadFailure.page.waitForFunction((hash) =>
      jigsaw.state?.screen === "play" && jigsaw.state.photoHash === hash,
    {}, savedHash);
    assert.ok(await photoReadFailure.page.evaluate(() =>
      jigsaw.state.pieces.find((piece) => piece.id === 0).locked),
    "photo was lost after a temporary save read failure");
    await checkErrors(photoReadFailure.errors);
    console.log("temporary photo save read failure: pass");
  } finally {
    await photoReadFailure.page.close();
  }
  const untouchedPhoto = await makePage(sizes[7]);
  try {
    let prompts = 0;
    untouchedPhoto.page.on('dialog', (dialog) => { prompts++; dialog.accept(); });
    await untouchedPhoto.page.$('#photo-input').then((input) => input.uploadFile(photoPaths[0]));
    await untouchedPhoto.page.waitForSelector('#crop-screen:not(.hidden)');
    await untouchedPhoto.page.locator('#crop-start').click();
    await untouchedPhoto.page.waitForFunction(() => jigsaw.state?.screen === 'play');
    await untouchedPhoto.page.locator('#play-back').click();
    const firstHash = await untouchedPhoto.page.evaluate(() => jigsaw.storage.game.photoHash);
    await untouchedPhoto.page.$('#photo-input').then((input) => input.uploadFile(photoPaths[1]));
    await untouchedPhoto.page.waitForSelector('#crop-screen:not(.hidden)');
    await untouchedPhoto.page.locator('#crop-start').click();
    await untouchedPhoto.page.waitForFunction((hash) => jigsaw.state?.screen === 'play' &&
      jigsaw.state.photoHash !== hash, {}, firstHash);
    assert.equal(prompts, 0, 'untouched photo puzzle asked for replacement');
    const newHash = await untouchedPhoto.page.evaluate(() => jigsaw.state.photoHash);
    const keys = await untouchedPhoto.page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('jigsaw-photo', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('images').objectStore('images').getAllKeys();
        request.onsuccess = () => { db.close(); resolve(request.result); };
        request.onerror = () => reject(request.error);
      };
    }));
    assert.deepEqual(keys, [newHash], 'unreferenced photo was not removed');
    await checkErrors(untouchedPhoto.errors);
  } finally {
    await untouchedPhoto.page.close();
  }
  const photoWriteFailure = await makePage(sizes[7]);
  try {
    photoWriteFailure.page.on('dialog', (dialog) => dialog.accept());
    await photoWriteFailure.page.$('#photo-input').then((input) => input.uploadFile(photoPaths[0]));
    await photoWriteFailure.page.waitForSelector('#crop-screen:not(.hidden)');
    await photoWriteFailure.page.locator('#crop-start').click();
    await photoWriteFailure.page.waitForFunction(() => jigsaw.state?.screen === 'play');
    await place(photoWriteFailure.page, 0, true);
    await photoWriteFailure.page.locator('#play-back').click();
    const oldHash = await photoWriteFailure.page.evaluate(() =>
      JSON.parse(localStorage.getItem('jigsaw.v1')).game.photoHash);
    await photoWriteFailure.page.$('#photo-input').then((input) => input.uploadFile(photoPaths[1]));
    await photoWriteFailure.page.waitForSelector('#crop-screen:not(.hidden)');
    await photoWriteFailure.page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'jigsaw.v1') throw Error('Write denied');
        return original.call(this, key, value);
      };
    });
    await photoWriteFailure.page.locator('#crop-start').click();
    await photoWriteFailure.page.waitForFunction(() => jigsaw.state?.screen === 'play' &&
      document.querySelector('#save-notice').textContent.includes("can't be saved"));
    assert.equal(await photoWriteFailure.page.evaluate(() =>
      JSON.parse(localStorage.getItem('jigsaw.v1')).game.photoHash), oldHash);
    await photoWriteFailure.page.waitForFunction((hash) => new Promise((resolve, reject) => {
      const open = indexedDB.open('jigsaw-photo', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('images').objectStore('images').getAllKeys();
        request.onsuccess = () => {
          db.close();
          resolve(request.result.length === 1 && request.result[0] === hash);
        };
        request.onerror = () => reject(request.error);
      };
    }), { timeout: 5000 }, oldHash);
    await photoWriteFailure.page.reload({ waitUntil: 'networkidle0' });
    await photoWriteFailure.page.waitForFunction(() => window.jigsaw);
    await photoWriteFailure.page.locator('#continue-button').click();
    await photoWriteFailure.page.waitForFunction(() => jigsaw.state?.screen === 'play' &&
      jigsaw.state.photoHash === JSON.parse(localStorage.getItem('jigsaw.v1')).game.photoHash);
    assert.equal(await photoWriteFailure.page.evaluate(() => jigsaw.state.photoHash), oldHash);
    const keys = await photoWriteFailure.page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('jigsaw-photo', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('images').objectStore('images').getAllKeys();
        request.onsuccess = () => { db.close(); resolve(request.result); };
        request.onerror = () => reject(request.error);
      };
    }));
    assert.deepEqual(keys, [oldHash], 'failed replacement left an unreferenced photo');
    await checkErrors(photoWriteFailure.errors);
  } finally {
    await photoWriteFailure.page.close();
  }
  const soundPage = await makePage(sizes[0], () => {
    localStorage.setItem("jigsaw.v1", JSON.stringify({ sound: false }));
  });
  try {
    const sound = await soundPage.page.$eval("#sound-button", (button) => ({
      onVisible:
        getComputedStyle(button.querySelector(".sound-on")).display !== "none",
      offVisible:
        getComputedStyle(button.querySelector(".sound-off")).display !== "none",
      label: button.getAttribute("aria-label"),
      pressed: button.getAttribute("aria-pressed"),
    }));
    assert.deepEqual(sound, {
      onVisible: false,
      offVisible: true,
      label: "Sound off",
      pressed: "false",
    });
    await checkErrors(soundPage.errors);
    console.log("restored sound preference: pass");
  } finally {
    await soundPage.page.close();
  }
  const pixelPage = await makePage(sizes[3]);
  try {
    await pixelPage.page.setViewport({
      width: 820,
      height: 1180,
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    });
    await start(pixelPage.page);
    const pixels = await pixelPage.page.evaluate(() => {
      const canvas = document.querySelector("#table"),
        rect = canvas.getBoundingClientRect();
      return { width: canvas.width, expected: Math.round(rect.width * 2) };
    });
    assert.equal(pixels.width, pixels.expected);
    await pixelPage.page.setViewport({
      width: 820,
      height: 1180,
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 3,
    });
    await pixelPage.page.waitForFunction(() => {
      const canvas = document.querySelector("#table"),
        rect = canvas.getBoundingClientRect();
      return canvas.width === Math.round(rect.width * 2);
    });
    await checkErrors(pixelPage.errors);
    console.log("pixel ratio cap: pass");
  } finally {
    await pixelPage.page.close();
  }
  }
  if (section === 'all' || section === 'integration') {
  for (const action of ['untouched', 'edges', 'shuffle', 'old-time', 'old-position']) {
    const replacement = await makePage(sizes[7]);
    try {
      await start(replacement.page);
      if (action === 'edges') await replacement.page.locator('#edges-button').click();
      if (action === 'shuffle') {
        await replacement.page.locator('#menu-button').click();
        await replacement.page.locator('#shuffle-button').click();
      }
      await replacement.page.locator('#play-back').click();
      if (action.startsWith('old-')) {
        await replacement.page.evaluate((kind) => {
          const record = JSON.parse(localStorage.getItem('jigsaw.v1'));
          delete record.game.hasMoves;
          if (kind === 'old-time') record.game.elapsed = 1;
          else record.game.pieces[0].x += 0.25;
          localStorage.setItem('jigsaw.v1', JSON.stringify(record));
        }, action);
        await replacement.page.reload();
        await replacement.page.waitForFunction(() => window.jigsaw);
      }
      await replacement.page.locator('[data-picture="starry-night"]').click();
      if (action === 'untouched') {
        await replacement.page.waitForFunction(() => jigsaw.state?.pictureId === 'starry-night');
        assert.equal(await replacement.page.$eval('#replace-dialog', (node) => node.open), false);
      } else {
        await replacement.page.waitForFunction(() =>
          document.querySelector('#replace-dialog').open);
        assert.equal(await replacement.page.evaluate(() => jigsaw.storage.game?.pictureId),
          'great-wave', `${action} replaced progress before confirmation`);
        await replacement.page.locator('#replace-cancel').click();
      }
      await checkErrors(replacement.errors);
    } finally {
      await replacement.page.close();
    }
  }
  console.log('replacement confirmation: pass');
  const orderPage = await makePage(sizes[7]);
  try {
    await start(orderPage.page);
    const overlap = await orderPage.page.evaluate(() => {
      const lower = jigsaw.state.pieces.find((piece) => piece.id === 0);
      const upper = jigsaw.state.pieces.find((piece) => piece.id === 31);
      upper.x = lower.x + 0.25;
      upper.y = lower.y;
      const shared = jigsaw.debug.piece(lower.id).current;
      return { tap: jigsaw.debug.pick(lower.id)?.current,
        shared, top: jigsaw.debug.hit(shared.x, shared.y) };
    });
    assert.ok(overlap.tap, 'covered piece has no exposed tap point');
    assert.equal(overlap.top, 31, 'overlap did not put the higher piece on top');
    await orderPage.page.mouse.click(overlap.tap.x, overlap.tap.y);
    assert.equal(await orderPage.page.evaluate(({ x, y }) => jigsaw.debug.hit(x, y),
      overlap.shared), 0, 'tap did not promote the covered piece');
    await orderPage.page.locator('#play-back').click();
    await orderPage.page.reload();
    await orderPage.page.waitForFunction(() => window.jigsaw);
    await orderPage.page.locator('#continue-button').click();
    await orderPage.page.waitForFunction(() => jigsaw.state?.screen === 'play');
    assert.equal(await orderPage.page.evaluate(({ x, y }) => jigsaw.debug.hit(x, y),
      overlap.shared), 0, 'reload changed the topmost piece');
    await checkErrors(orderPage.errors);
  } finally {
    await orderPage.page.close();
  }
  console.log('piece drawing order after reload: pass');
  const panPage = await makePage(sizes[7]);
  try {
    await start(panPage.page);
    await panPage.page.locator('#zoom-in').click();
    await panPage.page.locator('#zoom-in').click();
    const empty = await panPage.page.evaluate(() => {
      const rect = document.querySelector('#table').getBoundingClientRect();
      for (let y = 20; y < rect.height - 20; y += 20)
        for (let x = 20; x < rect.width - 20; x += 20)
          if (jigsaw.debug.hit(rect.left + x, rect.top + y) === null)
            return { x: rect.left + x, y: rect.top + y };
      return null;
    });
    assert.ok(empty, 'no empty table point was found');
    const before = await panPage.page.evaluate(() => ({ ...jigsaw.state.view }));
    await panPage.page.mouse.move(empty.x, empty.y);
    await panPage.page.mouse.down();
    await panPage.page.mouse.move(empty.x - 60, empty.y);
    await panPage.page.mouse.up();
    const after = await panPage.page.evaluate(() => ({ ...jigsaw.state.view }));
    assert.notEqual(after.x, before.x, 'empty-table pointer drag did not pan');
    await checkErrors(panPage.errors);
  } finally {
    await panPage.page.close();
  }
  console.log('empty-table pointer pan: pass');
  const gestures = await makePage(sizes[7]);
  try {
    await start(gestures.page);
    const results = await gestures.page.evaluate(() => {
      const canvas = document.querySelector("#table");
      canvas.setPointerCapture = () => {};
      const pick = jigsaw.debug.pick(0).current;
      const event = (name, id, dx = 0, dy = 0) => canvas.dispatchEvent(
        new PointerEvent(name, {
          bubbles: true, pointerId: id,
          clientX: pick.x + dx, clientY: pick.y + dy,
        }));
      const piece = () => jigsaw.state.pieces.find((item) => item.id === 0);
      const original = { x: piece().x, y: piece().y };
      const before = { started: jigsaw.state.started, runAt: jigsaw.state.runAt,
        elapsed: jigsaw.state.elapsed, hasMoves: jigsaw.state.hasMoves };
      const progressRestored = () =>
        jigsaw.state.started === before.started &&
        jigsaw.state.runAt === before.runAt &&
        jigsaw.state.elapsed === before.elapsed &&
        jigsaw.state.hasMoves === before.hasMoves;
      event("pointerdown", 1);
      event("pointermove", 1);
      event("pointerup", 1);
      const tapDidNotStart = progressRestored();
      event("pointerdown", 2);
      event("pointermove", 2, 25);
      event("pointercancel", 2, 25);
      const cancelRestored = piece().x === original.x && piece().y === original.y &&
        !piece().locked && jigsaw.debug.gesture === "idle" && progressRestored();
      event("pointerdown", 3);
      event("pointermove", 3, 25);
      event("lostpointercapture", 3, 25);
      const captureRestored = piece().x === original.x && piece().y === original.y &&
        !piece().locked && jigsaw.debug.gesture === "idle" && progressRestored();
      event("pointerdown", 4);
      event("pointermove", 4, 25);
      event("pointerdown", 5, 80);
      const pinchRestored = piece().x === original.x && piece().y === original.y &&
        !piece().locked && jigsaw.debug.gesture === "twoFingers";
      event("pointerdown", 6, 100);
      event("pointermove", 6, 130);
      const extraIgnored = jigsaw.debug.gesture === "twoFingers" &&
        piece().x === original.x;
      event("pointerup", 4);
      event("pointermove", 5, 90);
      const liftIdle = jigsaw.debug.gesture === "idle" && piece().x === original.x;
      event("pointerup", 5);
      return { tapDidNotStart, cancelRestored, captureRestored,
        pinchRestored, extraIgnored, liftIdle };
    });
    for (const [name, passed] of Object.entries(results))
      assert.ok(passed, `pointer state: ${name}`);
    await checkErrors(gestures.errors);
  } finally {
    await gestures.page.close();
  }
  const visibilityRace = await makePage(sizes[7]);
  try {
    await start(visibilityRace.page);
    const stayedHidden = await visibilityRace.page.evaluate(async () => {
      const resume = AudioContext.prototype.resume;
      let finishResume;
      AudioContext.prototype.resume = () => new Promise((resolve) => {
        finishResume = resolve;
      });
      const setHidden = (value) => {
        Object.defineProperty(document, 'hidden', { configurable: true, value });
        document.dispatchEvent(new Event('visibilitychange'));
      };
      try {
        setHidden(true);
        setHidden(false);
        setHidden(true);
        finishResume();
        await Promise.resolve();
        await Promise.resolve();
        return jigsaw.music.hidden;
      } finally {
        delete document.hidden;
        AudioContext.prototype.resume = resume;
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });
    assert.ok(stayedHidden, 'a stale resume callback restarted hidden music');
    await checkErrors(visibilityRace.errors);
  } finally {
    await visibilityRace.page.close();
  }
  for (const [name, inject] of [
    [
      "storage-failure",
      () => {
        Storage.prototype.setItem = function () {
          throw Error("Storage denied");
        };
      },
    ],
    [
      "invalid-save",
      () => {
        localStorage.setItem("jigsaw.v1", JSON.stringify({ game: "abc" }));
      },
    ],
    [
      "indexeddb-failure",
      () => {
        Object.defineProperty(window, "indexedDB", { value: undefined });
      },
    ],
  ]) {
    const { page, errors } = await makePage(sizes[0], inject);
    try {
      if (name === "indexeddb-failure") {
        await page
          .$("#photo-input")
          .then((input) => input.uploadFile(photoPaths[0]));
        await page.waitForSelector("#crop-screen:not(.hidden)");
        await page.locator("#crop-start").click();
      } else await start(page);
      await page.waitForFunction(() => jigsaw.state?.screen === "play");
      if (name === "storage-failure") {
        const notice = await page.$eval("#save-notice", (node) => node.textContent);
        assert.equal(notice, "Progress can't be saved in this browser");
        const position = await page.evaluate(() => jigsaw.debug.pick(0));
        if (position) await drag(page, position.current,
          { x: position.current.x + 16, y: position.current.y + 12 }, true);
        await page.reload({ waitUntil: "networkidle0" });
        await page.waitForFunction(() => window.jigsaw &&
          document.querySelectorAll(".picture-tile").length === 21);
        assert.ok(await page.$eval("#continue-card", (node) =>
          node.classList.contains("hidden")));
      }
      if (name === "indexeddb-failure") {
        assert.ok(
          await page.evaluate(() => {
            const raw = localStorage.getItem("jigsaw.v1");
            return raw === null || JSON.parse(raw).game === null;
          }),
        );
      }
      await checkErrors(errors);
      console.log(`${name}: pass`);
    } finally {
      await page.close();
    }
  }
  const staleSave = await makePage(sizes[7]);
  try {
    staleSave.page.on("dialog", (dialog) => dialog.accept());
    await start(staleSave.page);
    await staleSave.page.locator("#play-back").click();
    await staleSave.page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "jigsaw.v1") throw Error("Storage denied");
        return original.call(this, key, value);
      };
    });
    await staleSave.page.locator('[data-picture="starry-night"]').click();
    await staleSave.page.waitForFunction(() =>
      jigsaw.state?.screen === "play" && jigsaw.state.pictureId === "starry-night");
    assert.equal(await staleSave.page.evaluate(() =>
      JSON.parse(localStorage.getItem("jigsaw.v1")).game.pictureId), "great-wave");
    assert.ok(await staleSave.page.$eval("#save-notice", (node) =>
      node.textContent.includes("can't be saved")));
    for (let id = 0; id < 32; id++) await place(staleSave.page, id, false);
    await staleSave.page.waitForFunction(() => jigsaw.state?.screen === "done");
    await staleSave.page.reload({ waitUntil: "networkidle0" });
    await staleSave.page.waitForFunction(() => window.jigsaw &&
      document.querySelectorAll(".picture-tile").length === 21);
    assert.ok(await staleSave.page.$eval("#continue-card", (node) =>
      !node.classList.contains("hidden")));
    await staleSave.page.locator('#continue-button').click();
    await staleSave.page.waitForFunction(() => jigsaw.state?.pictureId === 'great-wave' &&
      jigsaw.state.screen === 'play');
    await staleSave.page.locator('#play-back').click();
    await start(staleSave.page);
    await staleSave.page.locator("#play-back").click();
    await staleSave.page.reload({ waitUntil: "networkidle0" });
    await staleSave.page.waitForFunction(() => window.jigsaw);
    assert.ok(await staleSave.page.$eval("#continue-card", (node) =>
      !node.classList.contains("hidden")),
    "new save was hidden by an older superseded marker");
    await checkErrors(staleSave.errors);
  } finally {
    await staleSave.page.close();
  }
  const markedSave = await makePage(sizes[7]);
  try {
    markedSave.page.on("dialog", (dialog) => dialog.accept());
    await start(markedSave.page);
    await markedSave.page.locator("#play-back").click();
    await markedSave.page.evaluate(() => {
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "jigsaw.v1") throw Error("Write denied");
        return originalSet.call(this, key, value);
      };
      const originalRemove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key) {
        if (key === "jigsaw.v1") throw Error("Removal denied");
        return originalRemove.call(this, key);
      };
    });
    await markedSave.page.locator('[data-picture="starry-night"]').click();
    await markedSave.page.waitForFunction(() =>
      jigsaw.state?.screen === "play" && jigsaw.state.pictureId === "starry-night");
    assert.equal(await markedSave.page.evaluate(() =>
      localStorage.getItem("jigsaw.v1.superseded")), null);
    assert.equal(await markedSave.page.evaluate(() =>
      JSON.parse(localStorage.getItem("jigsaw.v1")).game.pictureId), "great-wave");
    await markedSave.page.reload({ waitUntil: "networkidle0" });
    await markedSave.page.waitForFunction(() => window.jigsaw);
    assert.ok(await markedSave.page.$eval("#continue-card", (node) =>
      !node.classList.contains("hidden")));
    await markedSave.page.locator('#continue-button').click();
    await markedSave.page.waitForFunction(() => jigsaw.state?.pictureId === 'great-wave' &&
      jigsaw.state.screen === 'play');
    await checkErrors(markedSave.errors);
  } finally {
    await markedSave.page.close();
  }
  const failedResume = await makePage(sizes[7]);
  try {
    await start(failedResume.page);
    await failedResume.page.locator('#play-back').click();
    const before = await failedResume.page.evaluate(() => localStorage.getItem('jigsaw.v1'));
    await failedResume.page.evaluate(() => {
      window.__decodeImage = Image.prototype.decode;
      Image.prototype.decode = function () { return Promise.reject(Error('temporary image failure')); };
    });
    await failedResume.page.locator('#continue-button').click();
    await failedResume.page.waitForFunction(() =>
      document.querySelector('#chooser-message').textContent.includes('temporary image failure'));
    assert.equal(await failedResume.page.evaluate(() => localStorage.getItem('jigsaw.v1')), before);
    assert.ok(await failedResume.page.$eval('#continue-card', (node) =>
      !node.classList.contains('hidden')));
    await failedResume.page.evaluate(() => { Image.prototype.decode = window.__decodeImage; });
    await failedResume.page.locator('#continue-button').click();
    await failedResume.page.waitForFunction(() => jigsaw.state?.screen === 'play');
    await checkErrors(failedResume.errors);
  } finally {
    await failedResume.page.close();
  }
  const missingRandomUuid = await makePage(sizes[7]);
  try {
    await missingRandomUuid.page.evaluate(() => {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true, value: undefined,
      });
    });
    await start(missingRandomUuid.page);
    await missingRandomUuid.page.locator("#play-back").click();
    assert.ok(await missingRandomUuid.page.evaluate(() =>
      JSON.parse(localStorage.getItem("jigsaw.v1")).gameToken.startsWith("random-")));
    await missingRandomUuid.page.reload({ waitUntil: "networkidle0" });
    await missingRandomUuid.page.waitForFunction(() => window.jigsaw);
    assert.ok(await missingRandomUuid.page.$eval("#continue-card", (node) =>
      !node.classList.contains("hidden")));
    await checkErrors(missingRandomUuid.errors);
  } finally {
    await missingRandomUuid.page.close();
  }
  const invalidCrop = await makePage(sizes[7], () => {
    const game = {
      pictureId: "great-wave", count: 32, grid: [8, 4],
      crop: { x: 2000, y: 2000, width: 800, height: 400 },
      seed: 7, elapsed: 0,
      pieces: Array.from({ length: 32 }, (_, id) => ({
        id, x: id, y: 0, group: id, locked: false,
      })),
    };
    localStorage.setItem("jigsaw.v1", JSON.stringify({ game }));
  });
  try {
    assert.ok(await invalidCrop.page.$eval("#continue-card", (node) =>
      node.classList.contains("hidden")));
    assert.equal(await invalidCrop.page.evaluate(() => jigsaw.storage.game), null);
    await checkErrors(invalidCrop.errors);
  } finally {
    await invalidCrop.page.close();
  }
  const reducedPhoto = await makePage(sizes[7], () => {
    window.createImageBitmap = async (_file, options) => {
      window.resizeRequest = options;
      window.resizeRequestCount = (window.resizeRequestCount || 0) + 1;
      const canvas = document.createElement("canvas");
      canvas.width = options.resizeWidth || 100;
      canvas.height = options.resizeHeight || 100;
      return canvas;
    };
  });
  try {
    for (const [index, photoPath] of [largePhotoPath, largeWebpPath,
      lateJpegPath].entries()) {
      await reducedPhoto.page.$("#photo-input").then((input) =>
        input.uploadFile(photoPath));
      await reducedPhoto.page.waitForFunction((expected) =>
        window.resizeRequestCount === expected, {}, index + 1);
      await reducedPhoto.page.waitForSelector("#crop-screen:not(.hidden)");
      const requested = await reducedPhoto.page.evaluate(() => window.resizeRequest);
      if (index === 2) {
        assert.equal(requested.resizeWidth, undefined);
        assert.equal(requested.resizeHeight, undefined);
      } else {
        assert.equal(requested.resizeWidth, 2048);
        assert.equal(requested.resizeHeight, 1638);
      }
    }
    await checkErrors(reducedPhoto.errors);
  } finally {
    await reducedPhoto.page.close();
  }
  const limitedPhoto = await makePage(sizes[7], () => {
    window.createImageBitmap = async () => { throw Error("no resize support"); };
  });
  try {
    await limitedPhoto.page.$("#photo-input").then((input) =>
      input.uploadFile(largePhotoPath));
    await limitedPhoto.page.waitForFunction(() =>
      document.querySelector("#chooser-message").textContent.includes("60 megapixels"));
    assert.ok(await limitedPhoto.page.$eval("#crop-screen", (node) =>
      node.classList.contains("hidden")));
    await checkErrors(limitedPhoto.errors);
  } finally {
    await limitedPhoto.page.close();
  }
  const viewBoxPhoto = await makePage(sizes[7]);
  try {
    await viewBoxPhoto.page.$("#photo-input").then((input) =>
      input.uploadFile(viewBoxPhotoPath));
    await viewBoxPhoto.page.waitForSelector("#crop-screen:not(.hidden)");
    assert.equal(await viewBoxPhoto.page.$eval("#chooser-message", (node) =>
      node.textContent), "");
    await checkErrors(viewBoxPhoto.errors);
  } finally {
    await viewBoxPhoto.page.close();
  }
  for (const kind of ["abort", "item-error", "open-error", "blocked"]) {
    const failedPhoto = await makePage(sizes[7]);
    try {
      await failedPhoto.page.evaluate(installPhotoDatabaseFailure, kind);
      await failedPhoto.page.$("#photo-input").then((input) =>
        input.uploadFile(photoPaths[0]));
      await failedPhoto.page.waitForSelector("#crop-screen:not(.hidden)");
      await failedPhoto.page.locator("#crop-start").click();
      await failedPhoto.page.waitForFunction(() => jigsaw.state?.screen === "play");
      assert.equal(await failedPhoto.page.evaluate(() => jigsaw.state.resumeAllowed), false,
        `${kind} allowed photo resume`);
      if (kind === "abort" || kind === "item-error")
        assert.equal(await failedPhoto.page.evaluate(() =>
          window.__photoDatabaseClosed), 1);
      await checkErrors(failedPhoto.errors);
    } finally {
      await failedPhoto.page.close();
    }
  }
  const photoDecodeFailure = await makePage(sizes[7]);
  try {
    await photoDecodeFailure.page.$('#photo-input').then((input) =>
      input.uploadFile(photoPaths[0]));
    await photoDecodeFailure.page.waitForSelector('#crop-screen:not(.hidden)');
    await photoDecodeFailure.page.locator('#crop-start').click();
    await photoDecodeFailure.page.waitForFunction(() => jigsaw.state?.screen === 'play');
    await photoDecodeFailure.page.locator('#play-back').click();
    const saved = await photoDecodeFailure.page.evaluate(() => localStorage.getItem('jigsaw.v1'));
    await photoDecodeFailure.page.evaluate(() => {
      window.__decodeImage = Image.prototype.decode;
      Image.prototype.decode = function () { return Promise.reject(Error('temporary decode failure')); };
    });
    await photoDecodeFailure.page.locator('#continue-button').click();
    await photoDecodeFailure.page.waitForFunction(() =>
      document.querySelector('#continue-error').textContent.includes('Try again'));
    assert.equal(await photoDecodeFailure.page.evaluate(() => localStorage.getItem('jigsaw.v1')), saved);
    await photoDecodeFailure.page.evaluate(() => { Image.prototype.decode = window.__decodeImage; });
    await photoDecodeFailure.page.locator('#continue-button').click();
    await photoDecodeFailure.page.waitForFunction(() => jigsaw.state?.screen === 'play');
    await checkErrors(photoDecodeFailure.errors);
  } finally {
    await photoDecodeFailure.page.close();
  }
  const abortContinue = await makePage(sizes[7]);
  try {
    await abortContinue.page.$("#photo-input").then((input) =>
      input.uploadFile(photoPaths[0]));
    await abortContinue.page.waitForSelector("#crop-screen:not(.hidden)");
    await abortContinue.page.locator("#crop-start").click();
    await abortContinue.page.waitForFunction(() => jigsaw.state?.screen === "play");
    await abortContinue.page.locator("#play-back").click();
    await abortContinue.page.evaluate(() => { window.__realIndexedDB = indexedDB; });
    await abortContinue.page.evaluate(installPhotoDatabaseFailure, "abort");
    await abortContinue.page.locator("#continue-button").click();
    await abortContinue.page.waitForFunction(() =>
      document.querySelector("#continue-error").textContent.includes("Try again"));
    assert.equal(await abortContinue.page.$eval("#continue-error", (node) =>
      node.textContent), "Your photo couldn't be loaded. Try again.");
    assert.equal(await abortContinue.page.evaluate(() =>
      window.__photoDatabaseClosed), 1);
    assert.ok(await abortContinue.page.evaluate(() => jigsaw.storage.game));
    assert.ok(await abortContinue.page.$eval("#continue-card", (node) =>
      !node.classList.contains("hidden")));
    await abortContinue.page.evaluate(() => {
      Object.defineProperty(window, "indexedDB", {
        configurable: true, value: window.__realIndexedDB,
      });
    });
    await abortContinue.page.locator("#continue-button").click();
    await abortContinue.page.waitForFunction(() => jigsaw.state?.screen === "play");
    assert.equal(await abortContinue.page.$eval("#continue-error", (node) =>
      node.textContent), "");
    await checkErrors(abortContinue.errors);
  } finally {
    await abortContinue.page.close();
  }
  const missingPhoto = await makePage(sizes[7]);
  try {
    await missingPhoto.page.$("#photo-input").then((input) =>
      input.uploadFile(photoPaths[0]));
    await missingPhoto.page.waitForSelector("#crop-screen:not(.hidden)");
    await missingPhoto.page.locator("#crop-start").click();
    await missingPhoto.page.waitForFunction(() => jigsaw.state?.screen === "play");
    await missingPhoto.page.locator("#play-back").click();
    await missingPhoto.page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open("jigsaw-photo", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("images", "readwrite");
        transaction.objectStore("images").delete(jigsaw.storage.game.photoHash);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    }));
    await missingPhoto.page.locator("#continue-button").click();
    await missingPhoto.page.waitForFunction(() => jigsaw.storage.game === null);
    assert.ok(await missingPhoto.page.$eval("#continue-card", (node) =>
      node.classList.contains("hidden")));
    await checkErrors(missingPhoto.errors);
  } finally {
    await missingPhoto.page.close();
  }
  const photoRace = await makePage(sizes[7], () => {
    window.pendingDecodes = [];
    window.createImageBitmap = (file) => new Promise((resolve) => {
      window.pendingDecodes.push({ name: file.name, resolve });
    });
  });
  try {
    const input = await photoRace.page.$("#photo-input");
    await input.uploadFile(photoPaths[0]);
    await photoRace.page.waitForFunction(() => window.pendingDecodes.length === 1);
    await input.uploadFile(photoPaths[1]);
    await photoRace.page.waitForFunction(() => window.pendingDecodes.length === 2);
    await photoRace.page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 500;
      canvas.height = 300;
      window.pendingDecodes[1].resolve(canvas);
    });
    await photoRace.page.waitForSelector("#crop-screen:not(.hidden)");
    await photoRace.page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 300;
      canvas.height = 500;
      window.pendingDecodes[0].resolve(canvas);
    });
    await photoRace.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal(await photoRace.page.evaluate(() =>
      document.querySelector("#crop-canvas")._frame.crop.width), 500);
    assert.equal(await photoRace.page.evaluate(() =>
      document.querySelector("#crop-canvas")._frame.crop.height), 300);
    await photoRace.page.locator("#crop-back").click();
    await input.uploadFile(photoPaths[0]);
    await photoRace.page.waitForFunction(() => window.pendingDecodes.length === 3);
    await photoRace.page.locator('[data-picture="starry-night"]').click();
    await photoRace.page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 300;
      canvas.height = 500;
      window.pendingDecodes[2].resolve(canvas);
      return new Promise((resolve) => setTimeout(resolve, 0));
    });
    await photoRace.page.waitForFunction(() =>
      jigsaw.state?.screen === "play" && jigsaw.state.pictureId === "starry-night");
    assert.ok(await photoRace.page.$eval("#crop-screen", (node) =>
      node.classList.contains("hidden")));
    await checkErrors(photoRace.errors);
  } finally {
    await photoRace.page.close();
  }
  const draggedTile = await makePage(sizes[1]);
  try {
    const tile = await draggedTile.page.$eval('[data-picture="great-wave"]', (node) => {
      const box = node.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await draggedTile.page.touchscreen.touchStart(tile.x, tile.y);
    await draggedTile.page.touchscreen.touchMove(tile.x, tile.y - 150);
    await draggedTile.page.touchscreen.touchEnd();
    assert.ok(await draggedTile.page.$eval('#chooser', (node) =>
      !node.classList.contains('hidden')), 'drag over tiles opened a puzzle');
    assert.equal(await draggedTile.page.evaluate(() => jigsaw.state), null);
    const photoTile = await draggedTile.page.evaluate(() => {
      window.__pickerClicks = 0;
      document.querySelector('#photo-input').addEventListener('click', () =>
        window.__pickerClicks++);
      const tile = document.querySelector('[data-picture="photo"]');
      tile.scrollIntoView({ block: 'center', behavior: 'instant' });
      const box = tile.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await draggedTile.page.touchscreen.touchStart(photoTile.x, photoTile.y);
    await draggedTile.page.touchscreen.touchMove(photoTile.x, photoTile.y - 150);
    await draggedTile.page.touchscreen.touchEnd();
    assert.equal(await draggedTile.page.evaluate(() => window.__pickerClicks), 0,
      'drag over Your photo opened the picker');
    assert.ok(await draggedTile.page.$eval('#crop-screen', (node) =>
      node.classList.contains('hidden')));
    await checkErrors(draggedTile.errors);
  } finally {
    await draggedTile.page.close();
  }
  const replace = await makePage(sizes[7]);
  try {
    await start(replace.page);
    await replace.page.locator('#play-back').click();
    await replace.page.locator('[data-picture="starry-night"]').click();
    await replace.page.waitForFunction(() => jigsaw.state?.pictureId === 'starry-night');
    assert.equal(await replace.page.$eval('#replace-dialog', (node) => node.open), false,
      'a puzzle with no moves asked for confirmation');
    await place(replace.page, 0, false);
    await replace.page.locator('#play-back').click();
    assert.equal(await replace.page.$eval('#continue-name', (node) => node.textContent),
      'The Starry Night');
    await replace.page.locator('[data-picture="great-wave"]').click();
    await replace.page.waitForFunction(() => document.querySelector('#replace-dialog').open);
    assert.equal(await replace.page.$eval('#replace-dialog p', (node) => node.textContent),
      'Start a new puzzle? Your unfinished one will be replaced.');
    await replace.page.locator('#replace-cancel').click();
    assert.equal(await replace.page.evaluate(() => jigsaw.state.pictureId), 'starry-night');
    await replace.page.locator('[data-picture="great-wave"]').click();
    await replace.page.waitForFunction(() => document.querySelector('#replace-dialog').open);
    await replace.page.locator('#replace-start').click();
    await replace.page.waitForFunction(() =>
      jigsaw.state?.screen === 'play' && jigsaw.state.pictureId === 'great-wave');
    await checkErrors(replace.errors);
  } finally {
    await replace.page.close();
  }
  const chooserDouble = await makePage(sizes[7]);
  try {
    await chooserDouble.page.evaluate(() => {
      window.__decodeCalls = 0;
      const originalDecode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        window.__decodeCalls++;
        return new Promise((resolve) => {
          window.__finishDecode = () => resolve(originalDecode.call(this));
        });
      };
      const button = document.querySelector('[data-picture="great-wave"]');
      button.click();
      button.click();
    });
    assert.equal(await chooserDouble.page.evaluate(() => window.__decodeCalls), 1);
    assert.ok(await chooserDouble.page.$eval('[data-picture="great-wave"]', (node) => node.disabled));
    await chooserDouble.page.evaluate(() => window.__finishDecode());
    await chooserDouble.page.waitForFunction(() => jigsaw.state?.screen === "play");
    await checkErrors(chooserDouble.errors);
  } finally {
    await chooserDouble.page.close();
  }
  const navigationRace = await makePage(sizes[7]);
  try {
    navigationRace.page.on("dialog", (dialog) => dialog.accept());
    await start(navigationRace.page);
    await navigationRace.page.locator("#play-back").click();
    await navigationRace.page.evaluate(() => {
      window.__decodeCalls = 0;
      const originalDecode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        window.__decodeCalls++;
        return new Promise((resolve, reject) => {
          window.__finishDecode = () => originalDecode.call(this).then(resolve, reject);
        });
      };
      document.querySelector('[data-picture="starry-night"]').click();
      document.querySelector("#continue-button").click();
    });
    assert.equal(await navigationRace.page.evaluate(() => window.__decodeCalls), 1);
    assert.ok(await navigationRace.page.$eval("#continue-button", (node) =>
      node.disabled));
    await navigationRace.page.evaluate(() => window.__finishDecode());
    await navigationRace.page.waitForFunction(() =>
      jigsaw.state?.screen === "play" && jigsaw.state.pictureId === "starry-night");
    assert.equal(await navigationRace.page.evaluate(() =>
      JSON.parse(localStorage.getItem("jigsaw.v1")).game.pictureId),
    "starry-night");
    await checkErrors(navigationRace.errors);
  } finally {
    await navigationRace.page.close();
  }
  const cropDouble = await makePage(sizes[7]);
  try {
    await cropDouble.page.$("#photo-input").then((input) =>
      input.uploadFile(photoPaths[0]));
    await cropDouble.page.waitForSelector("#crop-screen:not(.hidden)");
    await cropDouble.page.evaluate(() => {
      window.__openCount = 0;
      Object.defineProperty(window, "indexedDB", { configurable: true, value: {
        open() {
          window.__openCount++;
          const db = {
            objectStoreNames: { contains: () => true }, close() {},
            transaction() {
              const transaction = { objectStore: () => ({ put: () => ({}) }) };
              window.__finishStore = () => transaction.oncomplete();
              return transaction;
            },
          };
          const request = { result: db };
          setTimeout(() => request.onsuccess(), 0);
          return request;
        },
      } });
      const button = document.querySelector("#crop-start");
      button.click();
      button.click();
    });
    await cropDouble.page.waitForFunction(() => window.__finishStore);
    assert.equal(await cropDouble.page.evaluate(() => window.__openCount), 1);
    assert.ok(await cropDouble.page.$eval("#crop-start", (node) => node.disabled));
    assert.ok(await cropDouble.page.$eval("#crop-back", (node) => node.disabled));
    await cropDouble.page.$eval("#crop-back", (node) => node.click());
    assert.ok(await cropDouble.page.$eval("#crop-screen", (node) =>
      !node.classList.contains("hidden")));
    await cropDouble.page.evaluate(() => window.__finishStore());
    await cropDouble.page.waitForFunction(() => jigsaw.state?.screen === "play");
    await checkErrors(cropDouble.errors);
  } finally {
    await cropDouble.page.close();
  }
  for (const orientation of [1, 6]) {
    const oriented = await makePage(sizes[7], () => {
      const original = window.createImageBitmap.bind(window);
      window.createImageBitmap = async (file, options) => {
        window.__bitmapOptions = options;
        return original(file, options);
      };
    });
    try {
      await oriented.page.$("#photo-input").then((input) =>
        input.uploadFile(path.join(scratch, `orientation-${orientation}.jpg`)));
      await oriented.page.waitForSelector("#crop-screen:not(.hidden)");
      const crop = await oriented.page.evaluate(() => {
        const canvas = document.querySelector("#crop-canvas");
        const frame = canvas._frame;
        const context = canvas.getContext("2d");
        const ratio = canvas.width / canvas.getBoundingClientRect().width;
        const sample = (fraction) => [...context.getImageData(
          Math.floor((frame.x + frame.width / 2) * ratio),
          Math.floor((frame.y + frame.height * fraction) * ratio), 1, 1).data];
        return { width: frame.crop.width, height: frame.crop.height,
          top: sample(0.2), bottom: sample(0.8), options: window.__bitmapOptions };
      });
      assert.equal(crop.width / crop.height, 2);
      assert.ok(crop.top[0] > crop.top[2] + 100,
        `orientation ${orientation} crop top is not red: ${crop.top}`);
      assert.ok(crop.bottom[2] > crop.bottom[0] + 100,
        `orientation ${orientation} crop bottom is not blue: ${crop.bottom}`);
      assert.equal(Boolean(crop.options.resizeWidth), orientation === 1);
      await shot(oriented.page, `orientation-${orientation}-crop`);
      await oriented.page.locator("#crop-start").click();
      await oriented.page.waitForFunction(() => jigsaw.state?.screen === "play");
      const started = await oriented.page.evaluate(async () => {
        const image = jigsaw.debug.image;
        await image.decode?.();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const sample = (fraction) => [...context.getImageData(
          Math.floor(canvas.width / 2), Math.floor(canvas.height * fraction),
          1, 1).data];
        return { width: canvas.width, height: canvas.height,
          top: sample(0.2), bottom: sample(0.8) };
      });
      assert.equal(started.width / started.height, 2);
      assert.ok(started.top[0] > started.top[2] + 100);
      assert.ok(started.bottom[2] > started.bottom[0] + 100);
      await shot(oriented.page, `orientation-${orientation}-play`);
      await checkErrors(oriented.errors);
    } finally {
      await oriented.page.close();
    }
  }
  }
  if (section === 'all' || section === 'offline') {
  let releasePicture;
  let pictureRequested;
  const pictureGate = new Promise((resolve) => (releasePicture = resolve));
  const pictureRequest = new Promise((resolve) => (pictureRequested = resolve));
  const delayedServer = createServer(async (request, response) => {
    try {
      const target = new URL(request.url, origin);
      if (target.pathname.endsWith('/pictures/great-wave.jpg')) {
        pictureRequested();
        await pictureGate;
      }
      const upstream = await fetch(target);
      const body = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(502);
      response.end(error.message);
    }
  });
  await new Promise((resolve) => delayedServer.listen(0, '127.0.0.1', resolve));
  const delayedUrl = new URL(url.href);
  delayedUrl.port = String(delayedServer.address().port);
  let delayed;
  try {
    delayed = await makePage({ ...sizes[1], url: delayedUrl.href });
    await pictureRequest;
    const before = await delayed.page.evaluate(() => ({
      controller: Boolean(navigator.serviceWorker?.controller),
      note: document.getElementById('offline-ready').textContent,
    }));
    assert.deepEqual(before, { controller: false, note: '' },
      'readiness appeared before the delayed painting was stored');
    releasePicture();
    await delayed.page.waitForFunction(() =>
      document.getElementById('offline-ready').textContent === 'Ready to play offline',
    { timeout: 120000 });
    const placement = await delayed.page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const note = rect('#offline-ready');
      const overlap = (other) => note.left < other.right && note.right > other.left &&
        note.top < other.bottom && note.bottom > other.top;
      return {
        live: document.getElementById('offline-ready').getAttribute('aria-live'),
        visible: getComputedStyle(document.getElementById('offline-ready')).display !== 'none',
        coversCount: overlap(rect('.chooser-count')),
        coversMusic: overlap(rect('#chooser-music')),
        coversTitle: overlap(rect('.picture-tile .tile-copy strong')),
      };
    });
    assert.deepEqual(placement, { live: 'polite', visible: true,
      coversCount: false, coversMusic: false, coversTitle: false });
    await start(delayed.page);
    assert.equal(await delayed.page.$eval('#offline-ready', (node) =>
      getComputedStyle(node).display), 'none', 'readiness remained visible during play');
    await checkErrors(delayed.errors);
    console.log('offlineReady: pass');
  } finally {
    releasePicture();
    await delayed?.page.close();
    await new Promise((resolve) => delayedServer.close(resolve));
  }
  const offline = await makePage(sizes[7]);
  try {
    await offline.page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller),
      { timeout: 120000 });
    const appManifest = await offline.page.appManifest();
    assert.deepEqual(appManifest.errors, []);
    const evicted = await offline.page.evaluate(async () => {
      const scope = new URL('.', location.href).href;
      const name = (await caches.keys()).find((entry) => entry.startsWith(`jigsaw ${scope} `));
      const cache = await caches.open(name);
      const paths = ['css/style.css', 'pictures/great-wave.jpg'];
      for (const path of paths) await cache.delete(new URL(path, scope).href);
      return Promise.all(paths.map(async (path) =>
        Boolean(await cache.match(new URL(path, scope).href))));
    });
    assert.deepEqual(evicted, [false, false], 'cache entries were not evicted');
    await offline.page.reload({ waitUntil: 'load' });
    await offline.page.waitForFunction(() =>
      document.getElementById('offline-ready').textContent === 'Ready to play offline',
    { timeout: 60000 });
    await offline.page.waitForFunction(async () => {
      const scope = new URL('.', location.href).href;
      const name = (await caches.keys()).find((entry) => entry.startsWith(`jigsaw ${scope} `));
      const cache = await caches.open(name);
      return await cache.match(new URL('css/style.css', scope).href) &&
        await cache.match(new URL('pictures/great-wave.jpg', scope).href);
    }, { timeout: 60000 });
    await offline.page.clearHttpCache();
    await offline.page.prepareOfflineWorkerRestart();
    const workersCut = await offline.page.setOfflineEverywhere(true);
    assert.ok(workersCut >= 1, 'no service worker target was put offline');
    await offline.page.stopServiceWorkers();
    await offline.page.reload({ waitUntil: 'load', timeout: 60000 });
    await offline.page.waitForRunningWorker();
    await offline.page.waitForFunction(() => window.jigsaw &&
      document.querySelectorAll('.picture-tile').length === 21);
    const workersAfter = await offline.page.serviceWorkerIds();
    assert.ok(!offline.page.offlineWorkerError,
      `could not cut a restarting worker off from the network: ${offline.page.offlineWorkerError}`);
    assert.ok(workersAfter.every((id) => offline.page.cutWorkerIds.has(id)),
      'a service worker was not put offline');
    const resources = await offline.page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const files = performance.getEntriesByType('resource').filter((entry) =>
        !entry.name.startsWith('data:') && !entry.name.startsWith('blob:'));
      return { navigation: navigation.workerStart,
        names: files.map((entry) => new URL(entry.name).pathname),
        network: files.filter((entry) => entry.workerStart === 0).map((entry) => entry.name) };
    });
    assert.ok(resources.navigation > 0, 'the page came from network');
    for (const file of ['css/style.css', 'js/app.js', 'js/core.js',
      'js/render.js', 'js/music.js', 'js/musicScore.js', 'js/effects.js',
      'pictures/manifest.json'])
      assert.ok(resources.names.includes(new URL(file, url).pathname),
        `${file} was not loaded from the offline app: ${JSON.stringify(resources)}`);
    assert.deepEqual(resources.network, []);
    await start(offline.page);
    for (let id = 0; id < 32; id++) await place(offline.page, id, false);
    await offline.page.waitForFunction(() => jigsaw.state?.screen === 'done');
    assert.equal(await offline.page.$eval('#done-title', (node) => node.textContent),
      'The Great Wave, Katsushika Hokusai');
    const arcadeRule = await offline.page.evaluate(() => {
      const button = document.getElementById('arcade-link');
      const media = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
        .filter((rule) => rule instanceof CSSMediaRule &&
          rule.media.mediaText === '(display-mode: standalone)');
      return { shown: getComputedStyle(button).display !== 'none',
        hidden: media.flatMap((rule) => [...rule.cssRules]).some((rule) =>
          button.matches(rule.selectorText) && rule.style.display === 'none') };
    });
    assert.ok(arcadeRule.shown && arcadeRule.hidden);
    await checkErrors(offline.errors);
    console.log('offlineApp: pass');
  } finally {
    await offline.page.setOfflineEverywhere(false);
    await offline.page.close();
  }
  }
  console.log(
    `Browser check passed: ${checks} assertions, ${screenshots} screenshots.`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
