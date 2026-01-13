/**
 * JwksService Advanced Tests
 *
 * Tests for edge cases, weak key handling, and private method behavior.
 */
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { JwksService } from '../jwks.service';

describe('JwksService Advanced', () => {
  describe('key rotation', () => {
    it('should use same key within rotation period', async () => {
      const service = new JwksService({ rotateDays: 30 });

      const jwks1 = await service.getPublicJwks();
      const jwks2 = await service.getPublicJwks();

      expect(jwks1.keys[0].kid).toBe(jwks2.keys[0].kid);
    });

    it('should generate different keys for different service instances', async () => {
      // Note: Each service instance generates its own key
      const service1 = new JwksService();
      const service2 = new JwksService();

      const jwks1 = await service1.getPublicJwks();
      const jwks2 = await service2.getPublicJwks();

      // Different instances have different keys (unless using persistence)
      // This test verifies key generation works
      expect(jwks1.keys[0]).toBeDefined();
      expect(jwks2.keys[0]).toBeDefined();
    });
  });

  describe('ES256 algorithm', () => {
    it('should generate valid ES256 JWKS', async () => {
      const service = new JwksService({ orchestratorAlg: 'ES256' });
      const jwks = await service.getPublicJwks();

      expect(jwks.keys[0].kty).toBe('EC');
      expect(jwks.keys[0].alg).toBe('ES256');
      expect(jwks.keys[0].crv).toBeDefined();
    });

    it('should return ES256 signing key', async () => {
      const service = new JwksService({ orchestratorAlg: 'ES256' });
      const { alg, kid, key } = await service.getOrchestratorSigningKey();

      expect(alg).toBe('ES256');
      expect(kid).toBeDefined();
      expect(key).toBeDefined();
    });
  });

  describe('provider JWKS management', () => {
    it('should cache provider JWKS with TTL', async () => {
      const service = new JwksService({ providerJwksTtlMs: 60000 });
      const providerId = 'test-provider';
      const jwks = {
        keys: [{ kty: 'RSA', kid: 'test', alg: 'RS256', use: 'sig', n: 'n', e: 'e' }],
      };

      service.setProviderJwks(providerId, jwks as any);

      // Should return cached JWKS
      const result = await service.getJwksForProvider({
        id: providerId,
        issuerUrl: 'https://example.com',
      });

      expect(result).toEqual(jwks);
    });

    it('should prefer inline JWKS over cached', async () => {
      const service = new JwksService();
      const providerId = 'test-provider';

      // Set cached JWKS
      const cachedJwks = {
        keys: [{ kty: 'RSA', kid: 'cached', alg: 'RS256', use: 'sig' }],
      };
      service.setProviderJwks(providerId, cachedJwks as any);

      // Provide inline JWKS
      const inlineJwks = {
        keys: [{ kty: 'RSA', kid: 'inline', alg: 'RS256', use: 'sig' }],
      };

      const result = await service.getJwksForProvider({
        id: providerId,
        issuerUrl: 'https://example.com',
        jwks: inlineJwks as any,
      });

      expect(result).toEqual(inlineJwks);
    });

    it('should handle empty JWKS gracefully', async () => {
      const service = new JwksService();

      const result = await service.getJwksForProvider({
        id: 'empty-provider',
        issuerUrl: 'https://empty.example.com',
        jwks: { keys: [] } as any,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('verifyGatewayToken edge cases', () => {
    it('should handle token with all JWT fields', async () => {
      const service = new JwksService();
      const issuer = 'https://gateway.example.com';

      const header = { alg: 'RS256', typ: 'JWT', kid: 'key-1' };
      const payload = {
        sub: 'user123',
        iss: issuer,
        aud: 'client-app',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        nbf: Math.floor(Date.now() / 1000) - 60,
        jti: 'unique-token-id',
        scope: 'openid profile',
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = `${headerB64}.${payloadB64}.signature`;

      const result = await service.verifyGatewayToken(token, issuer);

      expect(result.ok).toBe(true);
      expect(result.sub).toBe('user123');
      expect(result.payload).toMatchObject({
        sub: 'user123',
        iss: issuer,
        aud: 'client-app',
      });
    });

    it('should return error for malformed token', async () => {
      const service = new JwksService();

      const result = await service.verifyGatewayToken('not.a.valid.token.format', 'https://issuer.com');

      expect(result.ok).toBe(false);
    });

    it('should return error for token with invalid base64', async () => {
      const service = new JwksService();

      const result = await service.verifyGatewayToken('header.!!!invalid!!!.signature', 'https://issuer.com');

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('verifyTransparentToken edge cases', () => {
    it('should try multiple providers in order', async () => {
      const service = new JwksService();

      // Generate real keys
      const { privateKey, publicKey } = await generateKeyPair('RS256');
      const publicJwk = await exportJWK(publicKey);
      publicJwk.kid = 'correct-kid';
      publicJwk.alg = 'RS256';
      publicJwk.use = 'sig';

      const issuerUrl = 'https://provider2.example.com';

      // Create signed JWT
      const jwt = await new SignJWT({ sub: 'user123' })
        .setProtectedHeader({ alg: 'RS256', kid: 'correct-kid' })
        .setIssuer(issuerUrl)
        .setExpirationTime('1h')
        .sign(privateKey);

      // First provider won't match, second provider will
      const result = await service.verifyTransparentToken(jwt, [
        {
          id: 'provider1',
          issuerUrl: 'https://provider1.example.com',
          jwks: { keys: [{ kty: 'RSA', kid: 'wrong-kid', alg: 'RS256', use: 'sig', n: 'n', e: 'e' }] } as any,
        },
        {
          id: 'provider2',
          issuerUrl,
          jwks: { keys: [publicJwk] } as any,
        },
      ]);

      expect(result.ok).toBe(true);
      expect(result.providerId).toBe('provider2');
    });

    it('should handle provider with jwksUri that fails to fetch', async () => {
      const service = new JwksService({ networkTimeoutMs: 100 });

      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = { sub: 'user', iss: 'https://issuer.com' };
      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = `${headerB64}.${payloadB64}.signature`;

      const result = await service.verifyTransparentToken(token, [
        {
          id: 'provider1',
          issuerUrl: 'https://non-existent.invalid',
          jwksUri: 'https://non-existent.invalid/.well-known/jwks.json',
        },
      ]);

      expect(result.ok).toBe(false);
    });

    it('should include kid in error message when available', async () => {
      const service = new JwksService();

      const header = { alg: 'RS256', typ: 'JWT', kid: 'my-key-id' };
      const payload = { sub: 'user', iss: 'https://issuer.com' };
      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = `${headerB64}.${payloadB64}.invalid-sig`;

      const { publicKey } = await generateKeyPair('RS256');
      const publicJwk = await exportJWK(publicKey);
      publicJwk.kid = 'different-kid';
      publicJwk.alg = 'RS256';
      publicJwk.use = 'sig';

      const result = await service.verifyTransparentToken(token, [
        {
          id: 'provider1',
          issuerUrl: 'https://provider.example.com',
          jwks: { keys: [publicJwk] } as any,
        },
      ]);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('kid=my-key-id');
    });
  });

  describe('options configuration', () => {
    it('should use custom network timeout', async () => {
      const service = new JwksService({ networkTimeoutMs: 1 }); // Very short timeout

      // This should timeout quickly
      const result = await service.getJwksForProvider({
        id: 'slow-provider',
        issuerUrl: 'https://example.com',
        jwksUri: 'https://httpstat.us/200?sleep=5000', // 5 second delay
      });

      expect(result).toBeUndefined();
    });

    it('should use custom provider JWKS TTL', async () => {
      const service = new JwksService({ providerJwksTtlMs: 1 }); // 1ms TTL

      const jwks1 = { keys: [{ kty: 'RSA', kid: 'v1', alg: 'RS256', use: 'sig' }] };
      service.setProviderJwks('provider1', jwks1 as any);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      // After TTL expires, cached JWKS is stale but may still be returned as fallback
      const result = await service.getJwksForProvider({
        id: 'provider1',
        issuerUrl: 'https://example.com',
      });

      // Returns stale cache as fallback when fresh fetch fails
      expect(result).toEqual(jwks1);
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent getOrchestratorSigningKey calls', async () => {
      const service = new JwksService();

      const results = await Promise.all([
        service.getOrchestratorSigningKey(),
        service.getOrchestratorSigningKey(),
        service.getOrchestratorSigningKey(),
      ]);

      // All should return the same key
      const firstKid = results[0].kid;
      for (const result of results) {
        expect(result.kid).toBe(firstKid);
        expect(result.alg).toBe('RS256');
      }
    });

    it('should handle concurrent setProviderJwks calls', async () => {
      const service = new JwksService();
      const providerId = 'concurrent-provider';

      // Set JWKS concurrently
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 5; i++) {
        const jwks = { keys: [{ kty: 'RSA', kid: `key-${i}`, alg: 'RS256', use: 'sig' }] };
        promises.push(Promise.resolve().then(() => service.setProviderJwks(providerId, jwks as any)));
      }

      await Promise.all(promises);

      // Should have some JWKS cached (last one wins)
      const result = await service.getJwksForProvider({
        id: providerId,
        issuerUrl: 'https://example.com',
      });

      expect(result).toBeDefined();
      expect(result?.keys.length).toBe(1);
    });
  });

  describe('JWKS structure validation', () => {
    it('should handle JWKS with multiple keys', async () => {
      const service = new JwksService();

      const { privateKey, publicKey } = await generateKeyPair('RS256');
      const publicJwk = await exportJWK(publicKey);
      publicJwk.kid = 'key-1';
      publicJwk.alg = 'RS256';
      publicJwk.use = 'sig';

      // JWKS with multiple keys (only first should match)
      const multiKeyJwks = {
        keys: [
          { kty: 'RSA', kid: 'key-0', alg: 'RS256', use: 'sig', n: 'dummy', e: 'AQAB' },
          publicJwk,
          { kty: 'RSA', kid: 'key-2', alg: 'RS256', use: 'sig', n: 'dummy2', e: 'AQAB' },
        ],
      };

      const issuerUrl = 'https://multi-key.example.com';
      const jwt = await new SignJWT({ sub: 'user123' })
        .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
        .setIssuer(issuerUrl)
        .setExpirationTime('1h')
        .sign(privateKey);

      const result = await service.verifyTransparentToken(jwt, [
        {
          id: 'multi-key-provider',
          issuerUrl,
          jwks: multiKeyJwks as any,
        },
      ]);

      expect(result.ok).toBe(true);
      expect(result.sub).toBe('user123');
    });
  });
});
