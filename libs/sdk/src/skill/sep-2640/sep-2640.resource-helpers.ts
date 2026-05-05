// file: libs/sdk/src/skill/sep-2640/sep-2640.resource-helpers.ts

/**
 * Helpers for serving skills under the SEP-2640 `skill://` scheme.
 *
 * These helpers wrap the `SkillRegistry` and address skills by their
 * effective `<skill-path>` (the multi-segment URI locator) rather than by
 * display name only.
 */

import { joinPath, pathResolve, readFileBuffer } from '@frontmcp/utils';

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
  // Reject empty / SKILL.md (handled by the dedicated SKILL.md route)
  if (!filePath || filePath === 'SKILL.md') {
    throw new ResourceNotFoundError(`skill://${instance.getSkillPath()}/${filePath}`);
  }

  const segments = filePath
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => decodeURIComponent(s));

  // Reject any traversal attempt — `..` segments are rejected outright
  // and pathResolve below adds defence-in-depth for the FS path.
  if (segments.some((s) => s === '..' || s === '.')) {
    throw new PublicMcpError(`Invalid file path "${filePath}".`, 'INVALID_PARAMS', 400);
  }

  // ── In-memory fallback for inline (filesystem-agnostic) skills ────────
  // Try matching against `resolvedReferences[].content` /
  // `resolvedExamples[].content`. Match by `.filename` first, then by
  // bare `name` (e.g. 'getting-started' matches an entry named that).
  // Inline content is always text — bundles can't carry binary data.
  if (segments[0] === 'references' || segments[0] === 'examples') {
    const tail = segments.slice(1).join('/');
    const inline = await tryInMemorySubFile(instance, segments[0], tail);
    if (inline !== undefined) {
      return { kind: 'text', content: inline, mimeType: guessMimeType(filePath) };
    }
  }

  // ── Filesystem path ──────────────────────────────────────────────────
  const baseDir = instance.getBaseDir();
  if (!baseDir) {
    // No base dir AND no in-memory match — the skill genuinely doesn't
    // expose this file.
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
  } catch {
    throw new ResourceNotFoundError(`skill://${instance.getSkillPath()}/${filePath}`);
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
 * Look up a sub-file in the skill's in-memory resolved entries.
 *
 * Inline skills (defined via `skill({...})` or registered through
 * `registerSkillContent`) often carry their references/examples as
 * `{name, description, content}` objects rather than filesystem paths.
 * This helper matches `tail` against either the entry's `filename` or
 * its `name` (with optional `.md` suffix) and returns the body.
 */
async function tryInMemorySubFile(
  instance: SkillInstance,
  kind: 'references' | 'examples',
  tail: string,
): Promise<string | undefined> {
  if (!tail) return undefined;
  let content;
  try {
    content = await instance.load();
  } catch {
    return undefined;
  }

  const entries = kind === 'references' ? (content.resolvedReferences ?? []) : (content.resolvedExamples ?? []);
  const tailNoExt = tail.replace(/\.(md|markdown)$/i, '');

  for (const entry of entries) {
    const filename = (entry as { filename?: string }).filename;
    const name = (entry as { name?: string }).name;
    const inline = (entry as { content?: string }).content;
    if (!inline) continue;
    if (filename === tail || filename === tailNoExt) {
      return parseSkillMdFrontmatter(inline).body;
    }
    if (name === tail || name === tailNoExt) {
      return parseSkillMdFrontmatter(inline).body;
    }
  }
  return undefined;
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
 */
function isInside(child: string, parent: string): boolean {
  const parentPrefix = parent.endsWith('/') ? parent : `${parent}/`;
  return child === parent || child.startsWith(parentPrefix);
}
