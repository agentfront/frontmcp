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

import { ensureDir, fileExists, readdir, readFile, rm, writeFile } from '@frontmcp/utils';

import {
  applyPlan,
  isPluginContainedPath,
  planSkills,
  refreshBundleSkills,
  removeIfEmpty,
  type BundleRefreshResult,
  type InstalledBundleSkills,
  type PlannedFile,
  type SkillPlan,
  type SkillTreeLayout,
  type SkillTreeRecord,
} from './skill-tree';

export { isPluginContainedPath };

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

/** A Skilled OpenAPI skill read from the running server, with the SKILL.md written for it. */
export interface PluginEmitterBundleSkillInput {
  id: string;
  /** The skill's name in the bundle, which its folder is named after. */
  name: string;
  skillMd: string;
}

/** The bundle skills an install writes, and the bundle version they were read from. */
export interface PluginEmitterBundleSkills {
  bundleVersion?: string;
  skills: PluginEmitterBundleSkillInput[];
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
  /** The server's own skills, from the metadata the build recorded. */
  skills: PluginEmitterSkillInput[];
  /** The Skilled OpenAPI bundle's skills, read from the running server; left out for a server without the plugin. */
  bundleSkills?: PluginEmitterBundleSkills;
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
  shippedSkills: string[];
  /** Each bundle skill's name and the folder it was written to. */
  bundleSkills: Array<{ name: string; folder: string }>;
}

export interface RefreshBundleSkillsOptions {
  /** The root the plugin (Claude) or the skills folder (Codex) was installed under. */
  destRoot: string;
  name: string;
  bundleSkills: PluginEmitterBundleSkills;
  dryRun?: boolean;
}

export interface RefreshBundleSkillsResult extends BundleRefreshResult {
  /** The folder holding the skills: the plugin folder, or the Codex skills folder. */
  installDir: string;
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
      bundleSkills?: InstalledBundleSkills;
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

  // Skills subtree. A shipped skill's name is validated before it lands in a filesystem path or in synthesized
  // SKILL.md frontmatter (issue #411 security pass), so a malicious `@Skill({ name: '../x' })` can't escape the
  // plugin tree; a bundle skill's folder is named from its name in kebab-case.
  const layout: SkillTreeLayout = { root: pluginDir, skillsDir: path.join(pluginDir, 'skills') };
  const skillPlan = await planSkills(layout, opts.skills, opts.bundleSkills?.skills, (name) =>
    assertValidPluginName(name, 'emitClaudePlugin.skill'),
  );
  const plannedFiles: PlannedFile[] = [...skillPlan.files];

  // Commands subtree. Validate each command name before it lands in the
  // markdown body or the filesystem path — same rules as the plugin name.
  for (const cmd of [...opts.commands].sort((a, b) => a.name.localeCompare(b.name))) {
    assertValidCommandName(cmd.name, 'emitClaudePlugin.command');
    const cmdPath = path.join(pluginDir, 'commands', `${cmd.name}.md`);
    plannedFiles.push({
      absPath: cmdPath,
      relPath: path.relative(pluginDir, cmdPath),
      write: async () => {
        await ensureDir(path.dirname(cmdPath));
        await writeFile(cmdPath, renderCommandFile(cmd, opts.name));
      },
    });
  }

  // Build the manifest. Manifest is itself a managed file and appears last in
  // managedFiles so removal-on-uninstall happens after subtree cleanup.
  const record = skillRecordOf(skillPlan, plannedFiles, opts.bundleSkills);
  const manifest: ClaudePluginManifest = {
    name: opts.name,
    version: opts.version,
    description: opts.description,
    mcpServers: {
      [opts.name]: makeMcpServerEntry(opts),
    },
    skills: record.skills,
    ...(opts.commands.length > 0 ? { commands: opts.commands.map((c) => c.name).sort() } : {}),
    _meta: {
      frontmcp: {
        installedBy: `frontmcp@${opts.cliVersion}`,
        installedAt: new Date().toISOString(),
        bin: opts.name,
        binVersion: opts.version,
        managedFields: [...FRAMEWORK_MANAGED_FIELDS].sort(),
        managedFiles: record.managedFiles,
        ...(record.bundleSkills && { bundleSkills: record.bundleSkills }),
      },
    },
  };

  // Merge any user-owned top-level keys back in from the previous manifest.
  const mergedManifest = mergeUserManifestFields(manifest, previousManifest);

  // We don't `rm -rf` the plugin dir; we only remove previously-managed files that are no longer planned (and the
  // skill folders that leaves empty), write the planned files, then the manifest.
  let written: string[];
  let removed: string[] = [];
  if (!opts.dryRun) {
    await ensureDir(claudePluginDir);
    ({ written, removed } = await applyPlan(layout, previouslyManaged, plannedFiles));
    await writeFile(manifestPath, serializeManifest(mergedManifest));
    written.push(manifestPath);
  } else {
    written = [...plannedFiles.map((f) => f.absPath), manifestPath];
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
    skillsSkipped: skillPlan.skillsSkipped,
    shippedSkills: skillPlan.shippedSkills,
    bundleSkills: skillPlan.bundleSkills,
  };
}

/**
 * Rewrite the bundle skills of an installed Claude plugin from the bundle the server has now: write each again, add
 * new ones, and remove the folders of skills it no longer gives. The shipped skills, the commands and the MCP server
 * entry are left as installed.
 */
export async function refreshClaudeBundleSkills(opts: RefreshBundleSkillsOptions): Promise<RefreshBundleSkillsResult> {
  assertValidPluginName(opts.name, 'refreshClaudeBundleSkills');
  const pluginDir = path.join(opts.destRoot, opts.name);
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  const manifest = await readPluginManifest(manifestPath);
  if (!manifest) {
    throw new Error(`No Claude plugin is installed at ${pluginDir}: run "${opts.name} install -p claude" first`);
  }
  const layout: SkillTreeLayout = { root: pluginDir, skillsDir: path.join(pluginDir, 'skills') };
  const refreshed = await refreshBundleSkills(layout, claudeSkillRecord(manifest), opts.bundleSkills, !!opts.dryRun);
  if (!opts.dryRun) {
    const frontmcp = { ...manifest._meta.frontmcp, managedFiles: refreshed.record.managedFiles, bundleSkills: refreshed.record.bundleSkills };
    await writeFile(
      manifestPath,
      serializeManifest({ ...manifest, skills: refreshed.record.skills, _meta: { ...manifest._meta, frontmcp } }),
    );
  }
  return { installDir: pluginDir, ...refreshed.result };
}

/** The skills an installed Claude plugin holds, by kind; undefined when none is installed there. */
export async function readClaudePluginSkills(pluginDir: string): Promise<SkillTreeRecord | undefined> {
  const manifest = await readPluginManifest(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
  return manifest ? claudeSkillRecord(manifest) : undefined;
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
  await cleanupEmptyDirs(pluginDir);

  return { removed, preserved, pluginDir };
}

export async function readInstalledPluginVersion(pluginDir: string): Promise<string | undefined> {
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  const manifest = await readPluginManifest(manifestPath);
  return manifest?._meta?.frontmcp?.binVersion;
}

// ============================================================================
// Codex skills
// ============================================================================

/** The file in a server's Codex skills folder that records what an install wrote there; Codex skips dot-files. */
const CODEX_SKILLS_RECORD = '.frontmcp.json';

export interface EmitCodexSkillsOptions {
  /** The Codex skills folder: `.codex/skills` in the project, or `~/.codex/skills`. */
  destRoot: string;
  name: string;
  version: string;
  cliVersion: string;
  /** The server's own skills, from the metadata the build recorded. */
  skills: PluginEmitterSkillInput[];
  /** The Skilled OpenAPI bundle's skills, read from the running server; left out for a server without the plugin. */
  bundleSkills?: PluginEmitterBundleSkills;
  dryRun?: boolean;
}

export interface EmitCodexSkillsResult {
  /** `<destRoot>/<name>`: the folder holding the server's skills. */
  skillsDir: string;
  filesWritten: string[];
  filesRemoved: string[];
  skillsSkipped: Array<{ name: string; reason: string }>;
  shippedSkills: string[];
  bundleSkills: Array<{ name: string; folder: string }>;
}

interface CodexSkillsRecord extends SkillTreeRecord {
  installedBy: string;
  bin: string;
  binVersion: string;
}

/**
 * Write the server's skills where Codex finds them, as `<destRoot>/<name>/<skill>/SKILL.md`: the shipped skills and
 * the bundle skills, recorded in `<destRoot>/<name>/.frontmcp.json` so a reinstall removes only what it wrote.
 */
export async function emitCodexSkills(opts: EmitCodexSkillsOptions): Promise<EmitCodexSkillsResult> {
  assertValidPluginName(opts.name, 'emitCodexSkills');
  const layout = codexSkillsLayout(opts.destRoot, opts.name);
  const previous = await readCodexSkillsRecord(layout.root);
  const plan = await planSkills(layout, opts.skills, opts.bundleSkills?.skills, (name) =>
    assertValidPluginName(name, 'emitCodexSkills.skill'),
  );
  const result: EmitCodexSkillsResult = {
    skillsDir: layout.root,
    filesWritten: plan.files.map((file) => file.absPath),
    filesRemoved: [],
    skillsSkipped: plan.skillsSkipped,
    shippedSkills: plan.shippedSkills,
    bundleSkills: plan.bundleSkills,
  };
  if (opts.dryRun || (plan.files.length === 0 && !previous)) return result;
  const applied = await applyPlan(layout, previous?.managedFiles ?? [], plan.files);
  await writeCodexSkillsRecord(layout.root, {
    installedBy: `frontmcp@${opts.cliVersion}`,
    bin: opts.name,
    binVersion: opts.version,
    ...skillRecordOf(plan, plan.files, opts.bundleSkills),
  });
  return { ...result, filesWritten: applied.written, filesRemoved: applied.removed };
}

/** {@link refreshClaudeBundleSkills} for the skills an install wrote for Codex. */
export async function refreshCodexBundleSkills(opts: RefreshBundleSkillsOptions): Promise<RefreshBundleSkillsResult> {
  assertValidPluginName(opts.name, 'refreshCodexBundleSkills');
  const layout = codexSkillsLayout(opts.destRoot, opts.name);
  const previous = await readCodexSkillsRecord(layout.root);
  if (!previous) {
    throw new Error(`No Codex skills are installed at ${layout.root}: run "${opts.name} install -p codex" first`);
  }
  const refreshed = await refreshBundleSkills(layout, previous, opts.bundleSkills, !!opts.dryRun);
  if (!opts.dryRun) await writeCodexSkillsRecord(layout.root, { ...previous, ...refreshed.record });
  return { installDir: layout.root, ...refreshed.result };
}

/** Remove the skills an install wrote for Codex, leaving files someone else added there. */
export async function removeCodexSkills(args: {
  destRoot: string;
  name: string;
}): Promise<{ removed: string[]; skillsDir: string }> {
  assertValidPluginName(args.name, 'removeCodexSkills');
  const layout = codexSkillsLayout(args.destRoot, args.name);
  const previous = await readCodexSkillsRecord(layout.root);
  if (!previous) return { removed: [], skillsDir: layout.root };
  const { removed } = await applyPlan(layout, previous.managedFiles, []);
  const recordPath = path.join(layout.root, CODEX_SKILLS_RECORD);
  await rm(recordPath, { force: true });
  removed.push(recordPath);
  await removeIfEmpty(layout.root);
  return { removed, skillsDir: layout.root };
}

/** The skills an install wrote for Codex under `destRoot`, by kind; undefined when it wrote none. */
export async function readCodexSkills(destRoot: string, name: string): Promise<SkillTreeRecord | undefined> {
  return readCodexSkillsRecord(codexSkillsLayout(destRoot, name).root);
}

function codexSkillsLayout(destRoot: string, name: string): SkillTreeLayout {
  const skillsDir = path.join(destRoot, name);
  return { root: skillsDir, skillsDir };
}

async function readCodexSkillsRecord(skillsDir: string): Promise<CodexSkillsRecord | undefined> {
  const recordPath = path.join(skillsDir, CODEX_SKILLS_RECORD);
  if (!(await fileExists(recordPath))) return undefined;
  try {
    return JSON.parse(await readFile(recordPath)) as CodexSkillsRecord;
  } catch {
    return undefined;
  }
}

async function writeCodexSkillsRecord(skillsDir: string, record: CodexSkillsRecord): Promise<void> {
  await ensureDir(skillsDir);
  await writeFile(path.join(skillsDir, CODEX_SKILLS_RECORD), serializeJson(record));
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

function skillRecordOf(
  plan: SkillPlan,
  files: PlannedFile[],
  bundle: PluginEmitterBundleSkills | undefined,
): SkillTreeRecord {
  const bundleFolders = plan.bundleSkills.map((skill) => skill.folder);
  return {
    skills: [...plan.shippedSkills, ...bundleFolders].sort(),
    ...(bundle && {
      bundleSkills: { ...(bundle.bundleVersion !== undefined && { bundleVersion: bundle.bundleVersion }), skills: bundleFolders },
    }),
    managedFiles: files.map((file) => file.relPath).sort(),
  };
}

function claudeSkillRecord(manifest: ClaudePluginManifest): SkillTreeRecord {
  const bundleSkills = manifest._meta?.frontmcp?.bundleSkills;
  return {
    skills: manifest.skills ?? [],
    ...(bundleSkills && { bundleSkills }),
    managedFiles: manifest._meta?.frontmcp?.managedFiles ?? [],
  };
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
  return serializeJson(manifest);
}

function serializeJson(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value), null, 2) + '\n';
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
async function cleanupEmptyDirs(root: string): Promise<void> {
  if (!(await fileExists(root))) return;
  const skillsDir = path.join(root, 'skills');
  for (const entry of await readdir(skillsDir).catch((): string[] => [])) {
    await removeIfEmpty(path.join(skillsDir, entry));
  }
  for (const sub of ['commands', 'skills', '.claude-plugin']) {
    await removeIfEmpty(path.join(root, sub));
  }
  await removeIfEmpty(root);
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

function definesCodexServerTable(content: string, name: string): boolean {
  const keyForms = [name, `"${name}"`, `'${name}'`];
  return content.split(/\r?\n/).some((line) => {
    const tablePrefix = /^\s*\[\s*mcp_servers\s*\.\s*/.exec(line);
    if (!tablePrefix) return false;
    const rest = line.slice(tablePrefix[0].length);
    return keyForms.some((key) => rest.startsWith(key) && /^\s*[\].]/.test(rest.slice(key.length)));
  });
}

function assertNoUnmanagedCodexTable(content: string, name: string, configPath: string): void {
  const unmanaged = content.replace(MANAGED_CODEX_BLOCK, '');
  if (definesCodexServerTable(unmanaged, name)) {
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
