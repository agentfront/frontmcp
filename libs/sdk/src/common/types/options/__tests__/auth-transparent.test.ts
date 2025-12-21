import { transparentAuthOptionsSchema, authPresetSchema } from '../auth.options';

describe('Transparent Auth Options Schema', () => {
  describe('Flat Config', () => {
    it('should accept flat config with provider URL', () => {
      const input = {
        mode: 'transparent' as const,
        provider: 'https://auth.example.com',
        clientId: 'my-client-id',
        expectedAudience: 'my-api',
      };

      const result = transparentAuthOptionsSchema.parse(input);

      expect(result.mode).toBe('transparent');
      expect(result.remote.provider).toBe('https://auth.example.com');
      expect(result.remote.clientId).toBe('my-client-id');
      expect(result.expectedAudience).toBe('my-api');
    });

    it('should accept flat config with all common fields', () => {
      const input = {
        mode: 'transparent' as const,
        provider: 'https://auth.example.com',
        clientId: 'client-123',
        clientSecret: 'secret-456',
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        expectedAudience: ['api1', 'api2'],
        allowAnonymous: true,
      };

      const result = transparentAuthOptionsSchema.parse(input);

      expect(result.remote.provider).toBe('https://auth.example.com');
      expect(result.remote.clientId).toBe('client-123');
      expect(result.remote.clientSecret).toBe('secret-456');
      expect(result.remote.jwksUri).toBe('https://auth.example.com/.well-known/jwks.json');
      expect(result.expectedAudience).toEqual(['api1', 'api2']);
      expect(result.allowAnonymous).toBe(true);
    });

    it('should accept flat config with advanced options', () => {
      const input = {
        mode: 'transparent' as const,
        provider: 'https://auth.example.com',
        clientId: 'my-client',
        advanced: {
          scopes: ['openid', 'profile', 'email'],
          dcrEnabled: true,
          name: 'My Auth Provider',
          tokenEndpoint: 'https://auth.example.com/oauth/token',
        },
      };

      const result = transparentAuthOptionsSchema.parse(input);

      expect(result.remote.scopes).toEqual(['openid', 'profile', 'email']);
      expect(result.remote.dcrEnabled).toBe(true);
      expect(result.remote.name).toBe('My Auth Provider');
      expect(result.remote.tokenEndpoint).toBe('https://auth.example.com/oauth/token');
    });
  });

  describe('Preset Config', () => {
    it('should resolve Frontegg preset', () => {
      const input = {
        mode: 'transparent' as const,
        preset: 'frontegg' as const,
        domain: 'sample-app.frontegg.com',
        clientId: 'frontegg-client',
      };

      const result = transparentAuthOptionsSchema.parse(input);

      expect(result.remote.provider).toBe('https://sample-app.frontegg.com');
      expect(result.remote.jwksUri).toBe('https://sample-app.frontegg.com/.well-known/jwks.json');
      expect(result.remote.clientId).toBe('frontegg-client');
    });

    it('should resolve Auth0 preset', () => {
      const input = {
        mode: 'transparent' as const,
        preset: 'auth0' as const,
        domain: 'my-tenant.auth0.com',
        clientId: 'auth0-client',
      };

      const result = transparentAuthOptionsSchema.parse(input);

      expect(result.remote.provider).toBe('https://my-tenant.auth0.com');
      expect(result.remote.jwksUri).toBe('https://my-tenant.auth0.com/.well-known/jwks.json');
    });

    it('should resolve Okta preset', () => {
      const input = {
        mode: 'transparent' as const,
        preset: 'okta' as const,
        domain: 'my-org.okta.com',
        clientId: 'okta-client',
      };

      const result = transparentAuthOptionsSchema.parse(input);

      expect(result.remote.provider).toBe('https://my-org.okta.com');
      expect(result.remote.jwksUri).toBe('https://my-org.okta.com/oauth2/v1/keys');
    });

    it('should allow custom jwksUri to override preset default', () => {
      const input = {
        mode: 'transparent' as const,
        preset: 'frontegg' as const,
        domain: 'sample-app.frontegg.com',
        jwksUri: 'https://custom.example.com/jwks',
      };

      const result = transparentAuthOptionsSchema.parse(input);

      expect(result.remote.provider).toBe('https://sample-app.frontegg.com');
      expect(result.remote.jwksUri).toBe('https://custom.example.com/jwks');
    });

    it('should require domain when preset is specified', () => {
      const input = {
        mode: 'transparent' as const,
        preset: 'frontegg' as const,
        clientId: 'my-client',
      };

      expect(() => transparentAuthOptionsSchema.parse(input)).toThrow();
    });
  });

  describe('Legacy Nested Config', () => {
    it('should accept legacy nested remote config', () => {
      const input = {
        mode: 'transparent' as const,
        remote: {
          provider: 'https://legacy-auth.example.com',
          clientId: 'legacy-client',
          scopes: ['read', 'write'],
        },
        expectedAudience: 'legacy-api',
      };

      const result = transparentAuthOptionsSchema.parse(input);

      expect(result.remote.provider).toBe('https://legacy-auth.example.com');
      expect(result.remote.clientId).toBe('legacy-client');
      expect(result.remote.scopes).toEqual(['read', 'write']);
      expect(result.expectedAudience).toBe('legacy-api');
    });

    it('should allow flat fields to override nested remote fields', () => {
      const input = {
        mode: 'transparent' as const,
        remote: {
          provider: 'https://auth.example.com',
          clientId: 'old-client',
        },
        clientId: 'new-client', // Override
        clientSecret: 'new-secret', // Add
      };

      const result = transparentAuthOptionsSchema.parse(input);

      expect(result.remote.clientId).toBe('new-client');
      expect(result.remote.clientSecret).toBe('new-secret');
    });

    it('should merge advanced options with nested remote', () => {
      const input = {
        mode: 'transparent' as const,
        remote: {
          provider: 'https://auth.example.com',
        },
        advanced: {
          scopes: ['extra-scope'],
          dcrEnabled: true,
        },
      };

      const result = transparentAuthOptionsSchema.parse(input);

      expect(result.remote.scopes).toEqual(['extra-scope']);
      expect(result.remote.dcrEnabled).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should reject config without provider, preset, or remote', () => {
      const input = {
        mode: 'transparent' as const,
        clientId: 'orphan-client',
        expectedAudience: 'api',
      };

      expect(() => transparentAuthOptionsSchema.parse(input)).toThrow(
        'Must specify provider, preset+domain, or remote configuration',
      );
    });

    it('should reject invalid provider URL', () => {
      const input = {
        mode: 'transparent' as const,
        provider: 'not-a-url',
        clientId: 'my-client',
      };

      expect(() => transparentAuthOptionsSchema.parse(input)).toThrow();
    });

    it('should reject invalid jwksUri URL', () => {
      const input = {
        mode: 'transparent' as const,
        provider: 'https://auth.example.com',
        jwksUri: 'not-a-url',
      };

      expect(() => transparentAuthOptionsSchema.parse(input)).toThrow();
    });

    it('should reject invalid preset', () => {
      const input = {
        mode: 'transparent' as const,
        preset: 'invalid-provider' as any,
        domain: 'example.com',
      };

      expect(() => transparentAuthOptionsSchema.parse(input)).toThrow();
    });
  });

  describe('Defaults', () => {
    it('should apply default values', () => {
      const input = {
        mode: 'transparent' as const,
        provider: 'https://auth.example.com',
      };

      const result = transparentAuthOptionsSchema.parse(input);

      expect(result.requiredScopes).toEqual([]);
      expect(result.allowAnonymous).toBe(false);
      expect(result.anonymousScopes).toEqual(['anonymous']);
      expect(result.remote.dcrEnabled).toBe(false);
    });
  });
});

describe('Auth Preset Schema', () => {
  it('should accept valid presets', () => {
    expect(authPresetSchema.parse('frontegg')).toBe('frontegg');
    expect(authPresetSchema.parse('auth0')).toBe('auth0');
    expect(authPresetSchema.parse('okta')).toBe('okta');
  });

  it('should reject invalid presets', () => {
    expect(() => authPresetSchema.parse('invalid')).toThrow();
    expect(() => authPresetSchema.parse('keycloak')).toThrow();
  });
});
