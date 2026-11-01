import {
  chooseGrid,
  cropForGrid,
  makeEdges,
  layoutTable,
  findJoin,
  nearCorrect,
  complete,
  clamp,
  toTable,
  toScreen,
  zoomAt,
  clampView,
  validateSave,
  cropInsideImage,
  nextGesture,
  imageDimensions,
  jpegOrientation,
  hashText,
  random,
} from "./core.js";
import { buildPieceImages, drawScene, imageHit } from "./render.js";
import { createMusic } from "./music.js";
import { playEffect } from "./effects.js";
const SAVE_INTERVAL_MS = 1000;
const MAX_PIECE_PIXELS = 110;
const ZOOM_BUTTON_FACTOR = 1.35;
const TAP_DISTANCE_PIXELS = 6;
const $ = (id) => document.getElementById(id);
const elements = {
  chooser: $("chooser"),
  crop: $("crop-screen"),
  play: $("play-screen"),
  canvas: $("table"),
  stage: $("stage"),
};
let manifest = [],
  selection = null,
  count = 32,
  state = null,
  image = null,
  pieceImages = [],
  edges = null;
let guide = false,
  peek = false,
  dragged = null,
  pointers = new Map(),
  pinch = null,
  gesture = "idle",
  redrawPending = false;
let cropImage = null,
  cropCenter = { x: 0.5, y: 0.5 },
  cropZoom = 1,
  cropPointers = new Map();
let photoRequest = 0,
  navigationPending = false,
  storageReliable = true,
  saveReadFailed = false;
let photoCleanup = Promise.resolve();
let tilePointer = null;
let storage = { lastCount: 32, sound: true, music: true, best: {}, game: null };
let saveNoticeShown = false;
let offlineReadyTimer = null;
let audio = null,
  music = null,
  hideAudioTimer = null,
  visibilityGeneration = 0,
  saveTimer = null,
  lastSave = 0,
  lastSavedGame = null,
  imageBuildTimer = null,
  resizeTimer = null,
  celebration = [];
const parameters = new URLSearchParams(location.search);
const querySeed = parameters.has("seed")
  ? Number(parameters.get("seed"))
  : null;
function readStorage() {
  try {
    const value = JSON.parse(localStorage.getItem("jigsaw.v1") || "{}");
    const raw = value && typeof value === "object" && !Array.isArray(value)
      ? value : {};
    if ([32, 64, 128].includes(raw.lastCount))
      storage.lastCount = raw.lastCount;
    if (typeof raw.sound === "boolean") storage.sound = raw.sound;
    if (typeof raw.music === "boolean") storage.music = raw.music;
    if (raw.best && typeof raw.best === "object" && !Array.isArray(raw.best))
      for (const [key, value] of Object.entries(raw.best)) {
        const [pictureId, pieceCount] = key.split("|");
        const knownPicture =
          pictureId === "photo" ||
          manifest.some((item) => item.id === pictureId);
        if (
          knownPicture &&
          [32, 64, 128].includes(Number(pieceCount)) &&
          Number.isFinite(value) &&
          value >= 0
        )
          storage.best[key] = value;
      }
    storage.game = validateSave(raw.game,
      Object.fromEntries(manifest.map((item) => [item.id, item])));
    if (storage.game && storage.game.hasMoves === undefined) {
      const wasHidden = elements.play.classList.contains("hidden");
      elements.play.classList.remove("hidden");
      const slots = layoutTable(...storage.game.grid, storage.game.seed,
        elements.stage.clientWidth, elements.stage.clientHeight).slots;
      elements.play.classList.toggle("hidden", wasHidden);
      storage.game.hasMoves = storage.game.elapsed > 0 ||
        storage.game.pieces.some((piece) =>
          piece.x !== slots[piece.id].x || piece.y !== slots[piece.id].y);
    }
    count = storage.lastCount;
    return true;
  } catch {
    saveReadFailed = true;
    storageReliable = false;
    storage.game = null;
    count = storage.lastCount;
    return false;
  }
}
function newSaveToken() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const values = crypto.getRandomValues(new Uint32Array(4));
    return `random-${[...values].map((value) => value.toString(16).padStart(8, "0")).join("")}`;
  }
  return `time-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function writeStorage(retainedPhotoHash = storage.game?.photoHash) {
  if (!storageReliable) {
    storage.game = null;
    updateContinue();
    return false;
  }
  try {
    storage.gameToken = newSaveToken();
    localStorage.setItem("jigsaw.v1", JSON.stringify(storage));
    if (storage.game === null) lastSavedGame = null;
    queuePhotoCleanup(retainedPhotoHash);
    return true;
  } catch {
    storageReliable = false;
    storage.game = null;
    lastSavedGame = null;
    if (elements.chooser) updateContinue();
    if (!saveNoticeShown) {
      saveNoticeShown = true;
      $("save-notice").textContent = "Progress can't be saved in this browser";
    }
    return false;
  }
}
function save(force = false) {
  if (state?.screen !== "play") return;
  if (state.pictureId === "photo" && !state.resumeAllowed) {
    return;
  }
  const now = Date.now();
  if (force) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // A single delayed write keeps rapid drags from writing storage on every drop.
  if (!force && now - lastSave < SAVE_INTERVAL_MS) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), SAVE_INTERVAL_MS - (now - lastSave));
    return;
  }
  lastSave = now;
  storage.game = {
    pictureId: state.pictureId,
    photoHash: state.photoHash,
    count: state.count,
    grid: state.grid,
    crop: state.crop,
    seed: state.seed,
    pieces: state.pieces
      .map(({ id, x, y, group, locked }) => ({ id, x, y, group, locked })),
    hasMoves: state.hasMoves,
    gatherRest: state.gatherRest,
    elapsed: elapsed(),
  };
  const payload = JSON.stringify(storage.game);
  if (payload === lastSavedGame) return;
  if (writeStorage()) lastSavedGame = payload;
}
function discardPuzzle() {
  pauseTimer();
  clearTimeout(saveTimer);
  saveTimer = null;
  showScreen("chooser");
  state = null;
  image = null;
  pieceImages = [];
  edges = null;
  storage.game = null;
  writeStorage();
  updateContinue();
}
function showScreen(screen, openingView = false) {
  if (screen !== "chooser") hideOfflineReady();
  elements.chooser.classList.toggle("hidden", screen !== "chooser");
  elements.crop.classList.toggle("hidden", screen !== "crop");
  elements.play.classList.toggle(
    "hidden",
    screen !== "play" && screen !== "done",
  );
  if (state) state.screen = screen;
  if (screen === "play" || screen === "done") {
    requestAnimationFrame(() => {
      if (openingView && state?.screen === "play") {
        state.view = { ...state.defaultView };
        state.minScale = state.view.scale;
      } else fitView();
      rebuildImages();
      draw();
    });
  }
}
function hideOfflineReady() {
  clearTimeout(offlineReadyTimer);
  offlineReadyTimer = null;
  const note = $("offline-ready");
  note.classList.add("hidden");
  note.textContent = "";
}
function showOfflineReady() {
  if (elements.chooser.classList.contains("hidden")) return;
  const note = $("offline-ready");
  note.textContent = "Ready to play offline";
  note.classList.remove("hidden");
  clearTimeout(offlineReadyTimer);
  offlineReadyTimer = setTimeout(hideOfflineReady, 3000);
}
function updateCounts() {
  document.querySelectorAll("[data-count]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.count) === count);
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.count) === count),
    );
  });
}
function chooserMessage(message) {
  $("chooser-message").textContent = message;
}
function trackTileGesture(button) {
  button.addEventListener("pointerdown", (event) => {
    tilePointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scroll: window.scrollY,
      dragged: false,
    };
  });
  button.addEventListener("pointermove", (event) => {
    if (tilePointer?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - tilePointer.x,
      event.clientY - tilePointer.y) >= TAP_DISTANCE_PIXELS)
      tilePointer.dragged = true;
  });
  button.addEventListener("pointercancel", () => {
    if (tilePointer) tilePointer.dragged = true;
  });
}
function tileClickWasDrag(event) {
  const dragged = event.detail !== 0 && tilePointer &&
    (tilePointer.dragged ||
      Math.abs(window.scrollY - tilePointer.scroll) >= 2);
  tilePointer = null;
  return dragged;
}
function renderChooser() {
  $("picture-grid").replaceChildren();
  for (const item of manifest) {
    const button = document.createElement("button");
    button.className = "picture-tile";
    button.type = "button";
    button.innerHTML = `
      <img src="${item.thumb}" alt="">
      <span class="tile-copy"><strong></strong><span></span></span>
    `;
    button.querySelector("strong").textContent = item.title;
    button.querySelector(".tile-copy span").textContent = item.artist;
    trackTileGesture(button);
    button.addEventListener("click", (event) => {
      if (tileClickWasDrag(event)) return;
      ++photoRequest;
      selection = item;
      updateSelection();
      navigate(async () => {
        unlockAudio();
        const previous = storage.game;
        const samePuzzle = previous && previous.pictureId === item.id &&
          previous.count === count;
        if (samePuzzle) {
          await continueGame();
          return;
        }
        if (previous?.hasMoves && !(await askToReplace())) return;
        await startPuzzle(item);
      });
    });
    button.dataset.picture = item.id;
    $("picture-grid").append(button);
  }
  const photo = document.createElement("button");
  photo.className = "picture-tile";
  photo.type = "button";
  photo.dataset.picture = "photo";
  photo.innerHTML = `
    <span class="photo-tile-art">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg>
    </span>
    <span class="tile-copy"><strong>Your photo</strong><span>Choose from your device</span></span>
  `;
  trackTileGesture(photo);
  photo.addEventListener("click", (event) => {
    if (!tileClickWasDrag(event)) $("photo-input").click();
  });
  $("picture-grid").append(photo);
  updateCounts();
  updateContinue();
}
function updateSelection() {
  document.querySelectorAll(".picture-tile").forEach((tile) =>
    tile.classList.toggle("selected", tile.dataset.picture === selection?.id));
}
function askToReplace() {
  return new Promise((resolve) => {
    const dialog = $("replace-dialog");
    const start = $("replace-start");
    const cancel = $("replace-cancel");
    const finish = (accepted) => {
      dialog.close();
      start.removeEventListener("click", onStart);
      cancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      resolve(accepted);
    };
    const onStart = () => finish(true);
    const onCancel = (event) => { event.preventDefault(); finish(false); };
    start.addEventListener("click", onStart);
    cancel.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);
    dialog.showModal();
  });
}
function updateContinue() {
  const game = storage.game;
  $("continue-card").classList.toggle("hidden", !game);
  if (!game) {
    $("continue-error").textContent = "";
    return;
  }
  $("continue-name").textContent =
    game.pictureId === "photo"
      ? "Your photo"
      : manifest.find((item) => item.id === game.pictureId)?.title || "Puzzle";
  $("continue-progress").textContent =
    `${game.pieces.filter((piece) => piece.locked).length} of ${game.count} pieces placed`;
}
function setNavigationPending(pending) {
  navigationPending = pending;
  document.querySelectorAll(
    "#chooser button, #crop-screen button, #crop-zoom, #play-back, #new-button, #done-new, #again-button",
  ).forEach((control) => { control.disabled = pending; });
}
async function navigate(action) {
  if (navigationPending) return;
  setNavigationPending(true);
  try { await action(); }
  finally { setNavigationPending(false); }
}
async function decodeFile(file) {
  if (!file.type.startsWith("image/")) throw Error("Choose an image file.");
  const header = await file.slice(0, 16 * 1024 * 1024).arrayBuffer();
  const dimensions = imageDimensions(header, file.type);
  if (dimensions && (dimensions.width <= 0 || dimensions.height <= 0))
    throw Error("This photo has invalid dimensions.");
  const large = dimensions && Math.max(dimensions.width, dimensions.height) > 2048;
  const overLimit = dimensions && dimensions.width * dimensions.height > 60_000_000;
  const orientation = file.type === "image/jpeg" ? jpegOrientation(header) : 1;
  const needsFullDecode = file.type === "image/jpeg" &&
    (orientation === null || orientation >= 5);
  if (needsFullDecode && overLimit)
    throw Error("Photo exceeds 60 megapixels and reduced decoding is unavailable.");
  if (window.createImageBitmap) {
    try {
      if (large && !needsFullDecode) {
        const scale = 2048 / Math.max(dimensions.width, dimensions.height);
        const reduced = await createImageBitmap(file, {
          imageOrientation: "from-image",
          resizeWidth: Math.max(1, Math.round(dimensions.width * scale)),
          resizeHeight: Math.max(1, Math.round(dimensions.height * scale)),
          resizeQuality: "high",
        });
        if (overLimit && Math.max(reduced.width, reduced.height) > 2048) {
          reduced.close();
          throw Error("Photo exceeds 60 megapixels and reduced decoding is unavailable.");
        }
        return reduced;
      }
      const decoded = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (decoded.width * decoded.height > 60_000_000) {
        decoded.close();
        throw Error("Photo exceeds 60 megapixels and reduced decoding is unavailable.");
      }
      return decoded;
    } catch (error) {
      if (error.message.includes("60 megapixels")) throw error;
      /* Fallback handles browsers without this option. */
    }
  }
  if (overLimit) throw Error("Photo exceeds 60 megapixels and reduced decoding is unavailable.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.width * img.height > 60_000_000)
      throw Error("Photo exceeds 60 megapixels and reduced decoding is unavailable.");
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
function downscale(source) {
  const scale = Math.min(1, 2048 / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return canvas;
}
function cropBounds() {
  const grid = chooseGrid(cropImage.width, cropImage.height, count);
  const base = cropForGrid(cropImage.width, cropImage.height, ...grid);
  const width = base.width / cropZoom,
    height = base.height / cropZoom;
  return {
    x: clamp(
      cropCenter.x * cropImage.width - width / 2,
      0,
      cropImage.width - width,
    ),
    y: clamp(
      cropCenter.y * cropImage.height - height / 2,
      0,
      cropImage.height - height,
    ),
    width,
    height,
  };
}
function drawCrop() {
  if (!cropImage || elements.crop.classList.contains("hidden")) return;
  const canvas = $("crop-canvas"),
    rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#345447";
  ctx.fillRect(0, 0, rect.width, rect.height);
  const crop = cropBounds(),
    frameAspect = crop.width / crop.height;
  let frameW = rect.width * 0.8,
    frameH = frameW / frameAspect;
  if (frameH > rect.height * 0.82) {
    frameH = rect.height * 0.82;
    frameW = frameH * frameAspect;
  }
  const x = (rect.width - frameW) / 2,
    y = (rect.height - frameH) / 2;
  ctx.drawImage(
    cropImage,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    x,
    y,
    frameW,
    frameH,
  );
  ctx.strokeStyle = "#f9edd6";
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, frameW, frameH);
  ctx.strokeStyle = "#fff9";
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (frameW * i) / 3, y);
    ctx.lineTo(x + (frameW * i) / 3, y + frameH);
    ctx.moveTo(x, y + (frameH * i) / 3);
    ctx.lineTo(x + frameW, y + (frameH * i) / 3);
    ctx.stroke();
  }
  canvas._frame = { x, y, width: frameW, height: frameH, crop };
}
async function photoStore(mode, action) {
  return new Promise((resolve) => {
    let db = null;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (db) db.close();
      resolve(value);
    };
    try {
      const request = indexedDB.open("jigsaw-photo", 1);
      request.onupgradeneeded = () => {
        db = request.result;
        if (!request.result.objectStoreNames.contains("images"))
          request.result.createObjectStore("images");
      };
      request.onblocked = () => finish(null);
      request.onerror = () => finish(null);
      request.onsuccess = () => {
        db = request.result;
        if (settled) {
          db.close();
          return;
        }
        try {
          const transaction = db.transaction("images", mode);
          const itemRequest = action(transaction.objectStore("images"));
          itemRequest.onerror = () => finish(null);
          transaction.onabort = () => finish(null);
          transaction.onerror = () => finish(null);
          transaction.oncomplete = () => finish(mode === "readonly"
            ? (itemRequest.result === undefined
              ? { status: "missing" }
              : { status: "found", value: itemRequest.result })
            : true);
        } catch {
          finish(null);
        }
      };
    } catch {
      finish(null);
    }
  });
}
async function storePhoto(dataUrl, hash) {
  await photoCleanup;
  return (await photoStore("readwrite", (store) => store.put(dataUrl, hash))) === true;
}
async function loadPhoto(hash) {
  return photoStore("readonly", (store) => store.get(hash));
}
async function cleanUnusedPhotos(savedHash) {
  await photoStore("readwrite", (store) => {
    const request = store.getAllKeys();
    request.onsuccess = () => {
      for (const hash of request.result)
        if (hash !== savedHash) store.delete(hash);
    };
    return request;
  });
}
function queuePhotoCleanup(savedHash) {
  if (saveReadFailed) return;
  photoCleanup = photoCleanup.then(() => cleanUnusedPhotos(savedHash));
}
function persistedPhotoHash() {
  try {
    const game = JSON.parse(localStorage.getItem("jigsaw.v1") || "{}").game;
    return { readable: true, hash: game?.photoHash };
  } catch {
    return { readable: false, hash: null };
  }
}
async function decodeUrl(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}
async function startPuzzle(
  item,
  photo = null,
  resume = null,
  photoOptions = {},
) {
  try {
    const source = photo || (await decodeUrl(item.file));
    image = source;
    const grid = resume?.grid || chooseGrid(source.width, source.height, count);
    const crop =
      resume?.crop ||
      (photo
        ? { x: 0, y: 0, width: source.width, height: source.height }
        : cropForGrid(source.width, source.height, ...grid));
    if (!cropInsideImage(crop, source)) {
      const error = Error("Saved crop is outside the picture");
      error.invalidSave = true;
      throw error;
    }
    const seed =
      resume?.seed ??
      (Number.isInteger(querySeed) && querySeed >= 0 && querySeed <= 0xffffffff
        ? querySeed
        : Math.floor(Math.random() * 0xffffffff));
    edges = makeEdges(...grid, seed);
    for (const id of ["play-title", "done-title"]) {
      const heading = $(id);
      heading.querySelector(".heading-name").textContent = photo ? "Your photo" : item.title;
      heading.querySelector(".heading-artist").textContent = photo ? "" : `, ${item.artist}`;
    }
    elements.play.classList.remove("hidden");
    const layout = layoutTable(
      ...grid,
      seed,
      elements.stage.clientWidth,
      elements.stage.clientHeight,
    );
    const slots = layout.slots;
    const pieces =
      resume?.pieces ||
      slots.map((point, id) => ({
        id,
        x: point.x,
        y: point.y,
        group: id,
        locked: false,
      }));
    const allPositions = slots.concat(pieces);
    const helperBaseBounds = {
      left: Math.min(-0.5, ...slots.map((p) => p.x - 0.55)),
      top: Math.min(-0.5, ...slots.map((p) => p.y - 0.55)),
      right: Math.max(grid[0] + 0.5, ...slots.map((p) => p.x + 1.55)),
      bottom: Math.max(grid[1] + 0.5, ...slots.map((p) => p.y + 1.55)),
    };
    const tableBounds = {
      left: Math.min(-0.5, ...allPositions.map((p) => p.x - 0.55)),
      top: Math.min(-0.5, ...allPositions.map((p) => p.y - 0.55)),
      right: Math.max(grid[0] + 0.5, ...allPositions.map((p) => p.x + 1.55)),
      bottom: Math.max(grid[1] + 0.5, ...allPositions.map((p) => p.y + 1.55)),
    };
    state = {
      tableBounds,
      helperBaseBounds,
      minScale: layout.scale,
      defaultView: layout.view,
      layoutWidth: elements.stage.clientWidth,
      layoutHeight: elements.stage.clientHeight,
      screen: "play",
      pictureId: photo ? "photo" : item.id,
      photoHash: photo ? resume?.photoHash || photoOptions.hash : undefined,
      resumeAllowed: photo ? photoOptions.resumeAllowed !== false : true,
      count: grid[0] * grid[1],
      grid,
      crop,
      seed,
      pieces,
      hasMoves: resume?.hasMoves ?? Boolean(resume &&
        (resume.elapsed > 0 || resume.pieces.some((piece) =>
          piece.x !== slots[piece.id].x || piece.y !== slots[piece.id].y))),
      gatherRest: resume?.gatherRest ?? false,
      elapsed: resume?.elapsed || 0,
      started: (resume?.elapsed || 0) > 0,
      runAt: resume?.elapsed > 0 && !document.hidden ? performance.now() : null,
      view: layout.view,
    };
    if (music) music.seed = seed;
    guide = false;
    peek = false;
    dragged = null;
    pointers.clear();
    pinch = null;
    gesture = "idle";
    $("edges-button").querySelector("small").textContent =
      state.gatherRest ? "Rest" : "Edges";
    $("guide-button").setAttribute("aria-pressed", "false");
    $("done-card").classList.add("hidden");
    $("menu").classList.add("hidden");
    $("peek-overlay").classList.add("hidden");
    if (photo) {
      $("peek-image").src = photoOptions.dataUrl ||
        (photo.toDataURL ? photo.toDataURL("image/jpeg", 0.85) : photo.src);
    } else {
      const preview = document.createElement("canvas");
      preview.width = Math.round(crop.width);
      preview.height = Math.round(crop.height);
      preview.getContext("2d").drawImage(source, crop.x, crop.y,
        crop.width, crop.height, 0, 0, preview.width, preview.height);
      $("peek-image").src = preview.toDataURL("image/png");
    }
    showScreen("play", !resume);
    updateStatus();
    save(true);
    return true;
  } catch (error) {
    if (resume && error.invalidSave) {
      storage.game = null;
      writeStorage();
      updateContinue();
    }
    showScreen("chooser");
    chooserMessage(`Could not open the picture: ${error.message}`);
    return false;
  }
}
function elapsed() {
  if (!state) return 0;
  return (
    state.elapsed + (state.runAt ? (performance.now() - state.runAt) / 1000 : 0)
  );
}
function formatTime(seconds) {
  const total = Math.floor(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function updateStatus() {
  if (!state) return;
  $("progress").textContent =
    `${state.pieces.filter((p) => p.locked).length} / ${state.count}`;
  $("timer").textContent = formatTime(elapsed());
}
function startTimer() {
  if (!state.started) state.started = true;
  if (!state.runAt && !document.hidden) state.runAt = performance.now();
}
function pauseTimer() {
  if (state?.runAt) {
    state.elapsed = elapsed();
    state.runAt = null;
  }
}
function viewBounds() {
  return state.tableBounds;
}
function fitBounds(bounds) {
  if (!state || !elements.stage.clientWidth || !elements.stage.clientHeight)
    return;
  const width = elements.stage.clientWidth,
    height = elements.stage.clientHeight;
  const scale = Math.min(
    (width - 26) / (bounds.right - bounds.left),
    (height - 22) / (bounds.bottom - bounds.top),
  );
  state.minScale = scale;
  state.view = {
    scale,
    x: (width - (bounds.left + bounds.right) * scale) / 2,
    y: (height - (bounds.top + bounds.bottom) * scale) / 2,
  };
  draw();
}
// Drops stay inside the table bounds. Edges, Rest, and Shuffle can change the bounds;
// otherwise Fit uses the same frame until the screen size changes.
function fitView() {
  if (!state) return;
  if (state.screen === "done") {
    fitDone();
    return;
  }
  fitBounds(state.tableBounds);
}
function fitDone() {
  const [cols, rows] = state.grid;
  const card = $("done-card").getBoundingClientRect();
  const stage = elements.stage.getBoundingClientRect();
  const tall = stage.height > stage.width;
  const padding = 18;
  const width = tall ? stage.width : card.left - stage.left;
  const height = tall ? card.top - stage.top : stage.height;
  const scale = Math.min(
    (width - 2 * padding) / cols,
    (height - 2 * padding) / rows,
  );
  state.view = {
    scale,
    x: padding + (width - 2 * padding - cols * scale) / 2,
    y: padding + (height - 2 * padding - rows * scale) / 2,
  };
  draw();
}
function updateTableBounds() {
  const [cols, rows] = state.grid,
    points = state.pieces;
  state.tableBounds = {
    left: Math.min(-0.5, ...points.map((p) => p.x - 0.85)),
    top: Math.min(-0.5, ...points.map((p) => p.y - 0.85)),
    right: Math.max(cols + 0.5, ...points.map((p) => p.x + 1.85)),
    bottom: Math.max(rows + 0.5, ...points.map((p) => p.y + 1.85)),
  };
}
function changeZoom(
  factor,
  x = elements.stage.clientWidth / 2,
  y = elements.stage.clientHeight / 2,
) {
  if (!state) return;
  const minimum = state.minScale;
  state.view = clampView(
    zoomAt(state.view, factor, x, y, minimum,
      Math.max(minimum, MAX_PIECE_PIXELS)),
    viewBounds(),
    elements.stage.clientWidth,
    elements.stage.clientHeight,
  );
  draw();
  clearTimeout(imageBuildTimer);
  imageBuildTimer = setTimeout(rebuildImages, 180);
}
function rebuildImages() {
  if (!state || !image) return;
  pieceImages = buildPieceImages(
    image,
    state.crop,
    ...state.grid,
    edges,
    state.view.scale * Math.min(2, devicePixelRatio || 1) * 1.3,
  );
  draw();
}
function draw() {
  if (
    redrawPending ||
    !state ||
    elements.play.classList.contains("hidden") ||
    !pieceImages.length
  )
    return;
  redrawPending = true;
  requestAnimationFrame(() => {
    redrawPending = false;
    if (!state || elements.play.classList.contains("hidden")) return;
    drawScene(
      elements.canvas,
      state,
      image,
      pieceImages,
      guide,
      dragged,
      celebration,
    );
  });
}
function pickPiece(x, y) {
  const point = toTable(x, y, state.view);
  for (let i = state.pieces.length - 1; i >= 0; i--) {
    const piece = state.pieces[i];
    if (piece.locked) continue;
    if (imageHit(pieceImages[piece.id], point.x - piece.x, point.y - piece.y))
      return piece;
  }
  return null;
}
function moveGroup(group, dx, dy) {
  for (const piece of state.pieces)
    if (!piece.locked && piece.group === group) {
      piece.x += dx;
      piece.y += dy;
      if (dx || dy) state.hasMoves = true;
    }
}
function promoteGroup(group) {
  const selected = state.pieces.filter((piece) => piece.group === group);
  state.pieces = state.pieces
    .filter((piece) => piece.group !== group)
    .concat(selected);
}
function members(group) {
  return state.pieces.filter((piece) => !piece.locked && piece.group === group);
}
function dropGroup(group) {
  const groupPieces = members(group),
    anchor = groupPieces.find((piece) => nearCorrect(piece, state.grid[0]));
  if (anchor) {
    const from = new Map(
      groupPieces.map((piece) => [piece.id, { x: piece.x, y: piece.y }]),
    );
    moveGroup(
      group,
      (anchor.id % state.grid[0]) - anchor.x,
      Math.floor(anchor.id / state.grid[0]) - anchor.y,
    );
    for (const piece of groupPieces) {
      piece.anim = {
        ...from.get(piece.id),
        start: performance.now(),
        duration: 180,
      };
      piece.x = piece.id % state.grid[0];
      piece.y = Math.floor(piece.id / state.grid[0]);
      piece.locked = true;
    }
    animatePieces();
    sound("snap");
    updateStatus();
    if (complete(state.pieces)) finish();
    return;
  }
  let joined = false;
  for (let tries = 0; tries < state.count; tries++) {
    const join = findJoin(
      state.pieces,
      members(group).map((piece) => piece.id),
      ...state.grid,
    );
    if (!join) break;
    const otherGroup = state.pieces.find(
      (piece) => piece.id === join.otherId,
    ).group;
    if (otherGroup === group) break;
    moveGroup(group, join.dx, join.dy);
    for (const piece of state.pieces)
      if (piece.group === otherGroup) piece.group = group;
    joined = true;
  }
  if (joined) sound("join");
  const bounds = viewBounds(),
    groupPiecesAfter = members(group);
  const left = Math.min(...groupPiecesAfter.map((piece) => piece.x)),
    top = Math.min(...groupPiecesAfter.map((piece) => piece.y));
  const right = Math.max(...groupPiecesAfter.map((piece) => piece.x + 1)),
    bottom = Math.max(...groupPiecesAfter.map((piece) => piece.y + 1));
  const dx =
    left < bounds.left
      ? bounds.left - left
      : right > bounds.right
        ? bounds.right - right
        : 0;
  const dy =
    top < bounds.top
      ? bounds.top - top
      : bottom > bounds.bottom
        ? bounds.bottom - bottom
        : 0;
  if (dx || dy) moveGroup(group, dx, dy);
}
function pointerDown(event) {
  if (state?.screen !== "play") return;
  if (pointers.size >= 2) return;
  elements.canvas.setPointerCapture(event.pointerId);
  const x = event.clientX - elements.canvas.getBoundingClientRect().left,
    y = event.clientY - elements.canvas.getBoundingClientRect().top;
  pointers.set(event.pointerId, { x, y, startX: x, startY: y, maxDistance: 0 });
  if (pointers.size === 2) {
    if (dragged) {
      cancelDrag();
    }
    const [first, second] = [...pointers.values()];
    pinch = {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      midpoint: { x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2 },
    };
    gesture = nextGesture(gesture, "second");
    return;
  }
  const piece = pickPiece(x, y);
  if (piece) {
    promoteGroup(piece.group);
    dragged = {
      group: piece.group,
      pointerId: event.pointerId,
      lastX: x,
      lastY: y,
      original: members(piece.group).map(({ id, x, y }) => ({ id, x, y })),
      progress: { started: state.started, runAt: state.runAt,
        elapsed: state.elapsed, hasMoves: state.hasMoves },
    };
    gesture = nextGesture(gesture, "piece");
    sound("pick");
    draw();
  } else {
    gesture = nextGesture(gesture, "table");
  }
}
function cancelDrag() {
  if (!dragged) return;
  for (const original of dragged.original) {
    const piece = state.pieces.find((item) => item.id === original.id);
    piece.x = original.x;
    piece.y = original.y;
  }
  Object.assign(state, dragged.progress);
  updateStatus();
  dragged = null;
  draw();
}
function pointerMove(event) {
  const pointer = pointers.get(event.pointerId);
  if (!pointer || !state) return;
  const x = event.clientX - elements.canvas.getBoundingClientRect().left,
    y = event.clientY - elements.canvas.getBoundingClientRect().top;
  pointer.maxDistance = Math.max(
    pointer.maxDistance,
    Math.hypot(x - pointer.startX, y - pointer.startY),
  );
  const oldX = pointer.x;
  const oldY = pointer.y;
  pointer.x = x;
  pointer.y = y;
  if (gesture === "twoFingers" && pointers.size === 2) {
    const [first, second] = [...pointers.values()];
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    const midpoint = { x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2 };
    if (pinch?.distance) {
      changeZoom(distance / pinch.distance, pinch.midpoint.x, pinch.midpoint.y);
      state.view.x += midpoint.x - pinch.midpoint.x;
      state.view.y += midpoint.y - pinch.midpoint.y;
      state.view = clampView(state.view, viewBounds(),
        elements.stage.clientWidth, elements.stage.clientHeight);
      draw();
    }
    pinch = { distance, midpoint };
    return;
  }
  if (dragged?.pointerId === event.pointerId) {
    if (pointer.maxDistance >= TAP_DISTANCE_PIXELS) startTimer();
    moveGroup(
      dragged.group,
      (x - dragged.lastX) / state.view.scale,
      (y - dragged.lastY) / state.view.scale,
    );
    dragged.lastX = x;
    dragged.lastY = y;
    draw();
    return;
  }
  state.view.x += x - oldX;
  state.view.y += y - oldY;
  state.view = clampView(state.view, viewBounds(),
    elements.stage.clientWidth, elements.stage.clientHeight);
  draw();
}
function pointerUp(event) {
  const pointer = pointers.get(event.pointerId);
  pointers.delete(event.pointerId);
  unlockAudio();
  if (!pointer || !state) return;
  if (gesture === "twoFingers") {
    pinch = null;
    gesture = nextGesture(gesture, "lift");
    return;
  }
  if (dragged?.pointerId === event.pointerId) {
    const group = dragged.group;
    if (pointer.maxDistance >= TAP_DISTANCE_PIXELS) {
      dragged = null;
      dropGroup(group);
    } else {
      cancelDrag();
      for (const piece of members(group)) piece.wiggle = performance.now();
      animatePieces();
    }
    save();
    draw();
  }
  gesture = nextGesture(gesture, "lift");
}
function pointerCancel(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.clear();
  pinch = null;
  cancelDrag();
  gesture = nextGesture(gesture, "cancel");
}
function animatePieces() {
  if (!state || elements.play.classList.contains("hidden")) {
    state?.pieces.forEach((piece) => {
      delete piece.anim;
      delete piece.wiggle;
    });
    return;
  }
  const active = state?.pieces.some((piece) => piece.anim || piece.wiggle);
  if (!active) return;
  draw();
  requestAnimationFrame(animatePieces);
}
function finish() {
  pauseTimer();
  state.screen = "done";
  state.shineStart = performance.now();
  updateStatus();
  const key = `${state.pictureId}|${state.count}`,
    time = elapsed(),
    old = storage.best[key];
  const best = old === undefined || time < old;
  if (best) storage.best[key] = time;
  clearTimeout(saveTimer);
  saveTimer = null;
  storage.game = null;
  writeStorage(state.pictureId === "photo" ? state.photoHash : undefined);
  $("done-time").textContent = `Your time: ${formatTime(time)}`;
  $("best-time").textContent =
    `${best ? "New best! " : "Best time: "}${formatTime(storage.best[key])}`;
  $("done-card").classList.remove("hidden");
  fitDone();
  rebuildImages();
  sound("done");
  music?.dip();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const next = random(state.seed ^ 0x8271);
    celebration = Array.from({ length: 55 }, () => ({
      x: next() * elements.stage.clientWidth,
      y: -next() * 200,
      size: 3 + next() * 5,
      color: ["#e8bf70", "#f7e9d0", "#a4c5ae", "#d67c64"][
        Math.floor(next() * 4)
      ],
    }));
    let frames = 0;
    const animate = () => {
      if (state?.screen !== "done") return;
      for (const bit of celebration) bit.y += 2 + bit.size * 0.35;
      draw();
      if (++frames < 160) requestAnimationFrame(animate);
      else {
        celebration = [];
        draw();
      }
    };
    animate();
  }
}
function sound(kind) {
  if (!storage.sound || !audio || audio.state !== "running") return;
  playEffect(audio, kind);
}
function unlockAudio() {
  // Safari on iOS resumes audio only from a user gesture such as a click or pointer release.
  if (!storage.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (!music) {
      music = createMusic(audio);
      music.seed = state?.seed ?? 17;
    }
    if (storage.music && navigator.audioSession) {
      try { navigator.audioSession.type = "playback"; }
      catch { /* Playback continues when the session type is unavailable. */ }
    }
    if (audio.state === "suspended") audio.resume().then(() => music.setEnabled(storage.music && storage.sound));
    else music.setEnabled(storage.music && storage.sound);
  } catch {
    /* Audio is optional. */
  }
}
function updateMusicButtons() {
  document.querySelectorAll('.music-button').forEach((button) => {
    button.setAttribute('aria-pressed', String(!storage.music));
    button.setAttribute('aria-label', storage.music ? 'Mute music' : 'Unmute music');
  });
}
function scatterLoose() {
  if (!state) return;
  state.gatherRest = false;
  $("edges-button").querySelector("small").textContent = "Edges";
  const layout = layoutTable(
    ...state.grid,
    Math.floor(Math.random() * 0xffffffff),
    elements.stage.clientWidth,
    elements.stage.clientHeight,
  );
  const slots = layout.slots;
  for (const piece of state.pieces)
    if (!piece.locked && members(piece.group).length === 1) {
      moveGroup(piece.group, slots[piece.id].x - piece.x,
        slots[piece.id].y - piece.y);
    }
  updateTableBounds();
  state.helperBaseBounds = { ...state.tableBounds };
  state.defaultView = layout.view;
  fitView();
  save();
  draw();
}
function gatherEdges() {
  if (!state) return;
  const [cols, rows] = state.grid;
  const edge = (piece) => {
    const x = piece.id % cols;
    const y = Math.floor(piece.id / cols);
    return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
  };
  const loose = state.pieces.filter(
    (piece) => !piece.locked && members(piece.group).length === 1,
  );
  const selected = loose.filter((piece) =>
    state.gatherRest ? !edge(piece) : edge(piece),
  );
  const columns = Math.min(cols,
    Math.max(4, Math.ceil(Math.sqrt((selected.length * cols) / rows))));
  const rowStart = (cols - columns * 1.08) / 2;
  const edgeStart = state.helperBaseBounds.bottom + 0.5;
  const restStart = state.helperBaseBounds.top - 1.5;
  selected.forEach((piece, index) => {
    const x = rowStart + (index % columns) * 1.08;
    const line = Math.floor(index / columns);
    const y = state.gatherRest
      ? restStart - line * 1.08
      : edgeStart + line * 1.08;
    moveGroup(piece.group, x - piece.x, y - piece.y);
  });
  state.pieces = state.pieces
    .filter((piece) => !selected.includes(piece))
    .concat(selected);
  state.gatherRest = !state.gatherRest;
  $("edges-button").querySelector("small").textContent = state.gatherRest
    ? "Rest" : "Edges";
  updateTableBounds();
  fitBounds(state.tableBounds);
  save();
  draw();
}
function setPeek(value) {
  peek = value;
  $("peek-overlay").classList.toggle("hidden", !value);
  draw();
}
async function continueGame() {
  const game = storage.game;
  if (!game) return;
  $("continue-error").textContent = "";
  let photo = null,
    item = manifest.find((entry) => entry.id === game.pictureId);
  let photoOptions = {};
  if (game.pictureId === "photo") {
    const result = await loadPhoto(game.photoHash);
    if (!result) {
      $("continue-error").textContent = "Your photo couldn't be loaded. Try again.";
      return;
    }
    const url = result.value;
    if (result.status === "missing" || typeof url !== "string" ||
      hashText(url) !== game.photoHash) {
      storage.game = null;
      writeStorage();
      updateContinue();
      chooserMessage(
        "Saved photo could not be opened. Choose it again to start a new puzzle.",
      );
      return;
    }
    try {
      photo = await decodeUrl(url);
    } catch {
      $("continue-error").textContent = "Your photo couldn't be loaded. Try again.";
      return;
    }
    photoOptions = { dataUrl: url, hash: game.photoHash, resumeAllowed: true };
  }
  count = game.count;
  updateCounts();
  await startPuzzle(item, photo, game, photoOptions);
}
function wireChooserControls() {
  document.querySelectorAll("[data-count]").forEach((button) =>
    button.addEventListener("click", () => {
      count = Number(button.dataset.count);
      storage.lastCount = count;
      writeStorage();
      updateCounts();
      drawCrop();
    }),
  );
  $("continue-button").addEventListener("click", () => navigate(async () => {
    unlockAudio();
    await continueGame();
  }));
  $("discard-button").addEventListener("click", () => navigate(() => {
    if (
      !confirm("Start a new puzzle? Your unfinished puzzle will be replaced.")
    )
      return;
    discardPuzzle();
  }));
  $("photo-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const request = ++photoRequest;
    event.target.value = "";
    try {
      const decoded = await decodeFile(file);
      if (request !== photoRequest) {
        if (decoded.close) decoded.close();
        return;
      }
      cropImage = downscale(decoded);
      cropCenter = { x: 0.5, y: 0.5 };
      cropZoom = 1;
      $("crop-zoom").value = "1";
      showScreen("crop");
      requestAnimationFrame(drawCrop);
      chooserMessage("");
    } catch (error) {
      if (request !== photoRequest) return;
      chooserMessage(error.message.includes("60 megapixels")
        ? error.message
        : "This photo could not be opened. Choose a JPEG, PNG, or supported phone photo.");
    }
  });
}
function wireCropControls() {
  $("crop-back").addEventListener("click", () => navigate(() => {
    ++photoRequest;
    showScreen("chooser");
  }));
  $("crop-zoom").addEventListener("input", (event) => {
    cropZoom = Number(event.target.value);
    drawCrop();
  });
  const cropCanvas = $("crop-canvas");
  cropCanvas.addEventListener("pointerdown", (event) => {
    cropCanvas.setPointerCapture(event.pointerId);
    cropPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  cropCanvas.addEventListener("pointermove", (event) => {
    const previous = cropPointers.get(event.pointerId);
    if (!previous || !cropCanvas._frame) return;
    const frame = cropCanvas._frame;
    cropCenter.x = clamp(
      cropCenter.x -
        (((event.clientX - previous.x) / frame.width) * frame.crop.width) /
          cropImage.width,
      0,
      1,
    );
    cropCenter.y = clamp(
      cropCenter.y -
        (((event.clientY - previous.y) / frame.height) * frame.crop.height) /
          cropImage.height,
      0,
      1,
    );
    previous.x = event.clientX;
    previous.y = event.clientY;
    if (cropPointers.size === 2) {
      const [a, b] = [...cropPointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (cropCanvas._pinchDistance)
        cropZoom = clamp(
          (cropZoom * distance) / cropCanvas._pinchDistance,
          1,
          3,
        );
      cropCanvas._pinchDistance = distance;
      $("crop-zoom").value = String(cropZoom);
    }
    drawCrop();
  });
  const cropEnd = (event) => {
    cropPointers.delete(event.pointerId);
    if (cropPointers.size < 2) cropCanvas._pinchDistance = null;
  };
  cropCanvas.addEventListener("pointerup", cropEnd);
  cropCanvas.addEventListener("pointercancel", cropEnd);
  $("crop-start").addEventListener("click", () => navigate(async () => {
    unlockAudio();
    if (
      storage.game?.hasMoves &&
      !confirm("Start a new puzzle? Your unfinished puzzle will be replaced.")
    )
      return;
    const crop = cropBounds();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(crop.width);
    canvas.height = Math.round(crop.height);
    canvas
      .getContext("2d")
      .drawImage(
        cropImage,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85),
      hash = hashText(dataUrl),
      stored = await storePhoto(dataUrl, hash);
    if (!stored)
      chooserMessage(
        "This photo puzzle can be played, but cannot be resumed after closing the page.",
      );
    const started = await startPuzzle(null, canvas, null, {
      dataUrl,
      hash,
      resumeAllowed: stored,
    });
    if (stored && (!started || !storageReliable) && !saveReadFailed) {
      const persisted = persistedPhotoHash();
      if (persisted.readable && persisted.hash !== hash)
        await photoStore("readwrite", (store) => store.delete(hash));
    }
  }));
}
function wirePlayControls() {
  $("play-back").addEventListener("click", () => navigate(() => {
    pauseTimer();
    save(true);
    showScreen("chooser");
    updateContinue();
  }));
  $("sound-button").addEventListener("click", () => {
    storage.sound = !storage.sound;
    const button = $("sound-button");
    button.setAttribute("aria-pressed", String(storage.sound));
    button.setAttribute("aria-label", storage.sound ? "Sound on" : "Sound off");
    unlockAudio();
    music?.setEnabled(storage.sound && storage.music);
    writeStorage(state?.screen === "done" && state.pictureId === "photo"
      ? state.photoHash : storage.game?.photoHash);
  });
  document.querySelectorAll('.music-button').forEach((button) =>
    button.addEventListener('click', () => {
      storage.music = !storage.music;
      updateMusicButtons();
      if (storage.music) unlockAudio();
      music?.setEnabled(storage.music && storage.sound);
      writeStorage(state?.screen === "done" && state.pictureId === "photo"
        ? state.photoHash : storage.game?.photoHash);
    }));
  $("guide-button").addEventListener("click", () => {
    guide = !guide;
    $("guide-button").setAttribute("aria-pressed", String(guide));
    draw();
  });
  $("zoom-in").addEventListener("click", () => changeZoom(ZOOM_BUTTON_FACTOR));
  $("zoom-out").addEventListener("click", () =>
    changeZoom(1 / ZOOM_BUTTON_FACTOR));
  $("fit-button").addEventListener("click", fitView);
  $("edges-button").addEventListener("click", gatherEdges);
  const peekButton = $("peek-button");
  let peekTimer;
  let peekActive = false;
  peekButton.addEventListener("pointerdown", () => {
    clearTimeout(peekTimer);
    peekActive = true;
    setPeek(true);
  });
  window.addEventListener("pointerup", () => {
    if (!peekActive) return;
    peekActive = false;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => setPeek(false), 2000);
  });
  const cancelPeek = () => {
    peekActive = false;
    clearTimeout(peekTimer);
    setPeek(false);
  };
  window.addEventListener("pointercancel", cancelPeek);
  window.addEventListener("blur", cancelPeek);
  $("menu-button").addEventListener("click", () => {
    const open = $("menu").classList.toggle("hidden");
    $("menu-button").setAttribute("aria-expanded", String(!open));
  });
  $("shuffle-button").addEventListener("click", () => {
    $("menu").classList.add("hidden");
    scatterLoose();
  });
  for (const id of ["new-button", "done-new"])
    $(id).addEventListener("click", () => navigate(() => {
      if (
        state?.screen === "play" &&
        !confirm("Start a new puzzle? Your progress will be replaced.")
      )
        return;
      discardPuzzle();
    }));
  $("again-button").addEventListener("click", () => navigate(async () => {
    unlockAudio();
    const item = manifest.find((entry) => entry.id === state.pictureId);
    const photo = state.pictureId === "photo" ? image : null;
    let photoOptions = {};
    if (photo) {
      const hash = state.photoHash;
      const dataUrl = $("peek-image").src;
      const stored = hashText(dataUrl) === hash &&
        await storePhoto(dataUrl, hash);
      photoOptions = { hash, dataUrl, resumeAllowed: stored && storageReliable };
    }
    await startPuzzle(item, photo, null, photoOptions);
  }));
  elements.canvas.addEventListener("pointerdown", pointerDown);
  elements.canvas.addEventListener("pointermove", pointerMove);
  elements.canvas.addEventListener("pointerup", pointerUp);
  elements.canvas.addEventListener("pointercancel", pointerCancel);
  elements.canvas.addEventListener("lostpointercapture", pointerCancel);
  elements.canvas.addEventListener("contextmenu", (event) =>
    event.preventDefault(),
  );
  elements.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = elements.canvas.getBoundingClientRect();
    changeZoom(Math.exp(-event.deltaY * 0.001),
      event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
}
function wireLifecycle() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('#app')) unlockAudio();
  });
  document.addEventListener('pointerup', (event) => {
    if (event.target.closest('#app')) unlockAudio();
  });
  document.addEventListener("visibilitychange", () => {
    const generation = ++visibilityGeneration;
    if (document.hidden) {
      pauseTimer();
      save(true);
      music?.setHidden(true);
      clearTimeout(hideAudioTimer);
      if (audio) hideAudioTimer = setTimeout(() => audio.suspend(), 2100);
    } else if (state?.screen === "play" && state.started) {
      state.runAt = performance.now();
    }
    if (!document.hidden && audio) {
      clearTimeout(hideAudioTimer);
      audio.resume().then(() => {
        if (generation === visibilityGeneration && !document.hidden)
          music?.setHidden(false);
      }).catch(() => {});
    }
  });
  window.addEventListener("pagehide", () => {
    pauseTimer();
    save(true);
  });
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state?.screen === "done") {
        fitDone();
        rebuildImages();
      } else if (state?.screen === "play") {
        const width = elements.stage.clientWidth;
        const height = elements.stage.clientHeight;
        const sizeChanged =
          Math.abs(width - state.layoutWidth) > 1 ||
          Math.abs(height - state.layoutHeight) > 1;
        if (sizeChanged) {
          // Preserve moved pieces while fitting their existing table to the new orientation.
          fitBounds(viewBounds());
          state.defaultView = { ...state.view };
          state.layoutWidth = width;
          state.layoutHeight = height;
          rebuildImages();
        }
      }
      drawCrop();
    }, 140);
  }).observe(elements.stage);
  window.addEventListener("resize", drawCrop);
  watchPixelRatio();
}
function wireControls() {
  wireChooserControls();
  wireCropControls();
  wirePlayControls();
  wireLifecycle();
}
function watchPixelRatio() {
  const query = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`);
  query.addEventListener(
    "change",
    () => {
      rebuildImages();
      watchPixelRatio();
    },
    { once: true },
  );
}
async function boot() {
  try {
    const response = await fetch("pictures/manifest.json");
    if (!response.ok) throw Error("Could not load pictures");
    manifest = await response.json();
    if (readStorage()) queuePhotoCleanup(storage.game?.photoHash);
    wireControls();
    renderChooser();
    updateMusicButtons();
    $("sound-button").setAttribute("aria-pressed", String(storage.sound));
    $("sound-button").setAttribute(
      "aria-label",
      storage.sound ? "Sound on" : "Sound off",
    );
    setInterval(updateStatus, 250);
    window.jigsaw = {
      get state() {
        return state;
      },
      get storage() {
        return storage;
      },
      get music() {
        return music && { activeVoices: music.activeVoices,
          enabled: music.enabled, seed: music.seed, hidden: music.hidden };
      },
      debug: {
        get gesture() {
          return gesture;
        },
        hit(x, y) {
          const rect = elements.canvas.getBoundingClientRect();
          return pickPiece(x - rect.left, y - rect.top)?.id ?? null;
        },
        // The picture the pieces are cut from, so checks can sample its pixels.
        get image() {
          return image;
        },
        pick(id) {
          const piece = state?.pieces.find((item) => item.id === id);
          if (!piece || piece.locked) return null;
          const rect = elements.canvas.getBoundingClientRect();
          const offsets = [0, -0.25, 0.25, -0.4, 0.4];
          for (const dy of offsets) {
            for (const dx of offsets) {
              const from = toScreen(
                piece.x + 0.5 + dx,
                piece.y + 0.5 + dy,
                state.view,
              );
              const inside =
                from.x > 2 &&
                from.y > 2 &&
                from.x < rect.width - 2 &&
                from.y < rect.height - 2;
              if (!inside || pickPiece(from.x, from.y)?.id !== id) continue;
              const to = toScreen(
                (id % state.grid[0]) + 0.5 + dx,
                Math.floor(id / state.grid[0]) + 0.5 + dy,
                state.view,
              );
              return {
                current: { x: from.x + rect.left, y: from.y + rect.top },
                correct: { x: to.x + rect.left, y: to.y + rect.top },
              };
            }
          }
          return null;
        },
        piece(id) {
          if (!state) return null;
          const piece = state.pieces.find((item) => item.id === id);
          if (!piece) return null;
          const rect = elements.canvas.getBoundingClientRect();
          const current = toScreen(piece.x + 0.5, piece.y + 0.5, state.view),
            correct = toScreen(
              (id % state.grid[0]) + 0.5,
              Math.floor(id / state.grid[0]) + 0.5,
              state.view,
            );
          return {
            current: { x: current.x + rect.left, y: current.y + rect.top },
            correct: { x: correct.x + rect.left, y: correct.y + rect.top },
          };
        },
        visibleFraction(id) {
          const piece = state?.pieces.find((item) => item.id === id);
          if (!piece || !pieceImages[id]) return 0;
          const rect = elements.canvas.getBoundingClientRect();
          let shapeSamples = 0;
          let visibleSamples = 0;
          for (let row = 0; row < 12; row++) {
            for (let column = 0; column < 12; column++) {
              const offsetX = -0.25 + (column + 0.5) * 1.5 / 12;
              const offsetY = -0.25 + (row + 0.5) * 1.5 / 12;
              if (!imageHit(pieceImages[id], offsetX, offsetY)) continue;
              shapeSamples++;
              const point = toScreen(piece.x + offsetX, piece.y + offsetY, state.view);
              const onCanvas = point.x >= 0 && point.x < rect.width &&
                point.y >= 0 && point.y < rect.height;
              if (onCanvas && pickPiece(point.x, point.y)?.id === id)
                visibleSamples++;
            }
          }
          return shapeSamples ? visibleSamples / shapeSamples : 0;
        },
        fit: fitView,
      },
    };
  } catch (error) {
    chooserMessage(`Jigsaw could not start: ${error.message}`);
    console.error(error);
  }
}
boot();
window.addEventListener("load", () => {
  const worker = navigator.serviceWorker;
  if (!worker) return;
  worker.addEventListener("message", (event) => {
    if (event.source === worker.controller && event.data === "OFFLINE_READY")
      showOfflineReady();
  });
  worker.addEventListener("controllerchange", () => {
    hideOfflineReady();
    worker.controller?.postMessage("CHECK_OFFLINE_READY");
  });
  worker.controller?.postMessage("CHECK_OFFLINE_READY");
  worker.register("sw.js").catch((error) =>
    console.warn("Offline app could not be prepared:", error),
  );
});
