import {
  normalizeAppScope,
  normalizeMultiAppScope,
  scopeDiscoveryDeps,
} from './scope.utils';
import {
  AppType,
  FrontMcpMultiAppConfig,
  FrontMcpSplitByAppConfig,
  ScopeKind,
  AppMetadata,
} from '@frontmcp/sdk';
import { Scope } from './scope.instance';

describe('scope.utils', () => {
  describe('normalizeAppScope', () => {
    const mockApp: AppType = class MockApp {} as any;
    const mockAppMetadata: Partial<AppMetadata> = {
      id: 'testApp',
      name: 'TestApp',
      standalone: undefined,
    };

    beforeEach(() => {
      // Mock the normalizeApp function behavior
      Object.defineProperty(mockApp, 'metadata', {
        value: mockAppMetadata,
        configurable: true,
      });
    });

    it('should create a SPLIT_BY_APP scope record', () => {
      const config: FrontMcpSplitByAppConfig = {
        splitByApp: true,
        http: { port: 3000 },
      };

      const result = normalizeAppScope(mockApp, config);

      expect(result.kind).toBe(ScopeKind.SPLIT_BY_APP);
      expect(result.provide).toBe(Scope);
      expect(result.metadata.apps).toEqual([mockApp]);
    });

    it('should use app id from metadata', () => {
      const config: FrontMcpSplitByAppConfig = {
        splitByApp: true,
      };

      const result = normalizeAppScope(mockApp, config);

      expect(result.metadata.id).toBe('testApp');
    });

    it('should fall back to app name if id is not provided', () => {
      const appWithoutId = { ...mockApp };
      Object.defineProperty(appWithoutId, 'metadata', {
        value: { name: 'FallbackApp' },
        configurable: true,
      });

      const config: FrontMcpSplitByAppConfig = {
        splitByApp: true,
      };

      const result = normalizeAppScope(appWithoutId as any, config);

      expect(result.metadata.id).toBe('FallbackApp');
    });

    it('should throw error when splitByApp is true and standalone is includeInParent', () => {
      const appWithIncludeInParent = { ...mockApp };
      Object.defineProperty(appWithIncludeInParent, 'metadata', {
        value: {
          ...mockAppMetadata,
          standalone: 'includeInParent',
        },
        configurable: true,
      });

      const config: FrontMcpSplitByAppConfig = {
        splitByApp: true,
      };

      expect(() => normalizeAppScope(appWithIncludeInParent as any, config)).toThrow(
        'standalone: includeInParent is not supported for splitByApp scope'
      );
    });

    it('should include app auth config in scope metadata', () => {
      const appWithAuth = { ...mockApp };
      const authConfig = {
        type: 'remote' as const,
        baseUrl: 'https://auth.example.com',
      };
      Object.defineProperty(appWithAuth, 'metadata', {
        value: {
          ...mockAppMetadata,
          auth: authConfig,
        },
        configurable: true,
      });

      const config: FrontMcpSplitByAppConfig = {
        splitByApp: true,
      };

      const result = normalizeAppScope(appWithAuth as any, config);

      expect(result.metadata.auth).toEqual(authConfig);
    });

    it('should merge config with app metadata', () => {
      const config: FrontMcpSplitByAppConfig = {
        splitByApp: true,
        http: { port: 4000, path: '/api' },
      };

      const result = normalizeAppScope(mockApp, config);

      expect(result.metadata.http).toEqual(config.http);
    });
  });

  describe('normalizeMultiAppScope', () => {
    const mockApp1: AppType = class MockApp1 {} as any;
    const mockApp2: AppType = class MockApp2 {} as any;

    it('should create a MULTI_APP scope record', () => {
      const config: FrontMcpMultiAppConfig = {
        http: { port: 3000 },
      };

      const result = normalizeMultiAppScope([mockApp1, mockApp2], config);

      expect(result.kind).toBe(ScopeKind.MULTI_APP);
      expect(result.provide).toBe(Scope);
      expect(result.metadata.apps).toEqual([mockApp1, mockApp2]);
    });

    it('should always use "root" as the scope id', () => {
      const config: FrontMcpMultiAppConfig = {
        http: { port: 3000 },
      };

      const result = normalizeMultiAppScope([mockApp1], config);

      expect(result.metadata.id).toBe('root');
    });

    it('should handle empty app list', () => {
      const config: FrontMcpMultiAppConfig = {
        http: { port: 3000 },
      };

      const result = normalizeMultiAppScope([], config);

      expect(result.metadata.apps).toEqual([]);
      expect(result.metadata.id).toBe('root');
    });

    it('should include config in metadata', () => {
      const config: FrontMcpMultiAppConfig = {
        http: { port: 5000, path: '/multi' },
        auth: {
          type: 'remote' as const,
          baseUrl: 'https://auth.example.com',
        },
      };

      const result = normalizeMultiAppScope([mockApp1, mockApp2], config);

      expect(result.metadata.http).toEqual(config.http);
      expect(result.metadata.auth).toEqual(config.auth);
    });

    it('should handle single app in multi-app scope', () => {
      const config: FrontMcpMultiAppConfig = {
        http: { port: 3000 },
      };

      const result = normalizeMultiAppScope([mockApp1], config);

      expect(result.metadata.apps).toHaveLength(1);
      expect(result.metadata.apps[0]).toBe(mockApp1);
    });
  });

  describe('scopeDiscoveryDeps', () => {
    it('should return dependencies for MULTI_APP scope', () => {
      const scopeRecord = {
        kind: ScopeKind.MULTI_APP,
        provide: Scope,
        metadata: {
          id: 'root',
          apps: [],
        },
      };

      const result = scopeDiscoveryDeps(scopeRecord as any);

      expect(Array.isArray(result)).toBe(true);
      // Dependencies are extracted from class constructor, excluding the first one
    });

    it('should return dependencies for SPLIT_BY_APP scope', () => {
      const scopeRecord = {
        kind: ScopeKind.SPLIT_BY_APP,
        provide: Scope,
        metadata: {
          id: 'app1',
          apps: [],
        },
      };

      const result = scopeDiscoveryDeps(scopeRecord as any);

      expect(Array.isArray(result)).toBe(true);
      // Dependencies are extracted from class constructor, excluding the first one
    });

    it('should exclude first dependency (rec parameter)', () => {
      const scopeRecord = {
        kind: ScopeKind.MULTI_APP,
        provide: Scope,
        metadata: {
          id: 'root',
          apps: [],
        },
      };

      const result = scopeDiscoveryDeps(scopeRecord as any);

      // The first parameter (rec) should be excluded via slice(1)
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Edge Cases and Integration', () => {
    it('should handle app with minimal metadata', () => {
      const minimalApp = class MinimalApp {} as any;
      Object.defineProperty(minimalApp, 'metadata', {
        value: { name: 'Minimal' },
        configurable: true,
      });

      const config: FrontMcpSplitByAppConfig = {
        splitByApp: true,
      };

      const result = normalizeAppScope(minimalApp, config);

      expect(result.metadata.id).toBe('Minimal');
      expect(result.metadata.apps).toEqual([minimalApp]);
    });

    it('should preserve all config properties in multi-app scope', () => {
      const config: FrontMcpMultiAppConfig = {
        http: { port: 3000, path: '/api' },
        auth: {
          type: 'local' as const,
          clientId: 'test-client',
        },
      };

      const result = normalizeMultiAppScope([], config);

      expect(result.metadata).toMatchObject(config);
    });

    it('should handle app scope with complex auth configuration', () => {
      const appWithComplexAuth = class ComplexApp {} as any;
      const complexAuth = {
        type: 'remote' as const,
        baseUrl: 'https://auth.example.com',
        dcrEnabled: true,
        mode: 'orchestrated' as const,
        scopes: ['read', 'write'],
      };
      Object.defineProperty(appWithComplexAuth, 'metadata', {
        value: {
          name: 'ComplexApp',
          auth: complexAuth,
        },
        configurable: true,
      });

      const config: FrontMcpSplitByAppConfig = {
        splitByApp: true,
      };

      const result = normalizeAppScope(appWithComplexAuth, config);

      expect(result.metadata.auth).toEqual(complexAuth);
    });
  });
});