// Loaded with `node --import ./tools/register-vendor-three.mjs`; see vendor-three-hooks.mjs.
import { register } from 'node:module';

register('./vendor-three-hooks.mjs', import.meta.url);
