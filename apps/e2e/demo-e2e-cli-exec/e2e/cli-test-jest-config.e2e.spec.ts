// apps/e2e/demo-e2e-cli-exec/e2e/cli-test-jest-config.e2e.spec.ts
//
// End-to-end tests for `frontmcp test`'s injected Jest configuration
// (issue #402).
//
// Verifies the full path: user runs `frontmcp test` in a project that has
// (a) a `.tsx` component file with JSX syntax, and (b) a colocated
// `*.spec.tsx` unit test importing it. Before the fix the user saw either:
//   • `jest --no test found` (testMatch missed `.spec.ts(x)`), or
//   • SWC parse error on the JSX (transform regex skipped .tsx; even when
//     matched, SWC parser had no `tsx: true`).
//
// We spawn the COMPILED `frontmcp` CLI bin in a temp project with the
// `--testPathIgnorePatterns` defaults so node_modules isn't scanned, and
// assert the test run exits 0 with the expected jest summary.

import { spawn } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const FRONTMCP_BIN = path.join(ROOT_DIR, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');
const ROOT_NODE_MODULES = path.join(ROOT_DIR, 'node_modules');
const TEST_TIMEOUT = 120_000;

function distIsCurrent(): boolean {
  return existsSync(FRONTMCP_BIN);
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fix-402-e2e-'));
  // A minimal `src/tools/` layout that mirrors the CLAUDE.md convention.
  const srcDir = path.join(dir, 'src');
  const toolDir = path.join(srcDir, 'tools');
  await import('node:fs/promises').then((fs) => fs.mkdir(toolDir, { recursive: true }));

  // A trivial pure-TS unit under test.
  await writeFile(
    path.join(toolDir, 'greet.ts'),
    `export function greet(name: string): string { return 'Hello, ' + name + '!'; }\n`,
    'utf-8',
  );

  // The colocated `*.spec.ts` — must be discovered by the new testMatch.
  await writeFile(
    path.join(toolDir, 'greet.spec.ts'),
    `import { greet } from './greet';
describe('greet', () => {
  it('returns a greeting', () => {
    expect(greet('Ada')).toBe('Hello, Ada!');
  });
});
`,
    'utf-8',
  );

  // A `.tsx` component using JSX — exercises the new `tsx: true` parser.
  await writeFile(
    path.join(toolDir, 'badge.tsx'),
    `import { type ReactNode } from 'react';
export function Badge({ children }: { children: ReactNode }) {
  return <span data-testid="badge">{children}</span>;
}
`,
    'utf-8',
  );

  // The colocated `*.spec.tsx` — exercises both .tsx discovery AND .tsx
  // transformation (just parsing; we don't actually render here to avoid
  // pulling in a DOM environment).
  await writeFile(
    path.join(toolDir, 'badge.spec.tsx'),
    `import { Badge } from './badge';
describe('Badge', () => {
  it('is a function component (JSX parses cleanly)', () => {
    expect(typeof Badge).toBe('function');
    expect(Badge.length).toBeGreaterThanOrEqual(0);
  });
});
`,
    'utf-8',
  );

  // Provide a barebones package.json + tsconfig so jest/swc don't choke on
  // missing project files when resolving.
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fix-402-e2e', version: '0.0.0', private: true }, null, 2),
    'utf-8',
  );
  await writeFile(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'es2022',
          module: 'esnext',
          jsx: 'react-jsx',
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
        include: ['src/**/*'],
      },
      null,
      2,
    ),
    'utf-8',
  );

  // Symlink the monorepo's node_modules so jest can resolve @swc/jest /
  // @frontmcp/testing / react — installing them per-test would be slow and
  // pull in network. The CLI's injected config references these by bare
  // specifier, so the user's project (here, the temp dir) must be able to
  // resolve them from its own cwd.
  symlinkSync(ROOT_NODE_MODULES, path.join(dir, 'node_modules'), 'dir');

  return dir;
}

const describeOrSkip = distIsCurrent() ? describe : describe.skip;

describeOrSkip(
  `frontmcp test — Jest config end-to-end (issue #402)${distIsCurrent() ? '' : ' — SKIPPED: run `nx build cli` first'}`,
  () => {
    it(
      'discovers colocated *.spec.ts AND *.spec.tsx and runs them all green',
      async () => {
        const projectDir = await makeProject();
        const result = await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>(
          (resolve, reject) => {
            const child = spawn(process.execPath, [FRONTMCP_BIN, 'test', '--runInBand'], {
              cwd: projectDir,
              env: { ...process.env, NODE_ENV: 'test', CI: '1' },
              // Pipe stdio explicitly. The CLI's `runTest` spawns jest with
              // `stdio: 'inherit'`, which inherits the file descriptors of the
              // CLI process. That CLI process is OUR child here, so when we
              // pipe its stdio, jest's output flows through us and into the
              // captured buffers.
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf-8')));
            child.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf-8')));
            const killer = setTimeout(() => {
              child.kill('SIGKILL');
              reject(new Error(`timed out; partial:\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`));
            }, TEST_TIMEOUT - 5_000);
            child.once('error', (err) => {
              clearTimeout(killer);
              reject(err);
            });
            child.once('close', (exitCode) => {
              clearTimeout(killer);
              resolve({ stdout, stderr, exitCode });
            });
          },
        );

        // Strip ANSI escape sequences before matching — chalk/jest inject
        // them around `2 passed` etc., which breaks naive substring regexes.
        // eslint-disable-next-line no-control-regex
        const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
        const merged = stripAnsi(`${result.stdout}\n${result.stderr}`);
        // Both specs MUST be discovered.
        expect(merged).toMatch(/greet\.spec\.ts/);
        expect(merged).toMatch(/badge\.spec\.tsx/);
        // Both must pass.
        expect(merged).toMatch(/Tests:\s+2 passed,\s+2 total/);
        // And the exit code must be 0.
        expect(result.exitCode).toBe(0);
      },
      TEST_TIMEOUT,
    );
  },
);
