#!/usr/bin/env node
/**
 * Prints the commits that hold a merged PR's change, oldest first, one per line: what
 * `.github/workflows/cherry-pick-prompt.yml` cherry-picks to main.
 *
 * Usage: node scripts/cherry-pick-commits.mjs <merge-commit-sha> <pr-number>
 *
 * A squash merge is one commit, the PR's merge commit. When GitHub merges a native stack, an upper
 * PR's change can land as its own commit, with the PR's merge commit after it and empty: on
 * release/1.11.x, #1056 is 2a43a8b66 (the change) and 29920b485 (empty). Cherry-picking the merge
 * commit alone then picks nothing. So walk back along first parents from the merge commit, through
 * the commits whose subject ends with the PR's "(#<number>)" suffix, and print those that change
 * files. A merge commit with several parents is printed alone (the workflow picks it with `-m 1`),
 * as is the merge commit when none of the commits changes a file.
 */
import { spawnSync } from 'node:child_process';

const MAX_COMMITS = 50;

function git(args) {
  const res = spawnSync('git', args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(res.stderr || res.stdout).trim()}`);
  }
  return res.stdout.trim();
}

/** Whether a commit with one parent changes any file. A root commit always does. */
function changesFiles(sha) {
  const parents = git(['rev-list', '--parents', '-n1', sha]).split(/\s+/).slice(1);
  if (parents.length === 0) return true;
  return spawnSync('git', ['diff', '--quiet', parents[0], sha], { encoding: 'utf8' }).status !== 0;
}

export function cherryPickCommits(mergeSha, prNumber) {
  const merge = git(['rev-parse', '--verify', `${mergeSha}^{commit}`]);
  const parents = git(['rev-list', '--parents', '-n1', merge]).split(/\s+/).slice(1);
  if (parents.length > 1) return [merge];

  const suffix = `(#${prNumber})`;
  const run = [merge];
  let current = parents[0];
  while (current && run.length < MAX_COMMITS) {
    const [subject, ...currentParents] = git(['log', '-n1', '--format=%s%x00%P', current]).split('\0');
    const parentList = currentParents.join('').trim().split(/\s+/).filter(Boolean);
    if (!subject.trimEnd().endsWith(suffix) || parentList.length !== 1) break;
    run.unshift(current);
    current = parentList[0];
  }

  const withChanges = run.filter(changesFiles);
  return withChanges.length > 0 ? withChanges : [merge];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mergeSha, prNumber] = process.argv.slice(2);
  if (!mergeSha || !/^\d+$/.test(prNumber ?? '')) {
    console.error('Usage: node scripts/cherry-pick-commits.mjs <merge-commit-sha> <pr-number>');
    process.exit(2);
  }
  try {
    console.log(cherryPickCommits(mergeSha, prNumber).join('\n'));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
