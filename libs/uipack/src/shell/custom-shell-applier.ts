/**
 * Custom Shell Template Applier
 *
 * Replaces placeholder tokens in a custom shell template with
 * the generated fragment values (CSP, data script, bridge, content, title).
 *
 * All placeholders are replaced in a single pass over the template, so an
 * inserted value is never re-scanned for placeholders.
 *
 * @packageDocumentation
 */

import { SHELL_PLACEHOLDER_NAMES, type ShellPlaceholderName, type ShellPlaceholderValues } from './custom-shell-types';

const PLACEHOLDER_PATTERN = new RegExp(`\\{\\{(${SHELL_PLACEHOLDER_NAMES.join('|')})\\}\\}`, 'g');

const VALUE_KEYS: Record<ShellPlaceholderName, keyof ShellPlaceholderValues> = {
  CSP: 'csp',
  DATA: 'data',
  BRIDGE: 'bridge',
  CONTENT: 'content',
  TITLE: 'title',
};

/**
 * Apply placeholder values to a custom shell template.
 *
 * Each `{{PLACEHOLDER}}` token is replaced with the corresponding value, verbatim.
 * Values carry tool input and output (GHSA-rhr9-vhpf-jqp7), so they are inserted by a
 * function replacer: a value is never re-scanned for other placeholders, and `$&`, `$'`
 * or `` $` `` inside it are not expanded.
 *
 * @param template - The shell template with `{{PLACEHOLDER}}` tokens
 * @param values - The values to inject for each placeholder
 * @returns The final HTML string with all placeholders replaced
 *
 * @example
 * ```typescript
 * const html = applyShellTemplate(
 *   '<html><head>{{CSP}}{{DATA}}</head><body>{{CONTENT}}</body></html>',
 *   { csp: '<meta ...>', data: '<script>...</script>', bridge: '', content: '<div>Hi</div>', title: 'My Tool' },
 * );
 * ```
 */
export function applyShellTemplate(template: string, values: ShellPlaceholderValues): string {
  return template.replace(PLACEHOLDER_PATTERN, (_token, name: ShellPlaceholderName) => values[VALUE_KEYS[name]]);
}
