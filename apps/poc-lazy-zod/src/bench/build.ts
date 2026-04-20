/**
 * Bundles both entries with esbuild into single-file CJS.
 * Config mirrors libs/cli/src/commands/build/exec/esbuild-bundler.ts
 * (platform=node, format=cjs, target=node22, treeShaking=true,
 * keepNames=true) but forces minify=true and does NOT externalize zod —
 * zod is bundled in, matching an edge-worker / SEA distribution.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { build } from 'esbuild';

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'results');

async function buildOne(entry: string, outfile: string) {
  const start = Date.now();
  await build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    external: [], // bundle zod in
    keepNames: true,
    treeShaking: true,
    minify: true,
    sourcemap: false,
    logLevel: 'warning',
  });
  const size = fs.statSync(outfile).size;
  console.log(
    `[build] ${path.basename(outfile)} ${size} bytes (${(size / 1024 / 1024).toFixed(2)} MB) in ${Date.now() - start}ms`,
  );
  return size;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const eagerSize = await buildOne('src/entries/eager-entry.ts', path.join(OUT_DIR, 'eager.cjs'));
  const lazySize = await buildOne('src/entries/lazy-entry.ts', path.join(OUT_DIR, 'lazy.cjs'));
  fs.writeFileSync(
    path.join(OUT_DIR, 'bundle-sizes.json'),
    JSON.stringify(
      { eagerBytes: eagerSize, lazyBytes: lazySize, deltaPct: ((lazySize - eagerSize) / eagerSize) * 100 },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
