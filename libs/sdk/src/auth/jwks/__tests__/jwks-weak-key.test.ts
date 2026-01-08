/**
 * JwksService Weak RSA Key Tests
 *
 * Tests for fallback verification when OAuth providers use RSA keys < 2048 bits.
 * This is a security concern but should work with a warning.
 */
import { generateRsaKeyPair, rsaSign } from '../../../../../utils/src/crypto/node';
import { JwksService } from '../jwks.service';

describe('JwksService Weak RSA Key Handling', () => {
  let service: JwksService;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  // Generate a weak (1024-bit) RSA key pair for testing
  const weakKeyPair = generateRsaKeyPair(1024);
  const weakKid = weakKeyPair.publicJwk.kid;
  const weakPublicJwk = weakKeyPair.publicJwk;

  // Generate a strong (2048-bit) RSA key pair for comparison
  const strongKeyPair = generateRsaKeyPair(2048);
  const strongKid = strongKeyPair.publicJwk.kid;
  const strongPublicJwk = strongKeyPair.publicJwk;

  /**
   * Create a JWT signed with the given private key
   */
  function createJwt(
    payload: Record<string, unknown>,
    privateKey: ReturnType<typeof generateRsaKeyPair>['privateKey'],
    kid: string,
    alg: string = 'RS256',
  ): string {
    const header = { alg, typ: 'JWT', kid };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signatureInput = `${headerB64}.${payloadB64}`;

    const signature = rsaSign('RSA-SHA256', Buffer.from(signatureInput), privateKey);
    const signatureB64 = signature.toString('base64url');

    return `${headerB64}.${payloadB64}.${signatureB64}`;
  }

  beforeEach(() => {
    service = new JwksService();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  describe('Strong key verification', () => {
    it('should verify token signed with 2048-bit RSA key without warning', async () => {
      const issuer = 'https://auth.example.com';
      const payload = {
        iss: issuer,
        sub: 'user-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      const token = createJwt(payload, strongKeyPair.privateKey, strongKid);

      const result = await service.verifyTransparentToken(token, [
        {
          id: 'strong-provider',
          issuerUrl: issuer,
          jwks: { keys: [strongPublicJwk] },
        },
      ]);

      expect(result.ok).toBe(true);
      expect(result.sub).toBe('user-123');
      expect(result.providerId).toBe('strong-provider');
      // Should NOT emit a weak key warning
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('Weak key verification with fallback', () => {
    it('should verify token signed with 1024-bit RSA key and emit warning', async () => {
      const issuer = 'https://weak-auth.example.com';
      const payload = {
        iss: issuer,
        sub: 'user-456',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      const token = createJwt(payload, weakKeyPair.privateKey, weakKid);

      const result = await service.verifyTransparentToken(token, [
        {
          id: 'weak-provider',
          issuerUrl: issuer,
          jwks: { keys: [weakPublicJwk] },
        },
      ]);

      expect(result.ok).toBe(true);
      expect(result.sub).toBe('user-456');
      expect(result.providerId).toBe('weak-provider');

      // Should emit security warning
      expect(consoleWarnSpy).toHaveBeenCalled();
      const warningCalls = consoleWarnSpy.mock.calls.flat().join(' ');
      expect(warningCalls).toContain('SECURITY WARNING');
      expect(warningCalls).toContain('RSA key smaller than 2048 bits');
      expect(warningCalls).toContain('weak-provider');
    });

    it('should only warn once per provider for weak keys', async () => {
      const issuer = 'https://single-warn.example.com';
      const payload = {
        iss: issuer,
        sub: 'user-789',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      // Create a new service for isolated warning tracking
      const isolatedService = new JwksService();

      const provider = {
        id: 'once-warn-provider',
        issuerUrl: issuer,
        jwks: { keys: [weakPublicJwk] },
      };

      // First call - should warn
      const token1 = createJwt(payload, weakKeyPair.privateKey, weakKid);
      await isolatedService.verifyTransparentToken(token1, [provider]);

      const warningCountAfterFirst = consoleWarnSpy.mock.calls.length;
      expect(warningCountAfterFirst).toBeGreaterThan(0);

      // Second call - should NOT warn again for same provider
      const token2 = createJwt({ ...payload, sub: 'user-999' }, weakKeyPair.privateKey, weakKid);
      await isolatedService.verifyTransparentToken(token2, [provider]);

      // Warning count should be the same (no additional warnings)
      expect(consoleWarnSpy.mock.calls.length).toBe(warningCountAfterFirst);
    });

    it('should reject token with invalid signature even with weak key', async () => {
      const issuer = 'https://invalid-sig.example.com';
      const payload = {
        iss: issuer,
        sub: 'user-invalid',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      // Create token with weak key but tamper with it
      const validToken = createJwt(payload, weakKeyPair.privateKey, weakKid);
      const [header, , sig] = validToken.split('.');
      const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, sub: 'hacker' })).toString('base64url');
      const tamperedToken = `${header}.${tamperedPayload}.${sig}`;

      const result = await service.verifyTransparentToken(tamperedToken, [
        {
          id: 'tamper-provider',
          issuerUrl: issuer,
          jwks: { keys: [weakPublicJwk] },
        },
      ]);

      expect(result.ok).toBe(false);
    });

    it('should reject expired token even with weak key', async () => {
      const issuer = 'https://expired.example.com';
      const payload = {
        iss: issuer,
        sub: 'user-expired',
        exp: Math.floor(Date.now() / 1000) - 3600, // Already expired
      };

      const token = createJwt(payload, weakKeyPair.privateKey, weakKid);

      const result = await service.verifyTransparentToken(token, [
        {
          id: 'expired-provider',
          issuerUrl: issuer,
          jwks: { keys: [weakPublicJwk] },
        },
      ]);

      expect(result.ok).toBe(false);
      // Token is rejected - either by jose (key too small + expired) or by fallback (expired check)
      expect(result.error).toBeDefined();
    });
  });

  describe('Error detection', () => {
    it('should detect jose weak key error message', () => {
      // Access private method for testing
      const isWeakKeyError = (service as any).isWeakKeyError.bind(service);

      // Error message from jose library
      expect(isWeakKeyError(new TypeError('RS256 requires key modulusLength to be 2048 bits or larger'))).toBe(true);

      // Similar error variations
      expect(isWeakKeyError({ message: 'modulusLength must be at least 2048' })).toBe(true);

      // Unrelated errors should not match
      expect(isWeakKeyError(new Error('Invalid token'))).toBe(false);
      expect(isWeakKeyError(new Error('signature verification failed'))).toBe(false);
    });
  });

  describe('Key matching', () => {
    it('should match key by kid', () => {
      const findMatchingKey = (service as any).findMatchingKey.bind(service);

      const jwks = {
        keys: [
          { kid: 'key-1', kty: 'RSA', alg: 'RS256' },
          { kid: 'key-2', kty: 'RSA', alg: 'RS384' },
        ],
      };

      expect(findMatchingKey(jwks, { kid: 'key-2' })).toEqual(jwks.keys[1]);
    });

    it('should fallback to algorithm match when no kid', () => {
      const findMatchingKey = (service as any).findMatchingKey.bind(service);

      // When searching for RS384, the logic finds keys where:
      // 1. Exact alg match, OR
      // 2. RSA key type with any RS* algorithm
      // In practice, the first matching RSA key is used
      const jwks = {
        keys: [
          { kid: 'ec-key', kty: 'EC', alg: 'ES256' }, // Not RSA
          { kid: 'rsa-key', kty: 'RSA', alg: 'RS384' }, // RSA with matching alg
        ],
      };

      // Should skip EC key and find RSA key
      expect(findMatchingKey(jwks, { alg: 'RS384' })).toEqual(jwks.keys[1]);
    });

    it('should return first RSA key as last resort', () => {
      const findMatchingKey = (service as any).findMatchingKey.bind(service);

      const jwks = {
        keys: [
          { kid: 'ec-key', kty: 'EC', alg: 'ES256' },
          { kid: 'rsa-key', kty: 'RSA', alg: 'RS256' },
        ],
      };

      expect(findMatchingKey(jwks, {})).toEqual(jwks.keys[1]);
    });
  });

  describe('Algorithm mapping', () => {
    it('should map JWT algorithms to Node.js crypto algorithms', () => {
      const getNodeAlgorithm = (service as any).getNodeAlgorithm.bind(service);

      expect(getNodeAlgorithm('RS256')).toBe('RSA-SHA256');
      expect(getNodeAlgorithm('RS384')).toBe('RSA-SHA384');
      expect(getNodeAlgorithm('RS512')).toBe('RSA-SHA512');
      expect(getNodeAlgorithm('PS256')).toBe('RSA-PSS-SHA256');
      expect(getNodeAlgorithm('PS384')).toBe('RSA-PSS-SHA384');
      expect(getNodeAlgorithm('PS512')).toBe('RSA-PSS-SHA512');
      // Unknown algorithms should default to RSA-SHA256
      expect(getNodeAlgorithm('UNKNOWN')).toBe('RSA-SHA256');
    });
  });
});
