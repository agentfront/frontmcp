#!/usr/bin/env node
/**
 * Makes the one cherry-pick to main that `.github/workflows/cherry-pick-prompt.yml` opens for a GitHub native
 * stack of PRs merged to a release branch, in place of one cherry-pick PR per PR.
 *
 * Usage:
 *   node scripts/cherry-pick-stack.mjs mode <pr-number>
 *   node scripts/cherry-pick-stack.mjs plan <stack-number> [--pull-requests <numbers>] [--wait <seconds>]
 *   node scripts/cherry-pick-stack.mjs apply <plan.json>
 *   node scripts/cherry-pick-stack.mjs render <pull-request|issue> <result.json> <default-branch> <branch>
 *
 * `mode` prints `mode=`, `stack=` and `top=` lines for $GITHUB_OUTPUT. The mode is `single` for a PR in no stack
 * of two or more PRs (it gets its own cherry-pick), `stack-top` for the stack's top PR, whose run makes the stack's
 * cherry-pick, `stack-member` for the PRs below it, and `skip` for a stack that is not on a release/* or next/*
 * branch.
 *
 * `plan` prints the stack's merged PRs as JSON, bottom to top, each with the commits that hold its change
 * (scripts/cherry-pick-commits.mjs). `--pull-requests` keeps only those PRs; `--wait` first waits up to that many
 * seconds for the stack's open PRs to merge. It only reads, so it is also the dry run.
 *
 * `apply` cherry-picks the plan onto HEAD, one commit per PR, and stops at the first conflict. It skips a PR HEAD
 * already has: a commit says "Cherry-picked from #<number>", or picking it changes nothing. It prints the result as
 * JSON and never pushes. `render` prints the title and body of the
 * cherry-pick PR, or of the issue for a conflict, as JSON.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { cherryPickCommits } from './cherry-pick-commits.mjs';

const RELEASE_BRANCH = /^(release|next)\//;
const POLL_INTERVAL_MS = 10_000;
const WORKFLOW_NAME = 'Cherry-pick to main';

function run(command, args) {
  const res = spawnSync(command, args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(res.stderr || res.stdout).trim()}`);
  }
  return res.stdout.trim();
}

function parseNumber(text = '') {
  const match = /^#?(\d+)$/.exec(text.trim());
  if (!match) throw new Error(`Expected a stack or pull request number, got "${text}"`);
  return Number(match[1]);
}

export function parsePullRequestList(text = '') {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(parseNumber);
}

function isClosedUnmerged(pullRequest) {
  return pullRequest.state === 'closed' && !pullRequest.merged_at;
}

export function stackMode(stacks, prNumber) {
  const stack = stacks.find((candidate) => candidate.pull_requests.some((entry) => entry.number === prNumber));
  if (!stack || stack.pull_requests.length < 2) return { mode: 'single' };
  if (!RELEASE_BRANCH.test(stack.base.ref)) return { mode: 'skip', stack: stack.number };
  const mergeable = stack.pull_requests.filter((entry) => entry.number === prNumber || !isClosedUnmerged(entry));
  const top = mergeable[mergeable.length - 1].number;
  return { mode: top === prNumber ? 'stack-top' : 'stack-member', stack: stack.number, top };
}

export function planStack(stack, selected = []) {
  if (!RELEASE_BRANCH.test(stack.base.ref)) {
    throw new Error(`Stack #${stack.number} merges into ${stack.base.ref}, not a release/* or next/* branch`);
  }
  const outside = selected.filter((number) => !stack.pull_requests.some((entry) => entry.number === number));
  if (outside.length > 0) throw new Error(`Not in stack #${stack.number}: #${outside.join(', #')}`);

  const chosen = stack.pull_requests.filter((entry) => selected.length === 0 || selected.includes(entry.number));
  return {
    stack: stack.number,
    releaseBranch: stack.base.ref,
    pullRequests: chosen
      .filter((entry) => entry.merged_at)
      .map(({ number, title, user }) => ({ number, title, author: user.login, authorId: user.id })),
    open: chosen.filter((entry) => entry.state === 'open').map((entry) => entry.number),
    closed: chosen.filter(isClosedUnmerged).map((entry) => entry.number),
  };
}

function fetchStack(stackNumber) {
  return JSON.parse(run('gh', ['api', `repos/{owner}/{repo}/stacks/${stackNumber}`]));
}

function mergeCommitOf(prNumber) {
  return run('gh', ['api', `repos/{owner}/{repo}/pulls/${prNumber}`, '--jq', '.merge_commit_sha']);
}

async function planWithCommits(stackNumber, selected, waitSeconds) {
  const deadline = Date.now() + waitSeconds * 1000;
  let plan = planStack(fetchStack(stackNumber), selected);
  while (plan.open.length > 0 && Date.now() < deadline) {
    console.error(`Waiting for #${plan.open.join(', #')} to merge`);
    await sleep(POLL_INTERVAL_MS);
    plan = planStack(fetchStack(stackNumber), selected);
  }
  if (plan.pullRequests.length === 0) throw new Error(`Stack #${stackNumber} has no merged PR to cherry-pick`);

  const pullRequests = plan.pullRequests.map((pullRequest) => ({
    ...pullRequest,
    commits: cherryPickCommits(mergeCommitOf(pullRequest.number), pullRequest.number),
  }));
  return { ...plan, pullRequests };
}

function printMode(prNumber) {
  let stacks = [];
  try {
    stacks = JSON.parse(run('gh', ['api', `repos/{owner}/{repo}/stacks?pull_request=${prNumber}`]));
  } catch (err) {
    console.error(
      `::warning::Could not read the stack of #${prNumber}, so it gets its own cherry-pick: ${err.message}`,
    );
  }
  const { mode, stack = '', top = '' } = stackMode(stacks, prNumber);
  console.log(`mode=${mode}\nstack=${stack}\ntop=${top}`);
}

function isMergeCommit(sha) {
  return run('git', ['rev-list', '--parents', '-n1', sha]).split(/\s+/).length > 2;
}

function commitMessage(pullRequest, releaseBranch) {
  return [
    `Cherry-pick: ${pullRequest.title}`,
    '',
    `Cherry-picked from #${pullRequest.number} (merged to ${releaseBranch})`,
    `Original commit: ${pullRequest.commits.join(' ')}`,
    '',
    `Co-Authored-By: ${pullRequest.author} <${pullRequest.authorId}+${pullRequest.author}@users.noreply.github.com>`,
  ].join('\n');
}

function hasCherryPickOf(prNumber) {
  const grep = `--grep=Cherry-picked from #${prNumber} (`;
  return run('git', ['log', '-n1', '--format=%H', '--fixed-strings', grep, 'HEAD']) !== '';
}

export function applyPlan(plan) {
  const picked = [];
  const alreadyApplied = [];
  for (const [index, pullRequest] of plan.pullRequests.entries()) {
    if (hasCherryPickOf(pullRequest.number)) {
      console.error(`#${pullRequest.number} was cherry-picked already`);
      alreadyApplied.push(pullRequest);
      continue;
    }
    const mainline = isMergeCommit(pullRequest.commits[0]) ? ['-m', '1'] : [];
    const pick = spawnSync('git', ['cherry-pick', '--no-commit', ...mainline, ...pullRequest.commits], {
      encoding: 'utf8',
    });
    if (pick.status !== 0) {
      console.error(`#${pullRequest.number} conflicts: ${(pick.stderr || pick.stdout).trim()}`);
      spawnSync('git', ['cherry-pick', '--abort']);
      run('git', ['reset', '--hard', '--quiet', 'HEAD']);
      return { ...plan, picked, alreadyApplied, conflict: pullRequest, remaining: plan.pullRequests.slice(index) };
    }
    if (spawnSync('git', ['diff', '--cached', '--quiet']).status === 0) {
      console.error(`#${pullRequest.number} is already applied`);
      alreadyApplied.push(pullRequest);
      continue;
    }
    run('git', ['commit', '--quiet', '--message', commitMessage(pullRequest, plan.releaseBranch)]);
    console.error(`#${pullRequest.number} picked`);
    picked.push(pullRequest);
  }
  return { ...plan, picked, alreadyApplied, conflict: null, remaining: [] };
}

function pullRequestRange(pullRequests) {
  const first = pullRequests[0].number;
  const last = pullRequests[pullRequests.length - 1].number;
  return first === last ? `#${first}` : `#${first}–#${last}`;
}

function pullRequestTitle(result) {
  return `Cherry-pick: stack #${result.stack} (${pullRequestRange(result.pullRequests)})`;
}

function listOf(pullRequests) {
  return pullRequests.map((pullRequest) => `- #${pullRequest.number} ${pullRequest.title} (@${pullRequest.author})`);
}

function rerunHint(stack) {
  return `run the **${WORKFLOW_NAME}** workflow by hand with \`stack: ${stack}\``;
}

export function renderPullRequest(result, defaultBranch) {
  const notMerged = [...result.open, ...result.closed];
  const body = [
    `## Cherry-pick to ${defaultBranch}`,
    '',
    `This PR cherry-picks stack #${result.stack}, merged to \`${result.releaseBranch}\`: one commit per PR, bottom to top.`,
    '',
    '### Pull requests',
    ...listOf(result.picked),
  ];
  if (result.alreadyApplied.length > 0) {
    body.push('', `### Already on \`${defaultBranch}\`, skipped`, ...listOf(result.alreadyApplied));
  }
  if (notMerged.length > 0) {
    body.push(
      '',
      '### Not merged when this ran, left out',
      ...notMerged.map((number) => `- #${number}`),
      '',
      `To cherry-pick them once they merge, ${rerunHint(result.stack)}.`,
    );
  }
  body.push(
    '',
    '### Action Required',
    `Please review this cherry-pick to ensure it applies correctly to \`${defaultBranch}\`.`,
    '',
    `If the changes are NOT needed in \`${defaultBranch}\`, close this PR.`,
    '',
    '---',
    '_This PR was automatically created by the cherry-pick workflow._',
  );
  return { title: pullRequestTitle(result), body: body.join('\n') };
}

export function renderIssue(result, defaultBranch, branch) {
  const { conflict } = result;
  const pickedSoFar = result.picked.map((pullRequest) => `#${pullRequest.number}`).join(', ') || 'none';
  const body = [
    '## Manual Cherry-pick Required',
    '',
    `The automatic cherry-pick of stack #${result.stack} to \`${defaultBranch}\` stopped at a merge conflict on #${conflict.number}.`,
    '',
    '### Stack',
    `- **Stack:** #${result.stack}, merged to \`${result.releaseBranch}\``,
    `- **Conflict:** #${conflict.number} ${conflict.title} (@${conflict.author})`,
    `- **Picked so far:** ${pickedSoFar}, on the branch \`${branch}\`, with no PR opened`,
  ];
  if (result.alreadyApplied.length > 0) {
    const skipped = result.alreadyApplied.map((pullRequest) => `#${pullRequest.number}`).join(', ');
    body.push(`- **Already on \`${defaultBranch}\`, skipped:** ${skipped}`);
  }
  body.push(
    '',
    '### Manual Cherry-pick Instructions',
    '',
    '```bash',
    '# Start from what was picked so far',
    'git fetch origin',
    `git checkout -b ${branch} origin/${branch}`,
    '',
    '# Cherry-pick the remaining PRs in order (use -m 1 for a merge commit)',
    ...result.remaining.map(
      (pullRequest) => `git cherry-pick ${pullRequest.commits.join(' ')}  # #${pullRequest.number}`,
    ),
    '# After resolving a conflict: git add . && git cherry-pick --continue',
    '',
    `# Re-pin internal versions to the ${defaultBranch} line, and commit what it changes`,
    'node scripts/normalize-internal-versions.mjs',
    'yarn install --mode=update-lockfile',
    '',
    '# Push and create PR',
    `git push origin ${branch}`,
    `gh pr create --base ${defaultBranch} --title "${pullRequestTitle(result)}"`,
    '```',
    '',
    `Or fix the conflict on \`${defaultBranch}\`, then ${rerunHint(result.stack)}: it starts again from \`${defaultBranch}\` and skips the PRs \`${defaultBranch}\` already has.`,
    '',
    '### Decision Required',
    '- [ ] Cherry-pick is needed - resolve conflicts and apply',
    '- [ ] Cherry-pick is NOT needed - close this issue',
    '',
    '---',
    '_This issue was automatically created by the cherry-pick workflow._',
  );
  const range = pullRequestRange(result.pullRequests);
  return { title: `Manual cherry-pick needed: stack #${result.stack} (${range})`, body: body.join('\n') };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { 'pull-requests': { type: 'string', default: '' }, wait: { type: 'string', default: '0' } },
  });
  const [command, ...args] = positionals;
  if (command === 'mode') {
    printMode(parseNumber(args[0]));
  } else if (command === 'plan') {
    const selected = parsePullRequestList(values['pull-requests']);
    print(await planWithCommits(parseNumber(args[0]), selected, parseNumber(values.wait)));
  } else if (command === 'apply') {
    print(applyPlan(readJson(args[0])));
  } else if (command === 'render' && (args[0] === 'pull-request' || args[0] === 'issue')) {
    const [kind, resultFile, defaultBranch, branch] = args;
    const result = readJson(resultFile);
    print(kind === 'issue' ? renderIssue(result, defaultBranch, branch) : renderPullRequest(result, defaultBranch));
  } else {
    console.error('Usage: node scripts/cherry-pick-stack.mjs <mode|plan|apply|render> ... (see the file header)');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
