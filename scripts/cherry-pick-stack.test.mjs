import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parsePullRequestList, planStack, renderIssue, renderPullRequest, stackMode } from './cherry-pick-stack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, 'cherry-pick-stack.mjs');

function entry(number, state = 'merged') {
  return {
    number,
    title: `fix(sdk): change ${number}`,
    state: state === 'open' ? 'open' : 'closed',
    merged_at: state === 'merged' ? '2026-11-04T23:22:41Z' : null,
    user: { login: 'octocat', id: 583231 },
  };
}

function stackOf(entries, baseRef = 'release/1.11.x') {
  return { number: 1084, base: { ref: baseRef }, open: false, pull_requests: entries };
}

describe('stackMode', () => {
  test('a PR in no stack, or in a stack of one, gets its own cherry-pick', () => {
    assert.deepEqual(stackMode([], 1069), { mode: 'single' });
    assert.deepEqual(stackMode([stackOf([entry(1069)])], 1069), { mode: 'single' });
  });

  test("the stack's top PR is the one that acts", () => {
    const stacks = [stackOf([entry(1072), entry(1073), entry(1104)])];
    assert.deepEqual(stackMode(stacks, 1104), { mode: 'stack-top', stack: 1084, top: 1104 });
  });

  test('a PR below the top only names the stack and its top', () => {
    const stacks = [stackOf([entry(1072), entry(1073), entry(1104)])];
    assert.deepEqual(stackMode(stacks, 1073), { mode: 'stack-member', stack: 1084, top: 1104 });
  });

  test('a top PR closed without merging leaves the PR below it as the top', () => {
    const stacks = [stackOf([entry(1072), entry(1073), entry(1104, 'closed')])];
    assert.equal(stackMode(stacks, 1073).mode, 'stack-top');
  });

  test('a stack that is not on a release or next branch is skipped', () => {
    const stacks = [stackOf([entry(1072), entry(1073)], 'main')];
    assert.deepEqual(stackMode(stacks, 1073), { mode: 'skip', stack: 1084 });
    assert.equal(stackMode([stackOf([entry(1), entry(2)], 'next/2.0')], 2).mode, 'stack-top');
  });
});

describe('planStack', () => {
  test('includes the merged PRs bottom to top, with their authors', () => {
    const plan = planStack(stackOf([entry(1072), entry(1083), entry(1078)]));
    assert.equal(plan.releaseBranch, 'release/1.11.x');
    assert.deepEqual(
      plan.pullRequests.map((pullRequest) => pullRequest.number),
      [1072, 1083, 1078],
    );
    assert.deepEqual(plan.pullRequests[0], {
      number: 1072,
      title: 'fix(sdk): change 1072',
      author: 'octocat',
      authorId: 583231,
    });
  });

  test('a partly merged stack lists the open and the closed PRs apart', () => {
    const plan = planStack(stackOf([entry(1072), entry(1073, 'closed'), entry(1074), entry(1075, 'open')]));
    assert.deepEqual(
      plan.pullRequests.map((pullRequest) => pullRequest.number),
      [1072, 1074],
    );
    assert.deepEqual(plan.open, [1075]);
    assert.deepEqual(plan.closed, [1073]);
  });

  test('a list of PRs keeps those, in stack order', () => {
    const plan = planStack(stackOf([entry(1072), entry(1073), entry(1074), entry(1075, 'open')]), [1074, 1072, 1075]);
    assert.deepEqual(
      plan.pullRequests.map((pullRequest) => pullRequest.number),
      [1072, 1074],
    );
    assert.deepEqual(plan.open, [1075]);
  });

  test('refuses a PR that is not in the stack, and a stack that is not on a release branch', () => {
    assert.throws(() => planStack(stackOf([entry(1072)]), [1072, 999]), /Not in stack #1084: #999/);
    assert.throws(() => planStack(stackOf([entry(1072)], 'main')), /merges into main/);
  });
});

describe('parsePullRequestList', () => {
  test('reads numbers separated by commas or spaces, with or without #', () => {
    assert.deepEqual(parsePullRequestList('1072, #1073 1074,,'), [1072, 1073, 1074]);
    assert.deepEqual(parsePullRequestList(''), []);
    assert.deepEqual(parsePullRequestList(), []);
  });

  test('refuses anything else', () => {
    assert.throws(() => parsePullRequestList('1072, 10x3'), /Expected a stack or pull request number, got "10x3"/);
  });
});

describe('apply', () => {
  let repo;
  let scratch;
  const shas = {};

  function git(...args) {
    const res = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    return res.stdout.trim();
  }

  async function commit(subject, file, content) {
    await fs.writeFile(path.join(repo, file), content);
    git('add', '-A');
    git('commit', '-q', '-m', subject);
    return git('rev-parse', 'HEAD');
  }

  async function apply(pullRequests) {
    const planPath = path.join(scratch, 'plan.json');
    const plan = { stack: 1084, releaseBranch: 'release/1.11.x', open: [], closed: [], pullRequests };
    await fs.writeFile(planPath, JSON.stringify(plan));
    const res = spawnSync(process.execPath, [scriptPath, 'apply', planPath], { cwd: repo, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  }

  function pullRequest(number, ...commits) {
    return { ...planStack(stackOf([entry(number)])).pullRequests[0], commits };
  }

  before(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-pick-stack-'));
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-pick-stack-plan-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    await commit('chore: start', 'shared.txt', 'shared\n');

    git('checkout', '-q', '-b', 'release');
    shas.first = await commit('fix(sdk): first (#11)', 'first.txt', 'first\n');
    shas.second = await commit('fix(sdk): second (#12)', 'second.txt', 'second\n');
    shas.third = await commit('fix(sdk): third (#13)', 'shared.txt', 'shared, from the release branch\n');
    shas.fourth = await commit('fix(sdk): fourth (#14)', 'fourth.txt', 'fourth\n');
    git('checkout', '-q', '-b', 'topic');
    await commit('feat: topic work', 'topic.txt', 'topic\n');
    git('checkout', '-q', 'release');
    git('merge', '-q', '--no-ff', '-m', 'Merge pull request #15 from topic', 'topic');
    shas.merge = git('rev-parse', 'HEAD');

    git('checkout', '-q', 'main');
    shas.main = await commit('fix(sdk): second, on main', 'second.txt', 'second\n');
  });

  after(async () => {
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(scratch, { recursive: true, force: true });
  });

  test('picks each PR as one commit, in order, and skips a PR main already has', async () => {
    git('checkout', '-q', '-B', 'cherry-pick/stack-1084-main', shas.main);
    const result = await apply([
      pullRequest(11, shas.first),
      pullRequest(12, shas.second),
      pullRequest(14, shas.fourth),
      pullRequest(15, shas.merge),
    ]);

    assert.deepEqual(
      result.picked.map((picked) => picked.number),
      [11, 14, 15],
    );
    assert.deepEqual(
      result.alreadyApplied.map((skipped) => skipped.number),
      [12],
    );
    assert.equal(result.conflict, null);
    assert.deepEqual(git('log', '--format=%s', `${shas.main}..HEAD`, '--reverse').split('\n'), [
      'Cherry-pick: fix(sdk): change 11',
      'Cherry-pick: fix(sdk): change 14',
      'Cherry-pick: fix(sdk): change 15',
    ]);
    assert.equal(
      git('log', '-1', '--format=%b', 'HEAD~2'),
      [
        'Cherry-picked from #11 (merged to release/1.11.x)',
        `Original commit: ${shas.first}`,
        '',
        'Co-Authored-By: octocat <583231+octocat@users.noreply.github.com>',
      ].join('\n'),
    );
    assert.equal(git('show', 'HEAD:topic.txt'), 'topic');
  });

  test('skips a PR main records as cherry-picked, although picking it again would conflict', async () => {
    git('checkout', '-q', '-B', 'picked-main', shas.main);
    await commit(
      'Cherry-pick: fix(sdk): third\n\nCherry-picked from #13 (merged to release/1.11.x)',
      'shared.txt',
      'x\n',
    );
    const start = await commit('fix(sdk): shared, edited again on main', 'shared.txt', 'shared, edited again\n');
    git('checkout', '-q', '-B', 'cherry-pick/stack-1084-main', start);

    const result = await apply([pullRequest(13, shas.third), pullRequest(14, shas.fourth)]);

    assert.equal(result.conflict, null);
    assert.deepEqual(
      result.alreadyApplied.map((skipped) => skipped.number),
      [13],
    );
    assert.deepEqual(
      result.picked.map((picked) => picked.number),
      [14],
    );
  });

  test('stops at a conflict, keeps what it picked, and leaves a clean tree', async () => {
    git('checkout', '-q', '-B', 'conflicting-main', shas.main);
    const start = await commit('fix(sdk): shared, on main', 'shared.txt', 'shared, from main\n');
    git('checkout', '-q', '-B', 'cherry-pick/stack-1084-main', start);

    const result = await apply([
      pullRequest(11, shas.first),
      pullRequest(13, shas.third),
      pullRequest(14, shas.fourth),
    ]);

    assert.equal(result.conflict.number, 13);
    assert.deepEqual(
      result.picked.map((picked) => picked.number),
      [11],
    );
    assert.deepEqual(
      result.remaining.map((remaining) => [remaining.number, remaining.commits]),
      [
        [13, [shas.third]],
        [14, [shas.fourth]],
      ],
    );
    assert.equal(git('rev-parse', 'HEAD~1'), start);
    assert.equal(git('status', '--porcelain'), '');
  });
});

describe('render', () => {
  const picked = [entry(1072), entry(1073), entry(1074)].map((merged) => ({
    ...planStack(stackOf([merged])).pullRequests[0],
    commits: [`sha${merged.number}`],
  }));
  const base = { stack: 1084, releaseBranch: 'release/1.11.x', pullRequests: picked, open: [], closed: [] };

  test('the PR names the stack and its range, and lists the picked, the skipped and the unmerged PRs', () => {
    const result = { ...base, picked: picked.slice(1), alreadyApplied: picked.slice(0, 1), open: [1075], closed: [] };
    const { title, body } = renderPullRequest(result, 'main');

    assert.equal(title, 'Cherry-pick: stack #1084 (#1072–#1074)');
    assert.match(body, /### Pull requests\n- #1073 fix\(sdk\): change 1073 \(@octocat\)\n- #1074 /);
    assert.match(body, /### Already on `main`, skipped\n- #1072 /);
    assert.match(body, /### Not merged when this ran, left out\n- #1075\n/);
  });

  test('the issue names the PR that conflicted and the commits still to pick', () => {
    const result = {
      ...base,
      picked: picked.slice(0, 1),
      alreadyApplied: [],
      conflict: picked[1],
      remaining: picked.slice(1),
    };
    const { title, body } = renderIssue(result, 'main', 'cherry-pick/stack-1084-main');

    assert.equal(title, 'Manual cherry-pick needed: stack #1084 (#1072–#1074)');
    assert.match(body, /stopped at a merge conflict on #1073/);
    assert.match(body, /\*\*Picked so far:\*\* #1072, on the branch `cherry-pick\/stack-1084-main`/);
    assert.match(body, /git cherry-pick sha1073 {2}# #1073\ngit cherry-pick sha1074 {2}# #1074\n/);
    assert.match(body, /yarn install --mode=update-lockfile\ngit add -A && \(git diff --cached --quiet \|\| git commit -m /);
    assert.match(body, /`stack: 1084`/);
  });
});

test('the command line refuses an unknown command and a bad number', () => {
  assert.equal(spawnSync(process.execPath, [scriptPath, 'push'], { encoding: 'utf8' }).status, 2);
  const badNumber = spawnSync(process.execPath, [scriptPath, 'mode', 'abc'], { encoding: 'utf8' });
  assert.equal(badNumber.status, 1);
  assert.match(badNumber.stderr, /Expected a stack or pull request number/);
});
