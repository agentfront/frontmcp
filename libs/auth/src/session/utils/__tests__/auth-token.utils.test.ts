/**
 * Auth Token Utils Tests
 */
import { isJwt, getTokenSignatureFingerprint, deriveTypedUser, extractBearerToken } from '../auth-token.utils';

describe('auth-token.utils', () => {
  // ------------------------------------------
  // isJwt
  // ------------------------------------------
  describe('isJwt', () => {
    it('should return true for valid JWT format (3 dot-separated parts)', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123signature';
      expect(isJwt(jwt)).toBe(true);
    });

    it('should return false for non-JWT string (no dots)', () => {
      expect(isJwt('opaque-token-string')).toBe(false);
    });

    it('should return false for string with 2 parts', () => {
      expect(isJwt('part1.part2')).toBe(false);
    });

    it('should return false for string with 4 parts', () => {
      expect(isJwt('part1.part2.part3.part4')).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isJwt(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isJwt('')).toBe(false);
    });

    it('should return true for minimal 3-part dot string', () => {
      expect(isJwt('a.b.c')).toBe(true);
    });
  });

  // ------------------------------------------
  // getTokenSignatureFingerprint
  // ------------------------------------------
  describe('getTokenSignatureFingerprint', () => {
    it('should return the 3rd part for a JWT', () => {
      const jwt = 'header.payload.signatureValue';
      expect(getTokenSignatureFingerprint(jwt)).toBe('signatureValue');
    });

    it('should return SHA-256 base64url fingerprint for non-JWT', () => {
      const opaqueToken = 'opaque-bearer-token-value';
      const fingerprint = getTokenSignatureFingerprint(opaqueToken);
      // Should be a base64url string (no +, /, or = padding)
      expect(typeof fingerprint).toBe('string');
      expect(fingerprint).not.toContain('+');
      expect(fingerprint).not.toContain('/');
      expect(fingerprint).not.toContain('=');
      expect(fingerprint.length).toBeGreaterThan(0);
    });

    it('should produce deterministic fingerprint for same token', () => {
      const token = 'my-opaque-token';
      const fp1 = getTokenSignatureFingerprint(token);
      const fp2 = getTokenSignatureFingerprint(token);
      expect(fp1).toBe(fp2);
    });

    it('should produce different fingerprints for different tokens', () => {
      const fp1 = getTokenSignatureFingerprint('token-a');
      const fp2 = getTokenSignatureFingerprint('token-b');
      expect(fp1).not.toBe(fp2);
    });
  });

  // ------------------------------------------
  // deriveTypedUser
  // ------------------------------------------
  describe('deriveTypedUser', () => {
    it('should extract standard JWT claims', () => {
      const claims = {
        iss: 'https://issuer.example.com',
        sub: 'user-123',
        exp: 1700000000,
        iat: 1699999000,
        aud: 'my-audience',
        email: 'user@example.com',
        name: 'Test User',
        picture: 'https://example.com/avatar.png',
      };

      const user = deriveTypedUser(claims);
      expect(user.iss).toBe('https://issuer.example.com');
      expect(user.sub).toBe('user-123');
      expect(user.exp).toBe(1700000000);
      expect(user.iat).toBe(1699999000);
      expect(user.aud).toBe('my-audience');
      expect(user.email).toBe('user@example.com');
      expect(user.name).toBe('Test User');
      expect(user.picture).toBe('https://example.com/avatar.png');
    });

    it('should handle array aud', () => {
      const claims = {
        iss: 'iss',
        sub: 'sub',
        aud: ['aud1', 'aud2'],
      };
      const user = deriveTypedUser(claims);
      expect(user.aud).toEqual(['aud1', 'aud2']);
    });

    it('should handle missing optional claims', () => {
      const claims = {
        iss: 'iss',
        sub: 'sub',
      };
      const user = deriveTypedUser(claims);
      expect(user.iss).toBe('iss');
      expect(user.sub).toBe('sub');
      expect(user.exp).toBeUndefined();
      expect(user.iat).toBeUndefined();
      expect(user.aud).toBeUndefined();
      expect(user.email).toBeUndefined();
      expect(user.name).toBeUndefined();
      expect(user.picture).toBeUndefined();
    });

    it('should ignore claims with wrong types', () => {
      const claims = {
        iss: 123, // should be string
        sub: true, // should be string
        exp: 'not-a-number', // should be number
        iat: 'not-a-number',
        aud: 42, // should be string or string[]
        email: 999,
        name: false,
        picture: [],
      };
      const user = deriveTypedUser(claims as Record<string, unknown>);
      expect(user.iss).toBe('');
      expect(user.sub).toBe('');
      expect(user.exp).toBeUndefined();
      expect(user.iat).toBeUndefined();
      expect(user.aud).toBeUndefined();
      expect(user.email).toBeUndefined();
      expect(user.name).toBeUndefined();
      expect(user.picture).toBeUndefined();
    });

    it('should spread unknown claims through passthrough', () => {
      const claims = {
        iss: 'iss',
        sub: 'sub',
        custom_claim: 'custom-value',
        org_id: 'org-123',
      };
      const user = deriveTypedUser(claims);
      expect((user as Record<string, unknown>)['custom_claim']).toBe('custom-value');
      expect((user as Record<string, unknown>)['org_id']).toBe('org-123');
    });

    it('should extract sid claim', () => {
      const claims = {
        iss: 'iss',
        sub: 'sub',
        sid: 'session-id-123',
      };
      const user = deriveTypedUser(claims);
      expect(user.sid).toBe('session-id-123');
    });

    it('should extract preferred_username and username', () => {
      const claims = {
        iss: 'iss',
        sub: 'sub',
        preferred_username: 'johndoe',
        username: 'john',
      };
      const user = deriveTypedUser(claims);
      expect(user.preferred_username).toBe('johndoe');
      expect(user.username).toBe('john');
    });
  });

  // ------------------------------------------
  // extractBearerToken
  // ------------------------------------------
  describe('extractBearerToken', () => {
    it('should extract token from "Bearer token123"', () => {
      expect(extractBearerToken('Bearer token123')).toBe('token123');
    });

    it('should handle extra whitespace', () => {
      expect(extractBearerToken('  Bearer   mytoken  ')).toBe('mytoken');
    });

    it('should be case-insensitive', () => {
      expect(extractBearerToken('bearer mytoken')).toBe('mytoken');
      expect(extractBearerToken('BEARER mytoken')).toBe('mytoken');
    });

    it('should return undefined for missing header', () => {
      expect(extractBearerToken(undefined)).toBeUndefined();
    });

    it('should return undefined for empty header', () => {
      expect(extractBearerToken('')).toBeUndefined();
    });

    it('should return undefined for non-Bearer scheme', () => {
      expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeUndefined();
    });

    it('should return undefined for just "Bearer" without token', () => {
      expect(extractBearerToken('Bearer')).toBeUndefined();
    });

    it('should extract token with dots (JWT)', () => {
      const jwt = 'eyJ.eyJ.sig';
      expect(extractBearerToken(`Bearer ${jwt}`)).toBe(jwt);
    });
  });
});
