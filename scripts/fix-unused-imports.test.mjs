import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(scriptsDir, 'fix-unused-imports.mjs');
const repoRoot = path.dirname(scriptsDir);
const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(res.stderr || res.stdout).trim()}`);
  return res.stdout.trim();
}

async function commitFile(repo, file, message) {
  await fs.writeFile(path.join(repo, file), `${message}\n`);
  git(repo, ['add', file]);
  git(repo, ['commit', '-m', message]);
}

/**
 * A clone whose local `main` is stale, of a remote with `main` and `release/1.9.x` that each moved on.
 * Only Markdown changes, so the script finds no code file to run ESLint on.
 */
async function cloneWithReleaseLine() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fix-unused-imports-'));
  tempDirs.push(root);
  const remote = path.join(root, 'remote.git');
  const clone = path.join(root, 'clone');
  git(root, ['init', '--bare', '--initial-branch=main', remote]);
  git(root, ['clone', remote, clone]);
  git(clone, ['config', 'user.email', 'test@example.com']);
  git(clone, ['config', 'user.name', 'test']);
  await commitFile(clone, 'README.md', 'init');
  git(clone, ['push', 'origin', 'main']);
  git(clone, ['switch', '-c', 'release/1.9.x']);
  await commitFile(clone, 'RELEASE.md', 'release line');
  git(clone, ['push', 'origin', 'release/1.9.x']);
  git(clone, ['switch', 'main']);
  await commitFile(clone, 'MAIN.md', 'main moved on');
  git(clone, ['push', 'origin', 'main']);
  git(clone, ['reset', '--hard', 'HEAD~1']);
  return clone;
}

function run(cwd, args = [], env = {}) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_BASE_REF: '', ...env },
  });
  return { code: res.status, stdout: res.stdout.trim() };
}

test('compares a branch from the release line against the remote release branch, not the stale local main', async () => {
  const clone = await cloneWithReleaseLine();
  git(clone, ['switch', '-c', 'fix/thing', 'origin/release/1.9.x']);
  await commitFile(clone, 'FIX.md', 'the fix');

  const out = run(clone);

  assert.equal(out.code, 0);
  assert.match(out.stdout, /^Comparing against: origin\/release\/1\.9\.x$/m);
  assert.match(out.stdout, /No changed TypeScript\/JavaScript files to process\./);
});

test('compares a branch from main against the remote main', async () => {
  const clone = await cloneWithReleaseLine();
  git(clone, ['switch', '-c', 'feat/thing', 'origin/main']);
  await commitFile(clone, 'FEAT.md', 'the feature');

  assert.match(run(clone).stdout, /^Comparing against: origin\/main$/m);
});

test("uses the pull request's base when GITHUB_BASE_REF is set", async () => {
  const clone = await cloneWithReleaseLine();
  git(clone, ['switch', '-c', 'feat/thing', 'origin/main']);

  assert.match(
    run(clone, [], { GITHUB_BASE_REF: 'release/1.9.x' }).stdout,
    /^Comparing against: origin\/release\/1\.9\.x$/m,
  );
});

test('an explicit base branch wins', async () => {
  const clone = await cloneWithReleaseLine();
  git(clone, ['switch', '-c', 'fix/thing', 'origin/release/1.9.x']);

  assert.match(run(clone, ['main']).stdout, /^Comparing against: main$/m);
});

test('a changed file named like an ESLint option is linted as a file, not read as an option', async () => {
  const clone = await cloneWithReleaseLine();
  git(clone, ['switch', '-c', 'feat/thing', 'origin/main']);
  await fs.symlink(path.join(repoRoot, 'node_modules'), path.join(clone, 'node_modules'));
  const otherConfig =
    "import { writeFileSync } from 'node:fs';\nwriteFileSync('OTHER_CONFIG_LOADED', '');\nexport default [];\n";
  await fs.writeFile(path.join(clone, 'other.mjs'), otherConfig);
  await fs.writeFile(path.join(clone, '--config=other.mjs'), 'export {};\n');
  await fs.writeFile(path.join(clone, 'changed.ts'), "import { unused } from 'node:fs';\nexport const value = 1;\n");
  git(clone, ['add', '--', 'other.mjs', '--config=other.mjs', 'changed.ts']);
  git(clone, ['commit', '-m', 'option-like file name']);

  const out = run(clone, ['origin/main']);

  assert.equal(out.code, 0);
  await assert.rejects(fs.access(path.join(clone, 'OTHER_CONFIG_LOADED')));
  assert.equal(await fs.readFile(path.join(clone, 'changed.ts'), 'utf8'), 'export const value = 1;\n');
});
