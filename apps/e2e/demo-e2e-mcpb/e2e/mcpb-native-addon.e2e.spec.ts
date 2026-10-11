/**
 * An mcpb archive ships the native addons listed in `build.dependencies.nativeAddons`,
 * with their `.node` binaries and dependencies, in `server/node_modules/`: the server
 * loads better-sqlite3 from the extracted archive, outside the repository.
 */
import * as os from 'os';
import * as path from 'path';

import { McpClient, McpStdioClientTransport } from '@frontmcp/testing';
import { ensureDir, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { extractArchive, readArchive } from './helpers/archive';
import { runFrontmcp } from './helpers/mcpb-build';

// The scratch project lives inside this app so `node_modules` (with better-sqlite3) resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');
const APP = 'native-addon-demo';
const MCPB_OS = ['darwin', 'linux', 'win32'];

describe('frontmcp build --target mcpb with native addons', () => {
  let projectDir: string;
  let archive: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-mcpb-native-addon-'));
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import Database = require('better-sqlite3');
import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'sqlite-version', description: 'SQLite version from better-sqlite3', inputSchema: {} })
class SqliteVersionTool extends ToolContext {
  async execute() {
    const row = new Database(':memory:').prepare('select sqlite_version() as version').get() as { version: string };
    return \`sqlite \${row.version}\`;
  }
}

@App({ name: 'sqlite', tools: [SqliteVersionTool] })
class SqliteApp {}

@FrontMcp({
  info: { name: 'Native Addon', version: '1.0.0' },
  apps: [SqliteApp],
  auth: { mode: 'public' },
  logging: { level: LogLevel.Warn, enableConsole: false },
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
  build: { dependencies: { nativeAddons: ['better-sqlite3'] } },
  deployments: [{ target: 'mcpb' }],
};\n`,
    );
    const build = runFrontmcp(['build', '--target', 'mcpb'], projectDir);
    expect({ exitCode: build.exitCode, stderr: build.stderr }).toEqual({ exitCode: 0, stderr: '' });
    archive = path.join(projectDir, 'dist', 'mcpb', `${APP}-1.0.0.mcpb`);
  }, 240_000);

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('ships the addon with its .node binary and its dependencies, for this OS only', async () => {
    const { entries, manifest } = await readArchive(archive);
    expect(entries).toEqual(
      expect.arrayContaining([
        'server/node_modules/better-sqlite3/package.json',
        'server/node_modules/bindings/package.json',
      ]),
    );
    expect(entries.some((entry) => /^server\/node_modules\/better-sqlite3\/.+\.node$/.test(entry))).toBe(true);
    const compatibility = manifest['compatibility'] as { platforms?: string[] };
    if (MCPB_OS.includes(process.platform)) {
      expect(compatibility.platforms).toEqual([process.platform]);
    }
  });

  it('passes mcpb validate', () => {
    const result = runFrontmcp(['mcpb', 'validate', archive], projectDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('archive is valid');
  });

  it('runs from the extracted archive, outside the repository, and loads the addon', async () => {
    const extractDir = await mkdtemp(path.join(os.tmpdir(), 'mcpb-native-addon-'));
    const transport = new McpStdioClientTransport({
      command: process.execPath,
      args: [path.join(extractDir, 'server', 'index.js')],
      env: { ...process.env, FRONTMCP_STDIO: '1', HOME: extractDir, NODE_PATH: '' } as Record<string, string>,
    });
    const client = new McpClient({ name: 'native-addon-check', version: '1.0.0' }, { capabilities: {} });
    try {
      await extractArchive(archive, extractDir);
      await client.connect(transport);
      const result = await client.callTool({ name: 'sqlite-version', arguments: {} });
      expect(result.isError).not.toBe(true);
      const text = result.content.find((part: { type: string }) => part.type === 'text') as
        | { text: string }
        | undefined;
      expect(text?.text).toMatch(/sqlite \d+\.\d+\.\d+/);
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
      await rm(extractDir, { recursive: true, force: true });
    }
  }, 120_000);
});
