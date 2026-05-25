// file: libs/adapters/src/skills/classifier/render-resource-uri.ts
//
// Pure helper for rendering a `mcp+op://` resource URI template against the
// arguments of a tool call. Used by the runtime resource-change dispatcher
// to compute the URI that should be carried on `notifications/resources/updated`.
//
// Supports RFC 6570 Level 1 path templating (the only style that appears in
// OpenAPI path templates): `{id}` is substituted with the URL-encoded value
// of `args.id`. Anything more sophisticated (matrix expansion, query
// expansion, etc.) is rejected at build time by the classifier and would
// never reach this function in practice.

/**
 * Outcome of attempting to render a URI template.
 *
 *   { ok: true,  uri }    — every placeholder had a value in `args`
 *   { ok: false, missing } — at least one placeholder was unresolved; `missing`
 *                            lists the placeholder names in source order
 */
export type RenderResult = { ok: true; uri: string } | { ok: false; missing: string[] };

const TEMPLATE_PLACEHOLDER_RE = /\{([^{}]+)\}/g;

/**
 * Render a URI template by substituting `{name}` placeholders from `args`.
 *
 * - Coerces values to strings (numbers, booleans accepted; objects rejected
 *   as missing since there's no sensible string projection).
 * - URL-encodes each substituted value with `encodeURIComponent`.
 * - Returns `{ ok: false, missing }` if any placeholder has no resolvable
 *   value — the caller decides whether to drop the notification or log.
 *
 * @param template The URI template, e.g. `mcp+op://acme/users/{id}`.
 * @param args     The call arguments object the placeholders refer to.
 */
export function renderResourceUri(template: string, args: unknown): RenderResult {
  if (typeof template !== 'string' || template.length === 0) {
    return { ok: false, missing: [] };
  }

  const argObj = (args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;

  const missing: string[] = [];
  const uri = template.replace(TEMPLATE_PLACEHOLDER_RE, (_match, name: string) => {
    const value = argObj[name];
    if (value === undefined || value === null) {
      missing.push(name);
      return '';
    }
    // Reject non-primitive values; the substitution wouldn't be meaningful.
    if (typeof value === 'object') {
      missing.push(name);
      return '';
    }
    // Reject non-finite numbers — `String(NaN)` is the literal "NaN" and
    // `String(Infinity)` is "Infinity"; substituting either silently produces
    // a meaningless URI that downstream subscribers would resolve to a 404.
    // Surface as missing so the caller can log + skip the notification.
    if (typeof value === 'number' && !Number.isFinite(value)) {
      missing.push(name);
      return '';
    }
    // Booleans, finite numbers, strings — coerce + encode.
    return encodeURIComponent(String(value));
  });

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, uri };
}
