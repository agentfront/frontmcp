/**
 * Implementation of `frontmcp install --claude-plugin [--codex]` (issue #411).
 *
 * Flow:
 *   1. Load frontmcp.config + package.json to determine name/version/description.
 *   2. Spin up a transient direct-mode SDK instance to enumerate skills and
 *      prompts (the same surfaces a built bin would expose).
 *   3. Delegate to the shared `plugin-emitter.ts` helper.
 *
 * Status / dry-run paths are short-circuited before the SDK is loaded.
 */

import * as os from 'os';
import * as path from 'path';

import { tryLoadFrontMcpConfig } from '../../config/frontmcp-config.loader';
import { c } from '../../core/colors';
import {
  emitClaudePlugin,
  emitCodexEntry,
  readInstalledPluginVersion,
  removeClaudePlugin,
  removeCodexEntry,
  type EmitClaudePluginOptions,
  type PluginEmitterCommandInput,
  type PluginEmitterSkillInput,
} from '../build/exec/cli-runtime/plugin-emitter';

interface InstallOptions {
  claudePlugin?: boolean;
  codex?: boolean;
  scope?: 'project' | 'user';
  skills?: boolean;
  commands?: boolean;
  onlyMcp?: boolean;
  command?: string;
  env?: string[];
  dir?: string;
  dryRun?: boolean;
  status?: boolean;
}

export async function runInstallCurrentProject(rawOpts: Record<string, unknown>): Promise<void> {
  const opts = normalizeOptions(rawOpts);

  if (!opts.claudePlugin && !opts.codex) {
    process.stderr.write(c('red', 'Specify --claude and/or --codex.\n'));
    process.exit(1);
  }

  const projectMeta = await loadProjectMeta();
  if (!projectMeta) {
    process.stderr.write(
      c('red', 'No frontmcp.config found in this directory. Run `frontmcp install` from a FrontMCP project root.\n'),
    );
    process.exit(1);
  }

  if (opts.status) {
    await printStatus(projectMeta, opts);
    return;
  }

  const cliVersion = await getCliVersion();
  const skills = opts.skills === false || opts.onlyMcp ? [] : await collectSkillsFromProject();
  const commands = opts.commands === false || opts.onlyMcp ? [] : await collectPromptsFromProject();

  if (opts.claudePlugin) {
    await runClaudeInstall({ projectMeta, opts, cliVersion, skills, commands });
  }
  if (opts.codex) {
    await runCodexInstall({ projectMeta, opts, cliVersion });
  }
}

interface ProjectMeta {
  name: string;
  version: string;
  description: string;
}

async function loadProjectMeta(): Promise<ProjectMeta | undefined> {
  const cwd = process.cwd();
  const cfg = await tryLoadFrontMcpConfig(cwd).catch(() => undefined);
  if (!cfg) return undefined;
  const { readJSON, fileExists } = await import('@frontmcp/utils');
  const pkgPath = path.join(cwd, 'package.json');
  const pkg: { name?: string; version?: string; description?: string } = (await fileExists(pkgPath))
    ? ((await readJSON(pkgPath)) as { name?: string; version?: string; description?: string })
    : {};
  return {
    name: cfg.name ?? pkg.name ?? path.basename(cwd),
    version: cfg.version ?? pkg.version ?? '0.0.0',
    description: pkg.description ?? `${cfg.name ?? pkg.name ?? 'FrontMCP server'} (FrontMCP plugin)`,
  };
}

/**
 * Best-effort: bundle the project's entry to a temp file, hand the bundle
 * to the schema-extractor (the same routine the per-bin path uses at build
 * time), and return the enumerated skills / prompts. Failures are logged
 * and the empty-array fallback is returned so a partial setup never blocks
 * an install — the per-bin path remains the authoritative source.
 *
 * Wrapped in a single bundle+extract pass so both collectors share work:
 * spawning two extractor passes would double the SDK boot cost on every
 * dev-tool install.
 */
let cachedExtraction: Promise<{ skills: PluginEmitterSkillInput[]; commands: PluginEmitterCommandInput[] }> | undefined;

async function getProjectExtraction(cwd: string): Promise<{
  skills: PluginEmitterSkillInput[];
  commands: PluginEmitterCommandInput[];
}> {
  if (cachedExtraction) return cachedExtraction;
  cachedExtraction = (async () => {
    try {
      const { resolveEntry } = await import('../../shared/fs.js');
      const { mkdtemp, rm } = await import('@frontmcp/utils');
      const entry = await resolveEntry(cwd);
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-install-'));
      const bundlePath = path.join(tempDir, 'entry.cjs');
      try {
        const esbuild = require('esbuild') as typeof import('esbuild');
        await esbuild.build({
          entryPoints: [entry],
          bundle: true,
          write: true,
          outfile: bundlePath,
          platform: 'node',
          format: 'cjs',
          target: 'es2022',
          packages: 'external',
          sourcemap: false,
          logLevel: 'silent',
          absWorkingDir: cwd,
        });
        const { extractSchemas } = await import('../build/exec/cli-runtime/schema-extractor.js');
        const schema = await extractSchemas(bundlePath);
        const skills: PluginEmitterSkillInput[] = (schema.skillAssets ?? []).map((entry) => ({
          name: entry.skillName,
          description: `${entry.skillName} skill`,
          instructionFile: entry.instructionFile,
          resourceDirs: entry.resourceDirs,
        }));
        const commands: PluginEmitterCommandInput[] = (schema.prompts ?? []).map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments,
        }));
        return { skills, commands };
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch (err) {
      process.stderr.write(
        c(
          'yellow',
          `[install] could not enumerate skills/prompts from project (${(err as Error).message}); ` +
            `emitting plugin without them. Use the per-bin install (\`<bin> install -p claude\`) ` +
            `after \`frontmcp build:exec\` if you need the full set.\n`,
        ),
      );
      return { skills: [], commands: [] };
    }
  })();
  return cachedExtraction;
}

async function collectSkillsFromProject(): Promise<PluginEmitterSkillInput[]> {
  return (await getProjectExtraction(process.cwd())).skills;
}

async function collectPromptsFromProject(): Promise<PluginEmitterCommandInput[]> {
  return (await getProjectExtraction(process.cwd())).commands;
}

async function getCliVersion(): Promise<string> {
  try {
    const { readJSON } = await import('@frontmcp/utils');
    const pkg = (await readJSON(path.join(__dirname, '..', '..', '..', 'package.json'))) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function runClaudeInstall(args: {
  projectMeta: ProjectMeta;
  opts: InstallOptions;
  cliVersion: string;
  skills: PluginEmitterSkillInput[];
  commands: PluginEmitterCommandInput[];
}): Promise<void> {
  const destRoot = resolveDestRoot(args.opts);
  const emitOpts: EmitClaudePluginOptions = {
    destRoot,
    name: args.projectMeta.name,
    version: args.projectMeta.version,
    description: args.projectMeta.description,
    mcpCommand: args.opts.command ?? args.projectMeta.name,
    mcpArgs: ['serve', '--stdio'],
    envHints: args.opts.env ?? [],
    skills: args.skills,
    commands: args.commands,
    cliVersion: args.cliVersion,
    dryRun: args.opts.dryRun,
  };

  const result = await emitClaudePlugin(emitOpts);

  if (args.opts.dryRun) {
    process.stdout.write(`${c('cyan', '[install:claude] dry-run plan')}\n`);
    process.stdout.write(`  pluginDir: ${result.pluginDir}\n`);
    process.stdout.write(`  manifest: ${JSON.stringify(result.manifest, null, 2)}\n`);
    process.stdout.write(`  filesWritten (planned):\n`);
    for (const f of result.filesWritten) process.stdout.write(`    + ${f}\n`);
    return;
  }

  process.stdout.write(
    c(
      'green',
      `✓ Wrote ${result.pluginDir}/ (${args.skills.length} skills, ${args.commands.length} commands, 1 MCP server)\n`,
    ),
  );
  if (result.filesRemoved.length > 0) {
    process.stdout.write(`  Cleaned up ${result.filesRemoved.length} stale file(s) from previous install.\n`);
  }
  // Surface the dev-tool limitation explicitly: today this command only
  // emits the MCP server entry; per-project @Skill / @Prompt enumeration
  // is wired through the per-bin path (`<bin> install -p claude`). Don't
  // let users assume zero counts mean "your project has no skills".
  if (
    args.skills.length === 0 &&
    args.commands.length === 0 &&
    args.opts.skills !== false &&
    args.opts.commands !== false &&
    !args.opts.onlyMcp
  ) {
    process.stdout.write(
      c(
        'yellow',
        '  Note: the dev-tool path does not yet enumerate @Skill or @Prompt from project source.\n' +
          '  Build with `frontmcp build --target cli` and run `<bin> install -p claude` for full plugin coverage.\n',
      ),
    );
  }
  process.stdout.write(c('dim', '  Restart Claude Code (or run `/plugins reload`) to pick up the plugin.\n'));
}

async function runCodexInstall(args: {
  projectMeta: ProjectMeta;
  opts: InstallOptions;
  cliVersion: string;
}): Promise<void> {
  void args.cliVersion;
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  const env: Record<string, string> = {};
  for (const name of args.opts.env ?? []) env[name] = `\${${name}}`;
  const result = await emitCodexEntry({
    configPath,
    name: args.projectMeta.name,
    command: args.opts.command ?? args.projectMeta.name,
    args: ['serve', '--stdio'],
    env,
    dryRun: args.opts.dryRun,
  });

  if (args.opts.dryRun) {
    process.stdout.write(`${c('cyan', '[install:codex] dry-run plan')}\n`);
    process.stdout.write(`  configPath: ${configPath}\n`);
    process.stdout.write(`  configContent:\n${indentBlock(result.configContent, 4)}\n`);
    return;
  }

  process.stdout.write(c('green', `✓ Updated ${configPath} with [[mcp_servers]] entry for ${args.projectMeta.name}\n`));
}

async function printStatus(projectMeta: ProjectMeta, opts: InstallOptions): Promise<void> {
  process.stdout.write(`${c('bold', `${projectMeta.name} install --status`)}\n`);
  if (opts.claudePlugin || !opts.codex) {
    const destRoot = resolveDestRoot(opts);
    const pluginDir = path.join(destRoot, projectMeta.name);
    const installed = await readInstalledPluginVersion(pluginDir);
    if (installed) {
      const tag = installed === projectMeta.version ? 'installed' : 'outdated';
      process.stdout.write(
        `  claude:    ${tag} v${installed}${tag === 'outdated' ? ` (project at v${projectMeta.version})` : ''} at ${pluginDir}\n`,
      );
    } else {
      process.stdout.write(`  claude:    not installed at ${pluginDir}\n`);
    }
  }
  if (opts.codex) {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');
    const { fileExists, readFile } = await import('@frontmcp/utils');
    if (!(await fileExists(configPath))) {
      process.stdout.write(`  codex:     not installed (${configPath} does not exist)\n`);
    } else {
      const content = await readFile(configPath);
      const present = content.includes(`# frontmcp:codex-start:${projectMeta.name}`);
      process.stdout.write(
        present
          ? `  codex:     installed entry for ${projectMeta.name} in ${configPath}\n`
          : `  codex:     not installed in ${configPath}\n`,
      );
    }
  }
}

export async function runUninstallCurrentProject(rawOpts: Record<string, unknown>): Promise<void> {
  const opts = normalizeOptions(rawOpts);

  if (!opts.claudePlugin && !opts.codex) {
    process.stderr.write(c('red', 'Specify --claude and/or --codex.\n'));
    process.exit(1);
  }

  const projectMeta = await loadProjectMeta();
  if (!projectMeta) {
    process.stderr.write(c('red', 'No frontmcp.config found in this directory.\n'));
    process.exit(1);
  }

  if (opts.claudePlugin) {
    const destRoot = resolveDestRoot(opts);
    const result = await removeClaudePlugin({ destRoot, name: projectMeta.name });
    if (result.removed.length === 0) {
      process.stdout.write(c('dim', `  claude: nothing to remove at ${result.pluginDir}\n`));
    } else {
      process.stdout.write(c('green', `✓ Removed ${result.removed.length} file(s) from ${result.pluginDir}\n`));
    }
  }
  if (opts.codex) {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');
    const result = await removeCodexEntry({ configPath, name: projectMeta.name });
    if (result.removed) {
      process.stdout.write(c('green', `✓ Removed [[mcp_servers]] entry for ${projectMeta.name} from ${configPath}\n`));
    } else {
      process.stdout.write(c('dim', `  codex: no entry for ${projectMeta.name} in ${configPath}\n`));
    }
  }
}

function resolveDestRoot(opts: InstallOptions): string {
  if (opts.dir) return path.resolve(opts.dir);
  if (opts.scope === 'user') return path.join(os.homedir(), '.claude', 'plugins');
  return path.join(process.cwd(), '.claude', 'plugins');
}

function normalizeOptions(raw: Record<string, unknown>): InstallOptions {
  // Fail fast on bogus `--scope` values rather than silently coercing them to
  // 'project' — `--scope usr` would otherwise write files to the wrong root
  // (cwd's `.claude/plugins/` instead of `~/.claude/plugins/`) with no signal.
  const rawScope = raw['scope'];
  if (rawScope !== undefined && rawScope !== 'project' && rawScope !== 'user') {
    throw new Error(`Invalid --scope value: ${String(rawScope)}. Expected "project" or "user".`);
  }
  const scope: InstallOptions['scope'] = rawScope === 'user' ? 'user' : 'project';
  return {
    claudePlugin: raw['claudePlugin'] === true,
    codex: raw['codex'] === true,
    scope,
    skills: raw['skills'] !== false,
    commands: raw['commands'] !== false,
    onlyMcp: raw['onlyMcp'] === true,
    command: typeof raw['command'] === 'string' ? (raw['command'] as string) : undefined,
    env: Array.isArray(raw['env']) ? (raw['env'] as string[]) : [],
    dir: typeof raw['dir'] === 'string' ? (raw['dir'] as string) : undefined,
    dryRun: raw['dryRun'] === true,
    status: raw['status'] === true,
  };
}

function indentBlock(text: string, n: number): string {
  const pad = ' '.repeat(n);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}
