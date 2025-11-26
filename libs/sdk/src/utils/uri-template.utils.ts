// file: libs/sdk/src/utils/uri-template.utils.ts
// RFC 6570 Level 1 URI Template utilities

/**
 * Parsed URI template information
 */
export interface ParsedUriTemplate {
  pattern: RegExp;
  paramNames: string[];
}

/**
 * Parse a URI template (RFC 6570 Level 1) into a regex pattern and parameter names.
 * Supports simple string substitution: {param}
 *
 * Note: This implements RFC 6570 Level 1 only (simple string substitution).
 * Advanced operators like {+path}, {#fragment}, or {?query} are not supported.
 *
 * @example
 * parseUriTemplate("file:///{path}") => { pattern: /^file:\/\/\/([^/]+)$/, paramNames: ["path"] }
 * parseUriTemplate("users/{userId}/posts/{postId}") => { pattern: /^users\/([^/]+)\/posts\/([^/]+)$/, paramNames: ["userId", "postId"] }
 *
 * @throws Error if template is too long (>1000 chars) or has too many parameters (>50)
 */
export function parseUriTemplate(template: string): ParsedUriTemplate {
  if (template.length > 1000) {
    throw new Error('URI template too long (max 1000 characters)');
  }
  const paramCount = (template.match(/\{[^}]+\}/g) || []).length;
  if (paramCount > 50) {
    throw new Error('URI template has too many parameters (max 50)');
  }

  const paramNames: string[] = [];

  // Escape special regex characters, but handle {param} placeholders
  let regexStr = template.replace(/[.*+?^${}()|[\]\\]/g, (match) => {
    // Don't escape { and } yet - we'll handle them for parameters
    if (match === '{' || match === '}') return match;
    return '\\' + match;
  });

  // Replace {param} with capture groups
  regexStr = regexStr.replace(/\{([^}]+)\}/g, (_, paramName) => {
    paramNames.push(paramName);
    // Match any non-empty string segment (stops at /)
    return '([^/]+)';
  });

  return {
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

/**
 * Match a URI against a URI template and extract parameters.
 * Returns null if no match, or an object with extracted parameters.
 *
 * @example
 * matchUriTemplate("file:///{path}", "file:///documents/readme.txt")
 * => { path: "documents" } // Note: only captures first segment
 *
 * matchUriTemplate("users/{userId}/posts/{postId}", "users/123/posts/456")
 * => { userId: "123", postId: "456" }
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
 * @example
 * expandUriTemplate("file:///{path}", { path: "documents/readme.txt" })
 * => "file:///documents%2Freadme.txt"
 *
 * expandUriTemplate("users/{userId}/posts/{postId}", { userId: "123", postId: "456" })
 * => "users/123/posts/456"
 *
 * @throws Error if a required parameter is missing
 */
export function expandUriTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, paramName) => {
    const value = params[paramName];
    if (value === undefined) {
      throw new Error(`Missing parameter '${paramName}' for URI template '${template}'`);
    }
    return encodeURIComponent(value);
  });
}

/**
 * Extract parameter names from a URI template.
 *
 * @example
 * extractTemplateParams("users/{userId}/posts/{postId}") => ["userId", "postId"]
 */
export function extractTemplateParams(template: string): string[] {
  const params: string[] = [];
  template.replace(/\{([^}]+)\}/g, (_, paramName) => {
    params.push(paramName);
    return '';
  });
  return params;
}

/**
 * Check if a string is a URI template (contains {param} placeholders).
 */
export function isUriTemplate(uri: string): boolean {
  return /\{[^}]+\}/.test(uri);
}
