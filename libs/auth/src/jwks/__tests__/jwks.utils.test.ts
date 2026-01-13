/**
 * JWKS Utilities Tests
 */
import { trimSlash, normalizeIssuer, decodeJwtPayloadSafe } from '../jwks.utils';

describe('trimSlash', () => {
  it('should remove trailing slash from URL', () => {
    expect(trimSlash('https://example.com/')).toBe('https://example.com');
  });

  it('should remove multiple trailing slashes', () => {
    expect(trimSlash('https://example.com///')).toBe('https://example.com');
  });

  it('should handle URL without trailing slash', () => {
    expect(trimSlash('https://example.com')).toBe('https://example.com');
  });

  it('should handle empty string', () => {
    expect(trimSlash('')).toBe('');
  });

  it('should handle undefined/null as empty string', () => {
    expect(trimSlash(undefined as unknown as string)).toBe('');
    expect(trimSlash(null as unknown as string)).toBe('');
  });

  it('should preserve path components', () => {
    expect(trimSlash('https://example.com/path/to/resource/')).toBe('https://example.com/path/to/resource');
  });
});

describe('normalizeIssuer', () => {
  it('should normalize issuer URL with trailing slash', () => {
    expect(normalizeIssuer('https://auth.example.com/')).toBe('https://auth.example.com');
  });

  it('should normalize issuer URL without trailing slash', () => {
    expect(normalizeIssuer('https://auth.example.com')).toBe('https://auth.example.com');
  });

  it('should handle undefined', () => {
    expect(normalizeIssuer(undefined)).toBe('');
  });

  it('should handle empty string', () => {
    expect(normalizeIssuer('')).toBe('');
  });

  it('should convert non-string values to string', () => {
    expect(normalizeIssuer(123 as unknown as string)).toBe('123');
  });
});

describe('decodeJwtPayloadSafe', () => {
  // Helper to create a simple JWT for testing
  function createTestJwt(payload: Record<string, unknown>): string {
    const header = { alg: 'RS256', typ: 'JWT' };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = 'fake-signature';
    return `${headerB64}.${payloadB64}.${signature}`;
  }

  it('should decode valid JWT payload', () => {
    const payload = { sub: 'user123', iss: 'https://auth.example.com', exp: 9999999999 };
    const token = createTestJwt(payload);
    const decoded = decodeJwtPayloadSafe(token);

    expect(decoded).toEqual(payload);
  });

  it('should return undefined for undefined token', () => {
    expect(decodeJwtPayloadSafe(undefined)).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(decodeJwtPayloadSafe('')).toBeUndefined();
  });

  it('should return undefined for token with less than 2 parts', () => {
    expect(decodeJwtPayloadSafe('only-one-part')).toBeUndefined();
    expect(decodeJwtPayloadSafe('header.no-signature')).toBeUndefined();
  });

  it('should return undefined for invalid base64 payload', () => {
    expect(decodeJwtPayloadSafe('header.!!!invalid-base64!!!.signature')).toBeUndefined();
  });

  it('should return undefined for non-object payload', () => {
    const stringPayload = Buffer.from(JSON.stringify('just a string')).toString('base64url');
    expect(decodeJwtPayloadSafe(`header.${stringPayload}.signature`)).toBeUndefined();
  });

  it('should return undefined for null payload', () => {
    const nullPayload = Buffer.from('null').toString('base64url');
    expect(decodeJwtPayloadSafe(`header.${nullPayload}.signature`)).toBeUndefined();
  });

  it('should return undefined for array payload', () => {
    // Arrays are rejected since JWT payloads must be objects per RFC 7519
    const arrayPayload = Buffer.from(JSON.stringify([1, 2, 3])).toString('base64url');
    const result = decodeJwtPayloadSafe(`header.${arrayPayload}.signature`);
    expect(result).toBeUndefined();
  });

  it('should handle base64url encoding with - and _ characters', () => {
    // Create a payload that will produce - and _ in base64url
    const payload = { data: 'test>>>test' };
    const token = createTestJwt(payload);
    const decoded = decodeJwtPayloadSafe(token);

    expect(decoded).toEqual(payload);
  });

  it('should handle complex nested payload', () => {
    const payload = {
      sub: 'user123',
      iss: 'https://auth.example.com',
      aud: ['app1', 'app2'],
      claims: {
        name: 'John Doe',
        email: 'john@example.com',
      },
      exp: 9999999999,
    };
    const token = createTestJwt(payload);
    const decoded = decodeJwtPayloadSafe(token);

    expect(decoded).toEqual(payload);
  });
});
