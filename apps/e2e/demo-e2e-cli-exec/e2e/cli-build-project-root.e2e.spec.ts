/**
 * `frontmcp build` from a subfolder, and the served-path report (#679).
 *
 * - The config was found in the parent folder but `entry` resolved from the
 *   cwd: `Entry override not found: ./src/main.ts`.
 * - With `http: { entryPath }` in `@FrontMcp` and a `main.ts` that imports
 *   another `.ts` file, the build-time loader failed silently and the build
 *   reported the default path instead of the decorator's.
 */

import * as path from 'node:path';

import { fileExists, rm } from '@frontmcp/utils';

import { createScratchProject, helloServerFiles } from './helpers/dev-cli';
import { runFrontmcpCli } from './helpers/exec-cli';

const TEST_TIMEOUT = 120_000;

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('frontmcp build — project root and served path (#679)', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createScratchProject('build-root', {
      ...helloServerFiles({ http: `{ entryPath: '/decorated' }` }),
      'frontmcp.config.js': `module.exports = {
  name: 'build-root-demo',
  version: '1.0.0',
  entry: './src/main.ts',
  deployments: [{ target: 'node' }, { target: 'distributed' }],
};
`,
    });
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it(
    'builds from a subfolder into the project root',
    async () => {
      const { exitCode, stdout, stderr } = runFrontmcpCli(
        ['build', '--target', 'node'],
        { NODE_ENV: 'production' },
        path.join(projectDir, 'src'),
      );

      expect(stderr).not.toMatch(/Entry override not found/);
      expect(exitCode).toBe(0);
      expect(stripAnsi(stdout)).toContain('project root:');
      expect(await fileExists(path.join(projectDir, 'dist', 'node', 'build-root-demo.manifest.json'))).toBe(true);
      expect(await fileExists(path.join(projectDir, 'src', 'dist'))).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    'reports the entry path set in @FrontMcp when main.ts imports other .ts files',
    async () => {
      const { exitCode, stdout } = runFrontmcpCli(['build', '--target', 'distributed'], undefined, projectDir);

      expect(exitCode).toBe(0);
      const output = stripAnsi(stdout);
      expect(output).toContain('Server will serve MCP at /decorated');
      expect(output).not.toContain('could not read @FrontMcp metadata');
    },
    TEST_TIMEOUT,
  );
});
