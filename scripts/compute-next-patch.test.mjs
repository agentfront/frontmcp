import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, after } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptPath = path.join(__dirname, 'compute-next-patch.mjs');

// Track temporary directories for cleanup
const tempDirs = [];

// Cleanup all temporary directories after all tests
after(async () => {
  for (const dir of tempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

function run(cwd, args) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
  });

  return {
    code: res.status ?? 0,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  };
}

function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(res.stderr || res.stdout || '').trim()}`);
  }
  return (res.stdout || '').trim();
}

async function initRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'compute-next-patch-'));
  tempDirs.push(dir);

  git(dir, ['init']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);

  await fs.writeFile(path.join(dir, 'README.md'), 'test\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'init']);

  return dir;
}

test('stable: increments patch from latest stable tag', async () => {
  const repo = await initRepo();
  git(repo, ['tag', 'v1.4.2']);

  const out = run(repo, ['1.4']);
  assert.equal(out.code, 0);
  assert.equal(out.stdout, '1.4.3');
});

test('rc: auto-increments pre-release number for target version', async () => {
  const repo = await initRepo();
  git(repo, ['tag', 'v1.4.2']);
  git(repo, ['tag', 'v1.4.3-rc.1']);

  const out = run(repo, ['1.4', 'rc']);
  assert.equal(out.code, 0);
  assert.equal(out.stdout, '1.4.3-rc.2');
});

test('stable: rejects pre-release number argument', async () => {
  const repo = await initRepo();
  git(repo, ['tag', 'v1.4.2']);

  const out = run(repo, ['1.4', 'stable', '1']);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /pre-release-number is only valid/i);
});

test('rc: rejects non-numeric pre-release number', async () => {
  const repo = await initRepo();
  git(repo, ['tag', 'v1.4.2']);

  const out = run(repo, ['1.4', 'rc', 'abc']);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /Invalid pre-release number/i);
});

test('stable: first version when no existing tags', async () => {
  const repo = await initRepo();
  // No tags created - should start at X.Y.0

  const out = run(repo, ['1.4']);
  assert.equal(out.code, 0);
  assert.equal(out.stdout, '1.4.0');
});

test('beta: auto-increments pre-release number', async () => {
  const repo = await initRepo();
  git(repo, ['tag', 'v1.4.2']);
  git(repo, ['tag', 'v1.4.3-beta.1']);

  const out = run(repo, ['1.4', 'beta']);
  assert.equal(out.code, 0);
  assert.equal(out.stdout, '1.4.3-beta.2');
});

test('beta: starts at beta.1 when no prior beta tags', async () => {
  const repo = await initRepo();
  git(repo, ['tag', 'v1.4.2']);

  const out = run(repo, ['1.4', 'beta']);
  assert.equal(out.code, 0);
  assert.equal(out.stdout, '1.4.3-beta.1');
});

test('rc: explicit pre-release number overrides auto-increment', async () => {
  const repo = await initRepo();
  git(repo, ['tag', 'v1.4.2']);
  git(repo, ['tag', 'v1.4.3-rc.1']);
  git(repo, ['tag', 'v1.4.3-rc.2']);

  const out = run(repo, ['1.4', 'rc', '5']);
  assert.equal(out.code, 0);
  assert.equal(out.stdout, '1.4.3-rc.5');
});

test('rejects invalid release type', async () => {
  const repo = await initRepo();
  git(repo, ['tag', 'v1.4.2']);

  const out = run(repo, ['1.4', 'alpha']);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /Invalid release type/i);
});

test('rejects missing release-line argument', async () => {
  const repo = await initRepo();

  const out = run(repo, []);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /Usage:/i);
});

