/**
 * A redirect location as a `Location` header value. A header carries ASCII only, so any other character, and any
 * whitespace or control character, is percent-encoded as UTF-8; URL separators and `%XX` escapes already in the
 * location are kept, as Express's `res.location()` keeps them. A lone surrogate, which `encodeURI()` cannot encode,
 * becomes U+FFFD.
 */
export function toLocationHeader(location: string): string {
  return location.replace(/[^\x21-\x7e]+/g, (chars) => encodeURI(chars.replace(/\p{Cs}/gu, '�')));
}
