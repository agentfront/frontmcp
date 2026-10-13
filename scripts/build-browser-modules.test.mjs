import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-browser-modules.mjs');
const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

async function buildFixture(sources) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-modules-'));
  tempDirs.push(dir);
  const files = {
    'package.json': JSON.stringify({
      name: 'fixture',
      imports: { '#host': { browser: './src/host.browser.ts', default: './src/host.node.ts' } },
    }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022' } }),
    'src/host.browser.ts': "export const hostName = 'browser';\n",
    'src/host.node.ts':
      "import { createServer } from 'node:http';\nexport const hostName = 'node';\nexport { createServer };\n",
    'src/math.ts': 'export const sum = (a: number, b: number) => a + b;\n',
    'src/lazy.ts': 'export const lazy = true;\n',
    ...sources,
  };
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), content);
  }
  const result = spawnSync(
    process.execPath,
    [scriptPath, path.join(dir, 'src/index.ts'), path.join(dir, 'dist'), path.join(dir, 'tsconfig.json')],
    { encoding: 'utf8' },
  );
  return { dir, result };
}

test('builds one browser module per source file, with packages external', async () => {
  const { dir, result } = await buildFixture({
    'src/index.ts':
      "export { hostName } from '#host';\nexport { sum } from './math';\nexport { z } from 'zod';\nexport const loadLazy = () => import('./lazy');\n",
  });
  assert.equal(result.status, 0, result.stderr);

  assert.deepEqual((await fs.readdir(path.join(dir, 'dist'))).sort(), [
    'host.browser.mjs',
    'index.mjs',
    'lazy.mjs',
    'math.mjs',
  ]);
  const entry = await fs.readFile(path.join(dir, 'dist/index.mjs'), 'utf8');
  assert.match(entry, /from "\.\/host\.browser\.mjs"/, 'a subpath import resolves to its browser variant');
  assert.match(entry, /from "\.\/math\.mjs"/);
  assert.match(entry, /import\("\.\/lazy\.mjs"\)/, 'an import() stays a chunk boundary');
  assert.match(entry, /from "zod"/, 'packages stay external');
  for (const file of await fs.readdir(path.join(dir, 'dist'))) {
    assert.doesNotMatch(
      await fs.readFile(path.join(dir, 'dist', file), 'utf8'),
      /node:http/,
      `${file} is browser-only`,
    );
  }
});

test('names what each star re-export brings in, so a bundle without splitting keeps the modules it loads', async () => {
  const { dir, result } = await buildFixture({
    'package.json': JSON.stringify({ name: 'fixture', type: 'module', sideEffects: false }),
    'node_modules/fixture-dep/package.json': JSON.stringify({
      name: 'fixture-dep',
      type: 'module',
      exports: './index.mjs',
    }),
    'node_modules/fixture-dep/index.mjs': 'export const depValue = 1;\n',
    'src/index.ts': "export * from './barrel';\nexport * from 'fixture-dep';\n",
    'src/barrel/index.ts': "export * from './thing';\n",
    'src/barrel/thing.ts':
      "export class Thing {\n  static make() {\n    return 'made';\n  }\n  static reload() {\n    return import('./thing');\n  }\n}\nexport default Thing;\n",
  });
  assert.equal(result.status, 0, result.stderr);

  const barrel = await fs.readFile(path.join(dir, 'dist/barrel/index.mjs'), 'utf8');
  assert.match(barrel, /export \{ Thing \} from "\.\/thing\.mjs";/, 'a star re-export leaves out the default export');
  const entry = await fs.readFile(path.join(dir, 'dist/index.mjs'), 'utf8');
  assert.match(entry, /export \{ Thing \} from "\.\/barrel\/index\.mjs";/, 'nested star re-exports are followed');
  assert.match(entry, /export \{ depValue \} from "fixture-dep";/, "a package's star re-export is named too");
  for (const file of await fs.readdir(path.join(dir, 'dist'), { recursive: true })) {
    if (!file.endsWith('.mjs')) continue;
    assert.doesNotMatch(
      await fs.readFile(path.join(dir, 'dist', file), 'utf8'),
      /export \*/,
      `${file} has no export *`,
    );
  }

  const bundlePath = path.join(dir, 'single-file-bundle.mjs');
  await build({
    stdin: {
      contents: `import { Thing } from ${JSON.stringify(path.join(dir, 'dist/index.mjs'))};\nexport const made = Thing.make();\n`,
      resolveDir: dir,
    },
    bundle: true,
    format: 'esm',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const { made } = await import(pathToFileURL(bundlePath).href);
  assert.equal(made, 'made');
});

test('refuses a require() of another source module, which has no browser ESM equivalent', async () => {
  const { result } = await buildFixture({ 'src/index.ts': "export const math = require('./math');\n" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /require\('\.\/math'\) of an internal module has no browser ESM equivalent/);
});
