import type { UIType } from '@frontmcp/uipack/types';

/** Compiled JSX: the automatic runtime's `jsx` / `jsxs` / `jsxDEV` calls (`_`-prefixed too), or `React.createElement`. */
const COMPILED_JSX_PATTERN = /\b(?:React\.createElement|_?jsx(?:s|DEV)?)\)?\s*\(/;

const warnedComponentReferences = new WeakMap<object, Set<string>>();

/** `detectUIType` of `@frontmcp/uipack/adapters`, without loading its renderer; a test keeps the two equal. */
export function detectUIType(template: unknown): UIType {
  if (template === null || template === undefined) return 'auto';
  if (typeof template === 'object' && 'file' in template) {
    return /\.(tsx|jsx)$/i.test((template as { file: string }).file) ? 'react' : 'auto';
  }
  if (typeof template === 'function') {
    if (typeof template.prototype?.render === 'function') return 'react';
    if ((template as unknown as Record<string, unknown>)['$$typeof'] !== undefined) return 'react';
    if (template.name && /^[A-Z]/.test(template.name)) return 'react';
    return 'html';
  }
  if (typeof template === 'string') return template.includes('<') && template.includes('>') ? 'html' : 'markdown';
  return 'auto';
}

function isComponentReference(template: unknown): boolean {
  if (typeof template === 'object' && template !== null && '$$typeof' in template) return true;
  if (typeof template !== 'function' || detectUIType(template) !== 'react') return false;
  if (typeof template.prototype?.render === 'function') return true;
  if ((template as unknown as Record<string, unknown>)['$$typeof'] !== undefined) return true;
  return COMPILED_JSX_PATTERN.test(Function.prototype.toString.call(template));
}

/** `warnIfComponentReference` of `@frontmcp/uipack/adapters`, without loading its renderer; a test keeps the two equal. */
export function warnIfComponentReference(
  toolName: string,
  template: unknown,
  logger: { warn: (message: string) => void },
): boolean {
  if (!isComponentReference(template)) return false;
  const warned = warnedComponentReferences.get(template as object) ?? new Set<string>();
  if (!warned.has(toolName)) {
    warned.add(toolName);
    warnedComponentReferences.set(template as object, warned);
    logger.warn(
      `[FrontMCP] Tool "${toolName}": \`ui.template\` is a React component reference, which cannot be bundled ` +
        `(there is no source file to compile), so the widget would render an empty page. ` +
        `Use \`template: { file: './widget.tsx' }\` instead.`,
    );
  }
  return true;
}
