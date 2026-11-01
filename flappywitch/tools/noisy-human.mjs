import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBot } from '../test/flight-controller.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.scratch', 'noisy-human');
const reactionDelay = .12;
const aimError = .25;

function percentile(sorted, numerator, denominator) {
  const index = (sorted.length - 1) * numerator / denominator;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function calculateSummary(results) {
  const cleared = results.map(result => result.passed).sort((left, right) => left - right);
  return {
    count: cleared.length,
    minimum: cleared[0],
    firstQuartile: percentile(cleared, 1, 4),
    median: percentile(cleared, 1, 2),
    thirdQuartile: percentile(cleared, 3, 4),
    maximum: cleared.at(-1),
  };
}

async function main() {
  const sourceFiles = ['src/rules.js', 'src/main.js', 'test/flight-controller.mjs', 'tools/noisy-human.mjs'];
  const sourceHashes = await Promise.all(sourceFiles.map(async file => {
    const contents = await readFile(path.join(root, file));
    return `${file}: ${createHash('sha256').update(contents).digest('hex')}`;
  }));
  const results = Array.from({ length: 50 }, (_, index) => {
    const seed = index + 1;
    return { seed, ...runBot(seed, 'noisy', 150, { reactionDelay, aimError }) };
  });
  const summary = calculateSummary(results);
  const rawResults = [
    'seed\tcleared_gates\tcause\tdeath_gate',
    ...results.map(result => `${result.seed}\t${result.passed}\t${result.cause}\t${result.gate ?? ''}`),
    '',
  ].join('\n');
  const report = `# Noisy human measurement

The bot was run once for each deterministic game seed 1 through 50. It uses the fairness test's perfect-information flight planner. After each new gate it waits 120 milliseconds, then plans with one independent seeded uniform aim error from -0.25 to +0.25 world units for that gate. The simulation uses live physics, fixed-time simulation, gate construction, spacing, speed, moving centres, gust timing, collision, and scoring from src/rules.js. It has no wisp shield.

| Statistic | Cleared gates |
| --- | ---: |
| Minimum | ${summary.minimum} |
| First quartile | ${summary.firstQuartile} |
| Median | ${summary.median} |
| Third quartile | ${summary.thirdQuartile} |
| Maximum | ${summary.maximum} |

The median ${summary.median >= 4 && summary.median <= 12 ? 'is within' : 'is outside'} the requested 4 to 12 range.

Executable: Node.js ${process.version}. Source hashes: ${sourceHashes.join('; ')}.

Per-seed results: [noisy-human-results.tsv](noisy-human/noisy-human-results.tsv).
`;
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'noisy-human-results.tsv'), rawResults);
  await writeFile(path.join(root, '.scratch', 'noisy-human-report.md'), report);
  console.log(JSON.stringify(summary));
}

await main();
