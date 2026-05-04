import {
  bundleSourceSchema,
  npmSourceSchema,
  saasSourceSchema,
  signatureKeySchema,
  staticSourceSchema,
} from '../source-options';

describe('source-options schemas', () => {
  describe('staticSourceSchema', () => {
    it('parses a valid static source with default watch=false', () => {
      const out = staticSourceSchema.parse({ type: 'static', path: './bundle.yaml' });
      expect(out).toEqual({ type: 'static', path: './bundle.yaml', watch: false });
    });

    it('rejects empty path', () => {
      expect(() => staticSourceSchema.parse({ type: 'static', path: '' })).toThrow();
    });
  });

  describe('npmSourceSchema', () => {
    it('parses a valid npm source with default verifyProvenance=true', () => {
      const out = npmSourceSchema.parse({ type: 'npm', packageName: '@acme/bundle' });
      expect(out.verifyProvenance).toBe(true);
    });

    it('accepts optional exportName and verifyProvenance=false', () => {
      const out = npmSourceSchema.parse({
        type: 'npm',
        packageName: '@acme/bundle',
        exportName: 'default',
        verifyProvenance: false,
      });
      expect(out.exportName).toBe('default');
      expect(out.verifyProvenance).toBe(false);
    });
  });

  describe('saasSourceSchema', () => {
    const baseSaas = {
      type: 'saas' as const,
      endpoint: 'https://cloud.frontmcp.dev/v1/bundles/abc',
      authToken: 'token-xyz',
      expectedAudience: 'aud',
      jwksUrl: 'https://cloud.frontmcp.dev/.well-known/jwks.json',
      expectedIssuer: 'iss',
    };

    it('parses with HTTPS endpoint and HTTPS jwksUrl', () => {
      const out = saasSourceSchema.parse(baseSaas);
      expect(out.pollIntervalMs).toBe(300_000);
      expect(out.enableWebhook).toBe(false);
    });

    it('rejects http:// endpoint (must be HTTPS)', () => {
      expect(() => saasSourceSchema.parse({ ...baseSaas, endpoint: 'http://insecure.example/x' })).toThrow();
    });

    it('rejects http:// jwksUrl (must be HTTPS)', () => {
      expect(() => saasSourceSchema.parse({ ...baseSaas, jwksUrl: 'http://insecure.example/jwks.json' })).toThrow();
    });

    it('rejects malformed URLs', () => {
      expect(() => saasSourceSchema.parse({ ...baseSaas, endpoint: 'not-a-url' })).toThrow();
    });

    it('rejects ftp:// scheme', () => {
      expect(() => saasSourceSchema.parse({ ...baseSaas, endpoint: 'ftp://example.com/x' })).toThrow();
    });
  });

  describe('bundleSourceSchema (discriminated union)', () => {
    it('routes static type', () => {
      const out = bundleSourceSchema.parse({ type: 'static', path: '/x' });
      expect(out.type).toBe('static');
    });

    it('routes npm type', () => {
      const out = bundleSourceSchema.parse({ type: 'npm', packageName: 'p' });
      expect(out.type).toBe('npm');
    });

    it('rejects unknown discriminator', () => {
      expect(() => bundleSourceSchema.parse({ type: 'unknown' as never })).toThrow();
    });
  });

  describe('signatureKeySchema', () => {
    it('parses a valid RS256 key', () => {
      const out = signatureKeySchema.parse({
        keyId: 'k1',
        alg: 'RS256',
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIB...\n-----END PUBLIC KEY-----',
      });
      expect(out.alg).toBe('RS256');
    });

    it('parses EdDSA alg', () => {
      const out = signatureKeySchema.parse({ keyId: 'k1', alg: 'EdDSA', publicKeyPem: 'pem' });
      expect(out.alg).toBe('EdDSA');
    });

    it('rejects unsupported alg', () => {
      expect(() => signatureKeySchema.parse({ keyId: 'k1', alg: 'HS256', publicKeyPem: 'pem' })).toThrow();
    });
  });
});
