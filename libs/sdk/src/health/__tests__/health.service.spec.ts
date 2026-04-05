import { HealthService } from '../health.service';
import type { HealthScopeView } from '../health.service';
import type { HealthProbe } from '../health.types';

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => ({
  sha256Hex: jest.fn((data: string) => {
    // Simple deterministic hash for testing — uses content, not just length
    let h = 0;
    for (let i = 0; i < data.length; i++) {
      h = ((h << 5) - h + data.charCodeAt(i)) | 0;
    }
    return `hash_${h.toString(16)}`;
  }),
  getRuntimeContext: jest.fn(() => ({
    platform: 'linux',
    runtime: 'node',
    deployment: 'standalone',
    env: 'test',
  })),
}));

function createMockScope(overrides: Partial<HealthScopeView> = {}): HealthScopeView {
  return {
    transportService: { pingSessionStore: jest.fn().mockResolvedValue(true) },
    tools: { getTools: jest.fn().mockReturnValue([{ name: 'tool-a' }, { name: 'tool-b' }]) },
    resources: { getResources: jest.fn().mockReturnValue([{}, {}]) },
    prompts: { getPrompts: jest.fn().mockReturnValue([{}]) },
    skills: { getSkills: jest.fn().mockReturnValue([]) },
    agents: { getAgents: jest.fn().mockReturnValue([]) },
    apps: { getApps: jest.fn().mockReturnValue([]) },
    ...overrides,
  };
}

const defaultConfig = {
  enabled: true,
  healthzPath: '/healthz',
  readyzPath: '/readyz',
  probes: [],
};

const defaultServerInfo = { name: 'test-server', version: '1.0.0' };

describe('HealthService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getHealthz', () => {
    it('should return correct liveness response', () => {
      const service = new HealthService(defaultConfig, defaultServerInfo);

      const result = service.getHealthz();

      expect(result.status).toBe('ok');
      expect(result.server.name).toBe('test-server');
      expect(result.server.version).toBe('1.0.0');
      expect(result.runtime.platform).toBe('linux');
      expect(result.runtime.runtime).toBe('node');
      expect(result.runtime.deployment).toBe('standalone');
      expect(result.runtime.env).toBe('test');
      expect(result.uptime).toBeGreaterThan(0);
    });

    it('should use "unknown" for missing server info', () => {
      const service = new HealthService(defaultConfig, {});

      const result = service.getHealthz();

      expect(result.server.name).toBe('unknown');
      expect(result.server.version).toBe('unknown');
    });
  });

  describe('registerProbe', () => {
    it('should register and count probes', () => {
      const service = new HealthService(defaultConfig, defaultServerInfo);
      const probe: HealthProbe = { name: 'test', check: jest.fn().mockResolvedValue({ status: 'healthy' }) };

      expect(service.getProbeCount()).toBe(0);
      service.registerProbe(probe);
      expect(service.getProbeCount()).toBe(1);
    });
  });

  describe('autoDiscoverProbes', () => {
    it('should register session store probe', () => {
      const service = new HealthService(defaultConfig, defaultServerInfo);
      const scope = createMockScope();

      service.autoDiscoverProbes(scope);

      // session-store probe
      expect(service.getProbeCount()).toBe(1);
    });

    it('should register remote app probes', () => {
      const service = new HealthService(defaultConfig, defaultServerInfo);
      const scope = createMockScope({
        apps: {
          getApps: jest.fn().mockReturnValue([
            {
              id: 'remote-app',
              isRemote: true,
              getMcpClient: () => ({
                getHealthStatus: jest.fn().mockReturnValue({ status: 'healthy', latencyMs: 10 }),
              }),
            },
          ]),
        },
      });

      service.autoDiscoverProbes(scope);

      // session-store + remote:remote-app
      expect(service.getProbeCount()).toBe(2);
    });

    it('should skip non-remote apps', () => {
      const service = new HealthService(defaultConfig, defaultServerInfo);
      const scope = createMockScope({
        apps: {
          getApps: jest.fn().mockReturnValue([{ id: 'local-app', isRemote: false }]),
        },
      });

      service.autoDiscoverProbes(scope);

      expect(service.getProbeCount()).toBe(1); // session-store only
    });

    it('should register user-defined probes', () => {
      const config = {
        ...defaultConfig,
        probes: [{ name: 'custom-db', check: jest.fn().mockResolvedValue({ status: 'healthy' }) }],
      };
      const service = new HealthService(config, defaultServerInfo);
      const scope = createMockScope();

      service.autoDiscoverProbes(scope);

      // session-store + custom-db
      expect(service.getProbeCount()).toBe(2);
    });

    it('should skip invalid user probes', () => {
      const config = {
        ...defaultConfig,
        probes: [null, { name: 123 }, { name: 'valid', check: jest.fn().mockResolvedValue({ status: 'healthy' }) }],
      };
      const service = new HealthService(config as any, defaultServerInfo);
      const scope = createMockScope();

      service.autoDiscoverProbes(scope);

      // session-store + 1 valid user probe
      expect(service.getProbeCount()).toBe(2);
    });
  });

  describe('getReadyz', () => {
    it('should return ready when all probes are healthy', async () => {
      const service = new HealthService(defaultConfig, defaultServerInfo);
      service.registerProbe({ name: 'p1', check: async () => ({ status: 'healthy', latencyMs: 5 }) });
      service.registerProbe({ name: 'p2', check: async () => ({ status: 'healthy', latencyMs: 10 }) });
      const scope = createMockScope();
      service.autoDiscoverProbes(scope);

      const result = await service.getReadyz();

      expect(result.status).toBe('ready');
      expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
      // In test env, includeDetails defaults to true
      expect(result.probes).toBeDefined();
      expect(result.probes!['p1']?.status).toBe('healthy');
      expect(result.probes!['p2']?.status).toBe('healthy');
    });

    it('should return not_ready when any probe is unhealthy', async () => {
      const service = new HealthService(defaultConfig, defaultServerInfo);
      service.registerProbe({ name: 'ok', check: async () => ({ status: 'healthy' }) });
      service.registerProbe({ name: 'bad', check: async () => ({ status: 'unhealthy', error: 'down' }) });
      const scope = createMockScope();
      service.autoDiscoverProbes(scope);

      const result = await service.getReadyz();

      expect(result.status).toBe('not_ready');
      expect(result.probes!['bad']?.status).toBe('unhealthy');
    });

    it('should handle probe timeout', async () => {
      const config = { ...defaultConfig, readyz: { timeoutMs: 50 } };
      const service = new HealthService(config, defaultServerInfo);
      service.registerProbe({
        name: 'slow',
        check: () => new Promise((resolve) => setTimeout(() => resolve({ status: 'healthy' }), 200)),
      });
      const scope = createMockScope();
      service.autoDiscoverProbes(scope);

      const result = await service.getReadyz();

      expect(result.probes!['slow']?.status).toBe('unhealthy');
      expect(result.probes!['slow']?.error).toContain('timed out');
    });

    it('should handle probe that throws', async () => {
      const service = new HealthService(defaultConfig, defaultServerInfo);
      service.registerProbe({
        name: 'throws',
        check: async () => {
          throw new Error('Unexpected failure');
        },
      });
      const scope = createMockScope();
      service.autoDiscoverProbes(scope);

      const result = await service.getReadyz();

      expect(result.probes!['throws']?.status).toBe('unhealthy');
      expect(result.probes!['throws']?.error).toBe('Unexpected failure');
    });

    it('should include catalog info', async () => {
      const service = new HealthService(defaultConfig, defaultServerInfo);
      const scope = createMockScope();
      service.autoDiscoverProbes(scope);

      const result = await service.getReadyz();

      expect(result.catalog.toolCount).toBe(2);
      expect(result.catalog.resourceCount).toBe(2);
      expect(result.catalog.promptCount).toBe(1);
      expect(result.catalog.toolsHash).toBeTruthy();
    });

    it('should return empty catalog when scope not set', async () => {
      const service = new HealthService(defaultConfig, defaultServerInfo);

      const result = await service.getReadyz();

      expect(result.catalog.toolsHash).toBe('');
      expect(result.catalog.toolCount).toBe(0);
    });

    it('should omit probes when includeDetails is false', async () => {
      const config = { ...defaultConfig, includeDetails: false };
      const service = new HealthService(config, defaultServerInfo);
      service.registerProbe({ name: 'p', check: async () => ({ status: 'healthy' }) });
      const scope = createMockScope();
      service.autoDiscoverProbes(scope);

      const result = await service.getReadyz();

      expect(result.probes).toBeUndefined();
    });

    it('should include probes when includeDetails is true', async () => {
      const config = { ...defaultConfig, includeDetails: true };
      const service = new HealthService(config, defaultServerInfo);
      service.registerProbe({ name: 'p', check: async () => ({ status: 'healthy' }) });
      const scope = createMockScope();
      service.autoDiscoverProbes(scope);

      const result = await service.getReadyz();

      expect(result.probes).toBeDefined();
    });

    it('should return ready with no probes registered', async () => {
      const service = new HealthService(defaultConfig, defaultServerInfo);
      const scope = createMockScope();
      service.autoDiscoverProbes(scope);

      // Remove the auto-discovered session-store probe for this test
      (service as any).probes.length = 0;

      const result = await service.getReadyz();

      expect(result.status).toBe('ready');
    });
  });

  describe('catalog hash stability', () => {
    it('should produce consistent hash for same tool set', async () => {
      const service1 = new HealthService(defaultConfig, defaultServerInfo);
      const service2 = new HealthService(defaultConfig, defaultServerInfo);
      const scope = createMockScope();
      service1.autoDiscoverProbes(scope);
      service2.autoDiscoverProbes(scope);

      const r1 = await service1.getReadyz();
      const r2 = await service2.getReadyz();

      expect(r1.catalog.toolsHash).toBe(r2.catalog.toolsHash);
    });

    it('should produce different hash when tools change', async () => {
      const service1 = new HealthService(defaultConfig, defaultServerInfo);
      const scope1 = createMockScope({
        tools: { getTools: jest.fn().mockReturnValue([{ name: 'a' }, { name: 'b' }]) },
      });
      service1.autoDiscoverProbes(scope1);

      const service2 = new HealthService(defaultConfig, defaultServerInfo);
      const scope2 = createMockScope({
        tools: { getTools: jest.fn().mockReturnValue([{ name: 'a' }, { name: 'c' }]) },
      });
      service2.autoDiscoverProbes(scope2);

      const r1 = await service1.getReadyz();
      const r2 = await service2.getReadyz();

      expect(r1.catalog.toolsHash).not.toBe(r2.catalog.toolsHash);
    });

    it('should produce same hash regardless of tool order', async () => {
      const service1 = new HealthService(defaultConfig, defaultServerInfo);
      const scope1 = createMockScope({
        tools: { getTools: jest.fn().mockReturnValue([{ name: 'b' }, { name: 'a' }]) },
      });
      service1.autoDiscoverProbes(scope1);

      const service2 = new HealthService(defaultConfig, defaultServerInfo);
      const scope2 = createMockScope({
        tools: { getTools: jest.fn().mockReturnValue([{ name: 'a' }, { name: 'b' }]) },
      });
      service2.autoDiscoverProbes(scope2);

      const r1 = await service1.getReadyz();
      const r2 = await service2.getReadyz();

      expect(r1.catalog.toolsHash).toBe(r2.catalog.toolsHash);
    });
  });
});
