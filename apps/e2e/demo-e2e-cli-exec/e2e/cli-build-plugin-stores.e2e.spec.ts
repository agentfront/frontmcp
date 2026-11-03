/**
 * E2E: a build boots the server only to read it, and opens none of its stores (#1041), its plugins' included. The build
 * leaves the top-level `redis` out of that boot, so a CachePlugin on `global-store` failed it with `requires global
 * "redis" configuration`, and a RememberPlugin on `type: 'redis'` connected to its Redis. Now the build reads the
 * server without building either store, and the CLI it builds still checks the `redis` when it starts.
 */
import { createServer, type Server } from 'node:net';
import * as path from 'path';

import { ensureDir, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { runCliBundle, runFrontmcpCliAsync } from './helpers/exec-cli';

// The scratch project lives inside this app so `node_modules` resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');
const APP_NAME = 'plugin-stores-demo';
const BUILD_TIMEOUT_MS = 150_000;

describe('a build of a server whose plugins keep their stores on Redis', () => {
  let projectDir: string;
  let redisServer: Server;
  let redisConnections = 0;
  let redisPort: number;

  beforeAll(async () => {
    redisServer = createServer((socket) => {
      redisConnections++;
      socket.destroy();
    });
    await new Promise<void>((listening) => redisServer.listen(0, '127.0.0.1', listening));
    redisPort = (redisServer.address() as { port: number }).port;

    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-plugin-stores-'));
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import { App, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';
import CachePlugin from '@frontmcp/plugin-cache';
import RememberPlugin from '@frontmcp/plugin-remember';
import { z } from 'zod';

@Tool({ name: 'greet', description: 'Greet someone', inputSchema: { name: z.string() } })
class GreetTool extends ToolContext {
  async execute(input: { name: string }) {
    return \`Hello, \${input.name}\`;
  }
}

@App({ name: 'plugin-stores', tools: [GreetTool] })
class PluginStoresApp {}

export default {
  info: { name: 'Plugin Stores Demo', version: '1.0.0' },
  apps: [PluginStoresApp],
  auth: { mode: 'public' as const },
  logging: { level: LogLevel.Warn, enableConsole: false },
  redis: { url: process.env['CACHE_REDIS_URL'] },
  plugins: [
    CachePlugin.init({ type: 'global-store' }),
    RememberPlugin.init({
      type: 'redis',
      config: { host: '127.0.0.1', port: Number(process.env['REMEMBER_REDIS_PORT']) },
      skipLegacyPurge: true,
    }),
  ],
};
`,
    );
    await writeFile(
      path.join(projectDir, 'frontmcp.config.js'),
      `module.exports = {
  name: '${APP_NAME}',
  version: '1.0.0',
  entry: './src/main.ts',
  build: { esbuild: { external: ['zod', 'ioredis'] } },
  deployments: [{ target: 'cli' }],
};\n`,
    );
    // A project's own tsconfig, as a user's: the monorepo's paths would inline a second copy of the SDK
    await writeFile(
      path.join(projectDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'es2022',
          module: 'commonjs',
          moduleResolution: 'node',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['src'],
      }),
    );
  });

  afterAll(async () => {
    await new Promise((closed) => redisServer.close(closed));
    await rm(projectDir, { recursive: true, force: true });
  });

  it(
    'builds, without the redis the build leaves out and without connecting to a plugin store',
    async () => {
      const build = await runFrontmcpCliAsync(['build', '--target', 'cli', '--js'], projectDir, BUILD_TIMEOUT_MS, {
        REMEMBER_REDIS_PORT: String(redisPort),
      });

      expect({ exitCode: build.exitCode, output: build.exitCode === 0 ? '' : build.stdout + build.stderr }).toEqual({
        exitCode: 0,
        output: '',
      });
      expect(build.stdout).not.toContain('not written');
      expect(redisConnections).toBe(0);
    },
    BUILD_TIMEOUT_MS + 30_000,
  );

  it('builds a CLI that checks the redis when it starts', () => {
    const cliBundle = path.join(projectDir, 'dist', 'cli', `${APP_NAME}-cli.bundle.js`);

    const { exitCode, stderr } = runCliBundle(cliBundle, ['greet', '--name', 'Ada'], {
      REMEMBER_REDIS_PORT: String(redisPort),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('redis needs host or url');
  });
});
