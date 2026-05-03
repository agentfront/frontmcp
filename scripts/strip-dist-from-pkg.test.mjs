import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, after } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptPath = path.join(__dirname, 'strip-dist-from-pkg.js');

const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

async function runOnPkg(pkg) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'strip-dist-'));
  tempDirs.push(dir);
  const pkgPath = path.join(dir, 'package.json');
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));
  const res = spawnSync(process.execPath, [scriptPath, pkgPath], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`strip-dist failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(await fs.readFile(pkgPath, 'utf8'));
}

test('strips ./dist/ prefix from main', async () => {
  const out = await runOnPkg({ name: 'x', main: './dist/src/index.js' });
  assert.equal(out.main, './src/index.js');
});

test('#364: preserves .d.ts extension on types field', async () => {
  // Round-1 fix landed `"types": "./dist/src/index.d.ts"` in libs/cli/package.json,
  // but this script's regex was rewriting `./src/index.d.ts` → `./index.d.js`,
  // which TypeScript silently rejects (only honors .d.ts/.d.mts/.d.cts).
  const out = await runOnPkg({ name: 'x', types: './dist/src/index.d.ts' });
  assert.equal(out.types, './src/index.d.ts');
});

test('rewrites ./src/foo.ts → ./foo.js for non-declaration source paths', async () => {
  const out = await runOnPkg({
    name: 'x',
    imports: { '#util': './src/util.ts' },
  });
  assert.equal(out.imports['#util'], './util.js');
});

test('does not touch unrelated paths', async () => {
  const out = await runOnPkg({
    name: 'x',
    main: './out/index.cjs',
    types: './out/index.d.ts',
  });
  assert.equal(out.main, './out/index.cjs');
  assert.equal(out.types, './out/index.d.ts');
});

test('strips dist + preserves .d.ts inside exports map', async () => {
  const out = await runOnPkg({
    name: 'x',
    exports: {
      '.': {
        types: './dist/src/index.d.ts',
        import: './dist/src/index.mjs',
        require: './dist/src/index.js',
      },
    },
  });
  assert.deepEqual(out.exports['.'], {
    types: './src/index.d.ts',
    import: './src/index.mjs',
    require: './src/index.js',
  });
});

test('drops "development" condition from exports map', async () => {
  const out = await runOnPkg({
    name: 'x',
    exports: {
      '.': {
        development: './src/index.ts',
        import: './dist/src/index.mjs',
        require: './dist/src/index.js',
      },
    },
  });
  assert.equal(out.exports['.'].development, undefined);
  assert.equal(out.exports['.'].import, './src/index.mjs');
  assert.equal(out.exports['.'].require, './src/index.js');
});
