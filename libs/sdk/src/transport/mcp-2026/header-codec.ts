/**
 * Value encoding for the mirrored HTTP headers of protocol 2026-07-28.
 *
 * HTTP field values are limited to visible ASCII, so a tool name, resource URI,
 * or parameter value that falls outside that set travels Base64-wrapped in the
 * `=?base64?…?=` sentinel. Servers MUST decode before comparing to the body —
 * a naive string compare would reject every conforming client that had to
 * encode, and would accept a crafted literal that merely LOOKS encoded.
 */

const SENTINEL_PREFIX = '=?base64?';
const SENTINEL_SUFFIX = '?=';

/** True when `value` is wrapped in the (case-sensitive, lowercase) sentinel. */
export function isSentinelEncoded(value: string): boolean {
  return (
    value.startsWith(SENTINEL_PREFIX) &&
    value.endsWith(SENTINEL_SUFFIX) &&
    value.length >= SENTINEL_PREFIX.length + SENTINEL_SUFFIX.length
  );
}

/**
 * Decode a mirrored header value.
 *
 * Returns `undefined` when the sentinel is present but the payload is not valid
 * Base64/UTF-8 — the caller turns that into a `HeaderMismatch` rather than
 * silently comparing garbage.
 */
export function decodeHeaderValue(value: string): string | undefined {
  if (!isSentinelEncoded(value)) return value;

  const payload = value.slice(SENTINEL_PREFIX.length, value.length - SENTINEL_SUFFIX.length);
  try {
    const buf = Buffer.from(payload, 'base64');
    // `Buffer.from` is lenient — round-trip to confirm the payload really was
    // Base64 rather than arbitrary text that happened to parse.
    if (buf.toString('base64').replace(/=+$/, '') !== payload.replace(/=+$/, '')) return undefined;
    return buf.toString('utf8');
  } catch {
    return undefined;
  }
}

/** Encode a value for a mirrored header, wrapping it only when necessary. */
export function encodeHeaderValue(value: string): string {
  const needsEncoding = /[^\x20-\x7e]/.test(value) || value !== value.trim() || isSentinelEncoded(value);
  if (!needsEncoding) return value;
  return `${SENTINEL_PREFIX}${Buffer.from(value, 'utf8').toString('base64')}${SENTINEL_SUFFIX}`;
}

/** Horizontal tab — the one control character RFC 9110 permits in a field value. */
const HTAB = 0x09;

/** True when a raw header value contains octets HTTP does not permit. */
export function hasInvalidHeaderChars(value: string): boolean {
  // RFC 9110: field values are visible ASCII (0x21-0x7E), SP (0x20) and HTAB.
  // Scanned by code point rather than a character class so the literal never
  // embeds a control character — which lint rules (rightly) flag in regexes.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === HTAB) continue;
    if (code < 0x20 || code > 0x7e) return true;
  }
  return false;
}

/**
 * Compare a decoded header value against the value found in the request body.
 *
 * Numbers are compared numerically per the spec note (`42` and `42.0` are
 * equal); booleans use their lowercase spelling; everything else is an exact
 * string match.
 */
export function headerMatchesBodyValue(headerValue: string, bodyValue: unknown): boolean {
  if (typeof bodyValue === 'number') {
    const parsed = Number(headerValue);
    return Number.isFinite(parsed) && parsed === bodyValue;
  }
  if (typeof bodyValue === 'boolean') {
    return headerValue === String(bodyValue);
  }
  return headerValue === String(bodyValue);
}
