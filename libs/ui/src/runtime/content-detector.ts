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
export type RuntimeContentType =
  | 'jsx'
  | 'mdx'
  | 'html'
  | 'chart'
  | 'mermaid'
  | 'flow'
  | 'math'
  | 'map'
  | 'image'
  | 'video'
  | 'audio';

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

/**
 * Patterns that indicate chart JSON content.
 */
const CHART_PATTERN = /^\s*\{[\s\S]*"type"\s*:\s*"(?:bar|line|area|pie|scatter|radar|composed)"[\s\S]*"data"\s*:/;

/**
 * Patterns that indicate mermaid diagram content.
 */
const MERMAID_PATTERN =
  /^\s*(?:graph|sequenceDiagram|classDiagram|stateDiagram|flowchart|erDiagram|gantt|pie|journey|gitGraph)\b/;

/**
 * Patterns that indicate ReactFlow JSON content.
 */
const FLOW_PATTERN = /^\s*\{[\s\S]*"nodes"\s*:\s*\[[\s\S]*"edges"\s*:\s*\[/;

/**
 * Patterns that indicate math/LaTeX content.
 */
const MATH_PATTERNS = [
  /\$\$.+?\$\$/s,
  /\$[^$\n]+?\$/,
  /\\\[[\s\S]+?\\\]/,
  /\\\([\s\S]+?\\\)/,
  /\\begin\{(?:equation|align|gather|matrix|pmatrix|bmatrix|cases)\}/,
];

/**
 * Patterns that indicate GeoJSON / map content.
 */
const MAP_PATTERN =
  /^\s*\{[\s\S]*"type"\s*:\s*"(?:FeatureCollection|Feature|Point|LineString|Polygon|MultiPoint|MultiLineString|MultiPolygon|GeometryCollection)"/;

/**
 * Image URL / data URI patterns.
 */
const IMAGE_PATTERNS = [
  /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml)[;,]/,
  /^https?:\/\/.+\.(?:png|jpe?g|gif|webp|svg|avif|ico)(?:\?.*)?$/i,
];

/**
 * Media URL patterns (video/audio).
 */
const VIDEO_PATTERNS = [
  /^https?:\/\/.+\.(?:mp4|webm|ogg|mov)(?:\?.*)?$/i,
  /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com)\//i,
  /^data:video\//,
];

const AUDIO_PATTERNS = [
  /^https?:\/\/.+\.(?:mp3|wav|ogg|aac|flac|m4a)(?:\?.*)?$/i,
  /^https?:\/\/(?:www\.)?soundcloud\.com\//i,
  /^data:audio\//,
];

// ============================================
// Detection Functions
// ============================================

/**
 * Detect the content type of a source string.
 *
 * Priority:
 * 1. Chart JSON
 * 2. Flow JSON
 * 3. Map/GeoJSON
 * 4. Mermaid diagram syntax
 * 5. Math/LaTeX
 * 6. Image URL/data URI
 * 7. Video URL
 * 8. Audio URL
 * 9. JSX
 * 10. MDX/Markdown
 * 11. HTML (fallback)
 *
 * @param content - Source content to analyze
 * @returns Detected content type
 *
 * @example
 * ```typescript
 * detectContentType('<Card title="Hello" />');      // 'jsx'
 * detectContentType('# Hello World\n\nSome text');  // 'mdx'
 * detectContentType('<div class="foo">bar</div>');  // 'html'
 * detectContentType('graph TD; A-->B');              // 'mermaid'
 * detectContentType('$$E = mc^2$$');                 // 'math'
 * ```
 */
export function detectContentType(content: string): RuntimeContentType {
  if (!content || typeof content !== 'string') {
    return 'html';
  }

  const trimmed = content.trim();

  // Structured JSON types (check before text-based)
  if (CHART_PATTERN.test(trimmed)) return 'chart';
  if (FLOW_PATTERN.test(trimmed)) return 'flow';
  if (MAP_PATTERN.test(trimmed)) return 'map';

  // Diagram / math syntax
  if (MERMAID_PATTERN.test(trimmed)) return 'mermaid';
  if (MATH_PATTERNS.some((p) => p.test(trimmed))) return 'math';

  // Media types (usually single-line URLs)
  if (IMAGE_PATTERNS.some((p) => p.test(trimmed))) return 'image';
  if (VIDEO_PATTERNS.some((p) => p.test(trimmed))) return 'video';
  if (AUDIO_PATTERNS.some((p) => p.test(trimmed))) return 'audio';

  // Check for JSX patterns (highest priority among text types)
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
