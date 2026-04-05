import { createStorageProbe, createRemoteAppProbe, createTransportSessionProbe } from '../health.probes';

describe('createStorageProbe', () => {
  it('should return healthy when ping succeeds', async () => {
    const adapter = { ping: jest.fn().mockResolvedValue(true) };
    const probe = createStorageProbe('redis', adapter);

    const result = await probe.check();

    expect(result.status).toBe('healthy');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
    expect(adapter.ping).toHaveBeenCalledTimes(1);
  });

  it('should return unhealthy when ping returns false', async () => {
    const adapter = { ping: jest.fn().mockResolvedValue(false) };
    const probe = createStorageProbe('redis', adapter);

    const result = await probe.check();

    expect(result.status).toBe('unhealthy');
    expect(result.error).toBe('Ping returned false');
  });

  it('should return unhealthy when ping throws', async () => {
    const adapter = { ping: jest.fn().mockRejectedValue(new Error('Connection refused')) };
    const probe = createStorageProbe('redis', adapter);

    const result = await probe.check();

    expect(result.status).toBe('unhealthy');
    expect(result.error).toBe('Connection refused');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should set the probe name correctly', () => {
    const adapter = { ping: jest.fn() };
    const probe = createStorageProbe('my-store', adapter);

    expect(probe.name).toBe('my-store');
  });
});

describe('createRemoteAppProbe', () => {
  it('should return healthy when checker reports healthy', async () => {
    const provider = {
      getHealthStatus: jest.fn().mockReturnValue({
        status: 'healthy',
        latencyMs: 15,
        lastChecked: new Date(),
        consecutiveFailures: 0,
        consecutiveSuccesses: 3,
      }),
    };
    const probe = createRemoteAppProbe('payment-svc', provider);

    expect(probe.name).toBe('remote:payment-svc');
    const result = await probe.check();

    expect(result.status).toBe('healthy');
    expect(result.latencyMs).toBe(15);
    expect(result.error).toBeUndefined();
  });

  it('should return degraded when checker reports degraded', async () => {
    const provider = {
      getHealthStatus: jest.fn().mockReturnValue({
        status: 'degraded',
        latencyMs: 2500,
        lastChecked: new Date(),
        consecutiveFailures: 0,
        consecutiveSuccesses: 1,
      }),
    };
    const probe = createRemoteAppProbe('slow-svc', provider);

    const result = await probe.check();

    expect(result.status).toBe('degraded');
    expect(result.latencyMs).toBe(2500);
  });

  it('should return unhealthy when checker reports unhealthy', async () => {
    const provider = {
      getHealthStatus: jest.fn().mockReturnValue({
        status: 'unhealthy',
        lastChecked: new Date(),
        consecutiveFailures: 5,
        consecutiveSuccesses: 0,
        error: 'Connection timeout',
      }),
    };
    const probe = createRemoteAppProbe('down-svc', provider);

    const result = await probe.check();

    expect(result.status).toBe('unhealthy');
    expect(result.error).toBe('Connection timeout');
  });

  it('should return unhealthy when no health check result available', async () => {
    const provider = { getHealthStatus: jest.fn().mockReturnValue(undefined) };
    const probe = createRemoteAppProbe('unknown-svc', provider);

    const result = await probe.check();

    expect(result.status).toBe('unhealthy');
    expect(result.error).toBe('No health check result available');
  });

  it('should return unhealthy for unknown status', async () => {
    const provider = {
      getHealthStatus: jest.fn().mockReturnValue({
        status: 'unknown',
        lastChecked: new Date(),
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      }),
    };
    const probe = createRemoteAppProbe('new-svc', provider);

    const result = await probe.check();

    expect(result.status).toBe('unhealthy');
  });
});

describe('createTransportSessionProbe', () => {
  it('should return healthy when session store ping succeeds', async () => {
    const provider = { pingSessionStore: jest.fn().mockResolvedValue(true) };
    const probe = createTransportSessionProbe(provider);

    expect(probe.name).toBe('session-store');
    const result = await probe.check();

    expect(result.status).toBe('healthy');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should return unhealthy when session store ping returns false', async () => {
    const provider = { pingSessionStore: jest.fn().mockResolvedValue(false) };
    const probe = createTransportSessionProbe(provider);

    const result = await probe.check();

    expect(result.status).toBe('unhealthy');
    expect(result.error).toBe('Session store ping returned false');
  });

  it('should return unhealthy when session store ping throws', async () => {
    const provider = { pingSessionStore: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const probe = createTransportSessionProbe(provider);

    const result = await probe.check();

    expect(result.status).toBe('unhealthy');
    expect(result.error).toBe('ECONNREFUSED');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
