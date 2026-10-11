/**
 * E2E coverage for issue #411 follow-up — `<bin> install -p claude`.
 *
 * Builds the cli-exec-demo fixture (which registers two `@Skill` entries:
 * `greeting-helper` and `math-helper`) and exercises the install/uninstall/
 * status flow through the BUILT bin (not through the dev-tool `frontmcp`
 * CLI). This is the surface the issue explicitly calls out: a FrontMCP
 * server's own bin must inherit the install command and read its skills
 * from its sibling `bin-meta.json` + `_skills/` tree.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parse as parseToml } from 'smol-toml';

import { McpClient, McpStdioClientTransport } from '@frontmcp/testing';

import { ensureBuild, getCliBundlePath, getDistDir, runCli } from './helpers/exec-cli';

interface InstalledPluginManifest {
  name: string;
  mcpServers: Record<string, { command: string; args: string[] }>;
  skills: string[];
  _meta: { frontmcp: { installedBy: string; binVersion: string; managedFiles: string[] } };
}

const FRONTMCP_CLI_VERSION = (
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../libs/cli/package.json'), 'utf8')) as {
    version: string;
  }
).version;

function readPluginManifest(destRoot: string, appName: string): InstalledPluginManifest {
  return JSON.parse(
    fs.readFileSync(path.join(destRoot, appName, '.claude-plugin', 'plugin.json'), 'utf8'),
  ) as InstalledPluginManifest;
}

describe('cli-exec-demo install -p claude / -p codex (issue #411 follow-up)', () => {
  let claudeScope: string;
  let codexHome: string;
  const appName = 'cli-exec-demo';

  beforeAll(async () => {
    await ensureBuild();
    claudeScope = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-411-claude-'));
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-411-codex-'));
  });

  afterAll(() => {
    try {
      fs.rmSync(claudeScope, { recursive: true, force: true });
    } catch (_) {
      /* ok */
    }
    try {
      fs.rmSync(codexHome, { recursive: true, force: true });
    } catch (_) {
      /* ok */
    }
  });

  it('writes bin-meta.json next to the built bundle with skill metadata', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(getDistDir(), 'bin-meta.json'), 'utf8')) as {
      name: string;
      version: string;
      frontmcpVersion: string;
      skills: Array<{
        name: string;
        description?: string;
        tags?: string[];
        instructionFile?: string;
        resourceDirs?: Record<string, string>;
      }>;
    };
    expect(meta.name).toBe(appName);
    expect(typeof meta.version).toBe('string');
    expect(meta.frontmcpVersion).toBe(FRONTMCP_CLI_VERSION);
    const skillNames = meta.skills.map((s) => s.name).sort();
    expect(skillNames).toEqual(expect.arrayContaining(['greeting-helper', 'math-helper']));

    // description/tags must be plumbed through (gap closed by #411 follow-up + #415 SDK plumbing).
    const greeting = meta.skills.find((s) => s.name === 'greeting-helper');
    expect(greeting?.description).toBe('A helper skill for greeting users');
    expect(greeting?.tags).toEqual(expect.arrayContaining(['greeting', 'helper']));
  });

  it('install -p claude --dir <tmp> --dry-run prints the plan without writing', () => {
    const { stdout, exitCode } = runCli(['install', '-p', 'claude', '--dir', claudeScope, '--dry-run']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('dry-run plan');
    expect(stdout).toContain('pluginDir');
    // Nothing should have been written
    expect(fs.existsSync(path.join(claudeScope, appName))).toBe(false);
  });

  it('install -p claude --dir <tmp> writes a complete plugin folder', () => {
    const { stdout, exitCode } = runCli(['install', '-p', 'claude', '--dir', claudeScope]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/✓ Wrote /);

    const pluginDir = path.join(claudeScope, appName);
    expect(fs.existsSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, 'skills', 'greeting-helper', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, 'skills', 'math-helper', 'SKILL.md'))).toBe(true);

    const manifest = readPluginManifest(claudeScope, appName);
    expect(manifest.name).toBe(appName);
    expect(manifest.skills.sort()).toEqual(['greeting-helper', 'math-helper']);
    // Run as `node <bundle>` from dist/, so the entry restarts that same bundle by absolute path.
    expect(path.isAbsolute(manifest.mcpServers[appName].command)).toBe(true);
    expect(manifest.mcpServers[appName].args).toEqual([getCliBundlePath(), 'serve', '--stdio']);
    expect(manifest._meta.frontmcp.installedBy).toBe(`frontmcp@${FRONTMCP_CLI_VERSION}`);
    expect(manifest._meta.frontmcp.managedFiles).toEqual(
      expect.arrayContaining(['skills/greeting-helper/SKILL.md', 'skills/math-helper/SKILL.md']),
    );

    const greetingMd = fs.readFileSync(path.join(pluginDir, 'skills', 'greeting-helper', 'SKILL.md'), 'utf8');
    // Frontmatter must carry the description + tags so Claude Code's loader can index by them.
    expect(greetingMd.startsWith('---\n')).toBe(true);
    expect(greetingMd).toContain('name: greeting-helper');
    expect(greetingMd).toContain('description: A helper skill for greeting users');
    // Tags from `@Skill({ tags: ['greeting', 'helper'] })` must round-trip
    // through bin-meta.json → composeSkillMd → SKILL.md frontmatter.
    expect(greetingMd).toMatch(/tags:\s*\[[^\]]*greeting[^\]]*helper[^\]]*\]/);

    // Inline `@Skill({ instructions: '...' })` bodies must survive the build, not install as frontmatter alone.
    const mathMd = fs.readFileSync(path.join(pluginDir, 'skills', 'math-helper', 'SKILL.md'), 'utf8');
    expect(mathMd).toContain('name: math-helper');
    expect(mathMd).toContain('## Math Helper');
    expect(mathMd).toContain('Use the add tool to perform addition operations.');
  });

  it('the MCP entry written into plugin.json starts the server over stdio', async () => {
    const { command, args } = readPluginManifest(claudeScope, appName).mcpServers[appName];
    const transport = new McpStdioClientTransport({ command, args, env: { ...process.env } as Record<string, string> });
    const client = new McpClient({ name: 'plugin-entry-check', version: '1.0.0' }, { capabilities: {} });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('add');
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }, 60000);

  it('writes the bin name when the bin was started from a PATH directory', () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-plugin-bin-'));
    const destRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-plugin-path-'));
    try {
      fs.chmodSync(getCliBundlePath(), 0o755);
      fs.symlinkSync(getCliBundlePath(), path.join(binDir, 'hd'));
      execFileSync('hd', ['install', '-p', 'claude', '--dir', destRoot, '--only-mcp'], {
        cwd: getDistDir(),
        encoding: 'utf-8',
        env: { ...process.env, NODE_ENV: 'test', PATH: `${binDir}${path.delimiter}${process.env['PATH'] ?? ''}` },
      });
      expect(readPluginManifest(destRoot, appName).mcpServers[appName]).toEqual(
        expect.objectContaining({ command: 'hd', args: ['serve', '--stdio'] }),
      );
    } finally {
      fs.rmSync(binDir, { recursive: true, force: true });
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  it('--command takes a program with its arguments', () => {
    const destRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-plugin-command-'));
    try {
      const commandLine = `node "${getCliBundlePath()}" --stdio`;
      const { exitCode } = runCli([
        'install',
        '-p',
        'claude',
        '--dir',
        destRoot,
        '--only-mcp',
        '--command',
        commandLine,
      ]);
      expect(exitCode).toBe(0);
      expect(readPluginManifest(destRoot, appName).mcpServers[appName]).toEqual(
        expect.objectContaining({ command: 'node', args: [getCliBundlePath(), '--stdio'] }),
      );
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  it('install --status reports the plugin as installed for the matching scope', () => {
    const { stdout, exitCode } = runCli(['install', '--status', '--dir', claudeScope]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/claude:\s+installed/);
  });

  it('install --no-skills emits a plugin with zero skills entries', () => {
    const altScope = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-411-claude-noskill-'));
    try {
      const { exitCode } = runCli(['install', '-p', 'claude', '--dir', altScope, '--no-skills']);
      expect(exitCode).toBe(0);

      const manifest = JSON.parse(
        fs.readFileSync(path.join(altScope, appName, '.claude-plugin', 'plugin.json'), 'utf8'),
      ) as { skills: string[] };
      expect(manifest.skills).toEqual([]);
    } finally {
      fs.rmSync(altScope, { recursive: true, force: true });
    }
  });

  it('uninstall -p claude removes the plugin tree idempotently', () => {
    const pluginDir = path.join(claudeScope, appName);
    expect(fs.existsSync(pluginDir)).toBe(true);

    const first = runCli(['uninstall', '-p', 'claude', '--dir', claudeScope]);
    expect(first.exitCode).toBe(0);
    expect(fs.existsSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'))).toBe(false);

    // Second call must succeed even though there's nothing left to remove.
    const second = runCli(['uninstall', '-p', 'claude', '--dir', claudeScope]);
    expect(second.exitCode).toBe(0);
  });

  it('install -p codex --dry-run plans an [mcp_servers.<name>] table', () => {
    const { stdout, exitCode } = runCli(['install', '-p', 'codex', '--dry-run'], {
      HOME: codexHome,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('dry-run plan');
    expect(stdout).toContain(`[mcp_servers.${appName}]`);
    expect(stdout).not.toContain('[[mcp_servers]]');
    expect(fs.existsSync(path.join(codexHome, '.codex', 'config.toml'))).toBe(false);
  });

  it('install -p codex repairs an older [[mcp_servers]] block and keeps the user servers; uninstall removes only its table', () => {
    const codexConfig = path.join(codexHome, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
    const userSettings = 'model = "o3"\n\n[mcp_servers.other]\ncommand = "other-server"\n';
    const legacyBlock = [
      `# frontmcp:codex-start:${appName}`,
      '[[mcp_servers]]',
      `name = "${appName}"`,
      `command = "${appName}"`,
      'args = ["serve", "--stdio"]',
      `# frontmcp:codex-end:${appName}`,
    ].join('\n');
    fs.writeFileSync(codexConfig, `${userSettings}\n${legacyBlock}\n`);

    const install = runCli(['install', '-p', 'codex', '--env', 'DESK_TOKEN'], { HOME: codexHome });
    expect(install.exitCode).toBe(0);
    expect(install.stdout).toContain(`[mcp_servers.${appName}]`);
    const installed = parseToml(fs.readFileSync(codexConfig, 'utf8'));
    expect(installed['model']).toBe('o3');
    expect(installed['mcp_servers']).toEqual({
      other: { command: 'other-server' },
      [appName]: {
        command: expect.any(String),
        args: [getCliBundlePath(), 'serve', '--stdio'],
        env_vars: ['DESK_TOKEN'],
      },
    });

    const reinstall = runCli(['install', '-p', 'codex', '--env', 'DESK_TOKEN'], { HOME: codexHome });
    expect(reinstall.exitCode).toBe(0);
    expect(parseToml(fs.readFileSync(codexConfig, 'utf8'))['mcp_servers']).toEqual(installed['mcp_servers']);

    const uninstall = runCli(['uninstall', '-p', 'codex'], { HOME: codexHome });
    expect(uninstall.exitCode).toBe(0);
    const remaining = fs.readFileSync(codexConfig, 'utf8');
    expect(remaining.startsWith(userSettings)).toBe(true);
    expect(parseToml(remaining)['mcp_servers']).toEqual({ other: { command: 'other-server' } });
  });

  it('install -p codex refuses to add a second table for a server configured by hand', () => {
    const handHome = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-codex-hand-'));
    try {
      const codexConfig = path.join(handHome, '.codex', 'config.toml');
      fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
      const handWritten = `[mcp_servers.${appName}]\ncommand = "hand-written"\n`;
      fs.writeFileSync(codexConfig, handWritten);

      const { exitCode, stderr } = runCli(['install', '-p', 'codex'], { HOME: handHome });
      expect(exitCode).toBe(1);
      expect(stderr).toContain(`already defines [mcp_servers.${appName}] outside the frontmcp markers`);
      expect(fs.readFileSync(codexConfig, 'utf8')).toBe(handWritten);
    } finally {
      fs.rmSync(handHome, { recursive: true, force: true });
    }
  });
});
