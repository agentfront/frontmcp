import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// ─── Every ESM build that can call require() at runtime gets the banner ──────
//
// A lazy `require('path')` in a package's source survives into its `.mjs` bundle as esbuild's
// `__require` shim, which throws "Dynamic require of "path" is not supported" in an ES-module
// project unless the banner defined `require`. `@frontmcp/uipack` shipped without it, so a
// `"type": "module"` server could not bundle a `.tsx` widget or build an `auth.ui` page (#681).

const repoRoot = path.resolve(__dirname, '..');

/** Strip comments so a `require(` in a doc comment does not count. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

async function sourceCallsRequire(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      if (await sourceCallsRequire(full)) return true;
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(spec|test)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      const source = stripComments(await fs.readFile(full, 'utf8'));
      if (/(^|[^.\w$])require\(\s*['"`]/m.test(source)) return true;
    }
  }
  return false;
}

function buildCommands(project) {
  const options = project.targets?.build?.options ?? {};
  return [options.command, ...(options.commands ?? [])]
    .filter(Boolean)
    .map((cmd) => (typeof cmd === 'string' ? cmd : cmd.command));
}

test('every package whose ESM bundle can call require() injects the banner after building', async () => {
  const missing = [];
  for (const group of ['libs', 'plugins']) {
    for (const name of await fs.readdir(path.join(repoRoot, group))) {
      const projectDir = path.join(repoRoot, group, name);
      let project;
      try {
        project = JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8'));
      } catch {
        continue;
      }
      if (!project.targets?.['build-esm']) continue;
      if (!(await sourceCallsRequire(path.join(projectDir, 'src')))) continue;
      const esmDir = `${group}/${name}/dist/esm`;
      if (!buildCommands(project).some((cmd) => cmd.includes(`inject-esm-require-banner.js ${esmDir}`))) {
        missing.push(`${group}/${name}`);
      }
    }
  }
  assert.deepEqual(missing, [], `ESM builds with a lazy require() but no banner: ${missing.join(', ')}`);
});

test('a bundle that already inlines another package banner still loads (#681)', async () => {
  // edge / plugin-cache / plugin-dashboard bundle @frontmcp/utils' ESM output, banner included
  const file = await bundleWithBanner(
    'var __frontmcpModule = undefined;\nvar require2 = undefined;\nexport const sep = require("node:path").sep;\n',
  );
  const mod = await import(pathToFileURL(file).href);
  assert.equal(mod.sep, path.sep);
});
