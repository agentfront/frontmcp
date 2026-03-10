/**
 * JwksService Tests
 */
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { JwksService } from '../jwks.service';

describe('JwksService', () => {
  describe('constructor', () => {
    it('should create service with default options', () => {
      const service = new JwksService();
      expect(service).toBeInstanceOf(JwksService);
    });

    it('should create service with custom options', () => {
      const service = new JwksService({
        orchestratorAlg: 'ES256',
        rotateDays: 7,
        providerJwksTtlMs: 1000,
        networkTimeoutMs: 3000,
      });
      expect(service).toBeInstanceOf(JwksService);
    });
  });

  describe('getPublicJwks', () => {
    it('should return valid JWKS with RS256 algorithm', async () => {
      const service = new JwksService({ orchestratorAlg: 'RS256' });
      const jwks = await service.getPublicJwks();

      expect(jwks).toBeDefined();
      expect(jwks.keys).toBeInstanceOf(Array);
      expect(jwks.keys.length).toBe(1);
      expect(jwks.keys[0].kty).toBe('RSA');
      expect(jwks.keys[0].alg).toBe('RS256');
      expect(jwks.keys[0].use).toBe('sig');
      expect(jwks.keys[0].kid).toBeDefined();
    });

    it('should return valid JWKS with ES256 algorithm', async () => {
      const service = new JwksService({ orchestratorAlg: 'ES256' });
      const jwks = await service.getPublicJwks();

      expect(jwks).toBeDefined();
      expect(jwks.keys).toBeInstanceOf(Array);
      expect(jwks.keys.length).toBe(1);
      expect(jwks.keys[0].kty).toBe('EC');
      expect(jwks.keys[0].alg).toBe('ES256');
      expect(jwks.keys[0].use).toBe('sig');
      expect(jwks.keys[0].kid).toBeDefined();
    });

    it('should return same JWKS on subsequent calls (caching)', async () => {
      const service = new JwksService();
      const jwks1 = await service.getPublicJwks();
      const jwks2 = await service.getPublicJwks();

      expect(jwks1).toBe(jwks2);
      expect(jwks1.keys[0].kid).toBe(jwks2.keys[0].kid);
    });
  });

  describe('getOrchestratorSigningKey', () => {
    it('should return signing key with RS256', async () => {
      const service = new JwksService({ orchestratorAlg: 'RS256' });
      const { kid, key, alg } = await service.getOrchestratorSigningKey();

      expect(kid).toBeDefined();
      expect(typeof kid).toBe('string');
      expect(key).toBeDefined();
      expect(alg).toBe('RS256');
    });

    it('should return signing key with ES256', async () => {
      const service = new JwksService({ orchestratorAlg: 'ES256' });
      const { kid, key, alg } = await service.getOrchestratorSigningKey();

      expect(kid).toBeDefined();
      expect(typeof kid).toBe('string');
      expect(key).toBeDefined();
      expect(alg).toBe('ES256');
    });

    it('should return consistent kid between getPublicJwks and getOrchestratorSigningKey', async () => {
      const service = new JwksService();
      const jwks = await service.getPublicJwks();
      const { kid } = await service.getOrchestratorSigningKey();

      expect(jwks.keys[0].kid).toBe(kid);
    });
  });

  describe('setProviderJwks', () => {
    it('should set and cache provider JWKS', async () => {
      const service = new JwksService();
      const providerJwks = {
        keys: [
          {
            kty: 'RSA',
            kid: 'provider-key-1',
            alg: 'RS256',
            use: 'sig',
            n: 'test-modulus',
            e: 'AQAB',
          },
        ],
      };

      service.setProviderJwks('provider1', providerJwks as any);

      // Provider JWKS should be cached
      const result = await service.getJwksForProvider({
        id: 'provider1',
        issuerUrl: 'https://provider1.com',
      });

      expect(result).toEqual(providerJwks);
    });
  });

  describe('getJwksForProvider', () => {
    it('should return inline JWKS if provided', async () => {
      const service = new JwksService();
      const inlineJwks = {
        keys: [
          {
            kty: 'RSA',
            kid: 'inline-key',
            alg: 'RS256',
            use: 'sig',
            n: 'inline-modulus',
            e: 'AQAB',
          },
        ],
      };

      const result = await service.getJwksForProvider({
        id: 'provider1',
        issuerUrl: 'https://provider1.com',
        jwks: inlineJwks as any,
      });

      expect(result).toEqual(inlineJwks);
    });

    it('should return cached JWKS if still fresh', async () => {
      const service = new JwksService({ providerJwksTtlMs: 60000 }); // 1 minute TTL
      const cachedJwks = {
        keys: [
          {
            kty: 'RSA',
            kid: 'cached-key',
            alg: 'RS256',
            use: 'sig',
            n: 'cached-modulus',
            e: 'AQAB',
          },
        ],
      };

      service.setProviderJwks('provider1', cachedJwks as any);

      const result = await service.getJwksForProvider({
        id: 'provider1',
        issuerUrl: 'https://provider1.com',
      });

      expect(result).toEqual(cachedJwks);
    });

    it('should return undefined for provider without JWKS and no network access', async () => {
      const service = new JwksService({ networkTimeoutMs: 100 });

      // This should try to fetch from a non-existent URL and fail gracefully
      const result = await service.getJwksForProvider({
        id: 'unknown-provider',
        issuerUrl: 'https://non-existent-provider.invalid',
      });

      expect(result).toBeUndefined();
    });
  });

  describe('verifyGatewayToken', () => {
    it('should verify a valid gateway token', async () => {
      const service = new JwksService();
      const expectedIssuer = 'https://gateway.example.com';

      // Create a simple test token
      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = { sub: 'user123', iss: expectedIssuer, exp: Math.floor(Date.now() / 1000) + 3600 };
      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = `${headerB64}.${payloadB64}.fake-signature`;

      const result = await service.verifyGatewayToken(token, expectedIssuer);

      expect(result.ok).toBe(true);
      expect(result.issuer).toBe(expectedIssuer);
      expect(result.sub).toBe('user123');
    });

    it('should return error for invalid token', async () => {
      const service = new JwksService();

      const result = await service.verifyGatewayToken('invalid-token', 'https://issuer.com');

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('verifyTransparentToken', () => {
    it('should return error when no candidates provided', async () => {
      const service = new JwksService();

      const result = await service.verifyTransparentToken('some-token', []);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('no_providers');
    });

    it('should verify token against provider with inline JWKS', async () => {
      const service = new JwksService();

      // Generate a real key pair for testing
      const { privateKey, publicKey } = await generateKeyPair('RS256');
      const publicJwk = await exportJWK(publicKey);
      publicJwk.kid = 'test-kid';
      publicJwk.alg = 'RS256';
      publicJwk.use = 'sig';

      const providerJwks = { keys: [publicJwk] };
      const issuerUrl = 'https://provider.example.com';

      // Create a properly signed JWT
      const jwt = await new SignJWT({ sub: 'user123' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
        .setIssuer(issuerUrl)
        .setExpirationTime('1h')
        .sign(privateKey);

      const result = await service.verifyTransparentToken(jwt, [
        {
          id: 'provider1',
          issuerUrl,
          jwks: providerJwks as any,
        },
      ]);

      expect(result.ok).toBe(true);
      expect(result.sub).toBe('user123');
      expect(result.providerId).toBe('provider1');
    });

    it('should return error when no provider can verify token', async () => {
      const service = new JwksService();

      // Create a token that won't verify
      const header = { alg: 'RS256', typ: 'JWT', kid: 'unknown-kid' };
      const payload = { sub: 'user123', iss: 'https://issuer.com' };
      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = `${headerB64}.${payloadB64}.invalid-signature`;

      // Generate a key that won't match the token
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
      expect(result.error).toContain('no_provider_verified');
    });
  });

  describe('concurrent key initialization', () => {
    it('should handle concurrent calls to getPublicJwks', async () => {
      const service = new JwksService();

      // Make multiple concurrent calls
      const results = await Promise.all([
        service.getPublicJwks(),
        service.getPublicJwks(),
        service.getPublicJwks(),
        service.getPublicJwks(),
        service.getPublicJwks(),
      ]);

      // All should return the same JWKS with the same kid
      const firstKid = results[0].keys[0].kid;
      for (const jwks of results) {
        expect(jwks.keys[0].kid).toBe(firstKid);
      }
    });
  });
});
