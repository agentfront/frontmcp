/**
 * Auth Provider Detection Tests
 */
import type { AuthOptions } from '../../options/schema';
import {
  deriveProviderId,
  detectAuthProviders,
  appRequiresOrchestration,
  getProviderScopes,
  getProviderApps,
} from '../auth-provider-detection';
import { assertDefined } from '../../__test-utils__/assertion.helpers';

// ============================================
// Test Fixtures
// ============================================

function publicAuth(issuer?: string): AuthOptions {
  return {
    mode: 'public',
    sessionTtl: 3600,
    scopes: ['anonymous'],
    anonymousScopes: ['anonymous'],
    ...(issuer ? { issuer } : {}),
  } as AuthOptions;
}

function transparentAuth(providerUrl: string, opts?: { id?: string; requiredScopes?: string[] }): AuthOptions {
  return {
    mode: 'transparent',
    remote: {
      provider: providerUrl,
      ...(opts?.id ? { id: opts.id } : {}),
    },
    requiredScopes: opts?.requiredScopes ?? [],
    allowAnonymous: false,
    anonymousScopes: ['anonymous'],
  } as AuthOptions;
}

function orchestratedLocal(issuer?: string): AuthOptions {
  return {
    mode: 'orchestrated',
    type: 'local',
    tokenStorage: { type: 'memory' },
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
    ...(issuer ? { local: { issuer } } : {}),
  } as AuthOptions;
}

function orchestratedRemote(providerUrl: string, opts?: { id?: string; scopes?: string[] }): AuthOptions {
  return {
    mode: 'orchestrated',
    type: 'remote',
    remote: {
      provider: providerUrl,
      ...(opts?.id ? { id: opts.id } : {}),
      ...(opts?.scopes ? { scopes: opts.scopes } : {}),
    },
    tokenStorage: { type: 'memory' },
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
  } as AuthOptions;
}

// ============================================
// Tests
// ============================================

describe('auth-provider-detection', () => {
  // ------------------------------------------
  // deriveProviderId
  // ------------------------------------------
  describe('deriveProviderId', () => {
    it('should return "public" for public mode without issuer', () => {
      expect(deriveProviderId(publicAuth())).toBe('public');
    });

    it('should return issuer for public mode with issuer', () => {
      expect(deriveProviderId(publicAuth('https://my-issuer.com'))).toBe('https://my-issuer.com');
    });

    it('should return remote.id for transparent mode when id is set', () => {
      expect(deriveProviderId(transparentAuth('https://auth.example.com', { id: 'my-provider' }))).toBe('my-provider');
    });

    it('should return hostname-based id for transparent mode without id', () => {
      expect(deriveProviderId(transparentAuth('https://auth.example.com'))).toBe('auth_example_com');
    });

    it('should handle malformed URL in transparent mode', () => {
      const result = deriveProviderId(transparentAuth('not-a-url'));
      // urlToProviderId falls back to replacing non-alphanumeric with _
      expect(result).toBe('not_a_url');
    });

    it('should return remote.id for orchestrated remote when id is set', () => {
      expect(deriveProviderId(orchestratedRemote('https://auth.example.com', { id: 'remote-1' }))).toBe('remote-1');
    });

    it('should return hostname for orchestrated remote without id', () => {
      expect(deriveProviderId(orchestratedRemote('https://oauth.provider.io'))).toBe('oauth_provider_io');
    });

    it('should return local issuer for orchestrated local', () => {
      expect(deriveProviderId(orchestratedLocal('my-local-issuer'))).toBe('my-local-issuer');
    });

    it('should return "local" for orchestrated local without issuer', () => {
      expect(deriveProviderId(orchestratedLocal())).toBe('local');
    });

    it('should return "unknown" for unrecognized mode', () => {
      const options = { mode: 'something-else' } as unknown as AuthOptions;
      expect(deriveProviderId(options)).toBe('unknown');
    });
  });

  // ------------------------------------------
  // detectAuthProviders
  // ------------------------------------------
  describe('detectAuthProviders', () => {
    it('should return empty result when no parent and no apps', () => {
      const result = detectAuthProviders(undefined, []);
      expect(result.providers.size).toBe(0);
      expect(result.requiresOrchestration).toBe(false);
      expect(result.parentProviderId).toBeUndefined();
      expect(result.childProviderIds).toEqual([]);
      expect(result.uniqueProviderCount).toBe(0);
      expect(result.validationErrors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('should detect parent-only provider', () => {
      const result = detectAuthProviders(publicAuth('https://issuer.test'), []);
      expect(result.providers.size).toBe(1);
      expect(result.parentProviderId).toBe('https://issuer.test');
      expect(result.requiresOrchestration).toBe(false);
      expect(result.childProviderIds).toEqual([]);
      expect(result.uniqueProviderCount).toBe(1);
    });

    it('should detect app-only providers', () => {
      const apps = [{ id: 'app1', name: 'App1', auth: transparentAuth('https://auth.one.com') }];
      const result = detectAuthProviders(undefined, apps);
      expect(result.providers.size).toBe(1);
      expect(result.parentProviderId).toBeUndefined();
      expect(result.childProviderIds).toEqual(['auth_one_com']);
      expect(result.requiresOrchestration).toBe(true);
    });

    it('should detect parent + apps same provider', () => {
      const parent = transparentAuth('https://auth.shared.com', { id: 'shared' });
      const apps = [{ id: 'app1', name: 'App1', auth: transparentAuth('https://auth.shared.com', { id: 'shared' }) }];
      const result = detectAuthProviders(parent, apps);
      expect(result.providers.size).toBe(1);
      expect(result.parentProviderId).toBe('shared');
      // app was merged into the same provider entry
      const provider = result.providers.get('shared');
      assertDefined(provider);
      expect(provider.appIds).toContain('__parent__');
      expect(provider.appIds).toContain('app1');
      // Same provider merged => childProviderIds is empty and requiresOrchestration is false
      expect(result.childProviderIds).toEqual([]);
      expect(result.requiresOrchestration).toBe(false);
    });

    it('should detect parent + apps different providers (requires orchestration)', () => {
      const parent = transparentAuth('https://auth.parent.com', { id: 'parent-provider' });
      const apps = [
        { id: 'app1', name: 'App1', auth: transparentAuth('https://auth.child.com', { id: 'child-provider' }) },
      ];
      const result = detectAuthProviders(parent, apps);
      expect(result.providers.size).toBe(2);
      expect(result.requiresOrchestration).toBe(true);
      expect(result.childProviderIds).toContain('child-provider');
    });

    it('should merge scopes from multiple apps with same provider', () => {
      const apps = [
        {
          id: 'app1',
          name: 'App1',
          auth: transparentAuth('https://auth.shared.com', { id: 'shared', requiredScopes: ['read'] }),
        },
        {
          id: 'app2',
          name: 'App2',
          auth: transparentAuth('https://auth.shared.com', { id: 'shared', requiredScopes: ['write'] }),
        },
      ];
      const result = detectAuthProviders(undefined, apps);
      const provider = result.providers.get('shared');
      assertDefined(provider);
      expect(provider.scopes).toEqual(expect.arrayContaining(['read', 'write']));
      expect(provider.appIds).toEqual(['app1', 'app2']);
    });

    it('should skip apps without auth', () => {
      const apps = [
        { id: 'app1', name: 'App1' },
        { id: 'app2', name: 'App2', auth: transparentAuth('https://auth.test.com') },
      ];
      const result = detectAuthProviders(undefined, apps);
      expect(result.providers.size).toBe(1);
    });

    it('should set isParentProvider correctly', () => {
      const parent = publicAuth('parent-iss');
      const apps = [{ id: 'app1', name: 'App1', auth: transparentAuth('https://auth.child.com') }];
      const result = detectAuthProviders(parent, apps);
      const parentProvider = result.providers.get('parent-iss');
      assertDefined(parentProvider);
      expect(parentProvider.isParentProvider).toBe(true);
      const childProvider = result.providers.get('auth_child_com');
      assertDefined(childProvider);
      expect(childProvider.isParentProvider).toBe(false);
    });

    it('should produce validation error for transparent parent + multi providers', () => {
      const parent = transparentAuth('https://auth.parent.com');
      const apps = [{ id: 'app1', name: 'App1', auth: transparentAuth('https://auth.other.com') }];
      const result = detectAuthProviders(parent, apps);
      expect(result.validationErrors.length).toBeGreaterThan(0);
      expect(result.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('transparent mode')]));
      expect(result.validationErrors).toEqual(
        expect.arrayContaining([expect.stringContaining('incompatible with multi-provider')]),
      );
    });

    it('should produce warning for public parent + app providers', () => {
      const parent = publicAuth();
      const apps = [{ id: 'app1', name: 'App1', auth: transparentAuth('https://auth.child.com') }];
      const result = detectAuthProviders(parent, apps);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('public mode')]));
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('orchestrated mode')]));
    });

    it('should not produce warning for single public provider', () => {
      const result = detectAuthProviders(publicAuth(), []);
      expect(result.warnings).toEqual([]);
      expect(result.validationErrors).toEqual([]);
    });

    it('should set providerUrl for transparent mode', () => {
      const result = detectAuthProviders(transparentAuth('https://auth.test.com'), []);
      const provider = result.providers.get('auth_test_com');
      assertDefined(provider);
      expect(provider.providerUrl).toBe('https://auth.test.com');
    });

    it('should set providerUrl for orchestrated remote mode', () => {
      const result = detectAuthProviders(orchestratedRemote('https://auth.test.com'), []);
      const providerId = deriveProviderId(orchestratedRemote('https://auth.test.com'));
      const provider = result.providers.get(providerId);
      assertDefined(provider);
      expect(provider.providerUrl).toBe('https://auth.test.com');
    });

    it('should set providerUrl as undefined for public mode', () => {
      const result = detectAuthProviders(publicAuth(), []);
      const provider = result.providers.get('public');
      assertDefined(provider);
      expect(provider.providerUrl).toBeUndefined();
    });

    it('should set providerUrl as undefined for orchestrated local mode', () => {
      const result = detectAuthProviders(orchestratedLocal(), []);
      const provider = result.providers.get('local');
      assertDefined(provider);
      expect(provider.providerUrl).toBeUndefined();
    });

    it('should extract scopes for orchestrated remote', () => {
      const auth = orchestratedRemote('https://auth.test.com', { scopes: ['openid', 'profile'] });
      const result = detectAuthProviders(auth, []);
      const providerId = deriveProviderId(auth);
      const provider = result.providers.get(providerId);
      assertDefined(provider);
      expect(provider.scopes).toEqual(['openid', 'profile']);
    });
  });

  // ------------------------------------------
  // appRequiresOrchestration
  // ------------------------------------------
  describe('appRequiresOrchestration', () => {
    it('should return false when app has no auth', () => {
      expect(appRequiresOrchestration(undefined, publicAuth())).toBe(false);
    });

    it('should return false for public app without parent', () => {
      expect(appRequiresOrchestration(publicAuth(), undefined)).toBe(false);
    });

    it('should return true for non-public app without parent', () => {
      expect(appRequiresOrchestration(transparentAuth('https://auth.test.com'), undefined)).toBe(true);
    });

    it('should return false when app and parent have same provider', () => {
      const parent = transparentAuth('https://auth.shared.com', { id: 'shared' });
      const app = transparentAuth('https://auth.shared.com', { id: 'shared' });
      expect(appRequiresOrchestration(app, parent)).toBe(false);
    });

    it('should return true when app and parent have different providers', () => {
      const parent = transparentAuth('https://auth.parent.com', { id: 'parent' });
      const app = transparentAuth('https://auth.child.com', { id: 'child' });
      expect(appRequiresOrchestration(app, parent)).toBe(true);
    });
  });

  // ------------------------------------------
  // getProviderScopes
  // ------------------------------------------
  describe('getProviderScopes', () => {
    it('should return scopes for existing provider', () => {
      const auth = transparentAuth('https://auth.test.com', { id: 'test', requiredScopes: ['read', 'write'] });
      const result = detectAuthProviders(auth, []);
      expect(getProviderScopes(result, 'test')).toEqual(['read', 'write']);
    });

    it('should return empty array for unknown provider', () => {
      const result = detectAuthProviders(undefined, []);
      expect(getProviderScopes(result, 'nonexistent')).toEqual([]);
    });
  });

  // ------------------------------------------
  // getProviderApps
  // ------------------------------------------
  describe('getProviderApps', () => {
    it('should return app ids excluding __parent__', () => {
      const parent = transparentAuth('https://auth.shared.com', { id: 'shared' });
      const apps = [
        { id: 'app1', name: 'App1', auth: transparentAuth('https://auth.shared.com', { id: 'shared' }) },
        { id: 'app2', name: 'App2', auth: transparentAuth('https://auth.shared.com', { id: 'shared' }) },
      ];
      const result = detectAuthProviders(parent, apps);
      const appIds = getProviderApps(result, 'shared');
      expect(appIds).toEqual(['app1', 'app2']);
      expect(appIds).not.toContain('__parent__');
    });

    it('should return empty array for unknown provider', () => {
      const result = detectAuthProviders(undefined, []);
      expect(getProviderApps(result, 'nonexistent')).toEqual([]);
    });

    it('should return empty array for parent-only provider', () => {
      const result = detectAuthProviders(publicAuth('myissuer'), []);
      const appIds = getProviderApps(result, 'myissuer');
      expect(appIds).toEqual([]);
    });
  });
});
