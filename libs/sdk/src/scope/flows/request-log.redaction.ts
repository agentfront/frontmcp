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
 * `x-hub-signature-256`, `x-amzn-oidc-accesstoken`, `x-goog-iap-jwt-assertion`, ...), matched by
 * whole dash-separated words, or words ending in `token`, `secret`, `password`, `passwd` or `apikey`.
 */
const CREDENTIAL_HEADER_WORDS =
  /(?:^|-)(?:[a-z0-9]*(?:token|secret|password|passwd|apikey)|auth|authorization|credential|credentials|key|signature|cookie|jwt|passphrase)(?:-|$)/;

/** `mcp-session-id`, and the edge runtime's `x-frontmcp-session-id`. */
const SESSION_ID_HEADER = /(?:^|-)session-id$/;

const REFERER_HEADERS = new Set(['referer', 'referrer']);

function withoutQuery(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : `${url.slice(0, end)}?${REDACTED}`;
}

/** `apiKey`, `api_key` and `API Key` as `api-key`. */
function dashedWordsOf(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function namesCredential(key: string): boolean {
  return CREDENTIAL_HEADERS.has(key) || CREDENTIAL_HEADER_WORDS.test(key);
}

/** Whether a header or field name names a credential: `X-Auth-Token`, `apiKey`, `passWord` and `client_secret` all do. */
export function isCredentialName(name: string): boolean {
  return namesCredential(name.toLowerCase()) || namesCredential(dashedWordsOf(name));
}

/** Whether a header or field name names a session id: `mcp-session-id`, `sessionId` and `session_id` all do. */
export function isSessionIdName(name: string): boolean {
  return SESSION_ID_HEADER.test(dashedWordsOf(name));
}

/** The value the debug log may show for a request header. */
export function headerValueForLog(name: string, value: unknown): unknown {
  const key = name.toLowerCase();
  if (isCredentialName(name)) return REDACTED;
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
