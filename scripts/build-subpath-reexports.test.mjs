import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, 'build-subpath-reexports.mjs');
const require = createRequire(import.meta.url);
const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

const MANIFEST = {
  name: '@acme/tools',
  exports: {
    '.': { require: { default: './dist/index.js' }, import: { default: './dist/esm/index.mjs' } },
    './hand': {
      development: './src/hand/index.ts',
      require: { default: './dist/hand/index.js' },
      import: { default: './dist/esm/hand/index.mjs' },
    },
  },
};

async function packageWithBarrel(barrel) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'build-subpath-reexports-'));
  tempDirs.push(dir);
  const packageDir = path.join(dir, 'node_modules', '@acme', 'tools');
  const files = {
    'package.json': JSON.stringify(MANIFEST),
    'src/hand/index.ts': barrel,
    'src/hand/hammer.ts': 'export class Hammer {}\nexport interface HammerOptions { weight: number }\n',
    'dist/index.js': 'class Hammer {}\nmodule.exports = { Hammer };\n',
    'dist/esm/index.mjs': 'export class Hammer {}\n',
  };
  for (const [name, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(packageDir, name)), { recursive: true });
    await fs.writeFile(path.join(packageDir, name), body);
  }
  return packageDir;
}

const run = (packageDir) => spawnSync(process.execPath, [scriptPath, packageDir], { encoding: 'utf8' });

test("writes a subpath's require and import files as re-exports of the package root", async () => {
  const packageDir = await packageWithBarrel(
    "export { Hammer } from './hammer';\nexport type { HammerOptions } from './hammer';\n",
  );

  const res = run(packageDir);

  assert.equal(res.status, 0, res.stderr);
  const root = require(path.join(packageDir, 'dist/index.js'));
  const required = require(path.join(packageDir, 'dist/hand/index.js'));
  assert.deepEqual(Object.keys(required), ['Hammer']);
  assert.equal(required.Hammer, root.Hammer);
  const rootModule = await import(pathToFileURL(path.join(packageDir, 'dist/esm/index.mjs')).href);
  const imported = await import(pathToFileURL(path.join(packageDir, 'dist/esm/hand/index.mjs')).href);
  assert.deepEqual(Object.keys(imported), ['Hammer']);
  assert.equal(imported.Hammer, rootModule.Hammer);
});

test('leaves out a type the barrel re-exports without export type', async () => {
  const packageDir = await packageWithBarrel("export { Hammer, HammerOptions } from './hammer';\n");

  const res = run(packageDir);

  assert.equal(res.status, 0, res.stderr);
  const imported = await import(pathToFileURL(path.join(packageDir, 'dist/esm/hand/index.mjs')).href);
  assert.deepEqual(Object.keys(imported), ['Hammer']);
});

test("reads the names of a barrel's local export *", async () => {
  const packageDir = await packageWithBarrel("export * from './hammer';\n");

  const res = run(packageDir);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(Object.keys(require(path.join(packageDir, 'dist/hand/index.js'))), ['Hammer']);
});

test('refuses a barrel that re-exports another package with export *', async () => {
  const res = run(await packageWithBarrel("export * from 'saws';\n"));

  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /export \*/);
});
