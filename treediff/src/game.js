// Game rules, independent of rendering. A pair is two trees from one seed with the same traits;
// they differ in DIFFERENCES places (see differences.js). A round follows what the player has
// found and how often they clicked where no difference was; the score runs across rounds.

import { randomGenes } from './traits.js';
import { planDifferences, DIFFERENCES } from './differences.js';

// Makes a pair. A seed with a tree that has no room for the differences (a very small tree) is replaced.
export function makePair(rng, makeSeed) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const seed = makeSeed();
    const genes = randomGenes(rng);
    try {
      return { seed, genes, differences: planDifferences(seed, genes) };
    } catch {
      // Try another seed.
    }
  }
  throw new Error('could not make a pair with room for the differences');
}

// Points for what a click did: a difference found gains, a miss costs. A difference found again
// changes nothing. The score never goes below 0, so a run of misses at the start cannot leave
// the player owing points before they have found anything.
export const POINTS_FOUND = 100;
export const POINTS_MISS = -20;

export function scoreAfter(score, outcome) {
  if (outcome === 'found') return score + POINTS_FOUND;
  if (outcome === 'miss') return Math.max(0, score + POINTS_MISS);
  return score;
}

// How far each trunk stands from the middle of the pair: as close as the two crowns allow, with
// CROWN_GAP between them, so the trees never interleave and a branch clearly belongs to one tree.
// `left` and `right` are how far each tree reaches sideways from its own trunk: `left` toward the
// right tree, `right` toward the left tree (see trunkReach).
export const CROWN_GAP = 0.4;
// How far leaf blades reach past the branch bounds: at most 0.24 (see skeleton.js).
export const LEAF_BLADE_REACH = 0.24;

// How far the tree on `side` reaches from its trunk toward the other tree: its branches (`bounds`,
// minX and maxX measured from its own trunk), the leaf blades past them, and any object of a
// difference on it, out to its click radius (a little wider than the object is drawn, so the
// two trees' click areas stay apart too).
export function trunkReach(bounds, differences, side) {
  const inward = side === 'left' ? 1 : -1;
  const branches = side === 'left' ? bounds.maxX : -bounds.minX;
  const objects = differences
    .filter((difference) => difference.tree === side && difference.attach)
    .map((difference) => inward * difference.position[0] + difference.radius);
  return Math.max(branches + LEAF_BLADE_REACH, ...objects);
}

export function trunkOffset(left, right) {
  return (left + right + CROWN_GAP) / 2;
}

export function createRound(pair) {
  return { pair, found: [], misses: 0 };
}

export function isComplete(round) {
  return round.found.length === DIFFERENCES;
}

// A click that points at difference `index`, or at no difference (`index` null). Returns 'found' for a
// difference found now, 'again' for one found before, 'miss' for a click at no difference. An index
// that is not one of the pair's differences is a mistake by the caller, not a find.
export function registerClick(round, index) {
  if (index === null) {
    round.misses++;
    return 'miss';
  }
  const isDifference = Number.isInteger(index) && index >= 0 && index < round.pair.differences.length;
  if (!isDifference) throw new RangeError(`no difference ${index} in this pair`);
  if (round.found.includes(index)) return 'again';
  round.found.push(index);
  return 'found';
}
