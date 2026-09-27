/**
 * What the debug request log may write of each request header.
 *
 * The log exists to debug connection problems, so it keeps every header, but never a credential:
 * a credential header is replaced with `[REDACTED]`, a session id keeps its first 8 characters,
 * and a `Referer` loses its query (the dashboard page is opened as `/dashboard?token=…`, and the
 * page's own requests carry that URL as their `Referer`).
 */

const REDACTED = '[REDACTED]';

/** Headers the SDK and its plugins read credentials from. */
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  // `@frontmcp/plugin-dashboard`'s token for the dashboard's MCP endpoint
  'x-frontmcp-dashboard-token',
]);

/**
 * Header names that carry a credential by convention (`x-auth-token`, `x-access-token`,
 * `x-client-secret`, `x-client-key`, `x-functions-key`, `x-amz-security-token`,
 * `x-hub-signature-256`, ...), matched by whole dash-separated words.
 */
const CREDENTIAL_HEADER_WORDS =
  /(?:^|-)(?:auth|authorization|token|secret|password|passwd|credential|credentials|key|apikey|signature|cookie)(?:-|$)/;

/** `mcp-session-id`, and the edge runtime's `x-frontmcp-session-id`. */
const SESSION_ID_HEADER = /(?:^|-)session-id$/;

const REFERER_HEADERS = new Set(['referer', 'referrer']);

function withoutQuery(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : `${url.slice(0, end)}?${REDACTED}`;
}

/** The value the debug log may show for a request header. */
export function headerValueForLog(name: string, value: unknown): unknown {
  const key = name.toLowerCase();
  if (CREDENTIAL_HEADERS.has(key) || CREDENTIAL_HEADER_WORDS.test(key)) return REDACTED;
  if (SESSION_ID_HEADER.test(key)) return `${String(value).slice(0, 8)}...`;
  if (REFERER_HEADERS.has(key)) {
    return Array.isArray(value) ? value.map((entry) => withoutQuery(String(entry))) : withoutQuery(String(value));
  }
  return value;
}

/** Request headers as the debug log may show them. */
export function headersForLog(headers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, headerValueForLog(key, value)]));
}
