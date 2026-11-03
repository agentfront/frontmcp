/**
 * E2E: the generated CLI keeps its tasks in the Redis a `redis: { url }` names, with the password and database of the
 * URL, as the server does (#1035); it kept them in memory, or in the Redis of `REDIS_URL`. An unusable `redis.url`
 * stops it at startup with the server's message, where it ran with its tasks in memory.
 *
 * The Redis test needs Docker for the testcontainers Redis, and is skipped with SKIP_REDIS_TESTS=1.
 */
import * as path from 'path';

import Redis from 'ioredis';

import { ensureDir, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import {
  shouldSkipDistributedTests,
  startRedisContainer,
  type RedisContainerInfo,
} from '../../../../libs/testing/src/containers/redis-container';
import { runCliBundle, runFrontmcpCli } from './helpers/exec-cli';

// The scratch project lives inside this app so `node_modules` resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');
const APP_NAME = 'tasks-redis-demo';
const BUILD_TIMEOUT_MS = 150_000;
const PASSWORD = 'tasks-redis-e2e';
const DATABASE = '5';
const SKIP_REDIS = shouldSkipDistributedTests();

interface MonitoredCommand {
  command: string;
  database: string;
}

async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('the generated CLI keeps its tasks in the Redis of redis.url', () => {
  let projectDir: string;
  let cliBundle: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-tasks-redis-'));
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import { App, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({ name: 'greet', description: 'Greet someone', inputSchema: { name: z.string() } })
class GreetTool extends ToolContext {
  async execute(input: { name: string }) {
    return \`Hello, \${input.name}\`;
  }
}

@App({ name: 'tasks-redis', tools: [GreetTool] })
class TasksRedisApp {}

export default {
  info: { name: 'Tasks Redis Demo', version: '1.0.0' },
  apps: [TasksRedisApp],
  auth: { mode: 'public' as const },
  logging: { level: LogLevel.Warn, enableConsole: false },
  redis: { url: process.env['TASKS_REDIS_URL'] },
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

  const greet = (redisUrl: string) =>
    runCliBundle(cliBundle, ['greet', '--name', 'Ada'], { TASKS_REDIS_URL: redisUrl, REDIS_URL: '', REDIS_HOST: '' });

  it('fails at startup on an unusable redis.url, with the message of the server', () => {
    const { exitCode, stderr } = greet('http://127.0.0.1:6379');

    expect(exitCode).toBe(1);
    expect(stderr).toContain('redis.url must use the redis:// or rediss:// scheme');
  });

  describe('with a Redis', () => {
    let container: RedisContainerInfo | undefined;
    let monitor: Redis | undefined;
    const commands: MonitoredCommand[] = [];

    beforeAll(async () => {
      if (SKIP_REDIS) return;
      container = await startRedisContainer();
      const admin = new Redis(container.url);
      await admin.config('SET', 'requirepass', PASSWORD);
      admin.disconnect();
      monitor = await new Redis({ host: container.host, port: container.port, password: PASSWORD }).monitor();
      monitor.on('monitor', (_time: string, args: string[], _source: string, database: string) => {
        commands.push({ command: String(args[0]).toLowerCase(), database });
      });
    }, 120_000);

    afterAll(async () => {
      monitor?.disconnect();
      await container?.stop();
    });

    (SKIP_REDIS ? it.skip : it)(
      'opens the task store on the host, port, password and database of the URL',
      async () => {
        const { host, port } = container as RedisContainerInfo;
        const opened: MonitoredCommand = { command: 'ping', database: DATABASE };

        expect(greet(`redis://:${PASSWORD}@${host}:${port}/${DATABASE}`)).toEqual(
          expect.objectContaining({ exitCode: 0, stdout: expect.stringContaining('Hello, Ada') }),
        );

        await waitUntil(() => commands.some((seen) => seen.command === opened.command && seen.database === DATABASE));
        expect(commands).toContainEqual(opened);
      },
    );
  });
});
