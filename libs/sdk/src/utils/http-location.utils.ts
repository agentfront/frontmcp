/** A run of characters a URL does not carry as they are, including a `%` that does not start a `%XX` escape. */
const UNSAFE_IN_URL = /(?:[^\x21\x23-\x3b\x3d\x3f-\x5f\x61-\x7a\x7c\x7e]|%(?![0-9A-Fa-f]{2}))+/g;

/**
 * A redirect location as a `Location` header value, encoded as Express's `res.location()` encodes it. Characters
 * a URL does not carry are percent-encoded as UTF-8: those outside ASCII, whitespace and control characters, `"`,
 * `<`, `>`, `` ` ``, `{`, `}`, and a `%` that does not start an escape. URL separators and `%XX` escapes are kept.
 * A lone surrogate, which `encodeURI()` cannot encode, becomes U+FFFD.
 */
export function toLocationHeader(location: string): string {
  return location.replace(UNSAFE_IN_URL, (chars) => encodeURI(chars.replace(/\p{Cs}/gu, '\uFFFD')));
}
