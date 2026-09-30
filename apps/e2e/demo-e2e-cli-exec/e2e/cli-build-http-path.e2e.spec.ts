import { execFileSync } from 'child_process';
import * as path from 'path';

import { cp, mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

import { getFixtureDir, runFrontmcpCli } from './helpers/exec-cli';

// The scratch project lives inside this app so `node_modules` resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');

describe('build --target node honors transport.http.path (#642)', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-http-path-'));
    await cp(path.join(getFixtureDir(), 'src'), path.join(projectDir, 'src'), { recursive: true });
    await writeFile(
      path.join(projectDir, 'frontmcp.config.js'),
      `module.exports = {
  name: 'path-demo',
  version: '1.0.0',
  entry: './src/main.ts',
  deployments: [{ target: 'node' }],
  transport: { http: { path: '/api/mcp' } },
};\n`,
    );
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('bakes the configured path into the runner script', async () => {
    const { exitCode, stderr } = runFrontmcpCli(['build', '--target', 'node'], undefined, projectDir);
    expect(stderr).not.toMatch(/Error/);
    expect(exitCode).toBe(0);

    const runner = path.join(projectDir, 'dist', 'node', 'path-demo');
    const script = await readFile(runner);
    expect(script).toContain('FRONTMCP_HTTP_ENTRY_PATH="${FRONTMCP_HTTP_ENTRY_PATH:-/api/mcp}"');
    // The exported default is only a default: --version still short-circuits before the server boots.
    expect(execFileSync(runner, ['--version']).toString()).toContain('path-demo');
  }, 120_000);
});
