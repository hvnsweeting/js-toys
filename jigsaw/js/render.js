import { pieceOutline } from "./core.js";
const PAD = 0.26;
const MAX_PIXEL_RATIO = 2;
let tableTexture;

function texture(ctx, width, height) {
  if (!tableTexture) {
    tableTexture = document.createElement("canvas");
    tableTexture.width = tableTexture.height = 128;
    const surface = tableTexture.getContext("2d");
    const pixels = surface.createImageData(128, 128);
    let seed = 0x8b4e3a21;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const grain = ((seed >>> 24) - 128) / 25 + Math.sin(y * 0.8) * 1.5;
        const index = (y * 128 + x) * 4;
        pixels.data.set([96 + grain, 112 + grain, 91 + grain, 255], index);
      }
    }
    surface.putImageData(pixels, 0, 0);
  }
  ctx.fillStyle = ctx.createPattern(tableTexture, "repeat");
  ctx.fillRect(0, 0, width, height);
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    20,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75,
  );
  vignette.addColorStop(0, "rgba(255,223,158,.045)");
  vignette.addColorStop(1, "rgba(26,37,27,.24)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}
export function tracePiece(ctx, sides) {
  ctx.beginPath();
  for (const [command, ...values] of pieceOutline(sides)) ctx[command](...values);
}
export function buildPieceImages(
  image,
  crop,
  cols,
  rows,
  edges,
  pixelsPerCell,
) {
  const size = Math.max(80, Math.min(280, Math.ceil(pixelsPerCell)));
  return edges.map((sides, id) => {
    const surface = document.createElement("canvas");
    surface.width = surface.height = Math.ceil(size * (1 + PAD * 2));
    const ctx = surface.getContext("2d", { willReadFrequently: true });
    ctx.scale(size, size);
    ctx.translate(PAD, PAD);
    tracePiece(ctx, sides);
    ctx.save();
    ctx.clip();
    const x = id % cols,
      y = Math.floor(id / cols);
    ctx.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      -x,
      -y,
      cols,
      rows,
    );
    ctx.restore();
    ctx.save();
    tracePiece(ctx, sides);
    ctx.clip();
    ctx.save();
    ctx.translate(0.018, 0.018);
    tracePiece(ctx, sides);
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = "rgba(255,255,255,.64)";
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.translate(-0.018, -0.018);
    tracePiece(ctx, sides);
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = "rgba(21,37,33,.28)";
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    tracePiece(ctx, sides);
    ctx.lineWidth = 0.012;
    ctx.strokeStyle = "rgba(38,35,30,.65)";
    ctx.stroke();
    return { canvas: surface, ctx, size };
  });
}
function drawPiece(ctx, piece, image, scale = 1, lift = false) {
  let x = piece.x,
    y = piece.y;
  if (piece.anim) {
    const progress = Math.min(
      1,
      (performance.now() - piece.anim.start) / piece.anim.duration,
    );
    const ease = 1 - (1 - progress) ** 3;
    x = piece.anim.x + (piece.x - piece.anim.x) * ease;
    y = piece.anim.y + (piece.y - piece.anim.y) * ease;
    if (progress >= 1) delete piece.anim;
  }
  if (piece.wiggle) {
    const age = performance.now() - piece.wiggle;
    if (age < 220) x += Math.sin(age / 25) * 0.045 * (1 - age / 220);
    else delete piece.wiggle;
  }
  ctx.save();
  ctx.translate(x + 0.5, y + 0.5);
  ctx.scale(scale, scale);
  if (lift) {
    ctx.shadowColor = "rgba(20,30,27,.55)";
    ctx.shadowBlur = 0.24;
    ctx.shadowOffsetY = 0.12;
  }
  ctx.drawImage(image.canvas, -0.5 - PAD, -0.5 - PAD, 1 + PAD * 2, 1 + PAD * 2);
  ctx.restore();
}
export function drawScene(
  canvas,
  state,
  image,
  images,
  guide,
  dragging,
  confetti = [],
) {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width,
    height = rect.height;
  if (!width || !height) return;
  // Keep canvas detail on dense screens without paying for a full threefold redraw.
  const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * ratio),
    pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  texture(ctx, width, height);
  const view = state.view;
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  const [cols, rows] = state.grid;
  ctx.save();
  ctx.shadowColor = "rgba(20,31,24,.55)";
  ctx.shadowBlur = 0.22;
  ctx.shadowOffsetY = 0.11;
  ctx.fillStyle = "#a18d70";
  ctx.fillRect(-0.14, -0.14, cols + 0.28, rows + 0.28);
  ctx.restore();
  ctx.fillStyle = "#293b30";
  ctx.fillRect(-0.08, -0.08, cols + 0.16, rows + 0.16);
  const tray = ctx.createLinearGradient(0, 0, 0, rows);
  tray.addColorStop(0, "#435d4b");
  tray.addColorStop(1, "#526a54");
  ctx.fillStyle = tray;
  ctx.fillRect(0, 0, cols, rows);
  ctx.strokeStyle = "rgba(12,25,18,.55)";
  ctx.lineWidth = 0.05;
  ctx.strokeRect(0, 0, cols, rows);
  if (guide || state.screen === "done") {
    ctx.save();
    ctx.globalAlpha = state.screen === "done" ? 1 : 0.2;
    ctx.drawImage(
      image,
      state.crop.x,
      state.crop.y,
      state.crop.width,
      state.crop.height,
      0,
      0,
      cols,
      rows,
    );
    ctx.restore();
  }
  ctx.strokeStyle = "rgba(248,241,215,.4)";
  ctx.lineWidth = 0.025;
  ctx.strokeRect(0, 0, cols, rows);
  for (const piece of state.pieces)
    if (piece.locked) drawPiece(ctx, piece, images[piece.id]);
  for (const piece of state.pieces)
    if (!piece.locked && (!dragging || piece.group !== dragging.group))
      drawPiece(ctx, piece, images[piece.id]);
  if (dragging)
    for (const piece of state.pieces)
      if (piece.group === dragging.group && !piece.locked)
        drawPiece(ctx, piece, images[piece.id], 1.04, true);
  if (state.shineStart) {
    const progress = Math.min(1, (performance.now() - state.shineStart) / 850);
    if (progress < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cols, rows);
      ctx.clip();
      const x = -cols * 0.4 + progress * cols * 1.8;
      const gradient = ctx.createLinearGradient(x - 0.8, 0, x + 0.8, 0);
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      gradient.addColorStop(0.5, "rgba(255,255,255,.42)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, cols, rows);
      ctx.restore();
    } else delete state.shineStart;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  for (const bit of confetti) {
    ctx.fillStyle = bit.color;
    ctx.fillRect(bit.x, bit.y, bit.size, bit.size * 1.6);
  }
}
export function imageHit(image, x, y) {
  // Transparent corners and sockets let a lower piece receive the pointer.
  if (!image) return false;
  const px = Math.floor((x + PAD) * image.size),
    py = Math.floor((y + PAD) * image.size);
  if (px < 0 || py < 0 || px >= image.canvas.width || py >= image.canvas.height)
    return false;
  return image.ctx.getImageData(px, py, 1, 1).data[3] > 24;
}
