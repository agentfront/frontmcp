import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, after } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, 'inject-esm-require-banner.js');
const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

async function bundleWithBanner(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'esm-banner-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'bundle.mjs');
  await fs.writeFile(file, body);
  const res = spawnSync(process.execPath, [scriptPath, dir], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return file;
}

test('the banner does not statically import the node "module" builtin (browser bundlers stub it)', async () => {
  const file = await bundleWithBanner('export const ok = true;\n');
  const out = await fs.readFile(file, 'utf8');
  assert.doesNotMatch(out, /^\s*import\b.*['"]module['"]/m);
  assert.doesNotMatch(out, /from\s+['"](node:)?module['"]/);
});

test('on Node the banner defines a working require', async () => {
  const file = await bundleWithBanner('export const path = require("node:path").sep;\n');
  const mod = await import(pathToFileURL(file).href);
  assert.equal(mod.path, path.sep);
});

test('with no process global the bundle still loads and require stays undefined', async () => {
  const file = await bundleWithBanner('export const kind = typeof require;\n');
  const res = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const saved = globalThis.process; ` +
        `Object.defineProperty(globalThis, 'process', { value: undefined, configurable: true }); ` +
        `const m = await import(${JSON.stringify(pathToFileURL(file).href)}); ` +
        `Object.defineProperty(globalThis, 'process', { value: saved, configurable: true }); ` +
        `console.log(m.kind);`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), 'undefined');
});

test('injection is idempotent', async () => {
  const file = await bundleWithBanner('export const x = 1;\n');
  const first = await fs.readFile(file, 'utf8');
  spawnSync(process.execPath, [scriptPath, path.dirname(file)], { encoding: 'utf8' });
  assert.equal(await fs.readFile(file, 'utf8'), first);
});
