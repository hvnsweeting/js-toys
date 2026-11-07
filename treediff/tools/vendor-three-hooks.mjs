// Node module-resolution hooks that make `import 'three'` find the copy in vendor/,
// the same mapping the importmap in index.html gives the browser (test/vendorHook.test.js
// compares the two). With them the unit tests run on a machine that has Node but no
// node_modules folder. The vendored copy wins even when node_modules/three exists, so the
// tests always run against the files that CHECKSUMS.txt covers.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const vendorThree = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'three');
const addonsFolder = path.join(vendorThree, 'addons');

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: pathToFileURL(path.join(vendorThree, 'three.module.js')).href, shortCircuit: true };
  }
  if (specifier.startsWith('three/addons/')) {
    const file = path.join(addonsFolder, specifier.slice('three/addons/'.length));
    // A specifier such as 'three/addons/../../x' must not leave the addons folder.
    if (file.startsWith(addonsFolder + path.sep)) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
