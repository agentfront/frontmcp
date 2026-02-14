/**
 * AuthProvidersRegistry Tests
 *
 * Tests for the credential provider registry that manages
 * registration, lookup, filtering, and normalization of
 * credential provider configurations.
 */

import { AuthProvidersRegistry } from '../auth-providers.registry';
import { CredentialProviderAlreadyRegisteredError } from '../../errors/auth-internal.errors';
import type { CredentialProviderConfig, CredentialScope, LoadingStrategy } from '../auth-providers.types';
import type { Credential } from '../../session';

/**
 * Helper to create a minimal valid CredentialProviderConfig.
 */
function makeProvider(
  name: string,
  opts: {
    scope?: CredentialScope;
    loading?: LoadingStrategy;
    cacheTtl?: number;
    required?: boolean;
    description?: string;
    metadata?: Record<string, unknown>;
  } = {},
): CredentialProviderConfig {
  return {
    name,
    scope: opts.scope ?? 'session',
    loading: opts.loading ?? 'lazy',
    factory: jest.fn().mockResolvedValue(null),
    cacheTtl: opts.cacheTtl,
    required: opts.required,
    description: opts.description,
    metadata: opts.metadata,
  };
}

describe('AuthProvidersRegistry', () => {
  let registry: AuthProvidersRegistry;

  beforeEach(() => {
    registry = new AuthProvidersRegistry();
  });

  // --------------------------------------------------
  // Constructor
  // --------------------------------------------------

  describe('constructor', () => {
    it('should create an empty registry with no options', () => {
      const r = new AuthProvidersRegistry();
      expect(r.size).toBe(0);
      expect(r.isEmpty()).toBe(true);
    });

    it('should create a registry with custom defaultCacheTtl', () => {
      const r = new AuthProvidersRegistry({ defaultCacheTtl: 5000 });
      r.register(makeProvider('test-prov'));

      const config = r.get('test-prov');
      expect(config).toBeDefined();
      // Should use the custom defaultCacheTtl since provider has no cacheTtl
      expect(config!.cacheTtl).toBe(5000);
    });

    it('should register providers passed in options', () => {
      const providers = [makeProvider('github'), makeProvider('openai')];
      const r = new AuthProvidersRegistry({ providers });

      expect(r.size).toBe(2);
      expect(r.has('github')).toBe(true);
      expect(r.has('openai')).toBe(true);
    });

    it('should use default cacheTtl of 3600000 (1 hour) when not specified', () => {
      const r = new AuthProvidersRegistry();
      r.register(makeProvider('test'));

      expect(r.get('test')!.cacheTtl).toBe(3600000);
    });
  });

  // --------------------------------------------------
  // register
  // --------------------------------------------------

  describe('register', () => {
    it('should add a provider to the registry', () => {
      registry.register(makeProvider('github'));
      expect(registry.has('github')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('should throw CredentialProviderAlreadyRegisteredError for duplicate names', () => {
      registry.register(makeProvider('github'));

      expect(() => {
        registry.register(makeProvider('github'));
      }).toThrow(CredentialProviderAlreadyRegisteredError);
    });

    it('should throw an error that is instanceof CredentialProviderAlreadyRegisteredError', () => {
      registry.register(makeProvider('dup'));

      try {
        registry.register(makeProvider('dup'));
        fail('Expected error to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CredentialProviderAlreadyRegisteredError);
      }
    });

    it('should normalize the config with defaults', () => {
      registry.register(makeProvider('normalized'));

      const config = registry.get('normalized')!;
      expect(config.required).toBe(false);
      expect(config.cacheTtl).toBe(3600000);
      expect(config.scope).toBe('session');
      expect(config.loading).toBe('lazy');
    });

    it('should preserve explicit provider config values', () => {
      registry.register(
        makeProvider('explicit', {
          scope: 'global',
          loading: 'eager',
          cacheTtl: 60000,
          required: true,
          description: 'A test provider',
          metadata: { env: 'prod' },
        }),
      );

      const config = registry.get('explicit')!;
      expect(config.scope).toBe('global');
      expect(config.loading).toBe('eager');
      expect(config.cacheTtl).toBe(60000);
      expect(config.required).toBe(true);
      expect(config.description).toBe('A test provider');
      expect(config.metadata).toEqual({ env: 'prod' });
    });
  });

  // --------------------------------------------------
  // unregister
  // --------------------------------------------------

  describe('unregister', () => {
    it('should remove a registered provider and return true', () => {
      registry.register(makeProvider('github'));
      expect(registry.unregister('github')).toBe(true);
      expect(registry.has('github')).toBe(false);
    });

    it('should return false for a non-existent provider', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });

    it('should decrease size after unregistering', () => {
      registry.register(makeProvider('a'));
      registry.register(makeProvider('b'));
      registry.unregister('a');
      expect(registry.size).toBe(1);
    });
  });

  // --------------------------------------------------
  // get
  // --------------------------------------------------

  describe('get', () => {
    it('should return NormalizedProviderConfig for registered provider', () => {
      registry.register(makeProvider('github'));

      const config = registry.get('github');
      expect(config).toBeDefined();
      expect(config!.name).toBe('github');
    });

    it('should return undefined for unregistered provider', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('should return config with factory function', () => {
      const factoryFn = jest.fn().mockResolvedValue({ type: 'bearer', token: 'tok' });
      registry.register({ ...makeProvider('with-factory'), factory: factoryFn });

      const config = registry.get('with-factory')!;
      expect(config.factory).toBe(factoryFn);
    });
  });

  // --------------------------------------------------
  // has
  // --------------------------------------------------

  describe('has', () => {
    it('should return true for registered provider', () => {
      registry.register(makeProvider('exists'));
      expect(registry.has('exists')).toBe(true);
    });

    it('should return false for non-existent provider', () => {
      expect(registry.has('nope')).toBe(false);
    });
  });

  // --------------------------------------------------
  // getNames
  // --------------------------------------------------

  describe('getNames', () => {
    it('should return all registered provider names', () => {
      registry.register(makeProvider('github'));
      registry.register(makeProvider('openai'));
      registry.register(makeProvider('aws'));

      const names = registry.getNames();
      expect(names).toHaveLength(3);
      expect(names).toContain('github');
      expect(names).toContain('openai');
      expect(names).toContain('aws');
    });

    it('should return empty array when no providers registered', () => {
      expect(registry.getNames()).toEqual([]);
    });
  });

  // --------------------------------------------------
  // getAll
  // --------------------------------------------------

  describe('getAll', () => {
    it('should return all registered provider configs', () => {
      registry.register(makeProvider('a'));
      registry.register(makeProvider('b'));

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((p) => p.name)).toContain('a');
      expect(all.map((p) => p.name)).toContain('b');
    });

    it('should return empty array when registry is empty', () => {
      expect(registry.getAll()).toEqual([]);
    });
  });

  // --------------------------------------------------
  // getByScope
  // --------------------------------------------------

  describe('getByScope', () => {
    beforeEach(() => {
      registry.register(makeProvider('global1', { scope: 'global' }));
      registry.register(makeProvider('global2', { scope: 'global' }));
      registry.register(makeProvider('user1', { scope: 'user' }));
      registry.register(makeProvider('session1', { scope: 'session' }));
    });

    it('should filter by global scope', () => {
      const results = registry.getByScope('global');
      expect(results).toHaveLength(2);
      expect(results.every((p) => p.scope === 'global')).toBe(true);
    });

    it('should filter by user scope', () => {
      const results = registry.getByScope('user');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('user1');
    });

    it('should filter by session scope', () => {
      const results = registry.getByScope('session');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('session1');
    });

    it('should return empty array when no providers match scope', () => {
      const emptyRegistry = new AuthProvidersRegistry();
      expect(emptyRegistry.getByScope('global')).toEqual([]);
    });
  });

  // --------------------------------------------------
  // getByLoading
  // --------------------------------------------------

  describe('getByLoading', () => {
    beforeEach(() => {
      registry.register(makeProvider('eager1', { loading: 'eager' }));
      registry.register(makeProvider('eager2', { loading: 'eager' }));
      registry.register(makeProvider('lazy1', { loading: 'lazy' }));
    });

    it('should filter by eager loading strategy', () => {
      const results = registry.getByLoading('eager');
      expect(results).toHaveLength(2);
      expect(results.every((p) => p.loading === 'eager')).toBe(true);
    });

    it('should filter by lazy loading strategy', () => {
      const results = registry.getByLoading('lazy');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('lazy1');
    });
  });

  // --------------------------------------------------
  // getRequired
  // --------------------------------------------------

  describe('getRequired', () => {
    it('should return only required providers', () => {
      registry.register(makeProvider('req1', { required: true }));
      registry.register(makeProvider('req2', { required: true }));
      registry.register(makeProvider('opt1', { required: false }));
      registry.register(makeProvider('opt2')); // defaults to false

      const required = registry.getRequired();
      expect(required).toHaveLength(2);
      expect(required.every((p) => p.required === true)).toBe(true);
    });

    it('should return empty array when no required providers', () => {
      registry.register(makeProvider('opt'));
      expect(registry.getRequired()).toEqual([]);
    });
  });

  // --------------------------------------------------
  // getEager / getLazy
  // --------------------------------------------------

  describe('getEager', () => {
    it('should return providers with eager loading', () => {
      registry.register(makeProvider('e1', { loading: 'eager' }));
      registry.register(makeProvider('l1', { loading: 'lazy' }));

      const eager = registry.getEager();
      expect(eager).toHaveLength(1);
      expect(eager[0].name).toBe('e1');
    });
  });

  describe('getLazy', () => {
    it('should return providers with lazy loading', () => {
      registry.register(makeProvider('e1', { loading: 'eager' }));
      registry.register(makeProvider('l1', { loading: 'lazy' }));
      registry.register(makeProvider('l2', { loading: 'lazy' }));

      const lazy = registry.getLazy();
      expect(lazy).toHaveLength(2);
      expect(lazy.every((p) => p.loading === 'lazy')).toBe(true);
    });
  });

  // --------------------------------------------------
  // size
  // --------------------------------------------------

  describe('size', () => {
    it('should return 0 for empty registry', () => {
      expect(registry.size).toBe(0);
    });

    it('should reflect the number of registered providers', () => {
      registry.register(makeProvider('a'));
      registry.register(makeProvider('b'));
      registry.register(makeProvider('c'));
      expect(registry.size).toBe(3);
    });
  });

  // --------------------------------------------------
  // isEmpty
  // --------------------------------------------------

  describe('isEmpty', () => {
    it('should return true for empty registry', () => {
      expect(registry.isEmpty()).toBe(true);
    });

    it('should return false when providers are registered', () => {
      registry.register(makeProvider('a'));
      expect(registry.isEmpty()).toBe(false);
    });
  });

  // --------------------------------------------------
  // clear
  // --------------------------------------------------

  describe('clear', () => {
    it('should remove all registered providers', () => {
      registry.register(makeProvider('a'));
      registry.register(makeProvider('b'));

      registry.clear();

      expect(registry.size).toBe(0);
      expect(registry.isEmpty()).toBe(true);
      expect(registry.has('a')).toBe(false);
      expect(registry.has('b')).toBe(false);
    });

    it('should be safe to call on an empty registry', () => {
      registry.clear();
      expect(registry.size).toBe(0);
    });

    it('should allow re-registration after clear', () => {
      registry.register(makeProvider('a'));
      registry.clear();
      registry.register(makeProvider('a'));
      expect(registry.has('a')).toBe(true);
    });
  });

  // --------------------------------------------------
  // Normalization defaults
  // --------------------------------------------------

  describe('normalization', () => {
    it('should default required to false', () => {
      registry.register(makeProvider('test'));
      expect(registry.get('test')!.required).toBe(false);
    });

    it('should apply defaultCacheTtl when provider has no cacheTtl', () => {
      const r = new AuthProvidersRegistry({ defaultCacheTtl: 120000 });
      r.register(makeProvider('no-ttl'));

      expect(r.get('no-ttl')!.cacheTtl).toBe(120000);
    });

    it('should preserve provider-specific cacheTtl over defaultCacheTtl', () => {
      const r = new AuthProvidersRegistry({ defaultCacheTtl: 120000 });
      r.register(makeProvider('custom-ttl', { cacheTtl: 30000 }));

      expect(r.get('custom-ttl')!.cacheTtl).toBe(30000);
    });

    it('should preserve refresh function if provided', () => {
      const refreshFn = jest.fn().mockResolvedValue(null);
      registry.register({ ...makeProvider('with-refresh'), refresh: refreshFn });

      expect(registry.get('with-refresh')!.refresh).toBe(refreshFn);
    });

    it('should preserve toHeaders function if provided', () => {
      const headersFn = jest.fn().mockReturnValue({ Authorization: 'Bearer tok' });
      registry.register({ ...makeProvider('with-headers'), toHeaders: headersFn });

      expect(registry.get('with-headers')!.toHeaders).toBe(headersFn);
    });
  });
});
