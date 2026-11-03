/**
 * E2E: the generated CLI validates `jobs` with the server's schema (#1032). An invalid `jobs.store` stops it at
 * startup with the server's message, where it was taken for unset and the runs went to the top-level SQLite file;
 * `jobs.store: false` keeps them out of that file.
 */
import * as path from 'path';

import { ensureDir, fileExists, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { runCliBundle, runFrontmcpCli } from './helpers/exec-cli';
import { sqliteKeys } from './helpers/sqlite-keys';

// The scratch project lives inside this app so `node_modules` resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');
const APP_NAME = 'jobs-config-demo';
const BUILD_TIMEOUT_MS = 150_000;

describe('the generated CLI validates jobs as the server does', () => {
  let projectDir: string;
  let cliBundle: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-jobs-config-'));
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import { App, Job, JobContext, LogLevel } from '@frontmcp/sdk';
import { z } from 'zod';

@Job({ name: 'echo', description: 'Echo a payload', inputSchema: { payload: z.string() }, outputSchema: { result: z.string() } })
class EchoJob extends JobContext {
  async execute(input: { payload: string }) {
    return { result: \`Echo: \${input.payload}\` };
  }
}

@App({ name: 'jobs-config', jobs: [EchoJob] })
class JobsConfigApp {}

export default {
  info: { name: 'Jobs Config Demo', version: '1.0.0' },
  apps: [JobsConfigApp],
  auth: { mode: 'public' as const },
  logging: { level: LogLevel.Warn, enableConsole: false },
  sqlite: { path: process.env['JOBS_SQLITE_PATH'] },
  jobs: JSON.parse(process.env['JOBS_CONFIG'] ?? '{"enabled":true}'),
};
`,
    );
    await writeFile(
      path.join(projectDir, 'frontmcp.config.js'),
      `module.exports = {
  name: '${APP_NAME}',
  version: '1.0.0',
  entry: './src/main.ts',
  build: { esbuild: { external: ['zod'] } },
  deployments: [{ target: 'cli' }],
};\n`,
    );
    const build = runFrontmcpCli(['build', '--target', 'cli', '--js'], undefined, projectDir, BUILD_TIMEOUT_MS);
    expect({ exitCode: build.exitCode, stderr: build.exitCode === 0 ? '' : build.stderr }).toEqual({
      exitCode: 0,
      stderr: '',
    });
    cliBundle = path.join(projectDir, 'dist', 'cli', `${APP_NAME}-cli.bundle.js`);
  }, BUILD_TIMEOUT_MS + 30_000);

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  const runEcho = (jobs: Record<string, unknown>, sqlitePath: string) =>
    runCliBundle(cliBundle, ['job', 'run', 'echo', '--payload', 'hi'], {
      JOBS_CONFIG: JSON.stringify(jobs),
      JOBS_SQLITE_PATH: sqlitePath,
    });

  it('fails at startup on an invalid jobs.store, with the message of the server, before opening the sqlite', async () => {
    const sqlitePath = path.join(projectDir, 'invalid.sqlite');

    const { exitCode, stderr } = runEcho({ enabled: true, store: 'memory' }, sqlitePath);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('jobs.store must be false (runs kept in memory) or an object with redis or sqlite');
    expect(await fileExists(sqlitePath)).toBe(false);
  });

  it('keeps the runs in memory with jobs.store: false, where they go to the top-level sqlite otherwise', async () => {
    const inFile = path.join(projectDir, 'in-file.sqlite');
    const inMemory = path.join(projectDir, 'in-memory.sqlite');
    const succeeded = expect.objectContaining({ exitCode: 0, stdout: expect.stringContaining('Echo: hi') });

    expect(runEcho({ enabled: true }, inFile)).toEqual(succeeded);
    expect(runEcho({ enabled: true, store: false }, inMemory)).toEqual(succeeded);

    expect((await sqliteKeys(inFile)).some((key) => key.startsWith('mcp:jobs:'))).toBe(true);
    expect((await sqliteKeys(inMemory)).filter((key) => key.startsWith('mcp:jobs:'))).toEqual([]);
  });
});
