// The twelve traits ("genes") that shape a tree. Each gene is a number in [0, 1]; skeleton.js maps
// it to a physical quantity. Every pair gets one random set, so the pair's trees look alike and
// pairs look different from each other.

import { between } from './random.js';

export const TRAIT_KEYS = ['height', 'spread', 'weeping', 'reach', 'girth', 'gnarl', 'lean', 'lushness', 'leafSize', 'autumn', 'blossom', 'bark'];

// Random genes, biased toward trees that look good: mostly leafy, rarely extreme.
export function randomGenes(rng) {
  const genes = {};
  for (const key of TRAIT_KEYS) genes[key] = between(rng, 0.15, 0.85);
  genes.lushness = between(rng, 0.45, 0.95);
  genes.weeping = rng() < 0.25 ? between(rng, 0.55, 0.9) : between(rng, 0.1, 0.55);
  genes.blossom = rng() < 0.6 ? between(rng, 0, 0.15) : between(rng, 0.3, 0.9);
  genes.gnarl = between(rng, 0.05, 0.7);
  return genes;
}
