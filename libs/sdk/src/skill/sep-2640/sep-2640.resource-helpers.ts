// file: libs/sdk/src/skill/sep-2640/sep-2640.resource-helpers.ts

/**
 * Helpers for serving skills under the SEP-2640 `skill://` scheme.
 *
 * These helpers wrap the `SkillRegistry` and address skills by their
 * effective `<skill-path>` (the multi-segment URI locator) rather than by
 * display name only.
 */

import { isAbsolute, joinPath, pathResolve, readFileBuffer } from '@frontmcp/utils';

import type { ScopeEntry, SkillEntry } from '../../common';
import type { SkillLoadResult } from '../../common/entries/skill.entry';
import { PublicMcpError, ResourceNotFoundError } from '../../errors';
import { parseSkillMdFrontmatter } from '../skill-md-parser';
import type { SkillInstance } from '../skill.instance';

/**
 * Get all skills visible under MCP that the SEP-2640 transport binding
 * should surface (skills whose `visibility` allows MCP).
 */
export function getSepVisibleSkills(scope: ScopeEntry): SkillEntry[] {
  const registry = scope.skills;
  if (!registry || !registry.hasAny()) return [];
  return registry.getSkills({ visibility: 'mcp' });
}

/**
 * Look up a skill by its effective `<skill-path>` (joined by `/`).
 *
 * Falls back to lookup-by-name when no skill matches the full path —
 * supporting clients that pass `skill://my-skill/SKILL.md` for skills
 * registered without an explicit `metadata.skillPath`.
 */
export function findSkillByPath(scope: ScopeEntry, skillPath: string): SkillEntry | undefined {
  const registry = scope.skills;
  if (!registry || !registry.hasAny()) return undefined;
  if (typeof skillPath !== 'string' || skillPath.length === 0) return undefined;

  const visible = getSepVisibleSkills(scope);
  // Exact path match first (multi-segment paths)
  const byPath = visible.find((s) => s.getSkillPath() === skillPath);
  if (byPath) return byPath;

  // Fallback: treat the trailing segment as the skill name
  const segments = skillPath.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return undefined;
  const lastSegment = segments[segments.length - 1];
  return visible.find((s) => s.name === lastSegment && s.getSkillPath() === lastSegment);
}

/**
 * Load a skill addressed by its `<skill-path>`, asserting MCP visibility.
 */
export async function findAndLoadSkillByPath(
  scope: ScopeEntry,
  skillPath: string,
): Promise<{ loadResult: SkillLoadResult; instance: SkillInstance }> {
  const registry = scope.skills;
  if (!registry || !registry.hasAny()) {
    throw new PublicMcpError('Skills are not available in this scope.', 'CAPABILITY_NOT_AVAILABLE', 501);
  }

  const entry = findSkillByPath(scope, skillPath);
  if (!entry) {
    throw new ResourceNotFoundError(`skill://${skillPath}/SKILL.md`);
  }

  const loadResult = await registry.loadSkill(entry.metadata.id ?? entry.name);
  if (!loadResult) {
    throw new PublicMcpError(`Failed to load skill at "${skillPath}".`, 'INTERNAL_ERROR', 500);
  }

  return { loadResult, instance: entry as SkillInstance };
}

/**
 * Result of reading a skill sub-file. Mirrors the MCP
 * `TextResourceContents` / `BlobResourceContents` split: text resources
 * carry decoded UTF-8 string content, binary resources carry base64-
 * encoded bytes that the resource handler emits via `blob`.
 */
export type SkillFileReadResult =
  | { kind: 'text'; content: string; mimeType: string }
  | { kind: 'blob'; blob: string; mimeType: string };

/**
 * MIME-type prefixes / values we treat as decodable UTF-8 text. Anything
 * else is returned as a base64-encoded blob so binary assets (PNG, JPEG,
 * archives, native binaries) survive intact.
 */
function isTextMimeType(mimeType: string): boolean {
  if (mimeType.startsWith('text/')) return true;
  if (mimeType.startsWith('application/json')) return true;
  if (mimeType === 'application/yaml') return true;
  if (mimeType === 'application/x-sh') return true;
  if (mimeType === 'image/svg+xml') return true; // SVG is XML/text
  if (mimeType.startsWith('application/javascript')) return true;
  if (mimeType.startsWith('application/xml')) return true;
  return false;
}

/**
 * Read an arbitrary file inside a skill directory by URI-relative path.
 *
 * Resolution order:
 *   1. **In-memory resolved references / examples** — for inline
 *      (filesystem-agnostic) skills the SkillContent carries the bundled
 *      body inline; we serve from there first. This satisfies SEP-2640's
 *      "skills MUST function correctly without a local filesystem"
 *      requirement.
 *   2. **Filesystem under the skill's base directory** — for file-backed
 *      skills with declared `resources.{references,examples,scripts,assets}`
 *      directories or top-level files like `LICENSE`. Path-traversal is
 *      blocked via prefix check + explicit `.` / `..` segment rejection.
 *
 * Returns either a text or blob result depending on the MIME type, so
 * binary assets (images, archives) are not corrupted by UTF-8 decoding.
 */
export async function readSkillFileByPath(instance: SkillInstance, filePath: string): Promise<SkillFileReadResult> {
  // Reject empty / SKILL.md (handled by the dedicated SKILL.md route).
  // Case-insensitive: macOS / Windows filesystems treat `skill.md`,
  // `Skill.MD`, etc. as the same file, so the URI guard must too.
  if (!filePath || filePath.toLowerCase() === 'skill.md') {
    throw new ResourceNotFoundError(`skill://${instance.getSkillPath()}/${filePath}`);
  }

  // Decode each split segment AND reject embedded separators inside the
  // decoded form. Without this, a request like
  // `references%2F..%2FSKILL.md` survives the traversal/`SKILL.md` guards
  // because it stays a single segment until after validation.
  const rawSegments = filePath.split('/').filter((s) => s.length > 0);
  const segments: string[] = [];
  for (const raw of rawSegments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      throw new PublicMcpError(`Invalid file path "${filePath}".`, 'INVALID_PARAMS', 400);
    }
    // Reject embedded separators / traversal tokens / SKILL.md anywhere
    // post-decode (case-insensitive on the SKILL.md check to match how
    // most filesystems treat the canonical name).
    if (decoded.includes('/') || decoded.includes('\\')) {
      throw new PublicMcpError(`Invalid file path "${filePath}".`, 'INVALID_PARAMS', 400);
    }
    if (decoded === '..' || decoded === '.') {
      throw new PublicMcpError(`Invalid file path "${filePath}".`, 'INVALID_PARAMS', 400);
    }
    if (decoded.toLowerCase() === 'skill.md') {
      // Hard block: SKILL.md is reserved for the dedicated SKILL.md route.
      // Case-insensitive to match macOS / Windows filesystem semantics.
      throw new ResourceNotFoundError(`skill://${instance.getSkillPath()}/${filePath}`);
    }
    segments.push(decoded);
  }

  // ── Resolved-entry lookup (works for inline + file-backed) ────────────
  // Try matching against `resolvedReferences` / `resolvedExamples` first.
  // This handles two cases at once:
  //   • Inline (filesystem-agnostic) bundles whose entry carries `content`.
  //   • File-backed skills where entries are organized by reference subdir
  //     (e.g. `examples/getting-started/basic-setup.md`) but the SEP-2640
  //     URI references them by leaf name (`examples/basic-setup.md`).
  if (segments[0] === 'references' || segments[0] === 'examples') {
    const tail = segments.slice(1).join('/');
    const resolved = await tryResolvedSubFile(instance, segments[0], tail);
    if (resolved !== undefined) {
      return { kind: 'text', content: resolved, mimeType: guessMimeType(filePath) };
    }
  }

  // ── Filesystem path ──────────────────────────────────────────────────
  const baseDir = instance.getBaseDir();
  if (!baseDir) {
    // No base dir AND no resolved-entry match — the skill genuinely
    // doesn't expose this file.
    throw new ResourceNotFoundError(`skill://${instance.getSkillPath()}/${filePath}`);
  }

  // Try the resource subdirectories first
  const resources = instance.getResources();
  const candidateDirs: Array<[string, string | undefined]> = [
    ['references', resources?.references],
    ['examples', resources?.examples],
    ['scripts', resources?.scripts],
    ['assets', resources?.assets],
  ];

  let candidatePath: string | undefined;

  for (const [subdir, configured] of candidateDirs) {
    if (segments[0] !== subdir) continue;
    const dir = configured
      ? configured.startsWith('/')
        ? configured
        : pathResolve(baseDir, configured)
      : joinPath(baseDir, subdir);
    candidatePath = pathResolve(dir, ...segments.slice(1));
    if (!isInside(candidatePath, dir)) {
      throw new PublicMcpError(`Invalid file path "${filePath}".`, 'INVALID_PARAMS', 400);
    }
    break;
  }

  if (!candidatePath) {
    // Top-level file (e.g. LICENSE, README) — must stay inside the skill dir
    candidatePath = pathResolve(baseDir, ...segments);
    if (!isInside(candidatePath, baseDir)) {
      throw new PublicMcpError(`Invalid file path "${filePath}".`, 'INVALID_PARAMS', 400);
    }
  }

  const mimeType = guessMimeType(filePath);

  // Read raw bytes first; decode as UTF-8 only for text-shaped MIME
  // types. Binary assets (PNG, JPEG, archives, etc.) are returned as
  // base64 so consumers can rebuild the original bytes via
  // Buffer.from(blob, 'base64').
  let buffer: Buffer | Uint8Array;
  try {
    buffer = await readFileBuffer(candidatePath);
  } catch (err) {
    // Only "file/dir absent" → 404. Permission errors, EISDIR, I/O
    // failures, etc. surface as 5xx via the framework error handler;
    // masking them as 404 hides genuine misconfiguration from operators.
    if (isFileMissingError(err)) {
      throw new ResourceNotFoundError(`skill://${instance.getSkillPath()}/${filePath}`);
    }
    throw err;
  }

  if (!isTextMimeType(mimeType)) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    return { kind: 'blob', blob: buf.toString('base64'), mimeType };
  }

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const content = buf.toString('utf-8');

  // Strip frontmatter from markdown sub-files so the body is what hosts
  // present to the model. Top-level SKILL.md is served raw by a different
  // resource — see `Sep2640SkillMdResource`.
  const isMarkdown = filePath.endsWith('.md') || filePath.endsWith('.markdown');
  const body = isMarkdown ? parseSkillMdFrontmatter(content).body : content;

  return { kind: 'text', content: body, mimeType };
}

/**
 * Look up a sub-file in the skill's resolved entries.
 *
 * Resolution order for each candidate entry (matched by `filename` ===
 * `tail`, or `name` === `tail`/`tailNoExt`):
 *   1. Inline `entry.content` — bundles (e.g. `skill({...})` /
 *      `registerSkillContent`) carry the body directly.
 *   2. Absolute `entry.path` — catalog-style entries that point at a
 *      file on disk.
 *   3. Filename relative to the skill's configured `resources.<kind>`
 *      directory (or `<baseDir>/<kind>` when not configured) — covers
 *      file-backed skills whose entries are organized by reference
 *      subdirectory (e.g. `examples/getting-started/basic-setup.md`)
 *      but addressed by leaf name in the SEP-2640 URI.
 *
 * Returns the markdown body (frontmatter stripped) so consumers see
 * exactly what hosts present to the model.
 */
async function tryResolvedSubFile(
  instance: SkillInstance,
  kind: 'references' | 'examples',
  tail: string,
): Promise<string | undefined> {
  if (!tail) return undefined;
  let content;
  try {
    content = await instance.load();
  } catch (err) {
    // Inline-only skills (no base directory) MUST surface a load failure
    // — there's no filesystem fallback path to recover into, so a 404
    //   would mask the real error. File-backed skills can fall through
    //   to the FS branch in `readSkillFileByPath`, where ENOENT becomes
    //   a true `ResourceNotFoundError`.
    if (!instance.getBaseDir()) {
      throw err;
    }
    return undefined;
  }

  const entries = kind === 'references' ? (content.resolvedReferences ?? []) : (content.resolvedExamples ?? []);
  const tailNoExt = tail.replace(/\.(md|markdown)$/i, '');

  for (const entry of entries) {
    const filename = (entry as { filename?: string }).filename;
    const name = (entry as { name?: string }).name;
    const matches =
      (filename !== undefined && (filename === tail || filename === tailNoExt)) ||
      (name !== undefined && (name === tail || name === tailNoExt));
    if (!matches) continue;

    const inline = (entry as { content?: string }).content;
    if (inline) {
      return parseSkillMdFrontmatter(inline).body;
    }

    const absolutePath = (entry as { path?: string }).path;
    const resolvedPath = resolveEntryPath(instance, kind, absolutePath, filename);
    if (!resolvedPath) continue;

    try {
      const buf = await readFileBuffer(resolvedPath);
      const text = (Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString('utf-8');
      return parseSkillMdFrontmatter(text).body;
    } catch (err) {
      if (isFileMissingError(err)) {
        // Entry advertised but file missing — fall through to other
        // entries and ultimately the strict filesystem path so the
        // caller sees the standard `ResourceNotFoundError`.
        continue;
      }
      // Permission / I/O / EISDIR — surface to the caller. Silently
      // skipping would hide misconfigured catalog entries from operators.
      throw err;
    }
  }
  return undefined;
}

/**
 * Build the absolute disk path for a resolved-entry filename, mirroring
 * the directory resolution in `readSkillFileByPath`.
 *
 * Skills registered via `@Skill` (kind `CLASS_TOKEN`) often have no
 * `baseDir`, but their `resources.<kind>` is supplied as an absolute
 * path — that case is handled here so file-backed entries still resolve.
 */
function resolveEntryPath(
  instance: SkillInstance,
  kind: 'references' | 'examples',
  absolutePath: string | undefined,
  filename: string | undefined,
): string | undefined {
  // Use `isAbsolute` (Node `path.isAbsolute`) so Windows drive-letter
  // (`C:\foo`) and UNC paths (`\\server\share`) are recognised as absolute
  // — `startsWith('/')` is POSIX-only.
  if (absolutePath && isAbsolute(absolutePath)) return absolutePath;
  if (!filename) return undefined;
  const baseDir = instance.getBaseDir();
  const configured = instance.getResources()?.[kind];
  let dir: string | undefined;
  if (configured && isAbsolute(configured)) {
    dir = configured;
  } else if (baseDir) {
    dir = configured ? pathResolve(baseDir, configured) : joinPath(baseDir, kind);
  }
  if (!dir) return undefined;
  return pathResolve(dir, filename);
}

/**
 * Classify a file-read failure as a "missing file/dir" error vs. anything
 * else. Only ENOENT (and the related ENOTDIR for path-component-not-dir)
 * should map to `ResourceNotFoundError`; permission errors, EISDIR, and
 * generic I/O failures must surface to the caller so misconfiguration is
 * visible to operators rather than silently appearing as a 404.
 */
function isFileMissingError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Best-effort MIME type guess for sub-resource files. Limited to the file
 * types that commonly live inside a skill bundle; everything else falls
 * back to `application/octet-stream`.
 */
function guessMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'application/yaml';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.py')) return 'text/x-python';
  if (lower.endsWith('.js')) return 'text/javascript';
  if (lower.endsWith('.ts')) return 'text/x-typescript';
  if (lower.endsWith('.sh')) return 'application/x-sh';
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

/**
 * Path-traversal guard: returns true iff `child` is inside `parent`.
 *
 * Normalises both sides to POSIX separators before the prefix check so
 * the guard works on Windows where `pathResolve()` returns
 * `C:\skill\assets\logo.png` and a hard-coded `/` separator would
 * mis-classify legitimate child paths as escapes.
 */
function isInside(child: string, parent: string): boolean {
  const normChild = child.replace(/\\/g, '/');
  const normParent = parent.replace(/\\/g, '/');
  const parentPrefix = normParent.endsWith('/') ? normParent : `${normParent}/`;
  return normChild === normParent || normChild.startsWith(parentPrefix);
}
