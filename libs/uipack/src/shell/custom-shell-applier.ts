/**
 * Custom Shell Template Applier
 *
 * Replaces placeholder tokens in a custom shell template with
 * the generated fragment values (CSP, data script, bridge, content, title).
 *
 * Uses sequential `replaceAll` — injected content is NOT re-scanned,
 * so `{{CSP}}` inside user content is safe.
 *
 * @packageDocumentation
 */

import { SHELL_PLACEHOLDERS } from './custom-shell-types';
import type { ShellPlaceholderValues } from './custom-shell-types';

/**
 * Apply placeholder values to a custom shell template.
 *
 * Each `{{PLACEHOLDER}}` token is replaced with the corresponding value.
 * Replacement is single-pass per token — values injected for one placeholder
 * are not re-scanned for other placeholders.
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
  let result = template;

  result = result.replaceAll(SHELL_PLACEHOLDERS.CSP, values.csp);
  result = result.replaceAll(SHELL_PLACEHOLDERS.DATA, values.data);
  result = result.replaceAll(SHELL_PLACEHOLDERS.BRIDGE, values.bridge);
  result = result.replaceAll(SHELL_PLACEHOLDERS.CONTENT, values.content);
  result = result.replaceAll(SHELL_PLACEHOLDERS.TITLE, values.title);

  return result;
}
