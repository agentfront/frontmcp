// apps/e2e/demo-e2e-cli-exec/e2e/cli-test-pnpm-esm.e2e.spec.ts
//
// End-to-end test for `frontmcp test`'s injected `transformIgnorePatterns`
// under pnpm's node_modules layout (issue #519).
//
// pnpm installs into a symlinked content-addressable store, so the real path
// Jest resolves for a dependency is
// `node_modules/.pnpm/<name>@<version>/node_modules/<name>/...`. The previous
// pattern `node_modules/(?!(jose)/)` is unanchored, so it matched at the FIRST
// `node_modules/` — followed by `.pnpm/`, not the package name — the file was
// ignored, and the run died with `SyntaxError: Unexpected token 'export'`.
//
// We reproduce that layout by hand (no pnpm binary needed) with an ESM-only
// fixture package, and assert the compiled `frontmcp` CLI transpiles it. The
// project also sets `test.esmPackages`, so this covers the new config option
// through the real jest + swc pipeline at the same time.

import { spawn } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const FRONTMCP_BIN = path.join(ROOT_DIR, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');
const ROOT_NODE_MODULES = path.join(ROOT_DIR, 'node_modules');
const TEST_TIMEOUT = 120_000;

// The injected config references these by bare specifier, so the temp project
// must resolve them from its own cwd. Symlinking the individual entries (rather
// than the whole `node_modules`, as the sibling issue-#402 spec does) leaves us
// free to author a real `.pnpm` store alongside them. Each package's own
// transitive deps still resolve from its realpath inside the monorepo.
const LINKED_DEPS = ['.bin', 'jest', '@swc', '@frontmcp'];

const FIXTURE_NAME = 'esm-only-fixture';
const FIXTURE_VERSION = '1.0.0';

function distIsCurrent(): boolean {
  return existsSync(FRONTMCP_BIN);
}

/**
 * Build a project whose only dependency is an ESM-only package installed the
 * way pnpm installs it: the real files under `.pnpm/<name>@<version>/`, with a
 * top-level symlink pointing at them.
 */
async function makePnpmProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fix-519-e2e-'));
  const nodeModules = path.join(dir, 'node_modules');
  const storePkgDir = path.join(
    nodeModules,
    '.pnpm',
    `${FIXTURE_NAME}@${FIXTURE_VERSION}`,
    'node_modules',
    FIXTURE_NAME,
  );

  await mkdir(storePkgDir, { recursive: true });
  await writeFile(
    path.join(storePkgDir, 'package.json'),
    JSON.stringify({ name: FIXTURE_NAME, version: FIXTURE_VERSION, type: 'module', main: 'index.js' }, null, 2),
    'utf-8',
  );
  // Untranspiled ESM — Jest's CJS runtime throws `Unexpected token 'export'`
  // on this unless the transform actually reaches it.
  await writeFile(path.join(storePkgDir, 'index.js'), `export const answer = 42;\n`, 'utf-8');

  symlinkSync(path.relative(nodeModules, storePkgDir), path.join(nodeModules, FIXTURE_NAME), 'dir');

  for (const dep of LINKED_DEPS) {
    symlinkSync(path.join(ROOT_NODE_MODULES, dep), path.join(nodeModules, dep), 'dir');
  }

  const srcDir = path.join(dir, 'src');
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(srcDir, 'fixture.spec.ts'),
    `import { answer } from '${FIXTURE_NAME}';
describe('esm-only dependency under pnpm', () => {
  it('is transpiled rather than ignored', () => {
    expect(answer).toBe(42);
  });
});
`,
    'utf-8',
  );

  // Exercises the new \`test.esmPackages\` escape hatch (issue #519).
  await writeFile(
    path.join(dir, 'frontmcp.config.ts'),
    `export default {
  name: 'fix-519-e2e',
  deployments: [{ target: 'node' }],
  test: { esmPackages: ['${FIXTURE_NAME}'] },
};
`,
    'utf-8',
  );
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fix-519-e2e', version: '0.0.0', private: true }, null, 2),
    'utf-8',
  );
  await writeFile(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'es2022',
          module: 'esnext',
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
        },
        include: ['src/**/*'],
      },
      null,
      2,
    ),
    'utf-8',
  );

  return dir;
}

function runFrontmcpTest(projectDir: string): Promise<{ output: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FRONTMCP_BIN, 'test', '--runInBand'], {
      cwd: projectDir,
      env: { ...process.env, NODE_ENV: 'test', CI: '1' },
      // `runTest` spawns jest with `stdio: 'inherit'`, so jest's output flows
      // through the CLI process (our child) and into these buffers.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (d: Buffer) => (output += d.toString('utf-8')));
    child.stderr?.on('data', (d: Buffer) => (output += d.toString('utf-8')));
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out; partial output:\n${output}`));
    }, TEST_TIMEOUT - 5_000);
    child.once('error', (err) => {
      clearTimeout(killer);
      reject(err);
    });
    child.once('close', (exitCode) => {
      clearTimeout(killer);
      resolve({ output, exitCode });
    });
  });
}

const describeOrSkip = distIsCurrent() ? describe : describe.skip;

describeOrSkip(
  `frontmcp test — ESM deps under pnpm (issue #519)${distIsCurrent() ? '' : ' — SKIPPED: run `nx build cli` first'}`,
  () => {
    it(
      'transpiles an ESM-only package installed in pnpm’s .pnpm store',
      async () => {
        const projectDir = await makePnpmProject();
        const { output, exitCode } = await runFrontmcpTest(projectDir);

        // Strip ANSI escapes before matching — jest wraps its summary in them.
        // eslint-disable-next-line no-control-regex
        const merged = output.replace(/\x1b\[[0-9;]*m/g, '');

        // The regression signature: jest ignored the package, so its raw ESM
        // reached the CJS runtime untransformed.
        expect(merged).not.toMatch(/Unexpected token 'export'/);
        expect(merged).toMatch(/fixture\.spec\.ts/);
        expect(merged).toMatch(/Tests:\s+1 passed,\s+1 total/);
        expect(exitCode).toBe(0);
      },
      TEST_TIMEOUT,
    );
  },
);
