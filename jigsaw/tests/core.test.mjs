import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseGrid,
  cropForGrid,
  makeEdges,
  edgeSamples,
  makeScatter,
  layoutTable,
  findJoin,
  nearCorrect,
  complete,
  toScreen,
  toTable,
  zoomAt,
  clampView,
  validateSave,
  hashText,
  random,
  cropInsideImage,
  nextGesture,
  pieceOutline,
  sideCommands,
  imageDimensions,
  jpegOrientation,
} from "../js/core.js";
import { resolveRequest, createServer } from "../tools/serve.mjs";
import { mkdtemp, mkdir, writeFile, symlink, unlink, rm } from "node:fs/promises";
import path from "node:path";
test("grid and crop suit portrait, landscape and square images at all counts", () => {
  for (const count of [32, 64, 128])
    for (const [w, h] of [
      [1600, 900],
      [900, 1600],
      [1000, 1000],
    ]) {
      const [cols, rows] = chooseGrid(w, h, count),
        crop = cropForGrid(w, h, cols, rows),
        aspect = crop.width / cols / (crop.height / rows);
      assert.equal(cols * rows, count);
      assert.ok(aspect >= 0.8 - 1e-9 && aspect <= 1.25 + 1e-9);
      assert.ok(
        crop.x >= 0 &&
          crop.y >= 0 &&
          crop.x + crop.width <= w &&
          crop.y + crop.height <= h,
      );
    }
});
test("inner edges are shared, mirrored and have one tab side", () => {
  const cols = 8,
    rows = 4,
    edges = makeEdges(cols, rows, 42);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const id = y * cols + x;
      if (x < cols - 1) {
        assert.equal(edges[id].right, edges[id + 1].left);
        const a = edgeSamples(edges[id].right),
          b = edgeSamples(edges[id + 1].left, true);
        for (let i = 0; i < a.length; i++)
          assert.deepEqual(a[i], b[b.length - 1 - i]);
        assert.equal(Math.abs(edges[id].right.direction), 1);
      }
      if (y < rows - 1) assert.equal(edges[id].bottom, edges[id + cols].top);
    }
});
test("renderer outline commands coincide on adjacent boundaries", () => {
  const edges = makeEdges(2, 2, 42);
  const right = sideCommands(edges[0].right,
    { x: 1, y: 0 }, { x: 1, y: 1 }, false, false);
  const left = sideCommands(edges[1].left,
    { x: 0, y: 0 }, { x: 0, y: 1 }, false, true);
  const topLength = sideCommands(edges[0].top,
    { x: 0, y: 0 }, { x: 1, y: 0 }, true, false).length;
  assert.deepEqual(pieceOutline(edges[0]).slice(1 + topLength, 1 + topLength + 8), right);
  assert.equal(right.length, 8);
  assert.equal(left.length, 8);
  for (let index = 0; index < 8; index++) {
    const forward = right[index].slice(1);
    const backward = left[7 - index].slice(1).map((value, at) =>
      at % 2 === 0 ? value + 1 : value);
    const start = index === 0 ? [1, 0] : right[index - 1].slice(-2);
    assert.deepEqual(forward.slice(0, 2), backward.slice(2, 4));
    assert.deepEqual(forward.slice(2, 4), backward.slice(0, 2));
    assert.deepEqual(start, backward.slice(4, 6));
  }
});
test("scatter leaves at least half a cell visible", () => {
  for (const count of [32, 64, 128])
    for (const tall of [true, false]) {
      const [cols, rows] = chooseGrid(
          tall ? 800 : 1400,
          tall ? 1400 : 800,
          count,
        ),
        points = makeScatter(cols, rows, 77, tall);
      assert.equal(points.length, count);
      for (let i = 0; i < points.length; i++)
        for (let j = i + 1; j < points.length; j++) {
          const overlap =
            Math.max(0, 1 - Math.abs(points[i].x - points[j].x)) *
            Math.max(0, 1 - Math.abs(points[i].y - points[j].y));
          assert.ok(overlap <= 0.5);
        }
    }
});
test("responsive table fits the board and keeps loose cell areas visible", () => {
  const viewports = [
    [390, 740],
    [360, 535],
    [844, 295],
    [1180, 710],
    [1280, 690],
  ];
  for (const [width, height] of viewports) {
    for (const count of [32, 64, 128]) {
      const [cols, rows] = chooseGrid(1600, 900, count);
      const layout = layoutTable(cols, rows, 173, width, height);
      assert.equal(layout.slots.length, count);
      for (const slot of layout.slots) {
        const left = slot.x * layout.scale + layout.view.x;
        const top = slot.y * layout.scale + layout.view.y;
        const visibleWidth = Math.max(
          0,
          Math.min(width, left + layout.scale) - Math.max(0, left),
        );
        const visibleHeight = Math.max(
          0,
          Math.min(height, top + layout.scale) - Math.max(0, top),
        );
        assert.ok(visibleWidth * visibleHeight >= layout.scale ** 2 * 0.5);
      }
      for (let first = 0; first < layout.slots.length; first++) {
        let visibleSamples = 0;
        for (let sample = 0; sample < 100; sample++) {
          const x = layout.slots[first].x + ((sample % 10) + 0.5) / 10;
          const y =
            layout.slots[first].y + (Math.floor(sample / 10) + 0.5) / 10;
          const covered = layout.slots.some(
            (slot, id) =>
              id !== first &&
              x >= slot.x &&
              x <= slot.x + 1 &&
              y >= slot.y &&
              y <= slot.y + 1,
          );
          if (!covered) visibleSamples++;
        }
        assert.ok(
          visibleSamples >= 50,
          `piece ${first} has only ${visibleSamples}% visible area`,
        );
        for (let second = first + 1; second < layout.slots.length; second++) {
          const a = layout.slots[first];
          const b = layout.slots[second];
          const overlapWidth = Math.max(0, 1 - Math.abs(a.x - b.x));
          const overlapHeight = Math.max(0, 1 - Math.abs(a.y - b.y));
          assert.ok(overlapWidth * overlapHeight <= 0.5);
        }
      }
      if (count === 32 && width < height && width <= 390) {
        assert.ok(cols * layout.scale >= width * 0.85);
      }
      if (count === 32 && width > height) {
        assert.ok(rows * layout.scale >= height * 0.45);
      }
    }
  }
});
test("join works within tolerance and fails outside it", () => {
  const pieces = [
    { id: 0, x: 4, y: 4, group: 0, locked: false },
    { id: 1, x: 5.02, y: 4, group: 1, locked: false },
    { id: 2, x: 6.02, y: 4, group: 1, locked: false },
    { id: 3, x: 20, y: 20, group: 3, locked: false },
  ];
  assert.equal(findJoin(pieces, [0], 4, 1).otherId, 1);
  pieces[1].x = 5.31;
  assert.equal(findJoin(pieces, [0], 4, 1), null);
});
test("completion requires every piece locked", () => {
  assert.equal(complete([{ locked: true }, { locked: false }]), false);
  assert.equal(complete([{ locked: true }, { locked: true }]), true);
  assert.equal(complete([]), false);
});
test("table and screen coordinates convert both ways", () => {
  const view = { scale: 20, x: 50, y: 80 },
    point = toTable(160, 140, view);
  assert.deepEqual(toScreen(point.x, point.y, view), { x: 160, y: 140 });
});
test("zoom keeps the cursor point fixed", () => {
  const view = { scale: 20, x: 50, y: 80 };
  const point = toTable(160, 140, view);
  const next = zoomAt(view, 1.7, 160, 140, 1, 110);
  assert.deepEqual(toTable(160, 140, next), point);
  assert.deepEqual(toScreen(point.x, point.y, next), { x: 160, y: 140 });
});
test("save validation rejects malformed data", () => {
  const pictures = { "great-wave": { width: 1600, height: 1076 } };
  const valid = {
    pictureId: "great-wave",
    count: 32,
    grid: [8, 4],
    crop: { x: 0, y: 0, width: 800, height: 400 },
    seed: 7,
    elapsed: 1,
    pieces: Array.from({ length: 32 }, (_, id) => ({
      id,
      x: id,
      y: 0,
      group: id,
      locked: false,
    })),
  };
  assert.deepEqual(validateSave(valid, pictures), valid);
  const drawingOrder = { ...valid, hasMoves: true,
    pieces: [...valid.pieces].reverse() };
  assert.deepEqual(validateSave(drawingOrder, pictures), drawingOrder);
  for (const bad of [
    null,
    "abc",
    { ...valid, count: 64 },
    { ...valid, pictureId: "missing" },
    { ...valid, pieces: null },
    { ...valid, pieces: [] },
    { ...valid, elapsed: Infinity },
    { ...valid, seed: -1 },
    { ...valid, hasMoves: "yes" },
    { ...valid, gatherRest: "yes" },
    { ...valid, pieces: [valid.pieces[0], ...valid.pieces.slice(1, -1), valid.pieces[0]] },
    { ...valid, crop: { ...valid.crop, x: -1 } },
    { ...valid, crop: { x: 2000, y: 2000, width: 800, height: 400 } },
    {
      ...valid,
      pieces: valid.pieces.map((p, i) => (i ? p : { ...p, x: NaN })),
    },
    {
      ...valid,
      pieces: valid.pieces.map((p, i) => (i ? p : { ...p, y: 1001 })),
    },
  ])
    assert.equal(validateSave(bad, pictures), null);
  const grouped = structuredClone(valid);
  grouped.pieces[0] = { ...grouped.pieces[0], x: 0, y: 0, group: 0 };
  grouped.pieces[1] = { ...grouped.pieces[1], x: 1, y: 0, group: 0 };
  assert.deepEqual(validateSave(grouped, pictures), grouped);
  grouped.pieces[1].x = 0;
  assert.equal(validateSave(grouped, pictures), null);
  const locked = structuredClone(valid);
  locked.pieces[0] = { ...locked.pieces[0], x: 1, locked: true };
  assert.equal(validateSave(locked, pictures), null);
  assert.equal(cropInsideImage({ x: 2000, y: 2000, width: 800, height: 400 },
    { width: 1600, height: 900 }), false);
});
test("gesture transitions ignore extra fingers and end two fingers without a drag", () => {
  assert.equal(nextGesture("idle", "piece"), "dragging");
  assert.equal(nextGesture("dragging", "second"), "twoFingers");
  assert.equal(nextGesture("twoFingers", "third"), "twoFingers");
  assert.equal(nextGesture("twoFingers", "lift"), "idle");
  assert.equal(nextGesture("dragging", "cancel"), "idle");
  assert.equal(nextGesture("idle", "table"), "idle");
});
test("large photo headers expose dimensions before full bitmap decoding", () => {
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0);
  webp.write("WEBPVP8X", 8);
  webp[24] = 0x0f;
  webp[25] = 0x27;
  webp[27] = 0x3f;
  webp[28] = 0x1f;
  assert.deepEqual(imageDimensions(webp.buffer, "image/webp"),
    { width: 10000, height: 8000 });
  const segment = Buffer.alloc(65537);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(65535, 2);
  const frame = Buffer.alloc(19);
  frame[0] = 0xff;
  frame[1] = 0xc0;
  frame.writeUInt16BE(17, 2);
  frame.writeUInt16BE(8000, 5);
  frame.writeUInt16BE(10000, 7);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]),
    ...Array(17).fill(segment), frame]);
  assert.ok(jpeg.length > 1024 * 1024);
  assert.deepEqual(imageDimensions(jpeg.buffer, "image/jpeg"),
    { width: 10000, height: 8000 });
});
test("JPEG orientation reads the first image directory and rejects missing tags", () => {
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x12, 0x01, 0x03, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const bytes = jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength);
  assert.equal(jpegOrientation(bytes), 6);
  jpeg[30] = 1;
  assert.equal(jpegOrientation(jpeg.buffer.slice(jpeg.byteOffset,
    jpeg.byteOffset + jpeg.byteLength)), 1);
  assert.equal(jpegOrientation(new Uint8Array([0xff, 0xd8]).buffer), null);
});
test("server rejects traversal, dot paths, node modules, backslash and bad escapes", () => {
  const root = "/example/root";
  assert.equal(
    resolveRequest(root, "/jigsaw/").file,
    "/example/root/jigsaw/index.html",
  );
  assert.equal(resolveRequest(root, "/").file, "/example/root/index.html");
  assert.equal(resolveRequest(root, "/flappywitch/").file,
    "/example/root/flappywitch/index.html");
  assert.equal(resolveRequest(root, "/flappywitch/src/main.js").status, 200);
  assert.equal(resolveRequest(root, "/jigsaw/sw.js").status, 200);
  assert.equal(resolveRequest(root, "/jigsaw/manifest.webmanifest").status, 200);
  for (const request of [
    "/../secret",
    "/%2e%2e/secret",
    "/jigsaw/.scratch/x",
    "/jigsaw/node_modules/a",
    "/jigsaw/..\\secret",
    "/%E0%A4%A",
    "/jigsaw/./x",
    "/jigsaw/package.json",
    "/jigsaw/tests/core.test.mjs",
    "/jigsaw/tools/serve.mjs",
    "/flappywitch/test/rules.test.mjs",
    "/flappywitch/node_modules/x.js",
    "/README.md",
  ])
    assert.notEqual(resolveRequest(root, request).status, 200, request);
});
test("server redirects directories and blocks symlinks into private paths", async () => {
  const scratch = path.resolve(".scratch");
  await mkdir(scratch, { recursive: true });
  const fixture = await mkdtemp(path.join(scratch, "server-test-"));
  const game = path.join(fixture, "jigsaw");
  await mkdir(path.join(game, "js"), { recursive: true });
  await mkdir(path.join(game, ".scratch"));
  await writeFile(path.join(game, "index.html"), "game");
  await writeFile(path.join(game, "js", "public.json"), "public");
  await writeFile(path.join(game, ".scratch", "private.json"), "private");
  await symlink(path.join(game, ".scratch", "private.json"),
    path.join(game, "js", "alias.json"));
  const server = await createServer(fixture, async (actual) => {
    if (!actual.endsWith("public.json")) return;
    await unlink(actual);
    await symlink(path.join(game, ".scratch", "private.json"), actual);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const redirect = await fetch(`${origin}/jigsaw`, { redirect: "manual" });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get("location"), "/jigsaw/");
    const pictureDirectory = await fetch(`${origin}/jigsaw/pictures`,
      { redirect: "manual" });
    assert.equal(pictureDirectory.status, 301);
    assert.equal(pictureDirectory.headers.get("location"), "/jigsaw/pictures/");
    const page = await fetch(`${origin}/jigsaw/`);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), "game");
    const alias = await fetch(`${origin}/jigsaw/js/alias.json`);
    assert.equal(alias.status, 403);
    const swapped = await fetch(`${origin}/jigsaw/js/public.json`);
    assert.equal(swapped.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(fixture, { recursive: true, force: true });
  }
});

test("board snap threshold accepts inside and rejects outside", () => {
  assert.equal(nearCorrect({ id: 3, x: 3.299, y: 0 }, 8), true);
  assert.equal(nearCorrect({ id: 3, x: 3.301, y: 0 }, 8), false);
});
test("view clamp keeps the table reachable", () => {
  const bounds = { left: -2, top: -2, right: 10, bottom: 6 };
  const first = clampView({ x: 1000, y: -1000, scale: 30 }, bounds, 390, 640);
  assert.ok(first.x < 1000 && first.y > -1000);
  const second = clampView({ x: 0, y: 0, scale: 30 }, bounds, 390, 640);
  assert.equal(second.scale, 30);
});
test("seeded random sequence repeats", () => {
  const a = random(991),
    b = random(991);
  assert.deepEqual(
    Array.from({ length: 10 }, () => a()),
    Array.from({ length: 10 }, () => b()),
  );
});

test("photo saves require an image hash", () => {
  const base = {
    pictureId: "photo",
    count: 32,
    grid: [8, 4],
    crop: { x: 0, y: 0, width: 800, height: 400 },
    seed: 7,
    elapsed: 1,
    pieces: Array.from({ length: 32 }, (_, id) => ({
      id,
      x: id,
      y: 0,
      group: id,
      locked: false,
    })),
  };
  assert.equal(validateSave(base, {}), null);
  const valid = { ...base, photoHash: hashText("data:image/jpeg;base64,test") };
  assert.deepEqual(validateSave(valid, {}), valid);
  assert.notEqual(hashText("photo one"), hashText("photo two"));
});
test("view clamp centers a table smaller than the viewport", () => {
  const result = clampView(
    { x: 999, y: -999, scale: 10 },
    { left: 0, top: 0, right: 4, bottom: 3 },
    400, 300,
  );
  assert.equal(result.x, 180);
  assert.equal(result.y, 135);
});
