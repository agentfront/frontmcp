/**
 * Widget Sizing CSS
 *
 * Builds the static `<style>` block that applies a widget's configured
 * initial/min/max height and aspect-ratio to the shell document.
 *
 * This is the CSS-only half of the sizing feature — the runtime auto-resize
 * behaviour lives in the bridge IIFE (`generateAutoResize`) and reads the same
 * values from `window.__mcpWidgetSizing`.
 *
 * @packageDocumentation
 */

import { hasSizing } from './data-injector';
import type { WidgetSizing } from './types';

/**
 * Strip characters that could break out of the CSS declaration / `<style>` tag.
 *
 * Sizing values are author-configured (not end-user input), but they land
 * verbatim inside a `<style>` block, so we defensively drop `{`, `}`, `;`,
 * `<`, `>` and the `</style` sequence to keep the rule well-formed.
 */
function sanitizeCssValue(value: string): string {
  return value.replace(/[<>{};]/g, '').trim();
}

/**
 * Normalize a sizing value to a CSS length.
 *
 * - `number` → `${n}px`
 * - `string` → sanitized, used verbatim (any valid CSS length: `50vh`, `24rem`, …)
 */
function toCssLength(value: number | string): string {
  return typeof value === 'number' ? `${value}px` : sanitizeCssValue(value);
}

/**
 * Build a `<style>` tag applying the configured sizing to the shell document.
 *
 * Returns an empty string when no sizing values are configured (so widgets that
 * don't opt in are byte-for-byte unchanged).
 *
 * Rules emitted (only for the fields that are set):
 * - `html, body { height: <preferredHeight> }` — initial height baseline.
 * - `#root { min-height: <preferredHeight> }` — so content-driven layouts fill it.
 * - `html, body, #root { min-height / max-height / aspect-ratio }`.
 * - `body { margin: 0 }` whenever sizing is active so the iframe isn't padded.
 */
export function buildSizingStyleTag(sizing?: WidgetSizing): string {
  if (!hasSizing(sizing)) return '';

  // Only emit a <style> block for CSS-affecting fields. An autoResize-only config
  // (e.g. `{ autoResize: false }`) drives the runtime, not static CSS, so it must
  // not produce a stray `margin: 0` style tag.
  const hasCssSizing =
    sizing.preferredHeight !== undefined ||
    sizing.minHeight !== undefined ||
    sizing.maxHeight !== undefined ||
    sizing.aspectRatio !== undefined;
  if (!hasCssSizing) return '';

  const rootRules: string[] = [];
  const docRules: string[] = ['margin: 0;'];

  if (sizing.preferredHeight !== undefined) {
    const h = toCssLength(sizing.preferredHeight);
    docRules.push(`height: ${h};`);
    rootRules.push(`min-height: ${h};`);
  }
  if (sizing.minHeight !== undefined) {
    const mh = toCssLength(sizing.minHeight);
    docRules.push(`min-height: ${mh};`);
    rootRules.push(`min-height: ${mh};`);
  }
  if (sizing.maxHeight !== undefined) {
    const mx = toCssLength(sizing.maxHeight);
    docRules.push(`max-height: ${mx};`);
    rootRules.push(`max-height: ${mx};`);
  }
  if (sizing.aspectRatio !== undefined) {
    const ar =
      typeof sizing.aspectRatio === 'number' ? String(sizing.aspectRatio) : sanitizeCssValue(sizing.aspectRatio);
    if (ar) rootRules.push(`aspect-ratio: ${ar};`);
  }

  const parts: string[] = [`html, body { ${docRules.join(' ')} }`];
  if (rootRules.length > 0) {
    parts.push(`#root { ${rootRules.join(' ')} }`);
  }

  return `<style>${parts.join('\n')}</style>`;
}
