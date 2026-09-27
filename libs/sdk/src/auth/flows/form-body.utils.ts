/**
 * A POSTed HTML form body as a record.
 *
 * The Node host hands the flows an already-parsed object; the fetch handler
 * hands over the raw `application/x-www-form-urlencoded` string. Repeated keys
 * (checkbox groups such as `tools`) become arrays.
 */
export function parseFormBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  if (typeof body !== 'string' || !body.includes('=')) return {};
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const existing = out[key];
    out[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return out;
}
