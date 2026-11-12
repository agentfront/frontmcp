import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'perf-fetch-baseline.mjs');
const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

const fakeGh = `#!/bin/sh
printf '%s\\n' "$@" >> "$GH_ARGS_LOG"
if [ "$1" = "release" ]; then
  printf '%s' "$GH_RELEASE_LIST"
else
  cat "$GH_RELEASE_FILE"
fi
`;

/** Runs the script in a fresh directory against a stub gh that lists `tagName` and returns `release` for it. */
async function runWithRelease(tagName, release) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'perf-fetch-baseline-'));
  tempDirs.push(dir);
  const binDir = path.join(dir, 'bin');
  await fs.mkdir(binDir);
  await fs.writeFile(path.join(binDir, 'gh'), fakeGh, { mode: 0o755 });
  await fs.writeFile(path.join(dir, 'release.json'), JSON.stringify(release));
  const res = spawnSync(process.execPath, [scriptPath], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      GITHUB_REPOSITORY: 'owner/repo',
      GH_ARGS_LOG: path.join(dir, 'gh-args.log'),
      GH_RELEASE_LIST: JSON.stringify([{ tagName }]),
      GH_RELEASE_FILE: path.join(dir, 'release.json'),
    },
  });
  const ghArgs = (await fs.readFile(path.join(dir, 'gh-args.log'), 'utf8')).split('\n');
  return { dir, code: res.status, stdout: res.stdout, ghArgs };
}

const START = '<!-- PERF_BASELINE_START -->';
const END = '<!-- PERF_BASELINE_END -->';

test('writes the baseline found in the release body', async () => {
  const baseline = { release: 'v1.0.0', tests: { first: { memory: 1 } } };
  const body = `Notes\n${START}\n\`\`\`json\n${JSON.stringify(baseline)}\n\`\`\`\n${END}\n`;

  const { dir, code } = await runWithRelease('v1.0.0', { body });

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'perf-results/baseline.json'), 'utf8')), baseline);
});

test('answers at once for a JSON fence that is never closed, with a long run of whitespace', async () => {
  const body = `${START}\n\`\`\`json${' '.repeat(20000)}\n${END}`;

  const { code, stdout } = await runWithRelease('v1.0.0', { body });

  assert.equal(code, 0);
  assert.match(stdout, /No valid baseline found/);
});

test('a release tag with shell syntax reaches gh as one encoded argument and runs nothing', async () => {
  const { dir, code, ghArgs } = await runWithRelease('v1.0.0$(touch${IFS}TAG_RAN)', { body: '' });

  assert.equal(code, 0);
  await assert.rejects(fs.access(path.join(dir, 'TAG_RAN')));
  assert.ok(ghArgs.includes('repos/owner/repo/releases/tags/v1.0.0%24(touch%24%7BIFS%7DTAG_RAN)'));
});
