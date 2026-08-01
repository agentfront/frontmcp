import {
  decodeHeaderValue,
  encodeHeaderValue,
  hasInvalidHeaderChars,
  headerMatchesBodyValue,
  isSentinelEncoded,
} from '../header-codec';

describe('2026-07-28 header value codec', () => {
  describe('isSentinelEncoded', () => {
    it('recognizes a wrapped value', () => {
      expect(isSentinelEncoded('=?base64?aGk=?=')).toBe(true);
    });

    it('rejects a plain value', () => {
      expect(isSentinelEncoded('us-west1')).toBe(false);
    });

    it('rejects an uppercase sentinel — the markers are case-sensitive', () => {
      expect(isSentinelEncoded('=?BASE64?aGk=?=')).toBe(false);
    });

    it('rejects a prefix with no suffix', () => {
      expect(isSentinelEncoded('=?base64?aGk=')).toBe(false);
    });
  });

  describe('encodeHeaderValue', () => {
    it('passes plain ASCII through untouched', () => {
      expect(encodeHeaderValue('us-west1')).toBe('us-west1');
    });

    it('encodes non-ASCII', () => {
      expect(encodeHeaderValue('Hello, 世界')).toBe('=?base64?SGVsbG8sIOS4lueVjA==?=');
    });

    it('encodes values with leading or trailing whitespace', () => {
      expect(encodeHeaderValue(' padded ')).toBe('=?base64?IHBhZGRlZCA=?=');
    });

    it('encodes a literal that would otherwise look like the sentinel', () => {
      // Without this the server would decode a value the client never encoded.
      expect(encodeHeaderValue('=?base64?literal?=')).toBe('=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=');
    });
  });

  describe('decodeHeaderValue', () => {
    it('returns plain values unchanged', () => {
      expect(decodeHeaderValue('get_weather')).toBe('get_weather');
    });

    it('round-trips every encoded form', () => {
      for (const value of ['Hello, 世界', ' padded ', '=?base64?literal?=', 'line1\nline2']) {
        expect(decodeHeaderValue(encodeHeaderValue(value))).toBe(value);
      }
    });

    it('returns undefined for a sentinel wrapping non-base64 payload', () => {
      // Buffer.from is lenient, so a naive decode would silently produce garbage
      // and then compare it to the body. Signal the failure instead.
      expect(decodeHeaderValue('=?base64?not valid base64!!?=')).toBeUndefined();
    });
  });

  describe('hasInvalidHeaderChars', () => {
    it('accepts visible ASCII, space and tab', () => {
      expect(hasInvalidHeaderChars('abc DEF\t123')).toBe(false);
    });

    it('flags control characters', () => {
      expect(hasInvalidHeaderChars('line1\nline2')).toBe(true);
      expect(hasInvalidHeaderChars('bell')).toBe(true);
    });

    it('flags non-ASCII', () => {
      expect(hasInvalidHeaderChars('世界')).toBe(true);
    });
  });

  describe('headerMatchesBodyValue', () => {
    it('matches strings exactly', () => {
      expect(headerMatchesBodyValue('us-west1', 'us-west1')).toBe(true);
      expect(headerMatchesBodyValue('us-west1', 'eu-central1')).toBe(false);
    });

    it('compares integers numerically, not as strings', () => {
      expect(headerMatchesBodyValue('42', 42)).toBe(true);
      expect(headerMatchesBodyValue('42.0', 42)).toBe(true);
      expect(headerMatchesBodyValue('43', 42)).toBe(false);
    });

    it('rejects a non-numeric header against a numeric body value', () => {
      expect(headerMatchesBodyValue('not-a-number', 42)).toBe(false);
    });

    it('uses lowercase spelling for booleans', () => {
      expect(headerMatchesBodyValue('true', true)).toBe(true);
      expect(headerMatchesBodyValue('True', true)).toBe(false);
      expect(headerMatchesBodyValue('false', false)).toBe(true);
    });
  });
});
