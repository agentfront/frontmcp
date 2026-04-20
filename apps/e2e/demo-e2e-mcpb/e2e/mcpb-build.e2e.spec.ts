import { fileExists, stat } from '@frontmcp/utils';

import { readArchive, sha256File } from './helpers/archive';
import {
  ensureBuild,
  getAppName,
  getAppVersion,
  getArchivePath,
  getMcpbDir,
  resetBuildCache,
} from './helpers/mcpb-build';

describe('frontmcp build --target mcpb', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('produces the .mcpb archive at the expected path', async () => {
    expect(await fileExists(getArchivePath())).toBe(true);
    const { size } = await stat(getArchivePath());
    expect(size).toBeGreaterThan(0);
  });

  it('removes the __stage intermediate directory after zipping', async () => {
    const stageDir = `${getMcpbDir()}/__stage`;
    expect(await fileExists(stageDir)).toBe(false);
  });

  it('produces a v0.3 manifest with the expected metadata', async () => {
    const { manifest } = await readArchive(getArchivePath());
    expect(manifest['manifest_version']).toBe('0.3');
    expect(manifest['name']).toBe(getAppName());
    expect(manifest['version']).toBe(getAppVersion());
    expect(manifest['display_name']).toBe('MCPB Demo');
    expect(manifest['license']).toBe('Apache-2.0');
    expect(manifest['author']).toEqual({
      name: 'FrontMCP E2E',
      email: 'e2e@agentfront.dev',
    });
  });

  it('enumerates user tools and marks prompts as generated', async () => {
    const { manifest } = await readArchive(getArchivePath());
    const tools = manifest['tools'] as Array<{ name: string; description: string }>;
    expect(tools).toBeDefined();
    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(['echo', 'greet']);
    expect(manifest['tools_generated']).toBe(false);
    expect(manifest['prompts_generated']).toBe(true);
  });

  it('wires the stdio server entry under ${__dirname}/server/index.js', async () => {
    const { manifest, entries } = await readArchive(getArchivePath());
    const server = manifest['server'] as {
      type: string;
      entry_point: string;
      mcp_config: { command: string; args: string[] };
    };
    expect(server.type).toBe('node');
    expect(server.entry_point).toBe('server/index.js');
    expect(server.mcp_config.command).toBe('node');
    expect(server.mcp_config.args).toEqual(['${__dirname}/server/index.js']);
    expect(entries).toContain('server/index.js');
    expect(entries).toContain('server/package.json');
    expect(entries).toContain('manifest.json');
  });

  it('reports compatibility defaults (platforms + node runtime)', async () => {
    const { manifest } = await readArchive(getArchivePath());
    const compat = manifest['compatibility'] as {
      platforms?: string[];
      runtimes?: { node?: string };
    };
    expect(compat.platforms?.sort()).toEqual(['darwin', 'linux', 'win32']);
    expect(compat.runtimes?.node).toBeDefined();
  });

  it('emits a deterministic archive (byte-identical across back-to-back builds)', async () => {
    const first = await sha256File(getArchivePath());
    // Force a completely fresh rebuild from clean state
    resetBuildCache();
    await ensureBuild();
    const second = await sha256File(getArchivePath());
    expect(second).toBe(first);
  });
});
