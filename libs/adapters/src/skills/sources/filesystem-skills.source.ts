// file: libs/adapters/src/skills/sources/filesystem-skills.source.ts
//
// Watches a `skills/` directory and emits upsert/delete events for each
// subdirectory whose contents change. Hosts wire these events into the SDK's
// `SkillRegistry.registerSkillContent` so plain-disk skills participate in
// `notifications/skills/list_changed` like SaaS-pull skills already do (xmcp /
// mcp-skillset parity, addresses the "watch + reload" gap StaticSource fills
// only for single-file bundles).
//
// Producer/consumer split: this source emits `SkillContent` events directly
// and is intentionally NOT a `SkillBundleSource` (which emits `ResolvedBundle`
// for OpenAPI-style bundles). Filesystem skills don't have an OpenAPI spec,
// service map, or signature envelope — squeezing them through the bundle
// path would force opinions that don't apply.

// All Node APIs route through `@frontmcp/utils` per CLAUDE.md. The
// `watchFile` helper is Node-only at runtime (utils asserts Node) but the
// import is safe in V8-isolate builds — they only fail if the consumer
// actually instantiates this source on a non-Node target.
import {
  basename,
  joinPath,
  pathResolve,
  readdir,
  readFile,
  realpath,
  sep,
  stat,
  watchFile,
  type FileWatcherHandle,
} from '@frontmcp/utils';

/**
 * Lightweight logger surface — kept narrow so this module can sit in a
 * standalone adapter without dragging the SDK's full FrontMcpLogger type in.
 */
export interface FilesystemSkillsLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Minimum subset of `SkillContent` produced by this source. Hosts can map it
 * onto the SDK's full `SkillContent` (with resources, parameters, etc.) when
 * they wire `onChange` into `registerSkillContent`. The fields here are the
 * ones we read from SKILL.md directly.
 */
export interface FilesystemSkillContent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: Array<{ name: string; purpose?: string; required?: boolean }>;
  /** Bundled resource subdirs the host may also load (scripts/, references/, examples/, assets/). */
  resources?: { scripts?: string; references?: string; examples?: string; assets?: string };
  /** Optional license / compatibility notes parsed from frontmatter. */
  license?: string;
  compatibility?: string;
}

export type FilesystemSkillsEvent =
  | { op: 'upsert'; skill: FilesystemSkillContent; absPath: string }
  | { op: 'delete'; skillId: string; absPath: string };

export type FilesystemSkillsListener = (event: FilesystemSkillsEvent) => void;

export interface FilesystemSkillsSourceOptions {
  /** Directory holding skill subdirectories. Default: `./skills`. */
  skillsDir?: string;
  /**
   * Watch for changes after the initial scan. Default: true. When false the
   * source emits each skill once on `start()` and never re-fires.
   */
  watch?: boolean;
  /** Debounce window in ms before re-reading a changed subdir. Default: 200. */
  debounceMs?: number;
  /**
   * Polling interval (ms) used as a fallback when `fs.watch` is unreliable
   * (Linux watch limits, network FS, exotic mount points). When set, the
   * source falls back to polling the dir mtime; otherwise it surfaces the
   * `fs.watch` failure as a warning and stops watching.
   * Default: 2000.
   */
  pollIntervalMs?: number;
}

const DEFAULT_OPTIONS: Required<FilesystemSkillsSourceOptions> = {
  skillsDir: './skills',
  watch: true,
  debounceMs: 200,
  pollIntervalMs: 2000,
};

/**
 * Filesystem-backed skills source with hot reload.
 *
 * Lifecycle:
 *   - `start()` performs the initial scan, emitting one `upsert` per skill.
 *     Errors loading a single subdirectory are logged and that subdirectory
 *     is skipped — one bad skill never blocks the rest of the dir.
 *   - When `watch: true`, fs.watch runs against `skillsDir` (recursive). On
 *     change events we debounce, then re-load the affected subdir and emit
 *     `upsert`. A subdir that disappeared emits `delete`.
 *   - When `fs.watch` throws (Linux watch-count limit, certain network
 *     filesystems), we fall back to a polling loop that compares the
 *     directory listing on each tick.
 *   - `stop()` halts watchers, clears timers, and drops listeners.
 */
export class FilesystemSkillsSource {
  readonly id: string;
  private readonly options: Required<FilesystemSkillsSourceOptions>;
  private readonly listeners = new Set<FilesystemSkillsListener>();
  private readonly known = new Map<string, FilesystemSkillContent>(); // absPath → last emitted content
  private watcher: FileWatcherHandle | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private stopped = false;
  private rootResolved = '';

  constructor(
    options: FilesystemSkillsSourceOptions,
    private readonly logger: FilesystemSkillsLogger,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.id = `filesystem-skills:${this.options.skillsDir}`;
  }

  onChange(listener: FilesystemSkillsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    // Resolve symlinks at the root so symlinked skills directories compare
    // correctly against children (which we also realpath below). If the dir
    // does not exist yet, fall back to plain pathResolve — initialScan() will
    // log a warning when it can't read the directory.
    const absRoot = pathResolve(this.options.skillsDir);
    try {
      this.rootResolved = await realpath(absRoot);
    } catch {
      this.rootResolved = absRoot;
    }
    await this.initialScan();
    if (this.options.watch) {
      this.beginWatch();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* best-effort */
      }
      this.watcher = undefined;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    this.listeners.clear();
    this.known.clear();
  }

  private async initialScan(): Promise<void> {
    const entries = await this.listSkillSubdirs();
    for (const dir of entries) {
      await this.refreshSkill(dir);
    }
  }

  private async listSkillSubdirs(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.rootResolved);
    } catch (e) {
      this.logger.warn(`[fs-skills] cannot read ${this.rootResolved}: ${(e as Error).message}`);
      return [];
    }
    const out: string[] = [];
    for (const name of entries) {
      // Skip hidden / dotfiles — editor swap files and OS-junk should not turn
      // into spurious skill registrations.
      if (name.startsWith('.')) continue;
      const abs = joinPath(this.rootResolved, name);
      // Symlink-containment: only follow symlinks whose realpath stays inside
      // skillsDir. `pathResolve` only normalizes the string — symlinks need
      // `realpath` to expose their true target.
      let resolved: string;
      try {
        resolved = await realpath(abs);
      } catch {
        // race with concurrent delete or broken symlink — skip
        continue;
      }
      if (!resolved.startsWith(this.rootResolved + sep) && resolved !== this.rootResolved) {
        this.logger.warn(`[fs-skills] skipping ${name}: realpath escapes skillsDir`);
        continue;
      }
      try {
        const st = await stat(resolved);
        if (st.isDirectory()) out.push(resolved);
      } catch {
        // race with concurrent delete — skip
      }
    }
    return out.sort();
  }

  /** Reload a single skill subdir and emit upsert (or delete if vanished). */
  private async refreshSkill(absDir: string): Promise<void> {
    if (this.stopped) return;
    let exists = false;
    try {
      const st = await stat(absDir);
      exists = st.isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) {
      const prev = this.known.get(absDir);
      if (prev) {
        this.known.delete(absDir);
        this.emit({ op: 'delete', skillId: prev.id, absPath: absDir });
      }
      return;
    }

    let content: FilesystemSkillContent;
    try {
      content = await loadFilesystemSkill(absDir);
    } catch (e) {
      this.logger.warn(`[fs-skills] failed to load ${absDir}: ${(e as Error).message}`);
      return; // do not unregister on transient parse failures (editor swap files etc.)
    }

    const prev = this.known.get(absDir);
    if (prev && skillContentEqual(prev, content)) {
      // Identical content — no need to re-emit. Most fs.watch noise is here
      // (atomic writes that touch the file but leave bytes unchanged).
      return;
    }
    this.known.set(absDir, content);
    this.emit({ op: 'upsert', skill: content, absPath: absDir });
  }

  private emit(event: FilesystemSkillsEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (e) {
        this.logger.warn(`[fs-skills] listener threw: ${(e as Error).message}`);
      }
    }
  }

  private beginWatch(): void {
    try {
      this.watcher = watchFile(
        this.rootResolved,
        (_eventType, filename) => {
          if (this.stopped) return;
          // Filename may be null (some platforms). Without it we don't know
          // which subdir to refresh, so do a coarse rescan.
          if (!filename) {
            this.scheduleRescan();
            return;
          }
          // First path segment is the skill subdir name.
          const first = filename.split(sep)[0];
          if (!first || first.startsWith('.')) return; // editor swap files etc.
          const absDir = joinPath(this.rootResolved, first);
          this.scheduleRefresh(absDir);
        },
        { recursive: true },
      );
      this.watcher.onError((e) => {
        this.logger.warn(`[fs-skills] fs.watch error: ${e.message}; falling back to polling`);
        this.watcher?.close();
        this.watcher = undefined;
        this.beginPolling();
      });
    } catch (e) {
      this.logger.warn(
        `[fs-skills] fs.watch failed (${(e as Error).message}); polling at ${this.options.pollIntervalMs}ms instead`,
      );
      this.beginPolling();
    }
  }

  private beginPolling(): void {
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        await this.pollOnce();
      } catch (e) {
        this.logger.warn(`[fs-skills] poll tick error: ${(e as Error).message}`);
      }
      if (this.stopped) return;
      this.pollTimer = setTimeout(tick, this.options.pollIntervalMs);
      this.pollTimer.unref?.();
    };
    this.pollTimer = setTimeout(tick, this.options.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  /** Compare current dir listing to known set; emit upserts/deletes. */
  private async pollOnce(): Promise<void> {
    const dirs = new Set(await this.listSkillSubdirs());
    for (const known of [...this.known.keys()]) {
      if (!dirs.has(known)) {
        await this.refreshSkill(known); // emits delete
      }
    }
    for (const abs of dirs) {
      await this.refreshSkill(abs);
    }
  }

  /** Coarse rescan when filename is unknown (some Linux/macOS fs.watch events). */
  private scheduleRescan(): void {
    const key = '<rescan>';
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      this.debounceTimers.delete(key);
      void this.pollOnce().catch((e: unknown) => {
        this.logger.warn(`[fs-skills] rescan failed: ${(e as Error).message}`);
      });
    }, this.options.debounceMs);
    t.unref?.();
    this.debounceTimers.set(key, t);
  }

  private scheduleRefresh(absDir: string): void {
    const existing = this.debounceTimers.get(absDir);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      this.debounceTimers.delete(absDir);
      void this.refreshSkill(absDir).catch((e: unknown) => {
        this.logger.warn(`[fs-skills] refresh failed for ${absDir}: ${(e as Error).message}`);
      });
    }, this.options.debounceMs);
    t.unref?.();
    this.debounceTimers.set(absDir, t);
  }
}

// ───────────────────────── helpers ─────────────────────────

/**
 * Read a single skill directory's SKILL.md and produce a `FilesystemSkillContent`.
 * Exported for unit tests and for hosts that want to call directly.
 */
export async function loadFilesystemSkill(absDir: string): Promise<FilesystemSkillContent> {
  const skillMdPath = joinPath(absDir, 'SKILL.md');
  const raw = await readFile(skillMdPath, 'utf8');
  const { frontmatter, body } = parseSkillFrontmatter(raw);
  const dirName = basename(absDir);

  const name = (frontmatter['name'] as string | undefined) ?? dirName;
  const description = (frontmatter['description'] as string | undefined) ?? '';
  if (!description) {
    throw new Error(`SKILL.md missing 'description' frontmatter (in ${absDir})`);
  }
  const instructions = body.trim();
  if (!instructions) {
    throw new Error(`SKILL.md missing body content (in ${absDir})`);
  }
  const tools = parseToolList(frontmatter['tools']);

  // Detect resource subdirectories. Using stat instead of fileExists because
  // we care that the entry is a directory; a stray file named scripts/ would
  // otherwise be reported as a resource dir.
  const resources: NonNullable<FilesystemSkillContent['resources']> = {};
  for (const sub of ['scripts', 'references', 'examples', 'assets'] as const) {
    const subAbs = joinPath(absDir, sub);
    try {
      const st = await stat(subAbs);
      if (st.isDirectory()) resources[sub] = subAbs;
    } catch {
      /* missing — fine */
    }
  }

  const out: FilesystemSkillContent = {
    id: name,
    name,
    description,
    instructions,
    tools,
    ...(Object.keys(resources).length > 0 && { resources }),
  };
  if (typeof frontmatter['license'] === 'string') out.license = frontmatter['license'];
  if (typeof frontmatter['compatibility'] === 'string') out.compatibility = frontmatter['compatibility'];
  return out;
}

interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Minimal YAML-ish frontmatter parser — supports the subset that SKILL.md
 * actually uses (key/value pairs, optional quoted strings, simple lists).
 * For full YAML the host should use `loadSkillDirectory` from the SDK; this
 * adapter intentionally avoids pulling js-yaml as a runtime dep just for
 * parsing skill metadata.
 */
export function parseSkillFrontmatter(raw: string): ParsedFrontmatter {
  if (!raw.startsWith('---')) {
    return { frontmatter: {}, body: raw };
  }
  const closeIdx = raw.indexOf('\n---', 3);
  if (closeIdx === -1) {
    return { frontmatter: {}, body: raw };
  }
  const yamlBlock = raw.slice(3, closeIdx).trim();
  // Body starts after the closing `---` line. Skip the trailing newline if
  // present so the first body character is the first real content char.
  let bodyStart = closeIdx + 4;
  if (raw[bodyStart] === '\n') bodyStart += 1;
  const body = raw.slice(bodyStart);

  const fm: Record<string, unknown> = {};
  let currentListKey: string | undefined;
  for (const line of yamlBlock.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('- ') && currentListKey) {
      const arr = (fm[currentListKey] as unknown[]) ?? [];
      arr.push(stripQuotes(line.slice(2).trim()));
      fm[currentListKey] = arr;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    if (!rest) {
      // List header: `tools:` followed by indented `- foo` lines on next lines
      currentListKey = key;
      fm[key] = [];
      continue;
    }
    currentListKey = undefined;
    fm[key] = stripQuotes(rest);
  }
  return { frontmatter: fm, body };
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseToolList(raw: unknown): FilesystemSkillContent['tools'] {
  if (Array.isArray(raw)) {
    return raw
      .map((t) => (typeof t === 'string' ? { name: t } : null))
      .filter((t): t is { name: string } => t !== null);
  }
  if (typeof raw === 'string') {
    // Comma-separated form: `tools: a, b, c`
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }
  return [];
}

function skillContentEqual(a: FilesystemSkillContent, b: FilesystemSkillContent): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.description === b.description &&
    a.instructions === b.instructions &&
    a.license === b.license &&
    a.compatibility === b.compatibility &&
    JSON.stringify(a.tools) === JSON.stringify(b.tools) &&
    JSON.stringify(a.resources ?? {}) === JSON.stringify(b.resources ?? {})
  );
}
