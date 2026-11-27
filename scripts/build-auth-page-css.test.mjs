import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-auth-page-css.mjs');

test('the checked-in auth page stylesheet matches the classes the pages use', () => {
  const res = spawnSync(process.execPath, [scriptPath, '--check'], { encoding: 'utf8' });

  assert.equal(res.status, 0, res.stderr);
});
