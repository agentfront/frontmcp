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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ensureBuild, getDistDir, runCli } from './helpers/exec-cli';

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

    const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8')) as {
      name: string;
      mcpServers: Record<string, { command: string; args: string[] }>;
      skills: string[];
      _meta: { frontmcp: { binVersion: string; managedFiles: string[] } };
    };
    expect(manifest.name).toBe(appName);
    expect(manifest.skills.sort()).toEqual(['greeting-helper', 'math-helper']);
    expect(manifest.mcpServers[appName].command).toBe(appName);
    expect(manifest.mcpServers[appName].args).toEqual(['serve', '--stdio']);
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

  it('install -p codex writes an [[mcp_servers]] block into HOME/.codex/config.toml', () => {
    const { stdout, exitCode } = runCli(['install', '-p', 'codex', '--dry-run'], {
      HOME: codexHome,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('dry-run plan');
    expect(stdout).toContain(`[[mcp_servers]]`);
    expect(stdout).toContain(`name = "${appName}"`);
  });
});
