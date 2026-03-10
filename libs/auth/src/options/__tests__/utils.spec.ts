/**
 * Auth Options Utils Tests
 *
 * Tests for parsing, type guards, and access helpers for auth options.
 */
import { ZodError } from 'zod';
import {
  parseAuthOptions,
  isPublicMode,
  isTransparentMode,
  isOrchestratedMode,
  isOrchestratedLocal,
  isOrchestratedRemote,
  isLocalMode,
  isRemoteMode,
  allowsPublicAccess,
} from '../utils';
import type { AuthOptions } from '../schema';

describe('parseAuthOptions', () => {
  describe('public mode', () => {
    it('should parse valid public options with defaults', () => {
      const result = parseAuthOptions({ mode: 'public' });
      expect(result.mode).toBe('public');
      expect(result).toHaveProperty('sessionTtl', 3600);
      expect(result).toHaveProperty('anonymousScopes', ['anonymous']);
    });

    it('should parse public options with custom values', () => {
      const result = parseAuthOptions({
        mode: 'public',
        sessionTtl: 7200,
        anonymousScopes: ['read', 'anonymous'],
        issuer: 'https://my-server.com',
      });
      expect(result.mode).toBe('public');
      expect(result).toHaveProperty('sessionTtl', 7200);
      expect(result).toHaveProperty('anonymousScopes', ['read', 'anonymous']);
      expect(result).toHaveProperty('issuer', 'https://my-server.com');
    });
  });

  describe('transparent mode', () => {
    it('should parse valid transparent options with defaults', () => {
      const result = parseAuthOptions({
        mode: 'transparent',
        provider: 'https://auth.example.com',
        providerConfig: { id: 'auth0' },
      });
      expect(result.mode).toBe('transparent');
      expect(result).toHaveProperty('requiredScopes', []);
      expect(result).toHaveProperty('allowAnonymous', false);
      expect(result).toHaveProperty('anonymousScopes', ['anonymous']);
    });

    it('should parse transparent options with custom values', () => {
      const result = parseAuthOptions({
        mode: 'transparent',
        provider: 'https://auth.example.com',
        providerConfig: { id: 'auth0' },
        requiredScopes: ['read', 'write'],
        allowAnonymous: true,
        expectedAudience: 'https://api.example.com',
      });
      expect(result.mode).toBe('transparent');
      expect(result).toHaveProperty('requiredScopes', ['read', 'write']);
      expect(result).toHaveProperty('allowAnonymous', true);
      expect(result).toHaveProperty('expectedAudience', 'https://api.example.com');
    });
  });

  describe('local mode', () => {
    it('should parse valid local options with defaults', () => {
      const result = parseAuthOptions({
        mode: 'local',
      });
      expect(result.mode).toBe('local');
      expect(result).toHaveProperty('allowDefaultPublic', false);
      expect(result).toHaveProperty('anonymousScopes', ['anonymous']);
      expect(result).toHaveProperty('tokenStorage', 'memory');
    });

    it('should parse local options with custom values', () => {
      const result = parseAuthOptions({
        mode: 'local',
        allowDefaultPublic: true,
        anonymousScopes: ['public', 'read'],
      });
      expect(result.mode).toBe('local');
      expect(result).toHaveProperty('allowDefaultPublic', true);
      expect(result).toHaveProperty('anonymousScopes', ['public', 'read']);
    });
  });

  describe('remote mode', () => {
    it('should parse valid remote options', () => {
      const result = parseAuthOptions({
        mode: 'remote',
        provider: 'https://auth.example.com',
        providerConfig: { id: 'auth0' },
      });
      expect(result.mode).toBe('remote');
      expect(result).toHaveProperty('allowDefaultPublic', false);
    });

    it('should parse remote with full config', () => {
      const result = parseAuthOptions({
        mode: 'remote',
        provider: 'https://auth.example.com',
        clientId: 'my-client-id',
        scopes: ['openid', 'profile'],
        providerConfig: {
          id: 'auth0',
          name: 'Auth0 Provider',
        },
      });
      expect(result.mode).toBe('remote');
    });
  });

  describe('invalid options', () => {
    it('should throw ZodError for invalid mode', () => {
      expect(() => parseAuthOptions({ mode: 'invalid' } as unknown as Parameters<typeof parseAuthOptions>[0])).toThrow(
        ZodError,
      );
    });

    it('should throw ZodError for missing required fields', () => {
      expect(() => parseAuthOptions({} as unknown as Parameters<typeof parseAuthOptions>[0])).toThrow(ZodError);
    });

    it('should throw ZodError for transparent mode without provider', () => {
      expect(() =>
        parseAuthOptions({ mode: 'transparent' } as unknown as Parameters<typeof parseAuthOptions>[0]),
      ).toThrow(ZodError);
    });

    it('should throw ZodError for remote mode without provider', () => {
      expect(() =>
        parseAuthOptions({
          mode: 'remote',
        } as unknown as Parameters<typeof parseAuthOptions>[0]),
      ).toThrow(ZodError);
    });

    it('should throw ZodError for invalid remote provider URL', () => {
      expect(() =>
        parseAuthOptions({
          mode: 'transparent',
          provider: 'not-a-url',
          providerConfig: { id: 'test' },
        } as unknown as Parameters<typeof parseAuthOptions>[0]),
      ).toThrow(ZodError);
    });
  });
});

describe('isPublicMode', () => {
  it('should return true for public mode options', () => {
    const options: AuthOptions = parseAuthOptions({ mode: 'public' });
    expect(isPublicMode(options)).toBe(true);
  });

  it('should return false for transparent mode options', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      providerConfig: { id: 'auth0' },
    });
    expect(isPublicMode(options)).toBe(false);
  });

  it('should return false for local mode options', () => {
    const options: AuthOptions = parseAuthOptions({ mode: 'local' });
    expect(isPublicMode(options)).toBe(false);
  });

  it('should work with raw input objects', () => {
    expect(isPublicMode({ mode: 'public' })).toBe(true);
    expect(isPublicMode({ mode: 'transparent', provider: 'https://auth.example.com' })).toBe(false);
  });
});

describe('isTransparentMode', () => {
  it('should return true for transparent mode options', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      providerConfig: { id: 'auth0' },
    });
    expect(isTransparentMode(options)).toBe(true);
  });

  it('should return false for public mode options', () => {
    const options: AuthOptions = parseAuthOptions({ mode: 'public' });
    expect(isTransparentMode(options)).toBe(false);
  });

  it('should return false for local mode options', () => {
    const options: AuthOptions = parseAuthOptions({ mode: 'local' });
    expect(isTransparentMode(options)).toBe(false);
  });
});

describe('isLocalMode', () => {
  it('should return true for local mode options', () => {
    const options: AuthOptions = parseAuthOptions({ mode: 'local' });
    expect(isLocalMode(options)).toBe(true);
  });

  it('should return false for public mode options', () => {
    const options: AuthOptions = parseAuthOptions({ mode: 'public' });
    expect(isLocalMode(options)).toBe(false);
  });
});

describe('isRemoteMode', () => {
  it('should return true for remote mode options', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'remote',
      provider: 'https://auth.example.com',
      providerConfig: { id: 'auth0' },
    });
    expect(isRemoteMode(options)).toBe(true);
  });

  it('should return false for local mode options', () => {
    const options: AuthOptions = parseAuthOptions({ mode: 'local' });
    expect(isRemoteMode(options)).toBe(false);
  });
});

describe('isOrchestratedMode', () => {
  it('should return true for local mode options', () => {
    const options: AuthOptions = parseAuthOptions({ mode: 'local' });
    expect(isOrchestratedMode(options)).toBe(true);
  });

  it('should return true for remote mode options', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'remote',
      provider: 'https://auth.example.com',
      providerConfig: { id: 'auth0' },
    });
    expect(isOrchestratedMode(options)).toBe(true);
  });

  it('should return false for public mode options', () => {
    const options: AuthOptions = parseAuthOptions({ mode: 'public' });
    expect(isOrchestratedMode(options)).toBe(false);
  });

  it('should return false for transparent mode options', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      providerConfig: { id: 'auth0' },
    });
    expect(isOrchestratedMode(options)).toBe(false);
  });
});

describe('isOrchestratedLocal', () => {
  it('should return true for local mode', () => {
    const options = parseAuthOptions({ mode: 'local' });
    if (isOrchestratedMode(options)) {
      expect(isOrchestratedLocal(options)).toBe(true);
    }
  });

  it('should return false for remote mode', () => {
    const options = parseAuthOptions({
      mode: 'remote',
      provider: 'https://auth.example.com',
      providerConfig: { id: 'auth0' },
    });
    if (isOrchestratedMode(options)) {
      expect(isOrchestratedLocal(options)).toBe(false);
    }
  });
});

describe('isOrchestratedRemote', () => {
  it('should return true for remote mode', () => {
    const options = parseAuthOptions({
      mode: 'remote',
      provider: 'https://auth.example.com',
      providerConfig: { id: 'auth0' },
    });
    if (isOrchestratedMode(options)) {
      expect(isOrchestratedRemote(options)).toBe(true);
    }
  });

  it('should return false for local mode', () => {
    const options = parseAuthOptions({ mode: 'local' });
    if (isOrchestratedMode(options)) {
      expect(isOrchestratedRemote(options)).toBe(false);
    }
  });
});

describe('allowsPublicAccess', () => {
  it('should return true for public mode', () => {
    const options: AuthOptions = parseAuthOptions({ mode: 'public' });
    expect(allowsPublicAccess(options)).toBe(true);
  });

  it('should return true for transparent mode with allowAnonymous=true', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      providerConfig: { id: 'auth0' },
      allowAnonymous: true,
    });
    expect(allowsPublicAccess(options)).toBe(true);
  });

  it('should return false for transparent mode with allowAnonymous=false', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      providerConfig: { id: 'auth0' },
      allowAnonymous: false,
    });
    expect(allowsPublicAccess(options)).toBe(false);
  });

  it('should return false for transparent mode with default allowAnonymous', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'transparent',
      provider: 'https://auth.example.com',
      providerConfig: { id: 'auth0' },
    });
    // Default allowAnonymous is false
    expect(allowsPublicAccess(options)).toBe(false);
  });

  it('should return true for local mode with allowDefaultPublic=true', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'local',
      allowDefaultPublic: true,
    });
    expect(allowsPublicAccess(options)).toBe(true);
  });

  it('should return false for local mode with allowDefaultPublic=false', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'local',
      allowDefaultPublic: false,
    });
    expect(allowsPublicAccess(options)).toBe(false);
  });

  it('should return false for local mode with default allowDefaultPublic', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'local',
    });
    // Default allowDefaultPublic is false
    expect(allowsPublicAccess(options)).toBe(false);
  });

  it('should return true for remote with allowDefaultPublic=true', () => {
    const options: AuthOptions = parseAuthOptions({
      mode: 'remote',
      provider: 'https://auth.example.com',
      providerConfig: { id: 'auth0' },
      allowDefaultPublic: true,
    });
    expect(allowsPublicAccess(options)).toBe(true);
  });
});
