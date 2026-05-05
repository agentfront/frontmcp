// file: libs/sdk/src/skill/sep-2640/sep-2640.uri.ts

/**
 * URI parsing and validation for the `skill://` scheme per SEP-2640.
 *
 * Structure:
 *   skill://<skill-path>/<file-path>
 *
 * - `<skill-path>` is one or more `/`-separated segments locating the skill
 *   directory within the server's namespace. Its FINAL segment MUST equal the
 *   skill's frontmatter `name`. Preceding segments are an organizational
 *   prefix chosen by the server.
 * - `<file-path>` is the file's path relative to the skill directory. The
 *   primary content URI always ends in `/SKILL.md`.
 *
 * The first path segment occupies the RFC 3986 authority position by URI
 * mechanics but carries no special semantics — clients MUST NOT resolve it
 * as a network host.
 */

import { SKILL_INDEX_URI, SKILL_URI_SCHEME } from './sep-2640.constants';

/**
 * Decode a URI segment safely. Returns `undefined` for malformed
 * percent-escapes instead of throwing — letting parsers short-circuit
 * cleanly rather than surfacing `URIError` to client read-paths.
 */
function safeDecode(s: string): string | undefined {
  try {
    return decodeURIComponent(s);
  } catch {
    return undefined;
  }
}

function safeDecodeAll(segments: string[]): string[] | undefined {
  const out: string[] = [];
  for (const s of segments) {
    const decoded = safeDecode(s);
    if (decoded === undefined) return undefined;
    out.push(decoded);
  }
  return out;
}

/**
 * Parsed `skill://` URI components.
 */
export interface ParsedSkillUri {
  /** Full skill path segments — always at least one. The last segment is the skill name. */
  skillPathSegments: string[];
  /** The skill's name — the final segment of `<skill-path>`. */
  skillName: string;
  /**
   * Organisational prefix segments. Empty when `<skill-path>` is a single
   * segment.
   */
  prefixSegments: string[];
  /** File path segments relative to the skill directory; empty for directory URIs. */
  filePathSegments: string[];
  /** Whether this URI addresses the skill's `SKILL.md`. */
  isSkillMd: boolean;
  /** The full `<skill-path>` joined by `/`. */
  skillPath: string;
  /** The full `<file-path>` joined by `/`. */
  filePath: string;
}

/**
 * Test whether a URI uses the `skill://` scheme.
 */
export function isSkillUri(uri: string): boolean {
  return uri.startsWith(SKILL_URI_SCHEME);
}

/**
 * Test whether a URI is the well-known discovery index.
 */
export function isSkillIndexUri(uri: string): boolean {
  return uri === SKILL_INDEX_URI;
}

/**
 * Build a `skill://` URI from skill path segments and an optional file path.
 *
 * @example
 * buildSkillUri(['git-workflow'], 'SKILL.md') // skill://git-workflow/SKILL.md
 * buildSkillUri(['acme', 'billing', 'refunds'], 'templates/email.md')
 *   // skill://acme/billing/refunds/templates/email.md
 */
export function buildSkillUri(skillPathSegments: string[], filePath?: string): string {
  if (skillPathSegments.length === 0) {
    throw new Error('skill path must contain at least one segment (the skill name)');
  }
  const skillPath = skillPathSegments.map(encodeURIComponent).join('/');
  if (!filePath) {
    return `${SKILL_URI_SCHEME}${skillPath}`;
  }
  // file path is server-controlled; encode each segment but keep slashes
  const encodedFile = filePath
    .split('/')
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join('/');
  return `${SKILL_URI_SCHEME}${skillPath}/${encodedFile}`;
}

/**
 * Parse a `skill://` URI into its components.
 *
 * Returns `undefined` for malformed URIs. The well-known
 * `skill://index.json` does NOT parse as a skill URI — it's reserved.
 *
 * SEP-2640 §URI Scheme: the first segment occupies the RFC 3986 authority
 * position (parsed before the path), so we re-attach it to the path here.
 */
export function parseSkillUri(uri: string): ParsedSkillUri | undefined {
  if (!isSkillUri(uri) || isSkillIndexUri(uri)) return undefined;

  const remainder = uri.slice(SKILL_URI_SCHEME.length);
  if (remainder.length === 0) return undefined;

  // Strip query/fragment if present — SEP doesn't use them but be defensive.
  const cleanRemainder = remainder.split('#')[0].split('?')[0];

  const allSegments = safeDecodeAll(cleanRemainder.split('/').filter((s) => s.length > 0));
  if (!allSegments || allSegments.length === 0) return undefined;

  // Identify where <skill-path> ends and <file-path> begins.
  // SEP-2640: the primary skill content lives at <skill-path>/SKILL.md.
  // For directory URIs (skill://acme/billing/refunds), the entire URI is the
  // skill path. We disambiguate by:
  //   - explicit /SKILL.md suffix → file is SKILL.md, skill path is the rest
  //   - any other suffix → caller must provide skill path length out-of-band,
  //     so we use a heuristic: assume single-segment skill path unless the
  //     last directory token is "SKILL.md" or the URI ends in a known file
  //     extension. The robust path is `parseSkillUriWithKnownSkill`.
  const skillMdIdx = allSegments.lastIndexOf('SKILL.md');
  let skillPathSegments: string[];
  let filePathSegments: string[];
  let isSkillMd: boolean;

  if (skillMdIdx > 0 && skillMdIdx === allSegments.length - 1) {
    skillPathSegments = allSegments.slice(0, skillMdIdx);
    filePathSegments = ['SKILL.md'];
    isSkillMd = true;
  } else {
    // No SKILL.md anchor — treat the whole thing as skill-path. Callers that
    // need to address sub-files should always include SKILL.md or use
    // `parseSkillUriWithKnownSkill` once the registered skill path is known.
    skillPathSegments = allSegments;
    filePathSegments = [];
    isSkillMd = false;
  }

  if (skillPathSegments.length === 0) return undefined;

  const skillName = skillPathSegments[skillPathSegments.length - 1];
  const prefixSegments = skillPathSegments.slice(0, -1);

  return {
    skillPathSegments,
    skillName,
    prefixSegments,
    filePathSegments,
    isSkillMd,
    skillPath: skillPathSegments.join('/'),
    filePath: filePathSegments.join('/'),
  };
}

/**
 * Parse a `skill://` URI knowing the registered skill path. This is the
 * preferred parse path when the registry can supply the skill-path
 * (e.g. when handling `read_resource` for a known skill). It correctly
 * splits sub-file paths like `skill://my-skill/scripts/extract.py`.
 */
export function parseSkillUriWithKnownSkill(uri: string, knownSkillPath: string): ParsedSkillUri | undefined {
  if (!isSkillUri(uri) || isSkillIndexUri(uri)) return undefined;

  const remainder = uri.slice(SKILL_URI_SCHEME.length);
  // Require either an exact match or a `/` boundary so we don't match
  // `skill://my-skill-2/SKILL.md` against knownSkillPath `my-skill`.
  if (remainder !== knownSkillPath && !remainder.startsWith(`${knownSkillPath}/`)) {
    return undefined;
  }

  const afterSkillPath = remainder.slice(knownSkillPath.length);
  const filePath = afterSkillPath.startsWith('/') ? afterSkillPath.slice(1) : afterSkillPath;

  const skillPathSegments = knownSkillPath.split('/').filter((s) => s.length > 0);
  if (skillPathSegments.length === 0) return undefined;

  const filePathSegments = safeDecodeAll(filePath.split('/').filter((s) => s.length > 0));
  if (!filePathSegments) return undefined;

  const skillName = skillPathSegments[skillPathSegments.length - 1];
  const prefixSegments = skillPathSegments.slice(0, -1);
  const isSkillMd = filePathSegments.length === 1 && filePathSegments[0] === 'SKILL.md';

  return {
    skillPathSegments,
    skillName,
    prefixSegments,
    filePathSegments,
    isSkillMd,
    skillPath: skillPathSegments.join('/'),
    filePath: filePathSegments.join('/'),
  };
}

/**
 * Validate a `<skill-path>` per SEP-2640: one or more `/`-separated
 * segments, final segment matches the agentskills naming rules. Prefix
 * segments are looser (just non-empty URI path segments).
 *
 * Returns the validated skill path (lowercased final segment). Throws on
 * malformed input.
 */
export function validateSkillPath(skillPath: string, expectedName: string): string[] {
  const segments = skillPath
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => s.trim());

  if (segments.length === 0) {
    throw new Error('skill path must contain at least one segment');
  }

  const finalSegment = segments[segments.length - 1];
  if (finalSegment !== expectedName) {
    throw new Error(
      `skill path final segment "${finalSegment}" must match frontmatter name "${expectedName}" (SEP-2640 §Resource Mapping)`,
    );
  }

  // Agent Skills naming rule: kebab-case, max 64, no consecutive hyphens.
  // Already enforced by skillMetadataSchema for the name itself; we
  // re-check here in case the path is built directly.
  if (finalSegment.length > 64) {
    throw new Error(`skill name "${finalSegment}" exceeds the 64-character limit (Agent Skills spec)`);
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(finalSegment)) {
    throw new Error(`skill name "${finalSegment}" violates Agent Skills naming rules`);
  }
  if (finalSegment.includes('--')) {
    throw new Error(`skill name "${finalSegment}" must not contain consecutive hyphens`);
  }

  // Prefix segments: per SEP "SHOULD be valid URI path segments per RFC 3986".
  // We reject empty or whitespace-only segments and anything containing `/`
  // (already filtered above). Otherwise pass through.
  for (const seg of segments.slice(0, -1)) {
    if (!/^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/.test(seg)) {
      throw new Error(`skill path prefix segment "${seg}" contains characters disallowed by RFC 3986`);
    }
  }

  return segments;
}
