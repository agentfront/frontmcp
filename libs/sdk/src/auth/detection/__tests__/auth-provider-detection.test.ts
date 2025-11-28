/**
 * Auth Provider Detection Tests
 *
 * Tests the detection of unique auth providers across nested apps
 * and validation of orchestration requirements.
 */
import {
  detectAuthProviders,
  deriveProviderId,
  appRequiresOrchestration,
  getProviderScopes,
  getProviderApps,
  AppAuthInfo,
  AuthProviderDetectionResult,
} from '../auth-provider-detection';
import { AuthOptions } from '../../../common';

// ============================================
// Test-specific partial types
// ============================================
// These types represent the minimal shape needed for auth detection tests.
// The actual AuthOptions types have many required fields for runtime,
// but the detection functions only access specific properties.

/** Minimal public auth options for testing */
type TestPublicAuthOptions = {
  mode: 'public';
  issuer?: string;
};

/** Minimal transparent auth options for testing */
type TestTransparentAuthOptions = {
  mode: 'transparent';
  remote: {
    id?: string;
    provider: string;
    clientId?: string;
  };
  requiredScopes?: string[];
};

/** Minimal orchestrated local auth options for testing */
type TestOrchestratedLocalOptions = {
  mode: 'orchestrated';
  type: 'local';
  local?: {
    issuer?: string;
  };
};

/** Minimal orchestrated remote auth options for testing */
type TestOrchestratedRemoteOptions = {
  mode: 'orchestrated';
  type: 'remote';
  remote: {
    id?: string;
    provider: string;
    clientId?: string;
    clientSecret?: string;
    scopes?: string[];
  };
};

type TestOrchestratedAuthOptions = TestOrchestratedLocalOptions | TestOrchestratedRemoteOptions;

describe('Auth Provider Detection', () => {
  // ============================================
  // deriveProviderId Tests
  // ============================================

  describe('deriveProviderId', () => {
    it('should return issuer for public mode with custom issuer', () => {
      const options: TestPublicAuthOptions = {
        mode: 'public',
        issuer: 'my-custom-issuer',
      };
      expect(deriveProviderId(options as AuthOptions)).toBe('my-custom-issuer');
    });

    it('should return "public" for public mode without issuer', () => {
      const options: TestPublicAuthOptions = {
        mode: 'public',
      };
      expect(deriveProviderId(options as AuthOptions)).toBe('public');
    });

    it('should derive provider ID from URL for transparent mode', () => {
      const options: TestTransparentAuthOptions = {
        mode: 'transparent',
        remote: {
          provider: 'https://auth.example.com/.well-known/openid-configuration',
          clientId: 'client123',
        },
      };
      expect(deriveProviderId(options as AuthOptions)).toBe('auth_example_com');
    });

    it('should use explicit id for transparent mode if provided', () => {
      const options: TestTransparentAuthOptions = {
        mode: 'transparent',
        remote: {
          id: 'my-provider',
          provider: 'https://auth.example.com/.well-known/openid-configuration',
          clientId: 'client123',
        },
      };
      expect(deriveProviderId(options as AuthOptions)).toBe('my-provider');
    });

    it('should derive provider ID from URL for orchestrated remote mode', () => {
      const options: TestOrchestratedRemoteOptions = {
        mode: 'orchestrated',
        type: 'remote',
        remote: {
          provider: 'https://oauth.provider.com/authorize',
          clientId: 'client123',
          clientSecret: 'secret',
        },
      };
      expect(deriveProviderId(options as AuthOptions)).toBe('oauth_provider_com');
    });

    it('should use issuer for orchestrated local mode', () => {
      const options: TestOrchestratedLocalOptions = {
        mode: 'orchestrated',
        type: 'local',
        local: {
          issuer: 'my-local-issuer',
        },
      };
      expect(deriveProviderId(options as AuthOptions)).toBe('my-local-issuer');
    });

    it('should return "local" for orchestrated local mode without issuer', () => {
      const options: TestOrchestratedLocalOptions = {
        mode: 'orchestrated',
        type: 'local',
      };
      expect(deriveProviderId(options as AuthOptions)).toBe('local');
    });
  });

  // ============================================
  // detectAuthProviders Tests
  // ============================================

  describe('detectAuthProviders', () => {
    it('should detect single parent provider with no apps', () => {
      const parentAuth: TestPublicAuthOptions = {
        mode: 'public',
        issuer: 'parent-issuer',
      };

      const result = detectAuthProviders(parentAuth as AuthOptions, []);

      expect(result.uniqueProviderCount).toBe(1);
      expect(result.requiresOrchestration).toBe(false);
      expect(result.parentProviderId).toBe('parent-issuer');
      expect(result.childProviderIds).toEqual([]);
      expect(result.validationErrors).toEqual([]);
    });

    it('should detect apps inheriting from parent (no app auth)', () => {
      const parentAuth: TestOrchestratedLocalOptions = {
        mode: 'orchestrated',
        type: 'local',
        local: { issuer: 'parent' },
      };

      const apps: AppAuthInfo[] = [
        { id: 'app1', name: 'App 1' }, // No auth = inherits
        { id: 'app2', name: 'App 2' }, // No auth = inherits
      ];

      const result = detectAuthProviders(parentAuth as AuthOptions, apps);

      expect(result.uniqueProviderCount).toBe(1);
      expect(result.requiresOrchestration).toBe(false);
      expect(result.providers.get('parent')?.appIds).toEqual(['__parent__']);
    });

    it('should detect multiple unique auth providers requiring orchestration', () => {
      const parentAuth: TestOrchestratedLocalOptions = {
        mode: 'orchestrated',
        type: 'local',
        local: { issuer: 'parent' },
      };

      const apps: AppAuthInfo[] = [
        {
          id: 'slack',
          name: 'Slack',
          auth: {
            mode: 'transparent',
            remote: {
              id: 'slack-auth',
              provider: 'https://slack.com/oauth',
              clientId: 'slack-client',
            },
          } as AuthOptions,
        },
        {
          id: 'github',
          name: 'GitHub',
          auth: {
            mode: 'transparent',
            remote: {
              id: 'github-auth',
              provider: 'https://github.com/oauth',
              clientId: 'github-client',
            },
          } as AuthOptions,
        },
      ];

      const result = detectAuthProviders(parentAuth as AuthOptions, apps);

      expect(result.uniqueProviderCount).toBe(3); // parent + slack + github
      expect(result.requiresOrchestration).toBe(true);
      expect(result.parentProviderId).toBe('parent');
      expect(result.childProviderIds).toContain('slack-auth');
      expect(result.childProviderIds).toContain('github-auth');
    });

    it('should merge apps using the same provider', () => {
      const parentAuth: TestOrchestratedLocalOptions = {
        mode: 'orchestrated',
        type: 'local',
        local: { issuer: 'parent' },
      };

      const apps: AppAuthInfo[] = [
        {
          id: 'app1',
          name: 'App 1',
          auth: {
            mode: 'transparent',
            remote: {
              id: 'shared-provider',
              provider: 'https://shared.com/oauth',
              clientId: 'client1',
            },
            requiredScopes: ['scope1', 'scope2'],
          } as AuthOptions,
        },
        {
          id: 'app2',
          name: 'App 2',
          auth: {
            mode: 'transparent',
            remote: {
              id: 'shared-provider',
              provider: 'https://shared.com/oauth',
              clientId: 'client2',
            },
            requiredScopes: ['scope2', 'scope3'],
          } as AuthOptions,
        },
      ];

      const result = detectAuthProviders(parentAuth as AuthOptions, apps);

      expect(result.uniqueProviderCount).toBe(2); // parent + shared
      expect(result.requiresOrchestration).toBe(true);

      const sharedProvider = result.providers.get('shared-provider');
      expect(sharedProvider).toBeDefined();
      expect(sharedProvider?.appIds).toContain('app1');
      expect(sharedProvider?.appIds).toContain('app2');
      // Scopes should be merged and deduplicated
      expect(sharedProvider?.scopes).toContain('scope1');
      expect(sharedProvider?.scopes).toContain('scope2');
      expect(sharedProvider?.scopes).toContain('scope3');
    });

    it('should error when transparent mode used with child providers', () => {
      const parentAuth: TestTransparentAuthOptions = {
        mode: 'transparent',
        remote: {
          provider: 'https://parent.com/oauth',
          clientId: 'parent-client',
        },
      };

      const apps: AppAuthInfo[] = [
        {
          id: 'app1',
          name: 'App 1',
          auth: {
            mode: 'transparent',
            remote: {
              id: 'child-provider',
              provider: 'https://child.com/oauth',
              clientId: 'child-client',
            },
          } as AuthOptions,
        },
      ];

      const result = detectAuthProviders(parentAuth as AuthOptions, apps);

      expect(result.requiresOrchestration).toBe(true);
      expect(result.validationErrors.length).toBeGreaterThan(0);
      expect(result.validationErrors[0]).toContain('transparent mode');
      expect(result.validationErrors[0]).toContain('orchestrated mode');
    });

    it('should warn when public parent has apps with auth', () => {
      const parentAuth: TestPublicAuthOptions = {
        mode: 'public',
      };

      const apps: AppAuthInfo[] = [
        {
          id: 'app1',
          name: 'App 1',
          auth: {
            mode: 'transparent',
            remote: {
              id: 'child-provider',
              provider: 'https://child.com/oauth',
              clientId: 'child-client',
            },
          } as AuthOptions,
        },
      ];

      const result = detectAuthProviders(parentAuth as AuthOptions, apps);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('public mode');
      expect(result.warnings[0]).toContain('orchestrated mode');
    });

    it('should handle apps with orchestrated remote auth', () => {
      const parentAuth: TestOrchestratedLocalOptions = {
        mode: 'orchestrated',
        type: 'local',
        local: { issuer: 'parent' },
      };

      const apps: AppAuthInfo[] = [
        {
          id: 'salesforce',
          name: 'Salesforce',
          auth: {
            mode: 'orchestrated',
            type: 'remote',
            remote: {
              id: 'salesforce-auth',
              provider: 'https://login.salesforce.com/oauth',
              clientId: 'sf-client',
              clientSecret: 'sf-secret',
              scopes: ['api', 'refresh_token'],
            },
          } as AuthOptions,
        },
      ];

      const result = detectAuthProviders(parentAuth as AuthOptions, apps);

      expect(result.uniqueProviderCount).toBe(2);
      expect(result.requiresOrchestration).toBe(true);

      const sfProvider = result.providers.get('salesforce-auth');
      expect(sfProvider).toBeDefined();
      expect(sfProvider?.scopes).toContain('api');
      expect(sfProvider?.scopes).toContain('refresh_token');
    });

    it('should detect orchestration needed when no parent auth but apps have auth', () => {
      const apps: AppAuthInfo[] = [
        {
          id: 'app1',
          name: 'App 1',
          auth: {
            mode: 'transparent',
            remote: {
              id: 'provider1',
              provider: 'https://provider1.com/oauth',
              clientId: 'client1',
            },
          } as AuthOptions,
        },
      ];

      const result = detectAuthProviders(undefined, apps);

      expect(result.requiresOrchestration).toBe(true);
      expect(result.parentProviderId).toBeUndefined();
      expect(result.childProviderIds).toContain('provider1');
    });
  });

  // ============================================
  // appRequiresOrchestration Tests
  // ============================================

  describe('appRequiresOrchestration', () => {
    it('should return false when app has no auth (inherits)', () => {
      const parentAuth: TestOrchestratedLocalOptions = {
        mode: 'orchestrated',
        type: 'local',
      };

      expect(appRequiresOrchestration(undefined, parentAuth as AuthOptions)).toBe(false);
    });

    it('should return false when app uses public mode with no parent', () => {
      const appAuth: TestPublicAuthOptions = {
        mode: 'public',
      };

      expect(appRequiresOrchestration(appAuth as AuthOptions, undefined)).toBe(false);
    });

    it('should return true when app has different provider than parent', () => {
      const appAuth: TestTransparentAuthOptions = {
        mode: 'transparent',
        remote: {
          id: 'app-provider',
          provider: 'https://app.com/oauth',
          clientId: 'app-client',
        },
      };

      const parentAuth: TestOrchestratedLocalOptions = {
        mode: 'orchestrated',
        type: 'local',
        local: { issuer: 'parent' },
      };

      expect(appRequiresOrchestration(appAuth as AuthOptions, parentAuth as AuthOptions)).toBe(true);
    });

    it('should return false when app uses same provider as parent', () => {
      const appAuth: TestTransparentAuthOptions = {
        mode: 'transparent',
        remote: {
          id: 'shared-provider',
          provider: 'https://shared.com/oauth',
          clientId: 'app-client',
        },
      };

      const parentAuth: TestTransparentAuthOptions = {
        mode: 'transparent',
        remote: {
          id: 'shared-provider',
          provider: 'https://shared.com/oauth',
          clientId: 'parent-client',
        },
      };

      expect(appRequiresOrchestration(appAuth as AuthOptions, parentAuth as AuthOptions)).toBe(false);
    });
  });

  // ============================================
  // Helper Function Tests
  // ============================================

  describe('getProviderScopes', () => {
    it('should return scopes for existing provider', () => {
      const result: AuthProviderDetectionResult = {
        providers: new Map([
          [
            'test-provider',
            {
              id: 'test-provider',
              mode: 'transparent',
              appIds: ['app1'],
              scopes: ['read', 'write'],
              isParentProvider: false,
            },
          ],
        ]),
        requiresOrchestration: false,
        childProviderIds: ['test-provider'],
        uniqueProviderCount: 1,
        validationErrors: [],
        warnings: [],
      };

      expect(getProviderScopes(result, 'test-provider')).toEqual(['read', 'write']);
    });

    it('should return empty array for non-existent provider', () => {
      const result: AuthProviderDetectionResult = {
        providers: new Map(),
        requiresOrchestration: false,
        childProviderIds: [],
        uniqueProviderCount: 0,
        validationErrors: [],
        warnings: [],
      };

      expect(getProviderScopes(result, 'non-existent')).toEqual([]);
    });
  });

  describe('getProviderApps', () => {
    it('should return apps for provider excluding __parent__', () => {
      const result: AuthProviderDetectionResult = {
        providers: new Map([
          [
            'test-provider',
            {
              id: 'test-provider',
              mode: 'orchestrated',
              appIds: ['__parent__', 'app1', 'app2'],
              scopes: [],
              isParentProvider: true,
            },
          ],
        ]),
        requiresOrchestration: false,
        parentProviderId: 'test-provider',
        childProviderIds: [],
        uniqueProviderCount: 1,
        validationErrors: [],
        warnings: [],
      };

      const apps = getProviderApps(result, 'test-provider');
      expect(apps).toContain('app1');
      expect(apps).toContain('app2');
      expect(apps).not.toContain('__parent__');
    });

    it('should return empty array for non-existent provider', () => {
      const result: AuthProviderDetectionResult = {
        providers: new Map(),
        requiresOrchestration: false,
        childProviderIds: [],
        uniqueProviderCount: 0,
        validationErrors: [],
        warnings: [],
      };

      expect(getProviderApps(result, 'non-existent')).toEqual([]);
    });
  });
});
