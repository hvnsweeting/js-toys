const finaleRails = Array.from({length: 9}, (_, index) => [
  [index + 1, 6, '#'],
  [index + 1, 8, '#'],
]).flat();

const designs = [
  [
    'a1', 'First Light', 'Place a splitter to light both gold detectors.', 9, 7, 4, [],
    [[3, 4, 'splitter']]
  ],
  [
    'a2', 'Twin Signals', 'Split one branch of the fixed crystal.', 9, 8, 4, [[2, 4]],
    [[5, 3, 'splitter']]
  ],
  [
    'a3', 'Cascade Step', 'A second split can reach farther than the first.', 9, 9, 4, [],
    [[2, 4, 'splitter'], [6, 3, 'splitter']]
  ],
  [
    'a4', 'Outer Rim', 'A branch leaving the edge is lost.', 9, 9, 1, [[3, 1]], [[5, 0, 'splitter']]
  ],
  [
    'a5', 'Crystal Neighbors', 'Two touching crystals block a side branch.', 11, 10, 5,
    [[2, 5], [5, 5]], [[5, 4, 'splitter'], [8, 3, 'splitter']]
  ],
  [
    'b1', 'Convergence', 'Two paths can arrive at the same detector.', 9, 9, 4, [[2, 4]],
    [[5, 3, 'splitter'], [5, 5, 'splitter']]
  ],
  [
    'b2', 'Double Echo', 'Reach both outer targets and make exactly two paths at the center.', 11,
    10, 5, [[2, 5], [5, 4]], [[5, 6, 'splitter'], [7, 3, 'splitter']]
  ],
  [
    'b3', 'Threefold', 'Use a block to trim one branch without losing the threefold center.', 11, 11, 5,
    [[2, 5], [4, 4], [4, 6], [6, 3]],
    [[6, 5, 'splitter'], [8, 7, 'splitter'], [6, 6, 'block']]
  ],
  [
    'b4', 'Crossed Streams', 'Extend the earlier manifold to a far target while holding its count.',
    11, 11, 5, [[2, 5], [4, 4], [4, 6], [6, 3]],
    [[6, 5, 'splitter'], [8, 7, 'splitter'], [6, 6, 'block'], [8, 2, 'splitter']]
  ],
  [
    'b5', 'Sixfold Signal', 'Balance two sixfold counts; block the lane aimed at the red void.',
    15, 12, 7,
    [[2, 7], [4, 6], [4, 8], [6, 5], [6, 7], [6, 9]],
    [[8, 6, 'splitter'], [8, 8, 'splitter'], [9, 4, 'block'],
      [9, 10, 'splitter'], [9, 7, 'splitter']]
  ],
  [
    'c1', 'Dark Matter', 'Absorb the branch heading for the red void.', 9, 9, 4, [[2, 4]],
    [[6, 3, 'block']]
  ],
  [
    'c2', 'Safe Passage', 'Block the void, then split a branch into two counted targets.', 11, 10,
    5, [[2, 5], [5, 4]],
    [[7, 3, 'block'], [6, 6, 'splitter'], [8, 5, 'splitter']]
  ],
  [
    'c3', 'Containment Field', 'Seal both red lanes before splitting the middle beam.', 11, 12, 5,
    [[2, 5], [4, 4], [4, 6]],
    [[8, 3, 'block'], [8, 7, 'block'], [8, 5, 'splitter']]
  ],
  [
    'c4', 'Narrow Escape', 'Two blocks guard the voids while two crystals route around them.',
    13, 13, 6, [[2, 6], [5, 5], [5, 7], [8, 4]],
    [[9, 3, 'block'], [9, 8, 'splitter'], [10, 5, 'splitter'], [10, 7, 'block']]
  ],
  [
    'c5', 'Event Horizon', 'The metal rails stop early splits. Build two distant signals and seal the center.',
    15, 16, 7, [...finaleRails, [10, 7], [12, 6], [12, 8]],
    [[13, 5, 'splitter'], [14, 4, 'splitter'], [13, 9, 'splitter'],
      [14, 10, 'splitter'], [15, 7, 'block']]
  ],
];

// Goals are authored independently of the reference placements. The solver
// tests search from the empty board and check the true minimum piece count.
const goals = {
  a1: {detectors: '...T.T...', bonus: 2},
  a2: {detectors: '..T.T....', bonus: 3},
  a3: {detectors: '..T..T...', bonus: 3},
  a4: {detectors: '.T.......', bonus: 2},
  a5: {detectors: '..T........', bonus: 3},
  b1: {detectors: '..T.T....', quotas: {2: 1, 4: 2}, bonus: 4},
  b2: {detectors: '..T..T.T...', quotas: {5: 2}, bonus: 5},
  b3: {detectors: '..T.T.T.T..', quotas: {2: 1, 4: 3, 6: 1, 8: 1}, bonus: 6},
  b4: {detectors: '.T.TT.T.T..', quotas: {1: 1, 3: 1, 4: 3, 6: 1, 8: 1}, bonus: 7},
  b5: {detectors: '....VTT.TT.T...', quotas: {5: 3, 6: 6, 8: 6, 9: 4, 11: 1}, bonus: 20},
  c1: {detectors: '...V.T...', bonus: 1},
  c2: {detectors: '...VT.TT...', quotas: {4: 2, 6: 2, 7: 1}, bonus: 5},
  c3: {detectors: '...VT.TV...', quotas: {4: 2, 6: 2}, bonus: 4},
  c4: {detectors: '...VT.TVVT...', quotas: {4: 1, 6: 3, 9: 1}, bonus: 5},
  c5: {detectors: '...T...V...T...', bonus: 6},
};

function makeLevel([id, name, hint, width, height, source, fixed, reference]) {
  const rows = Array.from({length: height}, () => Array(width).fill('.'));
  rows[0][source] = 'S';
  for (const [row, col, kind = '^'] of fixed) rows[row][col] = kind;

  const solution = reference.map(([row, col, kind]) => ({row, col, kind}));
  const inventory = {
    splitter: solution.filter(piece => piece.kind === 'splitter').length,
    block: solution.filter(piece => piece.kind === 'block').length,
  };

  return {
    id,
    name,
    hint,
    grid: rows.map(row => row.join('')),
    ...goals[id],
    quotas: goals[id].quotas ?? {},
    inventory,
    par: solution.length,
    solution,
    sector: id[0].toUpperCase(),
  };
}

export const levels = designs.map(makeLevel);
export const levelById = Object.fromEntries(levels.map(level => [level.id, level]));
export const sectors = [
  {id: 'A', name: 'Calibration', description: 'Learn to bend the beam.'},
  {id: 'B', name: 'Timelines', description: 'Count every path.'},
  {id: 'C', name: 'Containment', description: 'Keep the void dark.'},
];
