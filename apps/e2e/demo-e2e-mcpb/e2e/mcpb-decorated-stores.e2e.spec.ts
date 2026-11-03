/**
 * E2E: `frontmcp build --target mcpb` reads a `@FrontMcp` class whose `redis.url` and `sqlite.encryption.secret` come
 * from variables that reach the server only when the MCPB host starts it, and opens neither store (#1041); the
 * decorator stopped the build. The shipped server still validates them when it starts.
 */
import { spawnSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

import { ensureDir, fileExists, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { extractArchive, readArchive } from './helpers/archive';
import { runFrontmcp, type CliResult } from './helpers/mcpb-build';

// The scratch project lives inside this app so `node_modules` resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');
const APP = 'decorated-stores-demo';

describe('frontmcp build --target mcpb of a @FrontMcp class whose stores take runtime-only variables', () => {
  let projectDir: string;
  let sqlitePath: string;
  let archive: string;
  let build: CliResult;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-mcpb-decorated-stores-'));
    sqlitePath = path.join(projectDir, 'stores.sqlite');
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'ping', description: 'Answer pong', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ name: 'decorated-stores', tools: [PingTool] })
class DecoratedStoresApp {}

@FrontMcp({
  info: { name: 'Decorated Stores', version: '1.0.0' },
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
  name: '${APP}',
  version: '1.0.0',
  entry: './src/main.ts',
  deployments: [{ target: 'mcpb' }],
};\n`,
    );
    build = runFrontmcp(['build', '--target', 'mcpb'], projectDir);
    archive = path.join(projectDir, 'dist', 'mcpb', `${APP}-1.0.0.mcpb`);
  }, 240_000);

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('builds the archive and its manifest without the variables, and opens no store', async () => {
    expect({ exitCode: build.exitCode, stderr: build.stderr }).toEqual({ exitCode: 0, stderr: '' });
    expect(build.stdout).not.toContain('not written');
    expect((await readArchive(archive)).entries).toContain('server/frontmcp.manifest.json');
    expect(await fileExists(sqlitePath)).toBe(false);
  });

  it('ships a server that fails at startup without the variables, with the message of the server', async () => {
    const extractDir = await mkdtemp(path.join(os.tmpdir(), 'mcpb-decorated-stores-'));
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
      expect(started.stderr.replace(/\s/g, '')).toContain('"path":["sqlite","encryption","secret"]');
      expect(await fileExists(sqlitePath)).toBe(false);
    } finally {
      await rm(extractDir, { recursive: true, force: true });
    }
  }, 60_000);
});
