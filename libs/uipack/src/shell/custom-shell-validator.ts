/**
 * Custom Shell Template Validator
 *
 * Validates that a shell template contains the required placeholders
 * and reports which optional placeholders are missing.
 *
 * @packageDocumentation
 */

import {
  SHELL_PLACEHOLDERS,
  SHELL_PLACEHOLDER_NAMES,
  REQUIRED_PLACEHOLDERS,
  OPTIONAL_PLACEHOLDERS,
} from './custom-shell-types';
import type { ShellPlaceholderName, ShellTemplateValidation } from './custom-shell-types';

/**
 * Validate a shell template string for placeholder presence.
 *
 * Scans for all known placeholders (`{{CSP}}`, `{{DATA}}`, `{{BRIDGE}}`,
 * `{{CONTENT}}`, `{{TITLE}}`) and reports which are found/missing.
 *
 * @returns Validation result with `valid: true` only if all required placeholders are present
 *
 * @example
 * ```typescript
 * const v = validateShellTemplate('<html>{{CSP}}{{CONTENT}}</html>');
 * // v.valid === true (CONTENT is present)
 * // v.missingOptional === ['DATA', 'BRIDGE', 'TITLE']
 * ```
 */
export function validateShellTemplate(template: string): ShellTemplateValidation {
  const found = {} as Record<ShellPlaceholderName, boolean>;

  for (const name of SHELL_PLACEHOLDER_NAMES) {
    found[name] = template.includes(SHELL_PLACEHOLDERS[name]);
  }

  const missingRequired = REQUIRED_PLACEHOLDERS.filter((name) => !found[name]);
  const missingOptional = OPTIONAL_PLACEHOLDERS.filter((name) => !found[name]);

  return {
    valid: missingRequired.length === 0,
    found,
    missingRequired,
    missingOptional,
  };
}
