/**
 * Unit tests for `frontmcp plugin install` runner internals (issue #411).
 *
 * Covers:
 *   - `--scope` validation: only 'project' | 'user' | undefined are accepted;
 *     anything else fails fast instead of silently writing files to the wrong
 *     root.
 *   - Best-effort skill/prompt collection: a missing/broken project entry
 *     surfaces a stderr warning and yields an empty array fallback so the
 *     install never crashes the user's session.
 *   - `--command` with arguments, and the Codex `[mcp_servers.<name>]` table.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parse as parseToml } from 'smol-toml';

import { runInstallCurrentProject } from '../install-claude-plugin';

describe('runInstallCurrentProject — option normalization (issue #411)', () => {
  let exitSpy: jest.SpyInstance<never, [code?: number | undefined]>;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    // process.exit is invoked when no provider is selected; stub so the test
    // can assert without bringing the runner down. Throw a sentinel so the
    // runner stops at the first exit() like the real flow.
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__exit__');
    }) as never);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('rejects a bogus --scope value before any side-effects run', async () => {
    // Assert both the error class AND the message — message-only checks pass
    // even when the runner rejects with a plain string or a non-Error object,
    // which loses stack traces in production logs.
    await expect(runInstallCurrentProject({ scope: 'usr', claudePlugin: true })).rejects.toBeInstanceOf(Error);
    await expect(runInstallCurrentProject({ scope: 'usr', claudePlugin: true })).rejects.toThrow(
      /Invalid --scope value: usr\. Expected "project" or "user"\./,
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('accepts --scope user without complaint', async () => {
    // No provider selected → runner exits 1; that means scope validation
    // already passed.
    await expect(runInstallCurrentProject({ scope: 'user' })).rejects.toThrow(/__exit__/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts --scope project without complaint', async () => {
    await expect(runInstallCurrentProject({ scope: 'project' })).rejects.toThrow(/__exit__/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts an absent --scope (default project)', async () => {
    await expect(runInstallCurrentProject({})).rejects.toThrow(/__exit__/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('frontmcp plugin install', () => {
  let projectDir: string;
  let stdout: string;
  const originalCwd = process.cwd();
  const originalHome = process.env['HOME'];

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-plugin-install-'));
    fs.writeFileSync(
      path.join(projectDir, 'frontmcp.config.json'),
      JSON.stringify({ name: 'help-desk', version: '2.0.0', deployments: [{ target: 'node' }] }),
    );
    process.chdir(projectDir);
    process.env['HOME'] = projectDir;
    stdout = '';
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.chdir(originalCwd);
    process.env['HOME'] = originalHome;
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('writes a --command with arguments as program plus args', async () => {
    await runInstallCurrentProject({
      claudePlugin: true,
      onlyMcp: true,
      dir: projectDir,
      command: 'node "./dist/help desk.js" --stdio',
    });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectDir, 'help-desk', '.claude-plugin', 'plugin.json'), 'utf8'),
    ) as { mcpServers: Record<string, { command: string; args: string[] }> };
    expect(manifest.mcpServers['help-desk']).toMatchObject({
      command: 'node',
      args: ['./dist/help desk.js', '--stdio'],
    });
  });

  it('keeps "serve --stdio" when --command names only a program', async () => {
    await runInstallCurrentProject({ claudePlugin: true, onlyMcp: true, dir: projectDir, command: 'hd' });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectDir, 'help-desk', '.claude-plugin', 'plugin.json'), 'utf8'),
    ) as { mcpServers: Record<string, { command: string; args: string[] }> };
    expect(manifest.mcpServers['help-desk']).toMatchObject({ command: 'hd', args: ['serve', '--stdio'] });
  });

  it('plans a Codex [mcp_servers.<name>] table that forwards --env names through env_vars', async () => {
    await runInstallCurrentProject({
      codex: true,
      dryRun: true,
      command: 'node ./dist/main.js --stdio',
      env: ['DESK_TOKEN'],
    });
    const plannedToml = stdout
      .slice(stdout.indexOf('configContent:\n') + 'configContent:\n'.length)
      .split('\n')
      .map((line) => line.replace(/^ {4}/, ''))
      .join('\n');
    const servers = parseToml(plannedToml)['mcp_servers'] as Record<string, unknown>;
    expect(fs.existsSync(path.join(projectDir, '.codex', 'config.toml'))).toBe(false);
    expect(servers['help-desk']).toEqual({
      command: 'node',
      args: ['./dist/main.js', '--stdio'],
      env_vars: ['DESK_TOKEN'],
    });
  });
});
