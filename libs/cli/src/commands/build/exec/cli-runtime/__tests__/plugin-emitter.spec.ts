import * as os from 'os';
import * as path from 'path';

import { mkdtemp, readFile, rm, writeFile, fileExists, mkdir } from '@frontmcp/utils';

import {
  assertValidPluginName,
  emitClaudePlugin,
  emitCodexEntry,
  isPluginContainedPath,
  readInstalledPluginVersion,
  removeClaudePlugin,
  removeCodexEntry,
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
            instructionFile: undefined,
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

  describe('emitCodexEntry', () => {
    it('writes a new [[mcp_servers]] block when config.toml does not exist', async () => {
      const configPath = path.join(tmp, '.codex', 'config.toml');
      const result = await emitCodexEntry({
        configPath,
        name: 'codex-bin',
        command: 'codex-bin',
        args: ['serve', '--stdio'],
        env: { TOKEN: '${TOKEN}' },
      });
      expect(result.written).toBe(true);
      const content = await readFile(configPath);
      expect(content).toContain('[[mcp_servers]]');
      expect(content).toContain('name = "codex-bin"');
      expect(content).toContain('command = "codex-bin"');
      expect(content).toContain('args = ["serve", "--stdio"]');
      expect(content).toContain('TOKEN = "${TOKEN}"');
      expect(content).toContain('# frontmcp:codex-start:codex-bin');
      expect(content).toContain('# frontmcp:codex-end:codex-bin');
    });

    it('replaces an existing block on re-emit (idempotent)', async () => {
      const configPath = path.join(tmp, '.codex', 'config.toml');
      await emitCodexEntry({ configPath, name: 'x', command: 'x', args: ['serve'] });
      await emitCodexEntry({ configPath, name: 'x', command: 'x', args: ['serve', '--new-flag'] });
      const content = await readFile(configPath);
      const startCount = (content.match(/# frontmcp:codex-start:x/g) ?? []).length;
      expect(startCount).toBe(1);
      expect(content).toContain('--new-flag');
    });

    it('preserves user content in the file when adding/removing blocks', async () => {
      const configPath = path.join(tmp, '.codex', 'config.toml');
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, '# user comment\n[other_section]\nfoo = "bar"\n');
      await emitCodexEntry({ configPath, name: 'add', command: 'add', args: [] });
      const content = await readFile(configPath);
      expect(content).toContain('# user comment');
      expect(content).toContain('foo = "bar"');
      expect(content).toContain('# frontmcp:codex-start:add');
      // Regression guard for the double-newline bug fixed in pass 2: at most a
      // single blank line should separate the user content from the new block.
      expect(content).not.toMatch(/\n\n\n+# frontmcp:codex-start/);
    });

    it('produces single-blank-line separator when appending to file without trailing newline', async () => {
      const configPath = path.join(tmp, '.codex', 'config.toml');
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, 'foo'); // no trailing newline
      await emitCodexEntry({ configPath, name: 'first', command: 'first', args: [] });
      const content = await readFile(configPath);
      // Expect "foo\n\n# frontmcp:codex-start:first\n..." — single blank line.
      expect(content).toMatch(/^foo\n\n# frontmcp:codex-start:first\n/);
    });

    it('collapses multiple trailing newlines into a single blank-line separator', async () => {
      const configPath = path.join(tmp, '.codex', 'config.toml');
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, 'foo\n\n\n');
      await emitCodexEntry({ configPath, name: 'second', command: 'second', args: [] });
      const content = await readFile(configPath);
      expect(content).toMatch(/^foo\n\n# frontmcp:codex-start:second\n/);
    });
  });

  describe('removeCodexEntry', () => {
    it('removes only the named block, preserving user content', async () => {
      const configPath = path.join(tmp, '.codex', 'config.toml');
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, '# user comment\n');
      await emitCodexEntry({ configPath, name: 'a', command: 'a', args: [] });
      await emitCodexEntry({ configPath, name: 'b', command: 'b', args: [] });
      const result = await removeCodexEntry({ configPath, name: 'a' });
      expect(result.removed).toBe(true);
      const content = await readFile(configPath);
      expect(content).toContain('# user comment');
      expect(content).toContain('# frontmcp:codex-start:b');
      expect(content).not.toContain('# frontmcp:codex-start:a');
    });
  });
});
