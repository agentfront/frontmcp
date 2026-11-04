import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, 'cherry-pick-commits.mjs');

let repo;

function git(...args) {
  const res = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim();
}

async function commit(subject, file, content) {
  if (file) await fs.writeFile(path.join(repo, file), content);
  git('add', '-A');
  git('commit', '--allow-empty', '-q', '-m', subject);
  return git('rev-parse', 'HEAD');
}

function run(...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { cwd: repo, encoding: 'utf8' });
}

const shas = {};

before(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-pick-commits-'));
  git('init', '-q', '-b', 'release');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  shas.base = await commit('chore(release): bump version to 1.11.0', 'version.txt', '1.11.0');
  // A stack of three PRs, merged as GitHub merges a native stack.
  shas.first = await commit('fix(sdk): exports (#1054)', 'exports.ts', 'export {}');
  shas.second = await commit('fix(sdk): headers (#1055)', 'headers.ts', 'headers');
  shas.thirdChange = await commit('fix(sdk): redirect (#1056)', 'redirect.ts', 'redirect');
  shas.thirdMerge = await commit('fix(sdk): redirect (#1056)');
  // A PR whose merge commit is empty and nothing before it is its own.
  shas.emptyOnly = await commit('docs: nothing to change (#1060)');
  // A merge commit with two parents.
  git('checkout', '-q', '-b', 'topic', shas.base);
  await commit('feat: topic work', 'topic.ts', 'topic');
  git('checkout', '-q', 'release');
  git('merge', '-q', '--no-ff', '-m', 'Merge pull request #1070 from topic', 'topic');
  shas.realMerge = git('rev-parse', 'HEAD');
});

after(async () => {
  await fs.rm(repo, { recursive: true, force: true });
});

test('a squash merge is its merge commit', () => {
  const res = run(shas.first, '1054');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), shas.first);
});

test('a stacked PR whose change landed before an empty merge commit is the change', () => {
  const res = run(shas.thirdMerge, '1056');
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.stdout.trim().split('\n'), [shas.thirdChange]);
});

test("stops at the first commit of another PR, so a stacked PR never picks its parent's change", () => {
  const res = run(shas.second, '1055');
  assert.equal(res.stdout.trim(), shas.second);
});

test('an empty merge commit with no change of its own is printed, for the workflow to report as applied', () => {
  const res = run(shas.emptyOnly, '1060');
  assert.equal(res.stdout.trim(), shas.emptyOnly);
});

test('a merge commit with two parents is printed alone', () => {
  const res = run(shas.realMerge, '1070');
  assert.equal(res.stdout.trim(), shas.realMerge);
});

test('refuses a missing PR number, and an unknown commit', () => {
  assert.equal(run(shas.first).status, 2);
  const unknown = run('0000000000000000000000000000000000000000', '1');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /failed/);
});
