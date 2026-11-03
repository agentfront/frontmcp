/**
 * E2E: `frontmcp build --target cli` reads a `@FrontMcp` class whose `redis.url` and `sqlite.encryption.secret` come
 * from variables the build machine has not set, and opens neither store (#1041); the decorator stopped the build. The
 * generated CLI still validates them when it starts: unset, it fails with the server's message; set, it runs.
 *
 * The run with the variables set needs Docker for the testcontainers Redis, and is skipped with SKIP_REDIS_TESTS=1.
 */
import * as path from 'path';

import { ensureDir, fileExists, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import {
  shouldSkipDistributedTests,
  startRedisContainer,
  type RedisContainerInfo,
} from '../../../../libs/testing/src/containers/redis-container';
import { runCliBundle, runFrontmcpCli, type CliResult } from './helpers/exec-cli';

// The scratch project lives inside this app so `node_modules` resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');
const APP_NAME = 'decorated-stores-demo';
const BUILD_TIMEOUT_MS = 150_000;
const SKIP_REDIS = shouldSkipDistributedTests();

describe('frontmcp build --target cli of a @FrontMcp class whose stores take runtime-only variables', () => {
  let projectDir: string;
  let sqlitePath: string;
  let cliBundle: string;
  let build: CliResult;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-decorated-stores-'));
    sqlitePath = path.join(projectDir, 'stores.sqlite');
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({ name: 'greet', description: 'Greet someone', inputSchema: { name: z.string() } })
class GreetTool extends ToolContext {
  async execute(input: { name: string }) {
    return \`Hello, \${input.name}\`;
  }
}

@App({ name: 'decorated-stores', tools: [GreetTool] })
class DecoratedStoresApp {}

@FrontMcp({
  info: { name: 'Decorated Stores Demo', version: '1.0.0' },
  apps: [DecoratedStoresApp],
  auth: { mode: 'public' },
  logging: { level: LogLevel.Warn, enableConsole: false },
  redis: { url: process.env['DECORATED_REDIS_URL'] as string },
  sqlite: { path: ${JSON.stringify(sqlitePath)}, encryption: { secret: process.env['DECORATED_SQLITE_SECRET'] as string } },
})
export default class Server {}
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
    build = runFrontmcpCli(['build', '--target', 'cli', '--js'], undefined, projectDir, BUILD_TIMEOUT_MS);
    cliBundle = path.join(projectDir, 'dist', 'cli', `${APP_NAME}-cli.bundle.js`);
  }, BUILD_TIMEOUT_MS + 30_000);

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  const greet = (env: Record<string, string>) =>
    runCliBundle(cliBundle, ['greet', '--name', 'Ada'], { REDIS_URL: '', REDIS_HOST: '', ...env });

  it('builds the CLI and its manifest without the variables, and opens no store', async () => {
    expect({ exitCode: build.exitCode, stderr: build.stderr }).toEqual({ exitCode: 0, stderr: '' });
    expect(build.stdout).not.toContain('not written');
    expect(await fileExists(path.join(projectDir, 'dist', 'cli', 'frontmcp.manifest.json'))).toBe(true);
    expect(await fileExists(sqlitePath)).toBe(false);
  });

  it('fails at startup without the variables, with the message of the server', async () => {
    const { exitCode, stderr } = greet({});

    expect(exitCode).toBe(1);
    expect(stderr.replace(/\s/g, '')).toContain('"path":["redis"]');
    expect(stderr.replace(/\s/g, '')).toContain('"path":["sqlite","encryption","secret"]');
    expect(await fileExists(sqlitePath)).toBe(false);
  });

  describe('with the variables set', () => {
    let container: RedisContainerInfo | undefined;

    beforeAll(async () => {
      if (!SKIP_REDIS) container = await startRedisContainer();
    }, 120_000);

    afterAll(async () => {
      await container?.stop();
    });

    (SKIP_REDIS ? it.skip : it)('runs', () => {
      const env = {
        DECORATED_REDIS_URL: (container as RedisContainerInfo).url,
        DECORATED_SQLITE_SECRET: 'decorated-stores-e2e-secret',
      };

      expect(greet(env)).toEqual(
        expect.objectContaining({ exitCode: 0, stdout: expect.stringContaining('Hello, Ada') }),
      );
    });
  });
});
