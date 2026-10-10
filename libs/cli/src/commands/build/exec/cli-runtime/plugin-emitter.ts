/**
 * Plugin emitter for issue #411 — turn a FrontMCP server's metadata into
 * a Claude Code plugin folder (`.claude/plugins/<bin>/`) or a Codex
 * `mcp_servers` entry. Shared by the dev-tool `frontmcp install` command
 * and the per-bin `<bin> install -p claude|codex` command.
 *
 * Design constraints (from planning/issues/411.md):
 *  - Pure helper module — no side-effects at import time.
 *  - All filesystem ops go through `@frontmcp/utils`.
 *  - Re-running install must be idempotent: managed files tracked in
 *    `_meta.frontmcp.managedFiles`; user-added files in the plugin
 *    directory are NEVER deleted.
 *  - Manifest written deterministically (sorted keys, fixed spacing) so
 *    snapshots are stable and re-runs are no-ops when nothing changed.
 *  - Codex emitter writes the `[mcp_servers.<name>]` table Codex reads,
 *    between frontmcp markers, without pulling in a TOML dependency.
 */

import * as path from 'path';

import {
  cp,
  ensureDir,
  fileExists,
  readdir,
  readFile,
  rm,
  writeFile,
} from '@frontmcp/utils';

import { composeSkillMd, readSkillInstructions } from './skill-md-compose';

// ============================================================================
// Public types
// ============================================================================

export interface PluginEmitterSkillInput {
  name: string;
  description: string;
  /**
   * Tags from `@Skill({ tags })`. Forwarded into the synthesized SKILL.md
   * frontmatter so Claude Code's filesystem loader can index by tag.
   */
  tags?: string[];
  /** License from `@Skill({ license })`. Forwarded into the synthesized frontmatter. */
  license?: string;
  /** Absolute path to SKILL.md. Takes precedence over `instructionContent`. */
  instructionFile?: string;
  /** Instruction text for skills with no source file (inline or URL-sourced). */
  instructionContent?: string;
  /** Absolute paths to the skill's resource subdirectories. */
  resourceDirs?: {
    references?: string;
    examples?: string;
    scripts?: string;
    assets?: string;
  };
}

export interface PluginEmitterCommandInput {
  /** Slash-command name without leading `/`. */
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface EmitClaudePluginOptions {
  /** Root dir under which `<name>/` will be created. */
  destRoot: string;
  name: string;
  version: string;
  description: string;
  /** MCP server invocation command (e.g. the bin name, or `node ./dist/main.js`). */
  mcpCommand: string;
  /** Typically `['serve', '--stdio']`. */
  mcpArgs: string[];
  /** Env-var names (placeholder values) to surface in `mcpServers.<bin>.env`. */
  envHints: string[];
  skills: PluginEmitterSkillInput[];
  commands: PluginEmitterCommandInput[];
  /** Used for `_meta.frontmcp.installedBy`. */
  cliVersion: string;
  /** If true: plan only, do not write. */
  dryRun?: boolean;
}

export interface EmitClaudePluginResult {
  pluginDir: string;
  manifest: ClaudePluginManifest;
  /** Absolute paths written (or that WOULD be written when dryRun). */
  filesWritten: string[];
  /** Absolute paths of pre-existing user files left in place. */
  filesPreserved: string[];
  /** Managed files from a previous install that were removed this run. */
  filesRemoved: string[];
  /** Skills left out because they had no instructions to install. */
  skillsSkipped: Array<{ name: string; reason: string }>;
}

export interface ClaudePluginManifest {
  name: string;
  version: string;
  description: string;
  mcpServers: Record<string, McpServerEntry>;
  skills: string[];
  commands?: string[];
  _meta: {
    frontmcp: {
      installedBy: string;
      installedAt: string;
      bin: string;
      binVersion: string;
      managedFields: string[];
      managedFiles: string[];
    };
  };
}

export interface McpServerEntry {
  command: string;
  args: string[];
  transport?: 'stdio';
  env?: Record<string, string>;
}

export interface EmitCodexOptions {
  /** `~/.codex/config.toml` typically. */
  configPath: string;
  name: string;
  command: string;
  args: string[];
  /** Env-var names Codex forwards from its own environment (`env_vars`). */
  envVars?: string[];
  dryRun?: boolean;
}

export interface McpInvocation {
  command: string;
  args: string[];
}

export interface SelfInvocationInput {
  /** `process.argv[1]`: how the running bin was started. */
  invokedPath: string;
  /** `process.execPath`: node, or the single executable itself. */
  execPath: string;
  /** The CLI bundle file for a JS bin; undefined for a single executable. */
  scriptPath?: string;
  /** `process.env.PATH`. */
  pathEnv?: string;
  /** Arguments that start the MCP server (typically `['serve', '--stdio']`). */
  args: string[];
}

export interface EmitCodexResult {
  written: boolean;
  previousVersion?: string;
  /** Final TOML content (or what would be written when dryRun). */
  configContent: string;
}

// ============================================================================
// Claude plugin emitter
// ============================================================================

/**
 * Validate a plugin name before it touches the filesystem or TOML blocks.
 * Rejects anything that could traverse out of the destination directory,
 * inject newlines into the codex block markers (`# frontmcp:codex-start:<name>`
 * / `# frontmcp:codex-end:<name>` — finding from #411 review), or smuggle
 * TOML-significant characters past the `tomlString` quoting.
 *
 * The allowed set is intentionally narrow — npm-style scoped names
 * (`@scope/name`) are NOT allowed since the `@` and `/` characters would
 * still produce surprising directory layouts. Callers that need scoped
 * names should sanitise first.
 */
/**
 * Validate a slash-command name (frontmatter / body content). Same rules
 * as `assertValidPluginName` so a malicious command name cannot inject
 * YAML directives or new markdown sections via interpolated body text
 * in `renderCommandFile`.
 */
export function assertValidCommandName(name: string, where: string): void {
  assertValidPluginName(name, where);
}

export function assertValidPluginName(name: string, where: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`Invalid plugin name passed to ${where}: must be a non-empty string`);
  }
  if (name.length > 64) {
    throw new Error(`Invalid plugin name "${name}" passed to ${where}: must be 64 chars or fewer`);
  }
  if (name === '.' || name === '..') {
    throw new Error(`Invalid plugin name "${name}" passed to ${where}: must not be "." or ".."`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new Error(
      `Invalid plugin name "${name}" passed to ${where}: must match /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/ (no slashes, newlines, or special chars)`,
    );
  }
}

/**
 * Returns true when `rel` resolves to a path strictly inside `pluginDir`.
 * Defends `emitClaudePlugin` and `removeClaudePlugin` against a tampered
 * prior `plugin.json` whose `_meta.frontmcp.managedFiles` entries try to
 * escape the plugin root with `../` traversals or absolute paths.
 */
export function isPluginContainedPath(pluginDir: string, rel: string): boolean {
  if (typeof rel !== 'string' || rel.length === 0) return false;
  if (path.isAbsolute(rel)) return false;
  const resolved = path.resolve(pluginDir, rel);
  const relative = path.relative(pluginDir, resolved);
  if (relative === '') return false; // never delete the plugin dir itself via a managedFile entry
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

const FRAMEWORK_MANAGED_FIELDS = [
  'name',
  'version',
  'description',
  'mcpServers',
  'skills',
  'commands',
  '_meta.frontmcp',
];

export async function emitClaudePlugin(opts: EmitClaudePluginOptions): Promise<EmitClaudePluginResult> {
  assertValidPluginName(opts.name, 'emitClaudePlugin');
  const pluginDir = path.join(opts.destRoot, opts.name);
  const claudePluginDir = path.join(pluginDir, '.claude-plugin');
  const manifestPath = path.join(claudePluginDir, 'plugin.json');

  // Read prior manifest (idempotency baseline) — file may not exist on first install.
  const previousManifest = await readPluginManifest(manifestPath);
  const previouslyManaged = previousManifest?._meta?.frontmcp?.managedFiles ?? [];

  // Build the new file plan in deterministic order.
  const plannedFiles: Array<{ absPath: string; relPath: string; action: () => Promise<void> }> = [];

  // Skills subtree. Validate the name before it lands in a filesystem
  // path or in synthesized SKILL.md frontmatter — same rules as command
  // names (issue #411 security pass), so a malicious `@Skill({ name: '../x' })`
  // can't escape the plugin tree.
  const skillsSkipped: EmitClaudePluginResult['skillsSkipped'] = [];
  const installedSkillNames: string[] = [];
  for (const skill of [...opts.skills].sort((a, b) => a.name.localeCompare(b.name))) {
    assertValidPluginName(skill.name, 'emitClaudePlugin.skill');
    const instructions = await readSkillInstructions(skill);
    if ('skipReason' in instructions) {
      skillsSkipped.push({ name: skill.name, reason: instructions.skipReason });
      continue;
    }
    installedSkillNames.push(skill.name);
    const skillDir = path.join(pluginDir, 'skills', skill.name);
    const skillMd = path.join(skillDir, 'SKILL.md');
    plannedFiles.push({
      absPath: skillMd,
      relPath: path.relative(pluginDir, skillMd),
      action: async () => {
        await ensureDir(skillDir);
        // The instruction file is typically a raw markdown body authored by
        // the user; Claude Code's filesystem loader needs YAML frontmatter
        // with at least `name` + `description`. composeSkillMd preserves a
        // pre-existing frontmatter block verbatim and otherwise synthesizes
        // one from the decorator metadata we plumbed through bin-meta.json.
        await writeFile(
          skillMd,
          composeSkillMd(
            { name: skill.name, description: skill.description, tags: skill.tags, license: skill.license },
            instructions.body,
          ),
        );
      },
    });
    for (const kind of ['references', 'examples', 'scripts', 'assets'] as const) {
      const src = skill.resourceDirs?.[kind];
      if (!src) continue;
      const dest = path.join(skillDir, kind);
      plannedFiles.push({
        absPath: dest,
        relPath: path.relative(pluginDir, dest),
        action: async () => {
          await ensureDir(skillDir);
          if (await fileExists(src)) {
            await cp(src, dest, { recursive: true });
          }
        },
      });
    }
  }

  // Commands subtree. Validate each command name before it lands in the
  // markdown body or the filesystem path — same rules as the plugin name.
  for (const cmd of [...opts.commands].sort((a, b) => a.name.localeCompare(b.name))) {
    assertValidCommandName(cmd.name, 'emitClaudePlugin.command');
    const cmdPath = path.join(pluginDir, 'commands', `${cmd.name}.md`);
    plannedFiles.push({
      absPath: cmdPath,
      relPath: path.relative(pluginDir, cmdPath),
      action: async () => {
        await ensureDir(path.dirname(cmdPath));
        await writeFile(cmdPath, renderCommandFile(cmd, opts.name));
      },
    });
  }

  // Build the manifest. Manifest is itself a managed file and appears last in
  // managedFiles so removal-on-uninstall happens after subtree cleanup.
  const newManagedFiles = plannedFiles.map((f) => f.relPath).sort();
  const manifest: ClaudePluginManifest = {
    name: opts.name,
    version: opts.version,
    description: opts.description,
    mcpServers: {
      [opts.name]: makeMcpServerEntry(opts),
    },
    skills: installedSkillNames,
    ...(opts.commands.length > 0 ? { commands: opts.commands.map((c) => c.name).sort() } : {}),
    _meta: {
      frontmcp: {
        installedBy: `frontmcp@${opts.cliVersion}`,
        installedAt: new Date().toISOString(),
        bin: opts.name,
        binVersion: opts.version,
        managedFields: [...FRAMEWORK_MANAGED_FIELDS].sort(),
        managedFiles: newManagedFiles,
      },
    },
  };

  // Merge any user-owned top-level keys back in from the previous manifest.
  const mergedManifest = mergeUserManifestFields(manifest, previousManifest);

  // Compute the file delta. We don't `rm -rf` the plugin dir; we only:
  //   1. Remove previously-managed files that are no longer in newManagedFiles.
  //   2. Write/overwrite the new managed files.
  //   3. Write the manifest.
  const previousSet = new Set(previouslyManaged);
  const newSet = new Set(newManagedFiles);
  const removed: string[] = [];
  const written: string[] = [];

  if (!opts.dryRun) {
    await ensureDir(claudePluginDir);
    // 1. Drop stale managed files. Guard against a tampered prior manifest
    // that may have injected escape-paths into `managedFiles`.
    for (const rel of previousSet) {
      if (newSet.has(rel)) continue;
      if (!isPluginContainedPath(pluginDir, rel)) continue;
      const abs = path.join(pluginDir, rel);
      if (await fileExists(abs)) {
        await rm(abs, { recursive: true, force: true });
        removed.push(abs);
      }
    }
    // 2. Write new/refreshed managed files.
    for (const f of plannedFiles) {
      await f.action();
      written.push(f.absPath);
    }
    // 3. Manifest.
    await writeFile(manifestPath, serializeManifest(mergedManifest));
    written.push(manifestPath);
  } else {
    written.push(...plannedFiles.map((f) => f.absPath), manifestPath);
  }

  const preserved = previousManifest
    ? Object.keys(previousManifest)
        .filter((k) => !FRAMEWORK_MANAGED_FIELDS.includes(k) && k !== '_meta')
        .map((k) => `<plugin.json>.${k}`)
    : [];

  return {
    pluginDir,
    manifest: mergedManifest,
    filesWritten: written,
    filesPreserved: preserved,
    filesRemoved: removed,
    skillsSkipped,
  };
}

export async function removeClaudePlugin(args: {
  destRoot: string;
  name: string;
}): Promise<{ removed: string[]; preserved: string[]; pluginDir: string }> {
  assertValidPluginName(args.name, 'removeClaudePlugin');
  const pluginDir = path.join(args.destRoot, args.name);
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  const manifest = await readPluginManifest(manifestPath);
  const removed: string[] = [];
  const preserved: string[] = [];

  if (!manifest) {
    return { removed, preserved, pluginDir };
  }

  // A tampered `plugin.json` could have injected paths like `../../etc/foo`
  // into `_meta.frontmcp.managedFiles` to coerce `rm` outside `pluginDir`
  // on uninstall. Guard each entry against escaping the plugin root.
  const managed = manifest._meta?.frontmcp?.managedFiles ?? [];
  for (const rel of managed) {
    if (!isPluginContainedPath(pluginDir, rel)) continue;
    const abs = path.join(pluginDir, rel);
    if (await fileExists(abs)) {
      await rm(abs, { recursive: true, force: true });
      removed.push(abs);
    }
  }
  if (await fileExists(manifestPath)) {
    await rm(manifestPath, { force: true });
    removed.push(manifestPath);
  }

  // Bottom-up empty-dir cleanup. Stops at first non-empty dir, preserving
  // user-added files.
  await cleanupEmptyDirs(pluginDir, preserved);

  return { removed, preserved, pluginDir };
}

export async function readInstalledPluginVersion(pluginDir: string): Promise<string | undefined> {
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  const manifest = await readPluginManifest(manifestPath);
  return manifest?._meta?.frontmcp?.binVersion;
}

// ============================================================================
// Codex emitter
// ============================================================================

const CODEX_BLOCK_START = '# frontmcp:codex-start';
const CODEX_BLOCK_END = '# frontmcp:codex-end';

export async function emitCodexEntry(opts: EmitCodexOptions): Promise<EmitCodexResult> {
  assertValidPluginName(opts.name, 'emitCodexEntry');
  const existing = (await fileExists(opts.configPath)) ? await readFile(opts.configPath) : '';
  const migrated = migrateLegacyCodexBlocks(existing);
  assertNoUnmanagedCodexTable(migrated, opts.name, opts.configPath);
  const previousVersion = extractCodexEntryComment(existing, opts.name);
  const newBlock = renderCodexBlock(opts);
  const merged = replaceCodexBlock(migrated, opts.name, newBlock);

  if (!opts.dryRun) {
    await ensureDir(path.dirname(opts.configPath));
    await writeFile(opts.configPath, merged);
  }

  return {
    written: !opts.dryRun,
    previousVersion,
    configContent: merged,
  };
}

export async function removeCodexEntry(args: {
  configPath: string;
  name: string;
}): Promise<{ removed: boolean; configContent: string }> {
  assertValidPluginName(args.name, 'removeCodexEntry');
  if (!(await fileExists(args.configPath))) {
    return { removed: false, configContent: '' };
  }
  const existing = await readFile(args.configPath);
  const migrated = migrateLegacyCodexBlocks(existing);
  const stripped = stripCodexBlock(migrated, args.name);
  if (stripped !== existing) {
    await writeFile(args.configPath, stripped);
  }
  return { removed: stripped !== migrated, configContent: stripped };
}

/**
 * Split a `--command` value into program and arguments the way a shell does:
 * whitespace separates words, and single or double quotes group them.
 */
export function splitCommandLine(commandLine: string): string[] {
  const words: string[] = [];
  let currentWord = '';
  let inWord = false;
  let openQuote: string | undefined;
  for (const char of commandLine) {
    if (openQuote) {
      if (char === openQuote) {
        openQuote = undefined;
      } else {
        currentWord += char;
      }
    } else if (char === '"' || char === "'") {
      openQuote = char;
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) {
        words.push(currentWord);
        currentWord = '';
        inWord = false;
      }
    } else {
      currentWord += char;
      inWord = true;
    }
  }
  if (openQuote) {
    throw new Error(`Unterminated ${openQuote} quote in --command: ${commandLine}`);
  }
  if (inWord) {
    words.push(currentWord);
  }
  if (words.length === 0) {
    throw new Error('--command must name the program that starts the MCP server');
  }
  return words;
}

/**
 * The MCP server invocation for a `--command` value. A lone program keeps the
 * default arguments; a program followed by arguments replaces them.
 */
export function applyCommandOverride(commandLine: string, defaultArgs: string[]): McpInvocation {
  const [command, ...args] = splitCommandLine(commandLine);
  return { command, args: args.length > 0 ? args : defaultArgs };
}

/**
 * The MCP server invocation that starts the running bin again. A bin started
 * by name from a `PATH` directory is written by that name, so the entry stays
 * portable; anything else (a `dist/` folder, npx's cache) gets absolute paths.
 */
export function resolveSelfInvocation(input: SelfInvocationInput): McpInvocation {
  const binName = path.basename(input.invokedPath);
  const pathDirs = (input.pathEnv ?? '')
    .split(path.delimiter)
    .filter((dir) => dir.length > 0 && !isNodeModulesBinDir(dir))
    .map((dir) => path.resolve(dir));
  const startedByBareName = binName === input.invokedPath;
  const startedFromPathDir = pathDirs.includes(path.resolve(path.dirname(input.invokedPath)));
  if (startedByBareName || startedFromPathDir) {
    return { command: binName, args: input.args };
  }
  if (input.scriptPath) {
    return { command: input.execPath, args: [input.scriptPath, ...input.args] };
  }
  return { command: input.execPath, args: input.args };
}

function isNodeModulesBinDir(dir: string): boolean {
  return path.basename(dir) === '.bin' && path.basename(path.dirname(dir)) === 'node_modules';
}

// ============================================================================
// Internals
// ============================================================================

function makeMcpServerEntry(opts: EmitClaudePluginOptions): McpServerEntry {
  const entry: McpServerEntry = {
    command: opts.mcpCommand,
    args: opts.mcpArgs,
    transport: 'stdio',
  };
  if (opts.envHints.length > 0) {
    const env: Record<string, string> = {};
    for (const name of opts.envHints.slice().sort()) {
      env[name] = `\${${name}}`;
    }
    entry.env = env;
  }
  return entry;
}

async function readPluginManifest(manifestPath: string): Promise<ClaudePluginManifest | undefined> {
  if (!(await fileExists(manifestPath))) return undefined;
  try {
    const raw = await readFile(manifestPath);
    return JSON.parse(raw) as ClaudePluginManifest;
  } catch {
    return undefined;
  }
}

function mergeUserManifestFields(
  next: ClaudePluginManifest,
  previous: ClaudePluginManifest | undefined,
): ClaudePluginManifest {
  if (!previous) return next;
  const out = { ...next } as Record<string, unknown>;
  // Preserve user-added entries in mcpServers other than the framework-owned one.
  if (previous.mcpServers && typeof previous.mcpServers === 'object') {
    const mergedMcp: Record<string, McpServerEntry> = { ...next.mcpServers };
    for (const [k, v] of Object.entries(previous.mcpServers)) {
      if (k !== next.name) mergedMcp[k] = v;
    }
    out.mcpServers = sortObjectKeys(mergedMcp);
  }
  // Preserve any unknown top-level key the user added.
  for (const [k, v] of Object.entries(previous)) {
    if (!FRAMEWORK_MANAGED_FIELDS.includes(k) && k !== '_meta' && !(k in out)) {
      out[k] = v;
    }
  }
  return out as unknown as ClaudePluginManifest;
}

function serializeManifest(manifest: ClaudePluginManifest): string {
  return JSON.stringify(sortObjectKeys(manifest), null, 2) + '\n';
}

function sortObjectKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => sortObjectKeys(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
    }
    return sorted as unknown as T;
  }
  return value;
}

function renderCommandFile(cmd: PluginEmitterCommandInput, binName: string): string {
  const args = cmd.arguments ?? [];
  const argHint = args
    .map((a) => (a.required === false ? `[${a.name}]` : `<${a.name}>`))
    .join(' ');
  const fm = ['---'];
  if (cmd.description) fm.push(`description: ${JSON.stringify(cmd.description)}`);
  if (argHint) fm.push(`argument-hint: ${JSON.stringify(argHint)}`);
  fm.push('---', '');
  const body = [
    `Invokes the MCP prompt \`${cmd.name}\` from the \`${binName}\` server.`,
    '',
    `See \`${binName} prompt get ${cmd.name}\` for the latest argument list.`,
    '',
  ];
  return fm.join('\n') + '\n' + body.join('\n');
}

/**
 * Bottom-up empty-directory cleanup after `removeClaudePlugin`. We only
 * remove a directory when:
 *   1. it's a framework-managed directory we know we created
 *      (`commands/`, `skills/`, `skills/<name>/`, `.claude-plugin/`,
 *      and the plugin root itself), AND
 *   2. it is empty (`readdir` returns []).
 *
 * Any user-added file under those dirs blocks the cleanup at that level
 * and bubbles all the way up — so a single user file anywhere in the
 * plugin tree leaves the entire tree (and the plugin dir itself) intact.
 * We never traverse INTO user-added subdirs.
 */
async function cleanupEmptyDirs(root: string, _preserved: string[]): Promise<void> {
  if (!(await fileExists(root))) return;
  // `readdir` and `rm` are imported statically at the top of this module so
  // the file bundles cleanly into the per-bin CLI (esbuild can't resolve
  // `await import('@frontmcp/utils')` inside a CJS bundle, which manifests
  // as a runtime "Dynamic require of fs is not supported" error when the
  // bin's own `uninstall -p claude` walks the plugin tree).

  // Pass 1: each per-skill folder under skills/ (one level deep).
  const skillsDir = path.join(root, 'skills');
  if (await fileExists(skillsDir)) {
    for (const entry of await safeReaddir(readdir, skillsDir)) {
      const sub = path.join(skillsDir, entry);
      await removeIfEmpty(sub, rm, readdir);
    }
  }

  // Pass 2: framework-managed dirs directly under the plugin root.
  for (const sub of ['commands', 'skills', '.claude-plugin']) {
    await removeIfEmpty(path.join(root, sub), rm, readdir);
  }

  // Pass 3: the plugin root itself (only if user added nothing).
  await removeIfEmpty(root, rm, readdir);
}

async function removeIfEmpty(
  dir: string,
  rmFn: (p: string, opts?: { recursive?: boolean; force?: boolean }) => Promise<void>,
  readdirFn: (p: string) => Promise<string[]>,
): Promise<void> {
  if (!(await fileExists(dir))) return;
  const entries = await safeReaddir(readdirFn, dir);
  if (entries.length === 0) {
    await rmFn(dir, { recursive: true, force: true });
  }
}

async function safeReaddir(
  readdirFn: (p: string) => Promise<string[]>,
  dir: string,
): Promise<string[]> {
  try {
    return await readdirFn(dir);
  } catch {
    return [];
  }
}

// ----- Codex TOML -----

const MANAGED_CODEX_BLOCK = /^# frontmcp:codex-start:(\S+)\r?\n([\s\S]*?)^# frontmcp:codex-end:\1\r?$/gm;

function renderCodexBlock(opts: EmitCodexOptions): string {
  const lines = [
    `${CODEX_BLOCK_START}:${opts.name}`,
    `[mcp_servers.${tomlBareKey(opts.name)}]`,
    `command = ${tomlString(opts.command)}`,
    `args = [${opts.args.map(tomlString).join(', ')}]`,
  ];
  const envVars = [...new Set(opts.envVars ?? [])].sort();
  if (envVars.length > 0) {
    lines.push(`env_vars = [${envVars.map(tomlString).join(', ')}]`);
  }
  lines.push(`${CODEX_BLOCK_END}:${opts.name}`);
  return lines.join('\n');
}

/**
 * Rewrite blocks written by frontmcp 1.9.4 and earlier, which used the
 * `[[mcp_servers]]` array shape Codex refuses, into `[mcp_servers.<name>]`.
 * Only text between frontmcp's own markers is touched.
 */
function migrateLegacyCodexBlocks(content: string): string {
  return content.replace(MANAGED_CODEX_BLOCK, (block: string, name: string, body: string) => {
    if (!/^\[\[mcp_servers\]\]/m.test(body)) return block;
    const migratedBody = body
      .replace(/^\[\[mcp_servers\]\]/m, `[mcp_servers.${tomlBareKey(name)}]`)
      .replace(/^name = .*\r?\n/m, '');
    return block.replace(body, () => migratedBody);
  });
}

function assertNoUnmanagedCodexTable(content: string, name: string, configPath: string): void {
  const unmanaged = content.replace(MANAGED_CODEX_BLOCK, '');
  const key = name.replace(/\./g, '\\.');
  const tableHeader = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:${key}|"${key}"|'${key}')\\s*[\\].]`, 'm');
  if (tableHeader.test(unmanaged)) {
    throw new Error(
      `${configPath} already defines [mcp_servers.${tomlBareKey(name)}] outside the frontmcp markers. ` +
        `Remove that table from ${configPath} (or rename the server in frontmcp.config), then run install again.`,
    );
  }
}

function replaceCodexBlock(existing: string, name: string, newBlock: string): string {
  const start = `${CODEX_BLOCK_START}:${name}`;
  const end = `${CODEX_BLOCK_END}:${name}`;
  const startIdx = findMarkerLine(existing, start);
  if (startIdx === -1) {
    // Normalize the existing content to end in exactly one newline before
    // appending the new block, so we don't double-up on first insert.
    const normalized = existing.length === 0 ? '' : existing.replace(/\n*$/, '\n');
    const sep = normalized.length === 0 ? '' : '\n';
    return `${normalized}${sep}${newBlock}\n`;
  }
  const endIdx = findMarkerLine(existing, end, startIdx);
  if (endIdx === -1) {
    // Corrupt block — treat as missing and append fresh.
    return `${existing.replace(/\n*$/, '\n')}\n${newBlock}\n`;
  }
  const before = existing.slice(0, startIdx);
  const after = existing.slice(endIdx + end.length).replace(/^\n/, '');
  return `${before}${newBlock}\n${after}`;
}

function stripCodexBlock(existing: string, name: string): string {
  const start = `${CODEX_BLOCK_START}:${name}`;
  const end = `${CODEX_BLOCK_END}:${name}`;
  const startIdx = findMarkerLine(existing, start);
  if (startIdx === -1) return existing;
  const endIdx = findMarkerLine(existing, end, startIdx);
  if (endIdx === -1) return existing;
  const before = existing.slice(0, startIdx).replace(/\n+$/, '\n');
  const after = existing.slice(endIdx + end.length).replace(/^\n+/, '\n');
  return (before + after).replace(/\n{3,}/g, '\n\n');
}

/** Index of the line that is exactly `marker`, so `help` never matches `help-desk`'s marker. */
function findMarkerLine(content: string, marker: string, fromIndex = 0): number {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markerLine = new RegExp(`^${escapedMarker}\\r?$`, 'gm');
  markerLine.lastIndex = fromIndex;
  return markerLine.exec(content)?.index ?? -1;
}

function extractCodexEntryComment(content: string, name: string): string | undefined {
  // Optional: look for an `# version:` comment inside the block; for now we
  // just return undefined since the block itself doesn't carry a version.
  void content;
  void name;
  return undefined;
}

function tomlString(value: string): string {
  // Basic strings: escape backslash + double-quote, encode common control chars.
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

function tomlBareKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}
