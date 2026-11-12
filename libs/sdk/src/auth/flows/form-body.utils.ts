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
  const out: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of new URLSearchParams(body)) {
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  return out;
}
