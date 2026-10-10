import * as os from 'os';
import * as path from 'path';

import { parse as parseToml } from 'smol-toml';

import { mkdtemp, readFile, rm, writeFile, fileExists, mkdir } from '@frontmcp/utils';

import {
  applyCommandOverride,
  assertValidPluginName,
  emitClaudePlugin,
  emitCodexEntry,
  isPluginContainedPath,
  readInstalledPluginVersion,
  removeClaudePlugin,
  removeCodexEntry,
  resolveSelfInvocation,
  splitCommandLine,
} from '../plugin-emitter';

describe('plugin-emitter (issue #411)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-411-emitter-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  describe('emitClaudePlugin', () => {
    it('writes a complete plugin folder (manifest + skills + commands)', async () => {
      const skillSrc = path.join(tmp, 'src-skill');
      await mkdir(skillSrc, { recursive: true });
      await writeFile(path.join(skillSrc, 'SKILL.md'), '---\nname: review-pr\n---\nReview PRs.');
      await mkdir(path.join(skillSrc, 'references'), { recursive: true });
      await writeFile(path.join(skillSrc, 'references', 'note.md'), 'note');

      const destRoot = path.join(tmp, 'plugins');
      const result = await emitClaudePlugin({
        destRoot,
        name: 'my-bin',
        version: '1.2.3',
        description: 'My MCP server',
        mcpCommand: 'my-bin',
        mcpArgs: ['serve', '--stdio'],
        envHints: ['MY_SECRET'],
        skills: [
          {
            name: 'review-pr',
            description: 'Review pull requests',
            instructionFile: path.join(skillSrc, 'SKILL.md'),
            resourceDirs: { references: path.join(skillSrc, 'references') },
          },
        ],
        commands: [
          {
            name: 'do-it',
            description: 'Do the thing',
            arguments: [{ name: 'target', required: true }],
          },
        ],
        cliVersion: '0.5.0',
      });

      const pluginDir = path.join(destRoot, 'my-bin');
      expect(result.pluginDir).toBe(pluginDir);
      expect(await fileExists(path.join(pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true);
      expect(await fileExists(path.join(pluginDir, 'skills', 'review-pr', 'SKILL.md'))).toBe(true);
      expect(await fileExists(path.join(pluginDir, 'skills', 'review-pr', 'references', 'note.md'))).toBe(true);
      expect(await fileExists(path.join(pluginDir, 'commands', 'do-it.md'))).toBe(true);

      const manifest = JSON.parse(await readFile(path.join(pluginDir, '.claude-plugin', 'plugin.json')));
      expect(manifest.name).toBe('my-bin');
      expect(manifest.version).toBe('1.2.3');
      expect(manifest.skills).toEqual(['review-pr']);
      expect(manifest.commands).toEqual(['do-it']);
      expect(manifest.mcpServers['my-bin'].command).toBe('my-bin');
      expect(manifest.mcpServers['my-bin'].args).toEqual(['serve', '--stdio']);
      expect(manifest.mcpServers['my-bin'].env).toEqual({ MY_SECRET: '${MY_SECRET}' });
      expect(manifest._meta.frontmcp.installedBy).toBe('frontmcp@0.5.0');
      expect(manifest._meta.frontmcp.binVersion).toBe('1.2.3');
      expect(manifest._meta.frontmcp.managedFiles).toContain('skills/review-pr/SKILL.md');
      expect(manifest._meta.frontmcp.managedFiles).toContain('commands/do-it.md');
    });

    it('is idempotent — second emit with same inputs produces the same managed-file set', async () => {
      const destRoot = path.join(tmp, 'plugins');
      const opts = {
        destRoot,
        name: 'idempotent',
        version: '1.0.0',
        description: 'd',
        mcpCommand: 'idempotent',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        skills: [],
        commands: [],
        cliVersion: '0.5.0',
      } as const;
      const first = await emitClaudePlugin(opts);
      const second = await emitClaudePlugin(opts);
      expect(second.manifest._meta.frontmcp.managedFiles).toEqual(first.manifest._meta.frontmcp.managedFiles);
    });

    it('removes previously-managed files that disappear on re-install', async () => {
      const destRoot = path.join(tmp, 'plugins');
      const base = {
        destRoot,
        name: 'shrinks',
        version: '1.0.0',
        description: 'd',
        mcpCommand: 'shrinks',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        cliVersion: '0.5.0',
      } as const;
      await emitClaudePlugin({
        ...base,
        skills: [],
        commands: [
          { name: 'one', description: 'one' },
          { name: 'two', description: 'two' },
        ],
      });
      const pluginDir = path.join(destRoot, 'shrinks');
      expect(await fileExists(path.join(pluginDir, 'commands', 'one.md'))).toBe(true);
      expect(await fileExists(path.join(pluginDir, 'commands', 'two.md'))).toBe(true);

      const result = await emitClaudePlugin({
        ...base,
        skills: [],
        commands: [{ name: 'one', description: 'one' }],
      });
      expect(await fileExists(path.join(pluginDir, 'commands', 'one.md'))).toBe(true);
      expect(await fileExists(path.join(pluginDir, 'commands', 'two.md'))).toBe(false);
      expect(result.filesRemoved.length).toBeGreaterThan(0);
    });

    it('preserves user-added top-level keys in plugin.json on re-install', async () => {
      const destRoot = path.join(tmp, 'plugins');
      const base = {
        destRoot,
        name: 'preserves',
        version: '1.0.0',
        description: 'd',
        mcpCommand: 'preserves',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        skills: [],
        commands: [],
        cliVersion: '0.5.0',
      } as const;
      await emitClaudePlugin(base);
      const manifestPath = path.join(destRoot, 'preserves', '.claude-plugin', 'plugin.json');
      const orig = JSON.parse(await readFile(manifestPath));
      orig['hooks'] = { 'on-call': './my-hook.sh' };
      orig.mcpServers['another-server'] = { command: 'other', args: [] };
      await writeFile(manifestPath, JSON.stringify(orig, null, 2));

      await emitClaudePlugin(base);

      const after = JSON.parse(await readFile(manifestPath));
      expect(after.hooks).toEqual({ 'on-call': './my-hook.sh' });
      expect(after.mcpServers['another-server']).toEqual({ command: 'other', args: [] });
      expect(after.mcpServers['preserves'].command).toBe('preserves');
    });

    it('synthesizes SKILL.md frontmatter when the source body has none (issue #411 + #415)', async () => {
      const skillSrc = path.join(tmp, 'src-no-fm');
      await mkdir(skillSrc, { recursive: true });
      // Source markdown body without YAML frontmatter — typical for projects
      // that author skills via `@Skill({ instructions: { file: './body.md' } })`.
      await writeFile(path.join(skillSrc, 'body.md'), '# Heading\n\nBody content.');

      const destRoot = path.join(tmp, 'plugins-fm');
      await emitClaudePlugin({
        destRoot,
        name: 'fm-bin',
        version: '1.0.0',
        description: 'd',
        mcpCommand: 'fm-bin',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        skills: [
          {
            name: 'tagged-skill',
            description: 'Skill with tags + license',
            tags: ['alpha', 'beta'],
            license: 'MIT',
            instructionFile: path.join(skillSrc, 'body.md'),
          },
        ],
        commands: [],
        cliVersion: '0.5.0',
      });

      const written = await readFile(path.join(destRoot, 'fm-bin', 'skills', 'tagged-skill', 'SKILL.md'));
      expect(written.startsWith('---\n')).toBe(true);
      expect(written).toContain('name: tagged-skill');
      expect(written).toContain('description: Skill with tags + license');
      expect(written).toContain('tags: [alpha, beta]');
      expect(written).toContain('license: MIT');
      expect(written).toContain('# Heading');
      expect(written).toContain('Body content.');
    });

    it('preserves a pre-existing frontmatter block in the source file verbatim', async () => {
      const skillSrc = path.join(tmp, 'src-has-fm');
      await mkdir(skillSrc, { recursive: true });
      const source = [
        '---',
        'name: source-defined',
        'description: from-source-file',
        '---',
        '',
        '# Body',
      ].join('\n');
      await writeFile(path.join(skillSrc, 'SKILL.md'), source);

      const destRoot = path.join(tmp, 'plugins-preserve');
      await emitClaudePlugin({
        destRoot,
        name: 'preserve-bin',
        version: '1.0.0',
        description: 'd',
        mcpCommand: 'preserve-bin',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        skills: [
          {
            name: 'source-defined',
            description: 'should-not-overwrite-source-frontmatter',
            instructionFile: path.join(skillSrc, 'SKILL.md'),
          },
        ],
        commands: [],
        cliVersion: '0.5.0',
      });

      const written = await readFile(path.join(destRoot, 'preserve-bin', 'skills', 'source-defined', 'SKILL.md'));
      expect(written).toBe(source);
      expect(written).not.toContain('should-not-overwrite-source-frontmatter');
    });

    it('writes inline instruction content as the SKILL.md body', async () => {
      const destRoot = path.join(tmp, 'plugins');
      await emitClaudePlugin({
        destRoot,
        name: 'inline-bin',
        version: '1.0.0',
        description: 'd',
        mcpCommand: 'inline-bin',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        skills: [{ name: 'math-helper', description: 'Math', instructionContent: '# Math\n\nAdd carefully.' }],
        commands: [],
        cliVersion: '0.5.0',
      });

      const skillMd = await readFile(path.join(destRoot, 'inline-bin', 'skills', 'math-helper', 'SKILL.md'));
      expect(skillMd).toContain('name: math-helper');
      expect(skillMd).toContain('# Math\n\nAdd carefully.');
    });

    it('skips a skill with no instructions instead of writing an empty SKILL.md', async () => {
      const destRoot = path.join(tmp, 'plugins');
      const result = await emitClaudePlugin({
        destRoot,
        name: 'partial-bin',
        version: '1.0.0',
        description: 'd',
        mcpCommand: 'partial-bin',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        skills: [
          { name: 'empty', description: 'nothing captured' },
          { name: 'lost', description: 'file gone', instructionFile: path.join(tmp, 'missing.md') },
          { name: 'kept', description: 'has a body', instructionContent: 'body' },
        ],
        commands: [],
        cliVersion: '0.5.0',
      });

      const pluginDir = path.join(destRoot, 'partial-bin');
      expect(result.skillsSkipped).toEqual([
        { name: 'empty', reason: 'no instructions were captured from the skill' },
        { name: 'lost', reason: `instruction file not found at ${path.join(tmp, 'missing.md')}` },
      ]);
      expect(result.manifest.skills).toEqual(['kept']);
      expect(await fileExists(path.join(pluginDir, 'skills', 'empty'))).toBe(false);
      expect(await fileExists(path.join(pluginDir, 'skills', 'lost'))).toBe(false);
      expect(await fileExists(path.join(pluginDir, 'skills', 'kept', 'SKILL.md'))).toBe(true);
    });

    it('dryRun does not touch the filesystem', async () => {
      const destRoot = path.join(tmp, 'plugins');
      const result = await emitClaudePlugin({
        destRoot,
        name: 'dry',
        version: '1.0.0',
        description: 'd',
        mcpCommand: 'dry',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        skills: [],
        commands: [],
        cliVersion: '0.5.0',
        dryRun: true,
      });
      expect(await fileExists(result.pluginDir)).toBe(false);
      expect(result.filesWritten.length).toBeGreaterThan(0); // planned, not actual
    });
  });

  describe('command-name validation (issue #411 security pass 3)', () => {
    it('rejects emitClaudePlugin when a command name contains injection-prone chars', async () => {
      const destRoot = path.join(tmp, 'plugins');
      await expect(
        emitClaudePlugin({
          destRoot,
          name: 'safe-bin',
          version: '1.0.0',
          description: 'd',
          mcpCommand: 'safe-bin',
          mcpArgs: ['serve', '--stdio'],
          envHints: [],
          skills: [],
          commands: [{ name: 'evil\ninjected: true' }],
          cliVersion: '0.5.0',
        }),
      ).rejects.toThrow(/emitClaudePlugin\.command/);
    });

    it('rejects emitClaudePlugin when a skill name escapes the plugin tree', async () => {
      // Without skill-name validation, `path.join(pluginDir, 'skills', '../../etc')`
      // would write SKILL.md outside the plugin directory. Mirrors the
      // command-name guard above (issue #411 follow-up + review-diff finding).
      const destRoot = path.join(tmp, 'plugins');
      await expect(
        emitClaudePlugin({
          destRoot,
          name: 'safe-bin',
          version: '1.0.0',
          description: 'd',
          mcpCommand: 'safe-bin',
          mcpArgs: ['serve', '--stdio'],
          envHints: [],
          skills: [{ name: '../../escape', description: 'tries to escape' }],
          commands: [],
          cliVersion: '0.5.0',
        }),
      ).rejects.toThrow(/emitClaudePlugin\.skill/);
    });
  });

  describe('assertValidPluginName (issue #411 security)', () => {
    it('accepts well-formed names', () => {
      for (const name of ['my-bin', 'my_bin', 'my.bin', 'a1', 'Plugin99', 'Long-Name.with.dots-and-underscores']) {
        expect(() => assertValidPluginName(name, 'test')).not.toThrow();
      }
    });

    it.each([
      ['', 'empty string'],
      ['.', 'literal "."'],
      ['..', 'literal ".." (path traversal)'],
      ['../etc/passwd', '../ traversal'],
      ['has/slash', 'forward slash'],
      ['has\\backslash', 'backslash'],
      ['has space', 'whitespace'],
      ['has\nnewline', 'newline (TOML injection)'],
      ['has\0null', 'NULL byte'],
      ['has\rcr', 'CR'],
      ['.hidden', 'leading dot (hidden dir)'],
      ['-leading-dash', 'leading dash'],
      ['hash#sign', 'hash (codex marker char)'],
      ['has[bracket', 'TOML bracket'],
      ['has=eq', 'TOML equals'],
      ['a'.repeat(65), 'name longer than 64 chars'],
    ])('rejects %o (%s)', (name, _why) => {
      expect(() => assertValidPluginName(name, 'test')).toThrow();
    });
  });

  describe('isPluginContainedPath (issue #411 security)', () => {
    it('accepts paths strictly inside the plugin dir', () => {
      const pluginDir = '/tmp/plugins/my-bin';
      expect(isPluginContainedPath(pluginDir, 'commands/foo.md')).toBe(true);
      expect(isPluginContainedPath(pluginDir, 'skills/x/SKILL.md')).toBe(true);
      expect(isPluginContainedPath(pluginDir, '.claude-plugin/plugin.json')).toBe(true);
    });

    it('rejects path-traversal escapes', () => {
      const pluginDir = '/tmp/plugins/my-bin';
      expect(isPluginContainedPath(pluginDir, '../escape')).toBe(false);
      expect(isPluginContainedPath(pluginDir, '../../etc/passwd')).toBe(false);
      expect(isPluginContainedPath(pluginDir, 'commands/../../../etc/passwd')).toBe(false);
    });

    it('rejects absolute paths', () => {
      const pluginDir = '/tmp/plugins/my-bin';
      expect(isPluginContainedPath(pluginDir, '/etc/passwd')).toBe(false);
    });

    it('rejects empty paths and the plugin dir itself', () => {
      const pluginDir = '/tmp/plugins/my-bin';
      expect(isPluginContainedPath(pluginDir, '')).toBe(false);
      expect(isPluginContainedPath(pluginDir, '.')).toBe(false);
    });
  });

  describe('removeClaudePlugin', () => {
    it('removes only managed files; leaves user files in place', async () => {
      const destRoot = path.join(tmp, 'plugins');
      const opts = {
        destRoot,
        name: 'cleanup',
        version: '1.0.0',
        description: 'd',
        mcpCommand: 'cleanup',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        skills: [],
        commands: [{ name: 'one' }],
        cliVersion: '0.5.0',
      } as const;
      await emitClaudePlugin(opts);
      const pluginDir = path.join(destRoot, 'cleanup');
      await writeFile(path.join(pluginDir, 'USER-FILE.txt'), 'mine');

      const result = await removeClaudePlugin({ destRoot, name: 'cleanup' });
      expect(result.removed.length).toBeGreaterThan(0);
      expect(await fileExists(path.join(pluginDir, 'commands', 'one.md'))).toBe(false);
      expect(await fileExists(path.join(pluginDir, 'USER-FILE.txt'))).toBe(true);
    });

    it('is a no-op when nothing is installed', async () => {
      const result = await removeClaudePlugin({ destRoot: path.join(tmp, 'nope'), name: 'never' });
      expect(result.removed).toEqual([]);
    });

    it('preserves nested user files inside skills/ and leaves the plugin dir intact', async () => {
      const destRoot = path.join(tmp, 'plugins');
      const opts = {
        destRoot,
        name: 'nested',
        version: '1.0.0',
        description: 'd',
        mcpCommand: 'nested',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        skills: [
          {
            name: 'managed',
            description: 'managed skill',
            instructionContent: 'managed body',
          },
        ],
        commands: [],
        cliVersion: '0.5.0',
      } as const;
      await emitClaudePlugin(opts);
      const pluginDir = path.join(destRoot, 'nested');
      // User drops a file inside skills/managed/ alongside the managed SKILL.md,
      // and another inside skills/ at the second level.
      await writeFile(path.join(pluginDir, 'skills', 'managed', 'NOTES.md'), 'user');
      await mkdir(path.join(pluginDir, 'skills', 'my-tool'), { recursive: true });
      await writeFile(path.join(pluginDir, 'skills', 'my-tool', 'README.md'), 'user');

      await removeClaudePlugin({ destRoot, name: 'nested' });

      expect(await fileExists(path.join(pluginDir, 'skills', 'managed', 'NOTES.md'))).toBe(true);
      expect(await fileExists(path.join(pluginDir, 'skills', 'my-tool', 'README.md'))).toBe(true);
      expect(await fileExists(pluginDir)).toBe(true);
    });

    it('refuses to delete files outside the plugin dir when managedFiles is tampered (issue #411 security)', async () => {
      const destRoot = path.join(tmp, 'plugins');
      const opts = {
        destRoot,
        name: 'tamper',
        version: '1.0.0',
        description: 'd',
        mcpCommand: 'tamper',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        skills: [],
        commands: [],
        cliVersion: '0.5.0',
      } as const;
      await emitClaudePlugin(opts);
      const pluginDir = path.join(destRoot, 'tamper');
      const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');

      // Write a sentinel file OUTSIDE the plugin dir that a traversal payload
      // would target.
      const sentinel = path.join(tmp, 'sensitive.txt');
      await writeFile(sentinel, 'should-not-be-deleted');

      // Inject a path-traversal payload into managedFiles.
      const traversal = path.relative(pluginDir, sentinel); // computes the ../../sensitive.txt path
      const manifest = JSON.parse(await readFile(manifestPath));
      manifest._meta.frontmcp.managedFiles = [...manifest._meta.frontmcp.managedFiles, traversal];
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      await removeClaudePlugin({ destRoot, name: 'tamper' });

      expect(await fileExists(sentinel)).toBe(true);
      expect(await readFile(sentinel)).toBe('should-not-be-deleted');
    });
  });

  describe('readInstalledPluginVersion', () => {
    it('returns binVersion from plugin.json when installed', async () => {
      const destRoot = path.join(tmp, 'plugins');
      await emitClaudePlugin({
        destRoot,
        name: 'has-version',
        version: '2.0.0',
        description: 'd',
        mcpCommand: 'has-version',
        mcpArgs: ['serve', '--stdio'],
        envHints: [],
        skills: [],
        commands: [],
        cliVersion: '0.5.0',
      });
      const version = await readInstalledPluginVersion(path.join(destRoot, 'has-version'));
      expect(version).toBe('2.0.0');
    });

    it('returns undefined when not installed', async () => {
      const version = await readInstalledPluginVersion(path.join(tmp, 'nothing'));
      expect(version).toBeUndefined();
    });
  });

  describe('Codex entry (map shape Codex reads)', () => {
    const legacyBlock = (name: string) =>
      [
        `# frontmcp:codex-start:${name}`,
        '[[mcp_servers]]',
        `name = "${name}"`,
        `command = "${name}"`,
        'args = ["serve", "--stdio"]',
        `env = { TOKEN = "\${TOKEN}" }`,
        `# frontmcp:codex-end:${name}`,
      ].join('\n');

    let configPath: string;

    beforeEach(async () => {
      configPath = path.join(tmp, '.codex', 'config.toml');
      await mkdir(path.dirname(configPath), { recursive: true });
    });

    async function readCodexServers(): Promise<Record<string, unknown>> {
      const parsed = parseToml(await readFile(configPath));
      return (parsed['mcp_servers'] ?? {}) as Record<string, unknown>;
    }

    it('writes [mcp_servers.<name>] with command and args, and no name key', async () => {
      const result = await emitCodexEntry({ configPath, name: 'codex-bin', command: 'codex-bin', args: ['serve', '--stdio'] });
      expect(result.written).toBe(true);
      const content = await readFile(configPath);
      expect(content).toContain('# frontmcp:codex-start:codex-bin\n[mcp_servers.codex-bin]\n');
      expect(content).toContain('# frontmcp:codex-end:codex-bin');
      expect(await readCodexServers()).toEqual({ 'codex-bin': { command: 'codex-bin', args: ['serve', '--stdio'] } });
    });

    it('forwards --env names through env_vars, sorted and de-duplicated', async () => {
      await emitCodexEntry({ configPath, name: 'x', command: 'x', args: [], envVars: ['TOKEN', 'REGION', 'TOKEN'] });
      expect(await readCodexServers()).toEqual({ x: { command: 'x', args: [], env_vars: ['REGION', 'TOKEN'] } });
    });

    it('quotes a server name that is not a bare TOML key', async () => {
      await emitCodexEntry({ configPath, name: 'help.desk', command: 'help-desk', args: [] });
      expect(await readFile(configPath)).toContain('[mcp_servers."help.desk"]');
      expect(Object.keys(await readCodexServers())).toEqual(['help.desk']);
    });

    it('keeps servers and settings the user configured', async () => {
      await writeFile(configPath, 'model = "o3"\n\n[mcp_servers.other]\ncommand = "other"\n');
      await emitCodexEntry({ configPath, name: 'help-desk', command: 'help-desk', args: ['serve'] });
      const parsed = parseToml(await readFile(configPath));
      expect(parsed['model']).toBe('o3');
      expect(parsed['mcp_servers']).toEqual({
        other: { command: 'other' },
        'help-desk': { command: 'help-desk', args: ['serve'] },
      });
    });

    it('is idempotent: installing twice leaves one block', async () => {
      await writeFile(configPath, '[mcp_servers.other]\ncommand = "other"\n');
      await emitCodexEntry({ configPath, name: 'x', command: 'x', args: ['serve'] });
      const once = await readFile(configPath);
      await emitCodexEntry({ configPath, name: 'x', command: 'x', args: ['serve'] });
      expect(await readFile(configPath)).toBe(once);
      expect(Object.keys(await readCodexServers()).sort()).toEqual(['other', 'x']);
    });

    it('replaces its own block when the invocation changes', async () => {
      await emitCodexEntry({ configPath, name: 'x', command: 'x', args: ['serve'] });
      await emitCodexEntry({ configPath, name: 'x', command: 'x', args: ['serve', '--new-flag'] });
      const content = await readFile(configPath);
      expect(content.match(/# frontmcp:codex-start:x$/gm)).toHaveLength(1);
      expect(await readCodexServers()).toEqual({ x: { command: 'x', args: ['serve', '--new-flag'] } });
    });

    it('rewrites a block an older frontmcp wrote in the [[mcp_servers]] shape on reinstall', async () => {
      await writeFile(configPath, `[mcp_servers.other]\ncommand = "other"\n\n${legacyBlock('help-desk')}\n`);
      await emitCodexEntry({ configPath, name: 'help-desk', command: 'help-desk', args: ['serve', '--stdio'] });
      expect(await readCodexServers()).toEqual({
        other: { command: 'other' },
        'help-desk': { command: 'help-desk', args: ['serve', '--stdio'] },
      });
    });

    it('rewrites the legacy block of another server in place when installing a new one', async () => {
      const userSettings = 'model = "o3"\n\n[mcp_servers.other]\ncommand = "other"\n';
      await writeFile(configPath, `${userSettings}\n${legacyBlock('legacy')}\n`);
      await emitCodexEntry({ configPath, name: 'help-desk', command: 'help-desk', args: [] });
      const content = await readFile(configPath);
      expect(content.startsWith(userSettings)).toBe(true);
      expect(content).toContain(
        '# frontmcp:codex-start:legacy\n[mcp_servers.legacy]\ncommand = "legacy"\nargs = ["serve", "--stdio"]\n',
      );
      expect(Object.keys(await readCodexServers()).sort()).toEqual(['help-desk', 'legacy', 'other']);
    });

    it('install twice, uninstall, and reinstall over a legacy block all leave a file Codex can read', async () => {
      await writeFile(configPath, `[mcp_servers.other]\ncommand = "other"\n\n${legacyBlock('help-desk')}\n`);
      await emitCodexEntry({ configPath, name: 'help-desk', command: 'help-desk', args: [] });
      await emitCodexEntry({ configPath, name: 'help-desk', command: 'help-desk', args: [] });
      expect(Object.keys(await readCodexServers()).sort()).toEqual(['help-desk', 'other']);

      expect((await removeCodexEntry({ configPath, name: 'help-desk' })).removed).toBe(true);
      expect(await readCodexServers()).toEqual({ other: { command: 'other' } });

      await writeFile(configPath, `${await readFile(configPath)}\n${legacyBlock('help-desk')}\n`);
      await emitCodexEntry({ configPath, name: 'help-desk', command: 'help-desk', args: ['serve'] });
      expect(await readCodexServers()).toEqual({
        other: { command: 'other' },
        'help-desk': { command: 'help-desk', args: ['serve'] },
      });
    });

    it('rewrites the remaining legacy blocks when another entry is uninstalled', async () => {
      await writeFile(configPath, `${legacyBlock('legacy')}\n`);
      await emitCodexEntry({ configPath, name: 'help-desk', command: 'help-desk', args: [] });
      await removeCodexEntry({ configPath, name: 'help-desk' });
      expect(Object.keys(await readCodexServers())).toEqual(['legacy']);
    });

    it('repairs legacy blocks on uninstall even when the named entry is absent', async () => {
      await writeFile(configPath, `${legacyBlock('legacy')}\n`);
      const result = await removeCodexEntry({ configPath, name: 'not-installed' });
      expect(result.removed).toBe(false);
      expect(Object.keys(await readCodexServers())).toEqual(['legacy']);
    });

    it('never matches the block of a server whose name starts with the same text', async () => {
      await emitCodexEntry({ configPath, name: 'help-desk', command: 'help-desk', args: [] });
      await emitCodexEntry({ configPath, name: 'help', command: 'help', args: ['serve'] });
      expect(await readCodexServers()).toEqual({
        'help-desk': { command: 'help-desk', args: [] },
        help: { command: 'help', args: ['serve'] },
      });
      await removeCodexEntry({ configPath, name: 'help' });
      expect(await readCodexServers()).toEqual({ 'help-desk': { command: 'help-desk', args: [] } });
    });

    it.each([
      ['[mcp_servers.help-desk]\ncommand = "hand-written"\n'],
      ['[mcp_servers."help-desk"]\ncommand = "hand-written"\n'],
      ['[mcp_servers.help-desk.env]\nTOKEN = "x"\n'],
    ])('refuses to add a second table for a server configured by hand: %j', async (handWritten) => {
      await writeFile(configPath, handWritten);
      await expect(emitCodexEntry({ configPath, name: 'help-desk', command: 'help-desk', args: [] })).rejects.toThrow(
        `${configPath} already defines [mcp_servers.help-desk] outside the frontmcp markers. Remove that table from ${configPath} (or rename the server in frontmcp.config), then run install again.`,
      );
      expect(await readFile(configPath)).toBe(handWritten);
      parseToml(handWritten);
    });

    it('does not mistake a hand-written server with a longer name for a duplicate', async () => {
      await writeFile(configPath, '[mcp_servers.help-desk-two]\ncommand = "two"\n');
      await emitCodexEntry({ configPath, name: 'help-desk', command: 'help-desk', args: [] });
      expect(Object.keys(await readCodexServers()).sort()).toEqual(['help-desk', 'help-desk-two']);
    });

    it('produces a single blank-line separator when appending to a file without a trailing newline', async () => {
      await writeFile(configPath, 'model = "o3"');
      await emitCodexEntry({ configPath, name: 'first', command: 'first', args: [] });
      expect(await readFile(configPath)).toMatch(/^model = "o3"\n\n# frontmcp:codex-start:first\n/);
      expect(Object.keys(await readCodexServers())).toEqual(['first']);
    });

    it('collapses multiple trailing newlines into a single blank-line separator', async () => {
      await writeFile(configPath, 'model = "o3"\n\n\n');
      await emitCodexEntry({ configPath, name: 'second', command: 'second', args: [] });
      expect(await readFile(configPath)).toMatch(/^model = "o3"\n\n# frontmcp:codex-start:second\n/);
      expect(Object.keys(await readCodexServers())).toEqual(['second']);
    });

    it('removes only the named block, preserving user content', async () => {
      await writeFile(configPath, '# user comment\n');
      await emitCodexEntry({ configPath, name: 'a', command: 'a', args: [] });
      await emitCodexEntry({ configPath, name: 'b', command: 'b', args: [] });
      expect((await removeCodexEntry({ configPath, name: 'a' })).removed).toBe(true);
      const content = await readFile(configPath);
      expect(content).toContain('# user comment');
      expect(content).not.toContain('# frontmcp:codex-start:a');
      expect(Object.keys(await readCodexServers())).toEqual(['b']);
    });

    it('dryRun returns the planned content without writing', async () => {
      const result = await emitCodexEntry({ configPath, name: 'x', command: 'x', args: [], dryRun: true });
      expect(result.written).toBe(false);
      expect(await fileExists(configPath)).toBe(false);
      expect(parseToml(result.configContent)['mcp_servers']).toEqual({ x: { command: 'x', args: [] } });
    });
  });

  describe('splitCommandLine', () => {
    it.each([
      ['help-desk', ['help-desk']],
      ['node ./dist/main.js --stdio', ['node', './dist/main.js', '--stdio']],
      ['  node   x.js  ', ['node', 'x.js']],
      ['"/Applications/My App/bin/server" --stdio', ['/Applications/My App/bin/server', '--stdio']],
      [`'C:\\Program Files\\nodejs\\node.exe' dist\\x.js`, ['C:\\Program Files\\nodejs\\node.exe', 'dist\\x.js']],
      ['node --title="a b" x.js', ['node', '--title=a b', 'x.js']],
      ['node ""', ['node', '']],
    ])('splits %j', (commandLine, expected) => {
      expect(splitCommandLine(commandLine)).toEqual(expected);
    });

    it('rejects an unterminated quote', () => {
      expect(() => splitCommandLine('node "x.js')).toThrow('Unterminated " quote in --command: node "x.js');
    });

    it('rejects a value with no program', () => {
      expect(() => splitCommandLine('   ')).toThrow('--command must name the program that starts the MCP server');
    });
  });

  describe('applyCommandOverride', () => {
    it('keeps the default arguments for a lone program', () => {
      expect(applyCommandOverride('hd', ['serve', '--stdio'])).toEqual({ command: 'hd', args: ['serve', '--stdio'] });
    });

    it('replaces the default arguments when the command line has its own', () => {
      expect(applyCommandOverride('node /abs/x.js --stdio', ['serve', '--stdio'])).toEqual({
        command: 'node',
        args: ['/abs/x.js', '--stdio'],
      });
    });
  });

  describe('resolveSelfInvocation', () => {
    const args = ['serve', '--stdio'];
    const execPath = '/usr/local/bin/node';
    const scriptPath = '/usr/local/lib/node_modules/help-desk/dist/cli/help-desk-cli.bundle.js';
    const pathEnv = ['/usr/local/bin', '/usr/bin'].join(path.delimiter);

    it('writes the bin name when the bin was started from a PATH directory', () => {
      expect(resolveSelfInvocation({ invokedPath: '/usr/local/bin/hd', execPath, scriptPath, pathEnv, args })).toEqual({
        command: 'hd',
        args,
      });
    });

    it('writes the bin name for a single executable started by name', () => {
      expect(resolveSelfInvocation({ invokedPath: 'help-desk', execPath: '/opt/hd/help-desk-cli-bin', pathEnv, args })).toEqual({
        command: 'help-desk',
        args,
      });
    });

    it('writes node and the bundle for a JS bin run from a dist folder', () => {
      const bundle = '/work/project/dist/cli/help-desk-cli.bundle.js';
      expect(resolveSelfInvocation({ invokedPath: bundle, execPath, scriptPath: bundle, pathEnv, args })).toEqual({
        command: execPath,
        args: [bundle, ...args],
      });
    });

    it('writes absolute paths for a bin npx started from its cache', () => {
      const npxBin = '/home/me/.npm/_npx/abc/node_modules/.bin';
      const npxPath = [npxBin, '/usr/bin'].join(path.delimiter);
      expect(
        resolveSelfInvocation({ invokedPath: path.join(npxBin, 'hd'), execPath, scriptPath, pathEnv: npxPath, args }),
      ).toEqual({ command: execPath, args: [scriptPath, ...args] });
    });

    it('writes the single executable path when it was started by a relative path', () => {
      expect(
        resolveSelfInvocation({ invokedPath: './dist/help-desk-cli-bin', execPath: '/work/dist/help-desk-cli-bin', pathEnv, args }),
      ).toEqual({ command: '/work/dist/help-desk-cli-bin', args });
    });

    it('writes absolute paths when PATH is empty', () => {
      expect(resolveSelfInvocation({ invokedPath: '/usr/local/bin/hd', execPath, scriptPath, pathEnv: '', args })).toEqual({
        command: execPath,
        args: [scriptPath, ...args],
      });
    });
  });
});
