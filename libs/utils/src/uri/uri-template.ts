/**
 * RFC 6570 URI Template utilities.
 *
 * Implements:
 *   - Level 1 simple string expansion (`{var}`) — value is percent-encoded,
 *     stops at `/`.
 *   - Level 2 reserved expansion (`{+var}`) — value passes reserved characters
 *     (including `/`) through unencoded, so a single template variable can
 *     span multiple path segments (e.g. `skill://{+skillPath}/SKILL.md`
 *     matches `skill://acme/billing/refunds/SKILL.md`).
 *
 * Other RFC 6570 operators (`{#frag}`, `{?query}`, `{&qcont}`, `{;path}`,
 * `{.label}`, `{/path}`) are not supported.
 */

/**
 * Parsed URI template information.
 */
export interface ParsedUriTemplate {
  /** Compiled regex pattern for matching URIs */
  pattern: RegExp;
  /** Ordered list of parameter names extracted from template */
  paramNames: string[];
}

/**
 * Parse a URI template (RFC 6570 Level 1 + reserved expansion) into a regex
 * pattern and parameter names.
 *
 * @param template - The URI template to parse
 * @returns Parsed template with pattern and parameter names
 * @throws Error if template is too long (>1000 chars) or has too many parameters (>50)
 *
 * @example
 * parseUriTemplate("file:///{path}")
 * // { pattern: /^file:\/\/\/([^/]+)$/, paramNames: ["path"] }
 *
 * parseUriTemplate("users/{userId}/posts/{postId}")
 * // { pattern: /^users\/([^/]+)\/posts\/([^/]+)$/, paramNames: ["userId", "postId"] }
 *
 * parseUriTemplate("skill://{+skillPath}/SKILL.md")
 * // { pattern: /^skill:\/\/(.+?)\/SKILL\.md$/, paramNames: ["skillPath"] }
 */
export function parseUriTemplate(template: string): ParsedUriTemplate {
  if (template.length > 1000) {
    throw new Error('URI template too long (max 1000 characters)');
  }
  // Use [^{}]+ instead of [^}]+ to fail fast on nested braces (ReDoS prevention)
  const paramCount = (template.match(/\{[^{}]+\}/g) || []).length;
  if (paramCount > 50) {
    throw new Error('URI template has too many parameters (max 50)');
  }

  const paramNames: string[] = [];

  // Walk the template, alternating literal segments and {param} / {+param}
  // placeholders. Literal segments get regex-escaped; placeholders become
  // a capture group whose shape depends on the operator. Doing both passes
  // in a single walk avoids escaping the `+` inside `{+name}`.
  const placeholder = /\{([^{}]+)\}/g;
  let regexStr = '';
  let lastIndex = 0;
  for (let m = placeholder.exec(template); m !== null; m = placeholder.exec(template)) {
    regexStr += escapeRegex(template.slice(lastIndex, m.index));
    const raw = m[1];
    const reserved = raw.startsWith('+');
    paramNames.push(reserved ? raw.slice(1) : raw);
    regexStr += reserved ? '(.+?)' : '([^/]+)';
    lastIndex = m.index + m[0].length;
  }
  regexStr += escapeRegex(template.slice(lastIndex));

  return {
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
}

/**
 * Match a URI against a URI template and extract parameters.
 * Returns null if no match, or an object with extracted parameters.
 *
 * @param template - The URI template
 * @param uri - The URI to match against the template
 * @returns Object with extracted parameters, or null if no match
 *
 * @example
 * matchUriTemplate("file:///{path}", "file:///documents")
 * // { path: "documents" }
 *
 * matchUriTemplate("users/{userId}/posts/{postId}", "users/123/posts/456")
 * // { userId: "123", postId: "456" }
 *
 * matchUriTemplate("users/{id}", "products/123")
 * // null (no match)
 */
export function matchUriTemplate(template: string, uri: string): Record<string, string> | null {
  const { pattern, paramNames } = parseUriTemplate(template);
  const match = uri.match(pattern);

  if (!match) return null;

  const params: Record<string, string> = {};
  paramNames.forEach((name, index) => {
    params[name] = decodeURIComponent(match[index + 1]);
  });

  return params;
}

/**
 * Expand a URI template with the given parameters.
 *
 * Encoding depends on the operator:
 *   - `{var}` (simple expansion): value is percent-encoded via
 *     `encodeURIComponent()` so `/`, `:`, etc. become `%2F`, `%3A`.
 *   - `{+var}` (reserved expansion): unreserved + reserved characters
 *     (per RFC 3986) pass through unencoded — only characters outside
 *     that set are percent-encoded. This lets a single variable carry
 *     a multi-segment path.
 *
 * Use {@link matchUriTemplate} to decode them back.
 *
 * @param template - The URI template
 * @param params - Object with parameter values (raw, unencoded)
 * @returns Expanded URI with parameters substituted (encoding depends on operator)
 * @throws Error if a required parameter is missing
 *
 * @example
 * expandUriTemplate("file:///{path}", { path: "documents" })
 * // "file:///documents"
 *
 * expandUriTemplate("users/{userId}/posts/{postId}", { userId: "123", postId: "456" })
 * // "users/123/posts/456"
 *
 * // Simple expansion percent-encodes reserved chars:
 * expandUriTemplate("notes://{id}", { id: "x-coredata://ABC/Note/1" })
 * // "notes://x-coredata%3A%2F%2FABC%2FNote%2F1"
 *
 * // Reserved expansion preserves them:
 * expandUriTemplate("skill://{+skillPath}/SKILL.md", { skillPath: "acme/billing" })
 * // "skill://acme/billing/SKILL.md"
 */
export function expandUriTemplate(template: string, params: Record<string, string>): string {
  // Use [^{}]+ instead of [^}]+ to fail fast on nested braces (ReDoS prevention)
  return template.replace(/\{([^{}]+)\}/g, (_, raw) => {
    const reserved = raw.startsWith('+');
    const paramName = reserved ? raw.slice(1) : raw;
    const value = params[paramName];
    if (value === undefined) {
      throw new Error(`Missing parameter '${paramName}' for URI template '${template}'`);
    }
    return reserved ? encodeReserved(value) : encodeURIComponent(value);
  });
}

/**
 * RFC 6570 §3.2.3 reserved expansion. Percent-encodes every character
 * that is not in the `unreserved` (ALPHA / DIGIT / "-" / "." / "_" / "~")
 * or `reserved` (gen-delims + sub-delims) sets.
 *
 * Inputs are treated as **raw, unencoded** values to preserve the
 * round-trip contract with {@link matchUriTemplate} (which decodes
 * captures via `decodeURIComponent`). Any pre-encoded `%xx` triplets in
 * the input are first decoded so a literal `%2F` round-trips as `%2F`
 * rather than as a path separator. Malformed percent sequences are
 * treated as literal text.
 */
function encodeReserved(value: string): string {
  const decoded = safeDecode(value);
  return decoded.replace(/[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]/g, (c) => encodeURIComponent(c));
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Fall back to a per-triplet decode that keeps malformed sequences
    // as literal text rather than aborting the whole expansion.
    return value.replace(/%[0-9A-Fa-f]{2}/g, (triplet) => {
      try {
        return decodeURIComponent(triplet);
      } catch {
        return triplet;
      }
    });
  }
}

/**
 * Extract parameter names from a URI template.
 *
 * @param template - The URI template
 * @returns Array of parameter names in order of appearance
 *
 * @example
 * extractTemplateParams("users/{userId}/posts/{postId}")
 * // ["userId", "postId"]
 *
 * extractTemplateParams("file:///static/path")
 * // []
 */
export function extractTemplateParams(template: string): string[] {
  const params: string[] = [];
  // Use [^{}]+ instead of [^}]+ to fail fast on nested braces (ReDoS prevention)
  template.replace(/\{([^{}]+)\}/g, (_, raw) => {
    params.push(raw.startsWith('+') ? raw.slice(1) : raw);
    return '';
  });
  return params;
}

/**
 * Check if a string is a URI template (contains {param} placeholders).
 *
 * @param uri - The string to check
 * @returns true if the string contains template placeholders
 *
 * @example
 * isUriTemplate("users/{userId}") // true
 * isUriTemplate("users/123") // false
 */
export function isUriTemplate(uri: string): boolean {
  // Use [^{}]+ instead of [^}]+ to fail fast on nested braces (ReDoS prevention)
  return /\{[^{}]+\}/.test(uri);
}
