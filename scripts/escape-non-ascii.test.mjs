import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, 'escape-non-ascii.mjs');
const require = createRequire(import.meta.url);
const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

async function distWith(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'escape-non-ascii-'));
  tempDirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), body);
  }
  return dir;
}

const run = (...args) => spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });

test('escapes comments, strings and templates and keeps every value', async () => {
  const body =
    '// note — here\n' +
    'const label = "\u{1F680} go →";\n' +
    'module.exports = { label, line: `§ ${label}`, chars: [..."—…"].length };\n';
  const dir = await distWith({ 'index.js': body, 'esm/index.mjs': '/** a → b */\nexport const x = 1;\n' });
  const before = require(path.join(dir, 'index.js'));
  delete require.cache[path.join(dir, 'index.js')];

  const res = run(dir);

  assert.equal(res.status, 0, res.stderr);
  for (const file of ['index.js', 'esm/index.mjs']) {
    assert.doesNotMatch(await fs.readFile(path.join(dir, file), 'utf8'), /[\u0080-\uffff]/);
  }
  assert.deepEqual(require(path.join(dir, 'index.js')), before);
});

test('leaves an ASCII-only file as it is', async () => {
  const body = 'module.exports = "plain";\n';
  const dir = await distWith({ 'index.js': body });

  assert.equal(run(dir).status, 0);
  assert.equal(await fs.readFile(path.join(dir, 'index.js'), 'utf8'), body);
});

test('refuses a raw template, whose text an escape would change', async () => {
  const body = 'module.exports = String.raw`a—b`;\n';
  const dir = await distWith({ 'index.js': body });

  const res = run(dir);

  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /index\.js: escaping its non-ASCII characters may change the program/);
  assert.equal(await fs.readFile(path.join(dir, 'index.js'), 'utf8'), body);
});

test('--check fails on a non-ASCII file and passes once it is escaped', async () => {
  const dir = await distWith({
    'nested/index.cjs': '/* ══ */ module.exports = 1;\n',
    'ok.js': 'module.exports = 2;\n',
  });

  const failing = run('--check', dir);
  assert.equal(failing.status, 1);
  assert.match(failing.stderr, /nested\/index\.cjs/);
  assert.doesNotMatch(failing.stderr, /ok\.js/);

  assert.equal(run(dir).status, 0);
  assert.equal(run('--check', dir).status, 0);
});
