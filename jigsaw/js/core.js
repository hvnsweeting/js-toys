export const COUNTS = [32, 64, 128];
export const SNAP_TOLERANCE = 0.3;
export const TAB_REACH = 0.22;
export const GRIDS = {
  32: [
    [8, 4],
    [4, 8],
  ],
  64: [
    [8, 8],
    [16, 4],
    [4, 16],
  ],
  128: [
    [16, 8],
    [8, 16],
    [32, 4],
    [4, 32],
  ],
};
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function chooseGrid(width, height, count) {
  if (!(width > 0 && height > 0) || !GRIDS[count])
    throw Error("Invalid picture or count");
  return GRIDS[count].reduce((best, candidate) => {
    const error = Math.abs(
      Math.log(width / candidate[0] / (height / candidate[1])),
    );
    const bestError = Math.abs(Math.log(width / best[0] / (height / best[1])));
    return error < bestError ? candidate : best;
  });
}
export function cropForGrid(
  width,
  height,
  cols,
  rows,
  centerX = 0.5,
  centerY = 0.5,
) {
  const aspect = width / height;
  const minimum = (cols / rows) * 0.8;
  const maximum = (cols / rows) * 1.25;
  const target = clamp(aspect, minimum, maximum);
  const cropWidth = Math.min(width, height * target);
  const cropHeight = Math.min(height, width / target);
  return {
    x: clamp(centerX * width - cropWidth / 2, 0, width - cropWidth),
    y: clamp(centerY * height - cropHeight / 2, 0, height - cropHeight),
    width: cropWidth,
    height: cropHeight,
  };
}
export function makeEdges(cols, rows, seed) {
  const next = random(seed);
  const edge = () => ({
    direction: next() < 0.5 ? -1 : 1,
    offset: (next() - 0.5) * 0.12,
    size: 0.85 + next() * 0.25,
  });
  const horizontal = Array.from({ length: rows - 1 }, () =>
    Array.from({ length: cols }, edge),
  );
  const vertical = Array.from({ length: rows }, () =>
    Array.from({ length: cols - 1 }, edge),
  );
  return Array.from({ length: cols * rows }, (_, id) => {
    const x = id % cols,
      y = Math.floor(id / cols);
    return {
      top: y ? horizontal[y - 1][x] : null,
      right: x < cols - 1 ? vertical[y][x] : null,
      bottom: y < rows - 1 ? horizontal[y][x] : null,
      left: x ? vertical[y][x - 1] : null,
    };
  });
}
export function edgeProfile(t, edge) {
  if (!edge) return 0;
  const u = (t - edge.offset - 0.5) / (TAB_REACH * edge.size);
  if (Math.abs(u) >= 1) return 0;
  const a = Math.abs(u);
  const rounded =
    a < 0.58 ? 1 : (1 + Math.cos((Math.PI * (a - 0.58)) / 0.42)) / 2;
  return edge.direction * TAB_REACH * edge.size * rounded;
}
export function edgeSamples(edge, reverse = false, steps = 64) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = reverse ? 1 - i / steps : i / steps;
    return [t, edgeProfile(t, edge)];
  });
}
export function sideCommands(edge, from, to, horizontal, reverse) {
  const center = 0.5 + (edge?.offset || 0);
  const size = edge?.size || 1;
  const direction = edge?.direction || 0;
  const point = (t, depth) => {
    const displacement = depth * direction * size;
    return horizontal
      ? [from.x + (to.x - from.x) * t, from.y + displacement]
      : [from.x + displacement, from.y + (to.y - from.y) * t];
  };
  if (!edge) return [["lineTo", ...point(reverse ? 0 : 1, 0)]];
  const positions = [
    [0, 0],
    [center - 0.2 * size, 0],
    [center - 0.09 * size, 0.055],
    [center - 0.16 * size, 0.14],
    [center, TAB_REACH],
    [center + 0.16 * size, 0.14],
    [center + 0.09 * size, 0.055],
    [center + 0.2 * size, 0],
    [1, 0],
  ];
  const controls = [
    [positions[1], positions[1], positions[1]],
    [[center - 0.12 * size, 0], [center - 0.09 * size, 0.015], positions[2]],
    [[center - 0.09 * size, 0.1], [center - 0.16 * size, 0.08], positions[3]],
    [[center - 0.16 * size, 0.19], [center - 0.08 * size, TAB_REACH], positions[4]],
    [[center + 0.08 * size, TAB_REACH], [center + 0.16 * size, 0.19], positions[5]],
    [[center + 0.16 * size, 0.08], [center + 0.09 * size, 0.1], positions[6]],
    [[center + 0.09 * size, 0.015], [center + 0.12 * size, 0], positions[7]],
    [positions[8], positions[8], positions[8]],
  ];
  return (reverse ? controls.slice().reverse() : controls).map((segment, index) => {
    const control = reverse
      ? [segment[1], segment[0], positions[7 - index]]
      : segment;
    return ["bezierCurveTo", ...control.flatMap((pair) => point(...pair))];
  });
}
export function pieceOutline(sides) {
  return [
    ["moveTo", 0, 0],
    ...sideCommands(sides.top, { x: 0, y: 0 }, { x: 1, y: 0 }, true, false),
    ...sideCommands(sides.right, { x: 1, y: 0 }, { x: 1, y: 1 }, false, false),
    ...sideCommands(sides.bottom, { x: 0, y: 1 }, { x: 1, y: 1 }, true, true),
    ...sideCommands(sides.left, { x: 0, y: 0 }, { x: 0, y: 1 }, false, true),
    ["closePath"],
  ];
}
export function makeScatter(cols, rows, seed, tall = false) {
  const next = random(seed ^ 0x6a09e667);
  const count = cols * rows;
  const slots = [];
  const half = Math.ceil(count / 2);
  const columns = tall
    ? Math.max(cols, Math.ceil(Math.sqrt((half * cols) / rows)))
    : Math.max(3, Math.ceil(Math.sqrt((half * rows) / cols)));
  const rowsPerBank = Math.ceil(half / columns);
  for (let id = 0; id < count; id++) {
    const bank = id < half ? -1 : 1;
    const local = id < half ? id : id - half;
    const column = local % columns;
    const row = Math.floor(local / columns);
    const jitterX = (next() - 0.5) * 0.08;
    const jitterY = (next() - 0.5) * 0.08;
    let x, y;
    if (tall) {
      x = (column - (columns - 1) / 2) * 1.08 + cols / 2 + jitterX;
      y =
        bank < 0
          ? -1.25 - (rowsPerBank - row) * 1.08 + jitterY
          : rows + 1.25 + row * 1.08 + jitterY;
    } else {
      x =
        bank < 0
          ? -1.25 - (columns - column) * 1.08 + jitterX
          : cols + 1.25 + column * 1.08 + jitterX;
      y = (row - (rowsPerBank - 1) / 2) * 1.08 + rows / 2 + jitterY;
    }
    slots.push({ x, y });
  }
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

const MIN_SCATTER_SPACING = 0.9;
const TABLE_MARGIN = 0.28;

export function layoutTable(cols, rows, seed, width, height) {
  const tall = height > width;
  const half = Math.ceil((cols * rows) / 2);
  let best = { scale: 0, columns: 1, rowsPerBank: half };

  for (let columns = 1; columns <= half; columns++) {
    const rowsPerBank = Math.ceil(half / columns);
    // Cell centers need enough separation that no loose piece loses half its visible area.
    const bankWidth =
      2 * TABLE_MARGIN + 1 + MIN_SCATTER_SPACING * (columns - 1);
    const bankHeight =
      2 * TABLE_MARGIN + 1 + MIN_SCATTER_SPACING * (rowsPerBank - 1);
    const widthUnits = tall ? Math.max(cols, bankWidth) : cols + 2 * bankWidth;
    const heightUnits = tall
      ? rows + 2 * bankHeight
      : Math.max(rows, bankHeight);
    const boardLimit = tall ? (width * 0.92) / cols : (height * 0.9) / rows;
    const scale = Math.min(
      width / widthUnits,
      height / heightUnits,
      boardLimit,
    );
    const sameScale = Math.abs(scale - best.scale) < 0.001;
    if (
      scale > best.scale + 0.001 ||
      (tall && sameScale && columns > best.columns)
    ) {
      best = { scale, columns, rowsPerBank };
    }
  }

  const { scale, columns, rowsPerBank } = best;
  const boardLeft = (width - cols * scale) / 2;
  const boardTop = (height - rows * scale) / 2;
  const next = random(seed ^ 0x6a09e667);
  const slots = [];
  const margin = TABLE_MARGIN * scale;

  for (let id = 0; id < cols * rows; id++) {
    const firstBank = id < half;
    const local = firstBank ? id : id - half;
    const column = local % columns;
    const row = Math.floor(local / columns);
    const jitterX = (next() - 0.5) * 0.04 * scale;
    const jitterY = (next() - 0.5) * 0.04 * scale;
    let centerX;
    let centerY;

    if (tall) {
      const bankHeight = (height - rows * scale) / 2;
      const xStep = (width - 2 * margin - scale) / Math.max(1, columns - 1);
      const yStep =
        (bankHeight - 2 * margin - scale) / Math.max(1, rowsPerBank - 1);
      centerX = columns === 1 ? width / 2 : margin + scale / 2 + column * xStep;
      centerY = margin + scale / 2 + row * yStep;
      if (!firstBank) centerY += boardTop + rows * scale;
    } else {
      const bankWidth = (width - cols * scale) / 2;
      const xStep = (bankWidth - 2 * margin - scale) / Math.max(1, columns - 1);
      const yStep =
        (height - 2 * margin - scale) / Math.max(1, rowsPerBank - 1);
      centerX = margin + scale / 2 + column * xStep;
      if (!firstBank) centerX += boardLeft + cols * scale;
      centerY =
        rowsPerBank === 1 ? height / 2 : margin + scale / 2 + row * yStep;
    }
    slots.push({
      x: (centerX + jitterX - boardLeft) / scale - 0.5,
      y: (centerY + jitterY - boardTop) / scale - 0.5,
    });
  }

  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  return { scale, slots, view: { scale, x: boardLeft, y: boardTop } };
}
export function neighbours(id, cols, rows) {
  const x = id % cols,
    y = Math.floor(id / cols),
    result = [];
  if (x) result.push(id - 1);
  if (x < cols - 1) result.push(id + 1);
  if (y) result.push(id - cols);
  if (y < rows - 1) result.push(id + cols);
  return result;
}
// The tolerance is in board cells so zoom never changes how close a drop must be.
export function nearCorrect(piece, cols, tolerance = SNAP_TOLERANCE) {
  return (
    Math.hypot(
      piece.x - (piece.id % cols),
      piece.y - Math.floor(piece.id / cols),
    ) <= tolerance
  );
}
export function findJoin(
  pieces,
  movingIds,
  cols,
  rows,
  tolerance = SNAP_TOLERANCE,
) {
  const moving = new Set(movingIds);
  for (const id of movingIds)
    for (const otherId of neighbours(id, cols, rows)) {
      if (
        moving.has(otherId) ||
        pieces.find((piece) => piece.id === otherId).locked
      )
        continue;
      const a = pieces.find((piece) => piece.id === id),
        b = pieces.find((piece) => piece.id === otherId);
      const dx = (otherId % cols) - (id % cols);
      const dy = Math.floor(otherId / cols) - Math.floor(id / cols);
      if (Math.hypot(b.x - a.x - dx, b.y - a.y - dy) <= tolerance)
        return { id, otherId, dx: b.x - dx - a.x, dy: b.y - dy - a.y };
    }
  return null;
}
export const complete = (pieces) =>
  pieces.length > 0 && pieces.every((piece) => piece.locked);
export const toTable = (x, y, view) => ({
  x: (x - view.x) / view.scale,
  y: (y - view.y) / view.scale,
});
export const toScreen = (x, y, view) => ({
  x: x * view.scale + view.x,
  y: y * view.scale + view.y,
});
export function zoomAt(view, factor, x, y, minimum, maximum) {
  const point = toTable(x, y, view);
  const scale = clamp(view.scale * factor, minimum, maximum);
  return { scale, x: x - point.x * scale, y: y - point.y * scale };
}
export function clampView(view, bounds, width, height) {
  const pad = Math.min(width, height) * 0.2;
  const left = width - pad - bounds.right * view.scale;
  const right = pad - bounds.left * view.scale;
  const top = height - pad - bounds.bottom * view.scale;
  const bottom = pad - bounds.top * view.scale;
  return {
    ...view,
    x: left > right ? (left + right) / 2 : clamp(view.x, left, right),
    y: top > bottom ? (top + bottom) / 2 : clamp(view.y, top, bottom),
  };
}
export function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}-${value.length}`;
}
export function validateSave(raw, pictureDimensions) {
  if (!raw || typeof raw !== "object" || !COUNTS.includes(raw.count))
    return null;
  if (raw.pictureId !== "photo" && !pictureDimensions[raw.pictureId])
    return null;
  if (
    raw.pictureId === "photo" &&
    (typeof raw.photoHash !== "string" ||
      !/^[0-9a-f]{8}-[0-9]+$/.test(raw.photoHash))
  )
    return null;
  const grid = raw.grid;
  if (
    !Array.isArray(grid) ||
    grid.length !== 2 ||
    !GRIDS[raw.count].some(
      (candidate) => candidate[0] === grid[0] && candidate[1] === grid[1],
    )
  )
    return null;
  if (
    !raw.crop ||
    !["x", "y", "width", "height"].every((key) =>
      Number.isFinite(raw.crop[key]),
    )
  )
    return null;
  if (
    raw.crop.x < 0 ||
    raw.crop.y < 0 ||
    raw.crop.width <= 0 ||
    raw.crop.height <= 0 ||
    raw.crop.width > 2048 ||
    raw.crop.height > 2048
  )
    return null;
  if (raw.pictureId !== "photo" &&
    !cropInsideImage(raw.crop, pictureDimensions[raw.pictureId])) return null;
  if (
    !Number.isInteger(raw.seed) ||
    raw.seed < 0 ||
    raw.seed > 0xffffffff ||
    !Number.isFinite(raw.elapsed) ||
    raw.elapsed < 0 ||
    (raw.hasMoves !== undefined && typeof raw.hasMoves !== "boolean") ||
    (raw.gatherRest !== undefined && typeof raw.gatherRest !== "boolean") ||
    !Array.isArray(raw.pieces) ||
    raw.pieces.length !== raw.count
  )
    return null;
  const valid = raw.pieces.every(
    (piece) =>
      piece &&
      Number.isInteger(piece.id) &&
      piece.id >= 0 &&
      piece.id < raw.count &&
      Number.isFinite(piece.x) &&
      Math.abs(piece.x) < 1000 &&
      Number.isFinite(piece.y) &&
      Math.abs(piece.y) < 1000 &&
      Number.isInteger(piece.group) &&
      piece.group >= 0 &&
      piece.group < raw.count &&
      typeof piece.locked === "boolean",
  );
  if (!valid || new Set(raw.pieces.map((piece) => piece.id)).size !== raw.count)
    return null;
  const groups = new Map();
  for (const piece of raw.pieces) {
    const correctX = piece.id % grid[0];
    const correctY = Math.floor(piece.id / grid[0]);
    if (piece.locked && (Math.abs(piece.x - correctX) > 0.001 ||
      Math.abs(piece.y - correctY) > 0.001)) return null;
    const offset = { x: piece.x - correctX, y: piece.y - correctY };
    const previous = groups.get(piece.group);
    if (previous && (Math.abs(offset.x - previous.x) > 0.001 ||
      Math.abs(offset.y - previous.y) > 0.001)) return null;
    groups.set(piece.group, offset);
  }
  return raw;
}

export function cropInsideImage(crop, image) {
  const epsilon = 0.001;
  return crop.x + crop.width <= image.width + epsilon &&
    crop.y + crop.height <= image.height + epsilon;
}
export function jpegOrientation(header) {
  const data = new DataView(header);
  if (data.byteLength < 4 || data.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= data.byteLength && data.getUint8(offset) === 0xff) {
    const marker = data.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) break;
    const length = data.getUint16(offset + 2);
    if (length < 2 || offset + 2 + length > data.byteLength) break;
    const start = offset + 4;
    if (marker === 0xe1 && length >= 16 &&
      data.getUint32(start) === 0x45786966 && data.getUint16(start + 4) === 0) {
      const tiff = start + 6;
      const byteOrder = data.getUint16(tiff);
      if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
      const little = byteOrder === 0x4949;
      const segmentEnd = offset + 2 + length;
      if (data.getUint16(tiff + 2, little) !== 42) return null;
      const directory = tiff + data.getUint32(tiff + 4, little);
      if (directory + 2 > segmentEnd) return null;
      const entries = data.getUint16(directory, little);
      for (let index = 0; index < entries; index++) {
        const entry = directory + 2 + index * 12;
        if (entry + 12 > segmentEnd) return null;
        if (data.getUint16(entry, little) !== 0x0112) continue;
        if (data.getUint16(entry + 2, little) !== 3 ||
          data.getUint32(entry + 4, little) !== 1) return null;
        const value = data.getUint16(entry + 8, little);
        return value >= 1 && value <= 8 ? value : null;
      }
    }
    offset += length + 2;
  }
  return null;
}
export function imageDimensions(header, type) {
  const data = new DataView(header);
  if (type === "image/png" && data.byteLength >= 24 &&
    data.getUint32(0) === 0x89504e47) {
    return { width: data.getUint32(16), height: data.getUint32(20) };
  }
  if (type === "image/gif" && data.byteLength >= 10) {
    return { width: data.getUint16(6, true), height: data.getUint16(8, true) };
  }
  if (type === "image/webp" && data.byteLength >= 30 &&
    data.getUint32(0) === 0x52494646 && data.getUint32(8) === 0x57454250) {
    const kind = data.getUint32(12);
    if (kind === 0x56503858) {
      const width = 1 + data.getUint8(24) + (data.getUint8(25) << 8) +
        (data.getUint8(26) << 16);
      const height = 1 + data.getUint8(27) + (data.getUint8(28) << 8) +
        (data.getUint8(29) << 16);
      return { width, height };
    }
    if (kind === 0x5650384c && data.getUint8(20) === 0x2f) {
      return {
        width: 1 + data.getUint8(21) + ((data.getUint8(22) & 0x3f) << 8),
        height: 1 + (data.getUint8(22) >> 6) + (data.getUint8(23) << 2) +
          ((data.getUint8(24) & 0x0f) << 10),
      };
    }
    if (kind === 0x56503820 && data.getUint8(23) === 0x9d &&
      data.getUint8(24) === 0x01 && data.getUint8(25) === 0x2a) {
      return {
        width: data.getUint16(26, true) & 0x3fff,
        height: data.getUint16(28, true) & 0x3fff,
      };
    }
  }
  if (type === "image/jpeg" && data.byteLength >= 4 && data.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 9 < data.byteLength) {
      if (data.getUint8(offset) !== 0xff) break;
      const marker = data.getUint8(offset + 1);
      const length = data.getUint16(offset + 2);
      if (length < 2 || offset + length + 2 > data.byteLength) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
        0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: data.getUint16(offset + 7),
          height: data.getUint16(offset + 5) };
      }
      offset += length + 2;
    }
  }
  if (type === "image/svg+xml") {
    const source = new TextDecoder().decode(header);
    const width = Number(source.match(/\bwidth="([0-9.]+)"/)?.[1]);
    const height = Number(source.match(/\bheight="([0-9.]+)"/)?.[1]);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

// A press on empty table starts a pan; a second finger switches to a two-finger gesture.
export function nextGesture(mode, action) {
  if (action === "cancel") return "idle";
  if (action === "second") return "twoFingers";
  if (action === "third") return mode;
  if (action === "lift") return "idle";
  if (action === "piece") return mode === "idle" ? "dragging" : mode;
  return mode;
}
