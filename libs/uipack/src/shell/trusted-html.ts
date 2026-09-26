/**
 * Trusted Markup
 *
 * Explicit markup values for UI template functions. A template result built with {@link html}
 * or wrapped with {@link trustedHtml} is rendered as HTML; with `escapeStringResults` on, a plain
 * string result is escaped instead.
 *
 * @packageDocumentation
 */

import { escapeHtml } from '../utils';

// Registered symbol so values made by any bundled copy of uipack are recognised; JSON cannot forge it.
const TRUSTED_HTML: unique symbol = Symbol.for('@frontmcp/uipack/trusted-html');

/**
 * Markup a template author vouches for. It renders as HTML and is never escaped again.
 * Create it with {@link html} or {@link trustedHtml}; `String(value)` returns the markup.
 */
export interface TrustedHtml {
  readonly [TRUSTED_HTML]: string;
  toString(): string;
}

/**
 * Mark already-safe markup as trusted. Only pass markup you produced or sanitized yourself —
 * never raw tool output or user input.
 */
export function trustedHtml(markup: string): TrustedHtml {
  const value = String(markup);
  return Object.freeze({ [TRUSTED_HTML]: value, toString: () => value });
}

/** Whether a value was created by {@link html} or {@link trustedHtml}. */
export function isTrustedHtml(value: unknown): value is TrustedHtml {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { [TRUSTED_HTML]?: unknown })[TRUSTED_HTML] === 'string'
  );
}

function interpolate(value: unknown): string {
  if (isTrustedHtml(value)) return value[TRUSTED_HTML];
  if (Array.isArray(value)) return value.map(interpolate).join('');
  if (value === false) return '';
  return escapeHtml(value);
}

/**
 * Tagged template that builds {@link TrustedHtml}.
 *
 * The literal parts are kept as markup. Each interpolated value is HTML-escaped unless it is
 * itself `TrustedHtml`; arrays are joined without a separator and `null`, `undefined` and `false`
 * render nothing. Always quote attribute values.
 *
 * @example
 * ```typescript
 * html`<ul>${items.map((item) => html`<li>${item.name}</li>`)}</ul>`
 * ```
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): TrustedHtml {
  let markup = strings[0];
  for (let index = 0; index < values.length; index++) {
    markup += interpolate(values[index]) + strings[index + 1];
  }
  return trustedHtml(markup);
}
