import { registerHealthRoutes, isReadyzEnabled } from '../health.routes';
import type { HealthService } from '../health.service';
import type { HealthOptionsInterface } from '../../common/types/options/health';

// Mock @frontmcp/utils
const mockGetRuntimeContext = jest.fn();
jest.mock('@frontmcp/utils', () => ({
  getRuntimeContext: () => mockGetRuntimeContext(),
}));

function createMockServer() {
  const routes: Array<{ method: string; path: string; handler: Function }> = [];
  return {
    registerRoute: jest.fn((method: string, path: string, handler: Function) => {
      routes.push({ method, path, handler });
    }),
    routes,
  };
}

function createMockHealthService(overrides: Partial<HealthService> = {}): HealthService {
  return {
    getHealthz: jest.fn().mockReturnValue({
      status: 'ok',
      server: { name: 'test', version: '1.0.0' },
      runtime: { platform: 'linux', runtime: 'node', deployment: 'standalone', env: 'test' },
      uptime: 100,
    }),
    getReadyz: jest.fn().mockResolvedValue({
      status: 'ready',
      totalLatencyMs: 10,
      catalog: { toolsHash: 'abc', toolCount: 1, resourceCount: 0, promptCount: 0, skillCount: 0, agentCount: 0 },
      probes: {},
    }),
    ...overrides,
  } as unknown as HealthService;
}

const defaultConfig: HealthOptionsInterface = {
  enabled: true,
  healthzPath: '/healthz',
  readyzPath: '/readyz',
  probes: [],
};

describe('isReadyzEnabled', () => {
  it('should return true for node runtime standalone', () => {
    mockGetRuntimeContext.mockReturnValue({ runtime: 'node', deployment: 'standalone' });
    expect(isReadyzEnabled(defaultConfig)).toBe(true);
  });

  it('should return false for edge runtime', () => {
    mockGetRuntimeContext.mockReturnValue({ runtime: 'edge', deployment: 'standalone' });
    expect(isReadyzEnabled(defaultConfig)).toBe(false);
  });

  it('should return false for serverless deployment', () => {
    mockGetRuntimeContext.mockReturnValue({ runtime: 'node', deployment: 'serverless' });
    expect(isReadyzEnabled(defaultConfig)).toBe(false);
  });

  it('should respect explicit readyz.enabled=true on serverless', () => {
    mockGetRuntimeContext.mockReturnValue({ runtime: 'node', deployment: 'serverless' });
    const config = { ...defaultConfig, readyz: { enabled: true, timeoutMs: 5000 } };
    expect(isReadyzEnabled(config)).toBe(true);
  });

  it('should respect explicit readyz.enabled=false on node', () => {
    mockGetRuntimeContext.mockReturnValue({ runtime: 'node', deployment: 'standalone' });
    const config = { ...defaultConfig, readyz: { enabled: false, timeoutMs: 5000 } };
    expect(isReadyzEnabled(config)).toBe(false);
  });

  it('should return true for browser runtime', () => {
    mockGetRuntimeContext.mockReturnValue({ runtime: 'browser', deployment: 'standalone' });
    expect(isReadyzEnabled(defaultConfig)).toBe(true);
  });

  it('should return true for bun runtime', () => {
    mockGetRuntimeContext.mockReturnValue({ runtime: 'bun', deployment: 'standalone' });
    expect(isReadyzEnabled(defaultConfig)).toBe(true);
  });
});

describe('registerHealthRoutes', () => {
  beforeEach(() => {
    mockGetRuntimeContext.mockReturnValue({ runtime: 'node', deployment: 'standalone' });
  });

  it('should register /healthz route', () => {
    const server = createMockServer();
    const healthService = createMockHealthService();

    registerHealthRoutes(server, healthService, defaultConfig);

    const healthzRoute = server.routes.find((r) => r.path === '/healthz');
    expect(healthzRoute).toBeDefined();
    expect(healthzRoute!.method).toBe('GET');
  });

  it('should register /health legacy alias', () => {
    const server = createMockServer();
    const healthService = createMockHealthService();

    registerHealthRoutes(server, healthService, defaultConfig);

    const healthRoute = server.routes.find((r) => r.path === '/health');
    expect(healthRoute).toBeDefined();
  });

  it('should not register duplicate /health when healthzPath is /health', () => {
    const server = createMockServer();
    const healthService = createMockHealthService();
    const config = { ...defaultConfig, healthzPath: '/health' };

    registerHealthRoutes(server, healthService, config);

    const healthRoutes = server.routes.filter((r) => r.path === '/health');
    expect(healthRoutes).toHaveLength(1);
  });

  it('should register /readyz on node runtime', () => {
    const server = createMockServer();
    const healthService = createMockHealthService();

    registerHealthRoutes(server, healthService, defaultConfig);

    const readyzRoute = server.routes.find((r) => r.path === '/readyz');
    expect(readyzRoute).toBeDefined();
  });

  it('should NOT register /readyz on edge runtime', () => {
    mockGetRuntimeContext.mockReturnValue({ runtime: 'edge', deployment: 'standalone' });
    const server = createMockServer();
    const healthService = createMockHealthService();

    registerHealthRoutes(server, healthService, defaultConfig);

    const readyzRoute = server.routes.find((r) => r.path === '/readyz');
    expect(readyzRoute).toBeUndefined();
  });

  it('should use custom paths', () => {
    const server = createMockServer();
    const healthService = createMockHealthService();
    const config = { ...defaultConfig, healthzPath: '/live', readyzPath: '/ready' };

    registerHealthRoutes(server, healthService, config);

    expect(server.routes.find((r) => r.path === '/live')).toBeDefined();
    expect(server.routes.find((r) => r.path === '/ready')).toBeDefined();
    expect(server.routes.find((r) => r.path === '/health')).toBeDefined(); // legacy alias
  });

  describe('route handlers', () => {
    it('/healthz should return 200 with ok status', async () => {
      const server = createMockServer();
      const healthService = createMockHealthService();
      registerHealthRoutes(server, healthService, defaultConfig);

      const handler = server.routes.find((r) => r.path === '/healthz')!.handler;
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handler({}, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
    });

    it('/healthz should return 503 when status is error', async () => {
      const healthService = createMockHealthService({
        getHealthz: jest.fn().mockReturnValue({ status: 'error', error: 'broken' }),
      } as any);
      const server = createMockServer();
      registerHealthRoutes(server, healthService, defaultConfig);

      const handler = server.routes.find((r) => r.path === '/healthz')!.handler;
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handler({}, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('/readyz should return 200 when ready', async () => {
      const server = createMockServer();
      const healthService = createMockHealthService();
      registerHealthRoutes(server, healthService, defaultConfig);

      const handler = server.routes.find((r) => r.path === '/readyz')!.handler;
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handler({}, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
    });

    it('/readyz should return 503 when not ready', async () => {
      const healthService = createMockHealthService({
        getReadyz: jest.fn().mockResolvedValue({
          status: 'not_ready',
          totalLatencyMs: 5001,
          catalog: {
            toolsHash: 'x',
            toolCount: 0,
            resourceCount: 0,
            promptCount: 0,
            skillCount: 0,
            agentCount: 0,
          },
        }),
      } as any);
      const server = createMockServer();
      registerHealthRoutes(server, healthService, defaultConfig);

      const handler = server.routes.find((r) => r.path === '/readyz')!.handler;
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handler({}, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });
  });
});
