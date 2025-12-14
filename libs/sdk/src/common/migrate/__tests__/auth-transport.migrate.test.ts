// common/migrate/__tests__/auth-transport.migrate.test.ts

import {
  needsMigration,
  migrateAuthTransportConfig,
  applyMigration,
  resetDeprecationWarning,
} from '../auth-transport.migrate';

describe('auth-transport migration', () => {
  beforeEach(() => {
    // Reset deprecation warning state before each test
    resetDeprecationWarning();
    // Suppress console.warn during tests
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('needsMigration', () => {
    it('should return false for new config structure', () => {
      const metadata = {
        transport: { enableStreamableHttp: true },
      };
      expect(needsMigration(metadata)).toBe(false);
    });

    it('should return true when auth.transport exists', () => {
      const metadata = {
        auth: {
          mode: 'public',
          transport: { enableStreamableHttp: true },
        },
      };
      expect(needsMigration(metadata)).toBe(true);
    });

    it('should return true when session exists', () => {
      const metadata = {
        session: { sessionMode: 'stateful' },
      };
      expect(needsMigration(metadata)).toBe(true);
    });

    it('should return true when both old configs exist', () => {
      const metadata = {
        auth: {
          mode: 'public',
          transport: { enableStreamableHttp: true },
        },
        session: { sessionMode: 'stateful' },
      };
      expect(needsMigration(metadata)).toBe(true);
    });

    it('should return false for empty auth without transport', () => {
      const metadata = {
        auth: { mode: 'public' },
      };
      expect(needsMigration(metadata)).toBe(false);
    });
  });

  describe('migrateAuthTransportConfig', () => {
    it('should return empty result when no migration needed', () => {
      const metadata = {
        transport: { enableStreamableHttp: true },
      };
      const result = migrateAuthTransportConfig(metadata);
      expect(result.transport).toBeUndefined();
      expect(result.redis).toBeUndefined();
      expect(result.auth).toBeUndefined();
    });

    it('should migrate session config to transport', () => {
      const metadata = {
        session: {
          sessionMode: 'stateless' as const,
          transportIdMode: 'jwt' as const,
          platformDetection: { customOnly: true },
        },
      };

      const result = migrateAuthTransportConfig(metadata);

      expect(result.transport?.sessionMode).toBe('stateless');
      expect(result.transport?.transportIdMode).toBe('jwt');
      expect(result.transport?.platformDetection?.customOnly).toBe(true);
    });

    it('should migrate auth.transport to transport', () => {
      const metadata = {
        auth: {
          mode: 'public',
          transport: {
            enableLegacySSE: true,
            enableSseListener: false,
            enableStreamableHttp: true,
            enableStatelessHttp: true,
            enableStatefulHttp: false,
            requireSessionForStreamable: false,
          },
        },
      };

      const result = migrateAuthTransportConfig(metadata);

      expect(result.transport?.enableLegacySSE).toBe(true);
      expect(result.transport?.enableSseListener).toBe(false);
      expect(result.transport?.enableStreamableHttp).toBe(true);
      expect(result.transport?.enableStatelessHttp).toBe(true);
      expect(result.transport?.enableStatefulHttp).toBe(false);
      expect(result.transport?.requireSessionForStreamable).toBe(false);
    });

    it('should migrate auth.transport.recreation to transport.persistence', () => {
      const metadata = {
        auth: {
          mode: 'public',
          transport: {
            recreation: {
              enabled: true,
              redis: { host: 'localhost', port: 6379 },
              defaultTtlMs: 7200000,
            },
          },
        },
      };

      const result = migrateAuthTransportConfig(metadata);

      expect(result.transport?.persistence?.enabled).toBe(true);
      expect(result.transport?.persistence?.redis?.host).toBe('localhost');
      expect(result.transport?.persistence?.defaultTtlMs).toBe(7200000);
    });

    it('should extract redis config to top-level', () => {
      const metadata = {
        auth: {
          mode: 'public',
          transport: {
            recreation: {
              enabled: true,
              redis: { host: 'redis.example.com', port: 6380 },
            },
          },
        },
      };

      const result = migrateAuthTransportConfig(metadata);

      expect(result.redis?.host).toBe('redis.example.com');
      expect(result.redis?.port).toBe(6380);
    });

    it('should not overwrite existing top-level redis', () => {
      const metadata = {
        redis: { host: 'existing-redis.com' },
        auth: {
          mode: 'public',
          transport: {
            recreation: {
              enabled: true,
              redis: { host: 'new-redis.com' },
            },
          },
        },
      };

      const result = migrateAuthTransportConfig(metadata);

      // Should not set redis since it already exists
      expect(result.redis).toBeUndefined();
    });

    it('should remove transport from auth config', () => {
      const metadata = {
        auth: {
          mode: 'public',
          issuer: 'https://example.com',
          transport: { enableStreamableHttp: true },
        },
      };

      const result = migrateAuthTransportConfig(metadata);

      expect(result.auth).toBeDefined();
      expect(result.auth?.mode).toBe('public');
      expect((result.auth as any).issuer).toBe('https://example.com');
      expect((result.auth as any).transport).toBeUndefined();
    });

    it('should merge session and auth.transport configs', () => {
      const metadata = {
        session: {
          sessionMode: 'stateless' as const,
          transportIdMode: 'jwt' as const,
        },
        auth: {
          mode: 'public',
          transport: {
            enableLegacySSE: true,
            enableStreamableHttp: false,
          },
        },
      };

      const result = migrateAuthTransportConfig(metadata);

      // From session
      expect(result.transport?.sessionMode).toBe('stateless');
      expect(result.transport?.transportIdMode).toBe('jwt');
      // From auth.transport
      expect(result.transport?.enableLegacySSE).toBe(true);
      expect(result.transport?.enableStreamableHttp).toBe(false);
    });
  });

  describe('applyMigration', () => {
    it('should return metadata unchanged when no migration needed', () => {
      const metadata = {
        transport: { enableStreamableHttp: true },
      };

      const result = applyMigration(metadata);

      expect(result).toBe(metadata);
    });

    it('should apply migrated transport config in place', () => {
      const metadata: any = {
        session: { sessionMode: 'stateless' },
      };

      const result = applyMigration(metadata);

      expect(result.transport?.sessionMode).toBe('stateless');
    });

    it('should apply migrated redis config in place', () => {
      const metadata: any = {
        auth: {
          mode: 'public',
          transport: {
            recreation: {
              enabled: true,
              redis: { host: 'localhost' },
            },
          },
        },
      };

      const result = applyMigration(metadata);

      expect(result.redis?.host).toBe('localhost');
    });

    it('should apply cleaned auth config', () => {
      const metadata: any = {
        auth: {
          mode: 'public',
          transport: { enableStreamableHttp: true },
        },
      };

      const result = applyMigration(metadata);

      expect(result.auth).toBeDefined();
      expect(result.auth?.transport).toBeUndefined();
    });

    it('should merge with existing transport config', () => {
      const metadata: any = {
        transport: { enableStatefulHttp: true },
        session: { sessionMode: 'stateless' },
      };

      const result = applyMigration(metadata);

      expect(result.transport?.enableStatefulHttp).toBe(true);
      expect(result.transport?.sessionMode).toBe('stateless');
    });
  });

  describe('deprecation warning', () => {
    it('should show deprecation warning once', () => {
      const warnSpy = jest.spyOn(console, 'warn');

      const metadata1: any = { session: { sessionMode: 'stateful' } };
      const metadata2: any = { session: { sessionMode: 'stateless' } };

      migrateAuthTransportConfig(metadata1);
      migrateAuthTransportConfig(metadata2);

      // Should only be called once due to the flag
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('should include migration guide URL in warning', () => {
      const warnSpy = jest.spyOn(console, 'warn');

      const metadata: any = { session: { sessionMode: 'stateful' } };
      migrateAuthTransportConfig(metadata);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://docs.frontmcp.dev/migrate/transport-config'),
      );
    });

    it('should mention auth.transport deprecation when applicable', () => {
      const warnSpy = jest.spyOn(console, 'warn');

      const metadata: any = {
        auth: { mode: 'public', transport: {} },
      };
      migrateAuthTransportConfig(metadata);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('auth.transport is deprecated'));
    });

    it('should mention session deprecation when applicable', () => {
      const warnSpy = jest.spyOn(console, 'warn');

      const metadata: any = { session: {} };
      migrateAuthTransportConfig(metadata);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('session is deprecated'));
    });
  });
});
