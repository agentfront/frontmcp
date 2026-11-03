/**
 * E2E: `frontmcp build --target mcpb` reads a `@FrontMcp` class whose plugins keep their stores on the top-level
 * `redis` and on SQLite, and builds neither store (#1041). The build leaves `redis` out, so a CachePlugin on
 * `global-store` failed it with `requires global "redis" configuration`, and an ApprovalPlugin on SQLite wrote its file.
 * The shipped server still checks the `redis` when it starts.
 */
import { spawnSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

import { ensureDir, fileExists, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { extractArchive, readArchive } from './helpers/archive';
import { runFrontmcp, type CliResult } from './helpers/mcpb-build';

// The scratch project lives inside this app so `node_modules` resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');
const APP = 'plugin-stores-demo';

describe('frontmcp build --target mcpb of a @FrontMcp class whose plugins keep their stores on Redis and SQLite', () => {
  let projectDir: string;
  let approvalsPath: string;
  let archive: string;
  let build: CliResult;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-mcpb-plugin-stores-'));
    approvalsPath = path.join(projectDir, 'approvals.sqlite');
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';
import { ApprovalPlugin } from '@frontmcp/plugin-approval';
import CachePlugin from '@frontmcp/plugin-cache';

@Tool({ name: 'ping', description: 'Answer pong', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ name: 'plugin-stores', tools: [PingTool] })
class PluginStoresApp {}

@FrontMcp({
  info: { name: 'Plugin Stores', version: '1.0.0' },
  apps: [PluginStoresApp],
  auth: { mode: 'public' },
  logging: { level: LogLevel.Warn, enableConsole: false },
  redis: { url: process.env['PLUGIN_STORES_REDIS_URL'] as string },
  plugins: [
    CachePlugin.init({ type: 'global-store' }),
    ApprovalPlugin.init({ storage: { type: 'sqlite', sqlite: { path: ${JSON.stringify(approvalsPath)} } } }),
  ],
})
export default class Server {}
`,
    );
    await writeFile(
      path.join(projectDir, 'frontmcp.config.js'),
      `module.exports = {
  name: '${APP}',
  version: '1.0.0',
  entry: './src/main.ts',
  deployments: [{ target: 'mcpb' }],
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
    build = runFrontmcp(['build', '--target', 'mcpb'], projectDir);
    archive = path.join(projectDir, 'dist', 'mcpb', `${APP}-1.0.0.mcpb`);
  }, 240_000);

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('builds the archive without the redis, and opens no plugin store', async () => {
    const stdoutOfFailure = build.exitCode === 0 ? '' : build.stdout;
    expect({ exitCode: build.exitCode, stderr: build.stderr, stdoutOfFailure }).toEqual({
      exitCode: 0,
      stderr: '',
      stdoutOfFailure: '',
    });
    expect(build.stdout).not.toContain('not written');
    expect((await readArchive(archive)).entries).toContain('server/frontmcp.manifest.json');
    expect(await fileExists(approvalsPath)).toBe(false);
  });

  it('ships a server that fails at startup without the redis, with the message of the server', async () => {
    const extractDir = await mkdtemp(path.join(os.tmpdir(), 'mcpb-plugin-stores-'));
    try {
      await extractArchive(archive, extractDir);
      const started = spawnSync(process.execPath, [path.join(extractDir, 'server', 'index.js')], {
        env: { ...process.env, FRONTMCP_STDIO: '1', HOME: extractDir, NODE_PATH: '' },
        input: '',
        encoding: 'utf-8',
        timeout: 30_000,
      });

      expect(started.status).toBe(1);
      expect(started.stderr.replace(/\s/g, '')).toContain('"path":["redis"]');
      expect(await fileExists(approvalsPath)).toBe(false);
    } finally {
      await rm(extractDir, { recursive: true, force: true });
    }
  }, 60_000);
});
