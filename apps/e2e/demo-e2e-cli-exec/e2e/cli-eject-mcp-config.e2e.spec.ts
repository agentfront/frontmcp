import * as os from 'os';
import * as path from 'path';

import { ensureDir, mkdtemp, readFile, readJSON, rm, writeFile } from '@frontmcp/utils';

import { runFrontmcpCli } from './helpers/exec-cli';

describe('CLI eject-mcp-config -o (#642)', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-eject-e2e-'));
    await writeFile(
      path.join(projectDir, 'frontmcp.config.js'),
      `module.exports = {
  name: 'eject-demo',
  version: '1.0.0',
  deployments: [{ target: 'node' }],
  clients: { cursor: { transport: 'stdio', command: 'npx', args: ['-y', 'eject-demo'] } },
};\n`,
    );
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('creates the missing parent folder and writes the config', async () => {
    const out = path.join(projectDir, '.cursor', 'nested', 'mcp.json');
    const { exitCode, stderr } = runFrontmcpCli(['eject-mcp-config', 'cursor', '-o', out], undefined, projectDir);
    expect(stderr).not.toMatch(/ENOENT/);
    expect(exitCode).toBe(0);
    expect(await readJSON(out)).toEqual({
      mcpServers: { 'eject-demo': { command: 'npx', args: ['-y', 'eject-demo'] } },
    });
  });

  it('merges into an existing config without dropping other servers or keys', async () => {
    const out = path.join(projectDir, 'existing', 'mcp.json');
    await ensureDir(path.dirname(out));
    await writeFile(
      out,
      JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'node', args: ['other.js'] } } }),
    );
    const { exitCode } = runFrontmcpCli(['eject-mcp-config', 'cursor', '-o', out], undefined, projectDir);
    expect(exitCode).toBe(0);
    expect(await readJSON(out)).toEqual({
      theme: 'dark',
      mcpServers: {
        other: { command: 'node', args: ['other.js'] },
        'eject-demo': { command: 'npx', args: ['-y', 'eject-demo'] },
      },
    });
  });

  it('refuses to overwrite a file that is not valid JSON', async () => {
    const out = path.join(projectDir, 'broken.json');
    await writeFile(out, '{oops');
    const { exitCode, stderr } = runFrontmcpCli(['eject-mcp-config', 'cursor', '-o', out], undefined, projectDir);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/not valid JSON/);
    expect(await readFile(out)).toBe('{oops');
  });

  it('does not write anything with --dry-run', async () => {
    const out = path.join(projectDir, 'dry', 'mcp.json');
    const { exitCode, stdout } = runFrontmcpCli(
      ['eject-mcp-config', 'cursor', '-o', out, '--dry-run'],
      undefined,
      projectDir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('eject-demo');
    const { fileExists } = await import('@frontmcp/utils');
    expect(await fileExists(out)).toBe(false);
  });
});
