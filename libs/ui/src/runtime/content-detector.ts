/**
 * Content Type Detection
 *
 * Detects whether content is JSX, MDX/Markdown, or plain HTML
 * based on heuristics. Used by the browser runtime to select
 * the appropriate rendering pipeline.
 *
 * @packageDocumentation
 */

// ============================================
// Content Types
// ============================================

/**
 * Content types supported by the browser runtime.
 */
export type RuntimeContentType = 'jsx' | 'mdx' | 'html';

// ============================================
// Detection Patterns
// ============================================

/**
 * Patterns that indicate JSX content.
 */
const JSX_PATTERNS = [
  // JSX-specific syntax: self-closing tags with capitalized names
  /<[A-Z][a-zA-Z0-9]*[\s/>]/,
  // JSX expressions: {someVar} or {() => ...}
  /\{[a-zA-Z_$][\w$.]*\}/,
  // React hooks: useState, useEffect, etc.
  /\buse[A-Z]\w+\s*\(/,
  // Arrow function components: const Foo = () =>
  /(?:const|let|var|function)\s+[A-Z][a-zA-Z0-9]*\s*(?:=\s*(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>|\()/,
  // Import from react
  /import\s+.*from\s+['"]react['"]/,
  // JSX pragma or import
  /\/\*\*?\s*@jsx\b/,
  // export default function/const (component pattern)
  /export\s+default\s+function\s+[A-Z]/,
];

/**
 * Patterns that indicate MDX/Markdown content.
 */
const MDX_PATTERNS = [
  // MDX frontmatter
  /^---\s*\n/,
  // Markdown headings
  /^#{1,6}\s+\S/m,
  // MDX import statements followed by markdown
  /^import\s+.*\n+#/m,
  // MDX export default (layout pattern)
  /^export\s+default\s+/m,
  // Markdown bullet lists
  /^\s*[-*+]\s+\S/m,
  // Markdown links
  /\[.+?\]\(.+?\)/,
  // Markdown code blocks
  /^```\w*/m,
  // Markdown emphasis
  /(?:\*\*|__).+?(?:\*\*|__)/,
];

// ============================================
// Detection Functions
// ============================================

/**
 * Detect the content type of a source string.
 *
 * Priority:
 * 1. JSX — if the content contains JSX-specific patterns (capitalized tags, hooks, React imports)
 * 2. MDX — if the content contains Markdown patterns (headings, frontmatter, lists)
 * 3. HTML — fallback for everything else
 *
 * @param content - Source content to analyze
 * @returns Detected content type
 *
 * @example
 * ```typescript
 * detectContentType('<Card title="Hello" />');      // 'jsx'
 * detectContentType('# Hello World\n\nSome text');  // 'mdx'
 * detectContentType('<div class="foo">bar</div>');  // 'html'
 * ```
 */
export function detectContentType(content: string): RuntimeContentType {
  if (!content || typeof content !== 'string') {
    return 'html';
  }

  const trimmed = content.trim();

  // Check for JSX patterns (highest priority)
  const jsxScore = countMatches(trimmed, JSX_PATTERNS);

  // Check for MDX/Markdown patterns
  const mdxScore = countMatches(trimmed, MDX_PATTERNS);

  // JSX needs at least 1 match, MDX needs at least 2 (to avoid false positives from HTML with brackets)
  if (jsxScore > 0 && jsxScore >= mdxScore) {
    return 'jsx';
  }

  if (mdxScore >= 2) {
    return 'mdx';
  }

  // If content has MDX-like imports with markdown, it's MDX
  if (mdxScore === 1 && /^import\s+/m.test(trimmed)) {
    return 'mdx';
  }

  return 'html';
}

/**
 * Count how many patterns match the content.
 */
function countMatches(content: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      count++;
    }
  }
  return count;
}
