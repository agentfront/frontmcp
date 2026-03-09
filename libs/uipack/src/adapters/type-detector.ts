/**
 * UI Type Detector
 *
 * Detects the UIType from a template value.
 *
 * @packageDocumentation
 */

import type { UIType } from '../types/ui-runtime';

/**
 * Detect the UIType from a template value.
 *
 * - Function with `$$typeof` or prototype with `render` → `'react'`
 * - Other function → `'html'` (template builder function)
 * - String → `'html'` (or `'markdown'` if it looks like markdown)
 * - Otherwise → `'auto'`
 */
export function detectUIType(template: unknown): UIType {
  if (template === null || template === undefined) {
    return 'auto';
  }

  // FileSource object with .tsx/.jsx extension → 'react'
  if (typeof template === 'object' && 'file' in template) {
    const file = (template as { file: string }).file;
    if (/\.(tsx|jsx)$/i.test(file)) return 'react';
  }

  if (typeof template === 'function') {
    // React class component check
    const proto = template.prototype;
    if (proto && typeof proto.render === 'function') {
      return 'react';
    }

    // React.memo / forwardRef check via $$typeof
    const asRecord = template as unknown as Record<string, unknown>;
    if (asRecord['$$typeof'] !== undefined) {
      return 'react';
    }

    // React functional component heuristic: named function starting with uppercase
    // follows React's naming convention (components must start with uppercase)
    if (template.name && /^[A-Z]/.test(template.name)) {
      return 'react';
    }

    // Regular function → treated as HTML template builder
    return 'html';
  }

  if (typeof template === 'string') {
    // Simple heuristic: if it contains HTML tags, it's HTML
    if (template.includes('<') && template.includes('>')) {
      return 'html';
    }
    // Otherwise treat as markdown
    return 'markdown';
  }

  return 'auto';
}
