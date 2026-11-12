import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptsDir);
const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

/** A copy of the script in a temporary repository whose catalog holds one example file with `frontmatter`. */
async function repoWithExample(frontmatter) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-catalog-'));
  tempDirs.push(root);
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile(path.join(scriptsDir, 'sync-catalog.mjs'), path.join(root, 'scripts', 'sync-catalog.mjs'));
  await fs.symlink(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'));
  const catalog = path.join(root, 'libs', 'skills', 'catalog');
  const exampleDir = path.join(catalog, 'some-skill', 'examples', 'some-reference');
  await fs.mkdir(exampleDir, { recursive: true });
  await fs.writeFile(path.join(catalog, 'skills-manifest.json'), '{ "skills": [] }\n');
  const body = '# Example\n\nShows a thing.\n\n## What This Demonstrates\n\n- First point\n- Second point\n';
  const examplePath = path.join(exampleDir, 'example.md');
  await fs.writeFile(examplePath, `---\n${frontmatter}---\n\n${body}`);
  return { root, examplePath };
}

test('replaces features built from nested YAML aliases with the body bullets, without expanding them', async () => {
  const levels = [`leaf: &l0 '${'x'.repeat(1000)}'`];
  for (let level = 1; level <= 6; level++) {
    const aliases = Array(9).fill(`*l${level - 1}`);
    levels.push(`l${level}: &l${level} [${aliases.join(', ')}]`);
  }
  const { root, examplePath } = await repoWithExample(`${levels.join('\n')}\nfeatures: [*l6, *l6]\n`);

  const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'sync-catalog.mjs')], { encoding: 'utf8' });

  assert.equal(res.status, 0, res.stderr);
  assert.match(await fs.readFile(examplePath, 'utf8'), /\nfeatures:\n {2}- First point\n {2}- Second point\n/);
});
