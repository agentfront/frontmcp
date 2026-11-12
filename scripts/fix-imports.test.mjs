import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(scriptsDir, 'fix-imports.ts');
const repoRoot = path.dirname(scriptsDir);
const tsxPath = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

/** Runs git in `cwd` and throws with its output when it fails. */
function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(res.stderr || res.stdout).trim()}`);
}

test('a changed file named like an ESLint or Prettier option is processed as a file, not read as an option', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'fix-imports-'));
  tempDirs.push(repo);
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'test']);
  await fs.writeFile(path.join(repo, 'README.md'), 'init\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'init']);
  git(repo, ['switch', '-c', 'feat/thing']);
  await fs.symlink(path.join(repoRoot, 'node_modules'), path.join(repo, 'node_modules'));
  const otherConfig =
    "import { writeFileSync } from 'node:fs';\nwriteFileSync('OTHER_CONFIG_LOADED', '');\nexport default {};\n";
  await fs.writeFile(path.join(repo, 'other.ts'), otherConfig);
  await fs.writeFile(path.join(repo, '--config=other.ts'), 'export {};\n');
  const duplicateImports =
    "import { join } from 'node:path';\nimport { dirname } from 'node:path';\nexport const value = [join, dirname];\n";
  await fs.writeFile(path.join(repo, 'changed.ts'), duplicateImports);
  git(repo, ['add', '--', 'other.ts', '--config=other.ts', 'changed.ts']);
  git(repo, ['commit', '-m', 'option-like file name']);

  const res = spawnSync(tsxPath, [scriptPath], { cwd: repo, encoding: 'utf8' });

  assert.equal(res.status, 0);
  await assert.rejects(fs.access(path.join(repo, 'OTHER_CONFIG_LOADED')));
  const changed = await fs.readFile(path.join(repo, 'changed.ts'), 'utf8');
  assert.match(changed, /^import \{ dirname, join \} from ["']node:path["'];\n/);
});
