import { readFile } from 'node:fs/promises';
import { checkRouteChunks } from './lib/route-chunks.mjs';

const path = process.argv[2];
if (!path) throw new Error('Pass the built Vite manifest path.');
checkRouteChunks(JSON.parse(await readFile(path, 'utf8')));
console.log(
  'Route chunk gate passed: six protected pages load separately from the entry.',
);
