export const AOC_EXAMPLE = [
  '.......S.......',
  '...............',
  '.......^.......',
  '...............',
  '......^.^......',
  '...............',
  '.....^.^.^.....',
  '...............',
  '....^.^...^....',
  '...............',
  '...^.^...^.^...',
  '...............',
  '..^...^.....^..',
  '...............',
  '.^.^.^.^.^...^.',
  '...............',
];

export function placedGrid(level, placements = []) {
  const grid = level.grid.map(row => [...row]);
  const source = level.grid[0].indexOf('S');
  for (const {row, col, kind} of placements) {
    const valid = row > 0 && row < grid.length && col >= 0 && col < grid[0].length;
    if (!valid || (row === 1 && col === source) || grid[row][col] !== '.') {
      throw new Error(`Invalid placement at row ${row}, column ${col}`);
    }
    grid[row][col] = kind === 'splitter' ? '^' : kind === 'block' ? '#' : '?';
    if (grid[row][col] === '?') throw new Error(`Unknown piece: ${kind}`);
  }
  return grid.map(row => row.join(''));
}

export function simulate(level, placements = []) {
  const grid = placedGrid(level, placements);
  const width = grid[0].length;
  const source = grid[0].indexOf('S');
  if (source < 0 || grid.some(row => row.length !== width)) throw new Error('Invalid grid');
  let incoming = Array(width).fill(0);
  incoming[source] = 1;
  const beamRows = [incoming.slice()];
  const splitEvents = [];
  for (let row = 1; row < grid.length; row++) {
    const outgoing = Array(width).fill(0);
    for (let col = 0; col < width; col++) {
      const count = incoming[col];
      if (!count) continue;
      const cell = grid[row][col];
      if (cell === '.') {
        outgoing[col] += count;
      } else if (cell === '^') {
        splitEvents.push({row, col, timelines: count});
        for (const side of [col - 1, col + 1]) {
          if (side >= 0 && side < width && grid[row][side] === '.') outgoing[side] += count;
        }
      }
    }
    beamRows.push(outgoing);
    incoming = outgoing;
  }
  const detectorCounts = incoming.slice();
  const totalTimelines = incoming.reduce((sum, count) => sum + count, 0);
  const detectorResults =
      [...level.detectors ?? '.'.repeat(width)].map((kind, col) => ({
                                                      col,
                                                      kind,
                                                      count: detectorCounts[col],
                                                      quota: level.quotas?.[col] ?? null,
                                                    }));
  return {
    grid,
    beamRows,
    splitEvents,
    splitCount: splitEvents.length,
    detectorCounts,
    detectorResults,
    totalTimelines
  };
}

// Lists every detector that breaks the goal, so the board can highlight all of them; the reason
// describes the first in words, without a column number the player would have to count.
export function checkWin(level, result) {
  if (level.timelineGoal != null) {
    const won = result.totalTimelines === level.timelineGoal;
    return {
      won,
      reason: won ? 'The exit timeline goal is met.' :
          `Try again: ${result.totalTimelines} timelines reached the exit; ` +
          `you need exactly ${level.timelineGoal}.`,
      failures: [],
    };
  }
  const failures = [];
  for (const detector of result.detectorResults) {
    const {col, kind, count, quota} = detector;
    if (kind === 'V' && count) failures.push({col, kind: 'void', count});
    if (kind !== 'T') continue;
    if (quota !== null && count !== quota) failures.push({col, kind: 'quota', count, quota});
    else if (!count) failures.push({col, kind: 'dark', count});
  }
  if (!failures.length)
    return {won: true, reason: 'All targets are lit and all voids are dark.', failures};
  // Lead with a void hit because it is harder to notice than a dark target.
  const first = failures.find(failure => failure.kind === 'void') ?? failures[0];
  const plural = number => number === 1 ? '' : 's';
  let reason;
  if (first.kind === 'void')
    reason = 'Try again: The beam hit a red void. Keep light off the highlighted red marker.';
  else if (first.kind === 'quota')
    reason = `Try again: A gold target needs ${first.quota} timeline${plural(first.quota)}, ` +
        `but has ${first.count}. Adjust the paths reaching it.`;
  else {
    const darkCount = failures.filter(failure => failure.kind === 'dark').length;
    reason = `Try again: ${darkCount} gold target${plural(darkCount)} ` +
        `${darkCount === 1 ? 'is' : 'are'} still dark. ` +
        'Adjust the beam to reach the highlighted targets.';
  }
  const others = failures.length - 1;
  if (first.kind !== 'dark' && others)
    reason += ` ${others} other detector${plural(others)} highlighted.`;
  return {won: false, reason, failures};
}

export function computeStars(level, result, piecesUsed) {
  const won = checkWin(level, result).won;
  return [
    won, won && piecesUsed <= level.par,
    won && (level.bonus == null || result.totalTimelines >= level.bonus)
  ];
}
