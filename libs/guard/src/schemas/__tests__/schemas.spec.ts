import {
  partitionKeySchema,
  rateLimitConfigSchema,
  concurrencyConfigSchema,
  timeoutConfigSchema,
  ipFilterConfigSchema,
  guardConfigSchema,
} from '../index';

describe('partitionKeySchema', () => {
  it('should accept "ip"', () => {
    expect(partitionKeySchema.parse('ip')).toBe('ip');
  });

  it('should accept "session"', () => {
    expect(partitionKeySchema.parse('session')).toBe('session');
  });

  it('should accept "userId"', () => {
    expect(partitionKeySchema.parse('userId')).toBe('userId');
  });

  it('should accept "global"', () => {
    expect(partitionKeySchema.parse('global')).toBe('global');
  });

  it('should accept a function', () => {
    const fn = (ctx: { sessionId: string }) => ctx.sessionId;
    expect(partitionKeySchema.parse(fn)).toBe(fn);
  });

  it('should reject an invalid string', () => {
    expect(() => partitionKeySchema.parse('invalid')).toThrow();
  });

  it('should reject a number', () => {
    expect(() => partitionKeySchema.parse(42)).toThrow();
  });
});

describe('rateLimitConfigSchema', () => {
  it('should parse valid input with all fields', () => {
    const result = rateLimitConfigSchema.parse({
      maxRequests: 100,
      windowMs: 30_000,
      partitionBy: 'ip',
    });

    expect(result.maxRequests).toBe(100);
    expect(result.windowMs).toBe(30_000);
    expect(result.partitionBy).toBe('ip');
  });

  it('should apply defaults for windowMs and partitionBy', () => {
    const result = rateLimitConfigSchema.parse({
      maxRequests: 50,
    });

    expect(result.maxRequests).toBe(50);
    expect(result.windowMs).toBe(60_000);
    expect(result.partitionBy).toBe('global');
  });

  it('should reject missing maxRequests', () => {
    expect(() => rateLimitConfigSchema.parse({})).toThrow();
  });

  it('should reject non-positive maxRequests', () => {
    expect(() => rateLimitConfigSchema.parse({ maxRequests: 0 })).toThrow();
    expect(() => rateLimitConfigSchema.parse({ maxRequests: -1 })).toThrow();
  });

  it('should reject non-integer maxRequests', () => {
    expect(() => rateLimitConfigSchema.parse({ maxRequests: 1.5 })).toThrow();
  });
});

describe('concurrencyConfigSchema', () => {
  it('should parse valid input with all fields', () => {
    const result = concurrencyConfigSchema.parse({
      maxConcurrent: 5,
      queueTimeoutMs: 1000,
      partitionBy: 'session',
    });

    expect(result.maxConcurrent).toBe(5);
    expect(result.queueTimeoutMs).toBe(1000);
    expect(result.partitionBy).toBe('session');
  });

  it('should apply defaults for queueTimeoutMs and partitionBy', () => {
    const result = concurrencyConfigSchema.parse({
      maxConcurrent: 3,
    });

    expect(result.maxConcurrent).toBe(3);
    expect(result.queueTimeoutMs).toBe(0);
    expect(result.partitionBy).toBe('global');
  });

  it('should reject missing maxConcurrent', () => {
    expect(() => concurrencyConfigSchema.parse({})).toThrow();
  });

  it('should reject non-positive maxConcurrent', () => {
    expect(() => concurrencyConfigSchema.parse({ maxConcurrent: 0 })).toThrow();
  });

  it('should reject negative queueTimeoutMs', () => {
    expect(() => concurrencyConfigSchema.parse({ maxConcurrent: 1, queueTimeoutMs: -1 })).toThrow();
  });
});

describe('timeoutConfigSchema', () => {
  it('should parse valid input', () => {
    const result = timeoutConfigSchema.parse({ executeMs: 5000 });
    expect(result.executeMs).toBe(5000);
  });

  it('should reject missing executeMs', () => {
    expect(() => timeoutConfigSchema.parse({})).toThrow();
  });

  it('should reject non-positive executeMs', () => {
    expect(() => timeoutConfigSchema.parse({ executeMs: 0 })).toThrow();
    expect(() => timeoutConfigSchema.parse({ executeMs: -100 })).toThrow();
  });

  it('should reject non-integer executeMs', () => {
    expect(() => timeoutConfigSchema.parse({ executeMs: 1.5 })).toThrow();
  });
});

describe('ipFilterConfigSchema', () => {
  it('should parse valid input with all fields', () => {
    const result = ipFilterConfigSchema.parse({
      allowList: ['10.0.0.0/8'],
      denyList: ['192.168.1.100'],
      defaultAction: 'deny',
      trustProxy: true,
      trustedProxyDepth: 3,
    });

    expect(result.allowList).toEqual(['10.0.0.0/8']);
    expect(result.denyList).toEqual(['192.168.1.100']);
    expect(result.defaultAction).toBe('deny');
    expect(result.trustProxy).toBe(true);
    expect(result.trustedProxyDepth).toBe(3);
  });

  it('should apply defaults for defaultAction, trustProxy, trustedProxyDepth', () => {
    const result = ipFilterConfigSchema.parse({});

    expect(result.defaultAction).toBe('allow');
    expect(result.trustProxy).toBe(false);
    expect(result.trustedProxyDepth).toBe(1);
  });

  it('should reject invalid defaultAction', () => {
    expect(() => ipFilterConfigSchema.parse({ defaultAction: 'block' })).toThrow();
  });

  it('should reject non-positive trustedProxyDepth', () => {
    expect(() => ipFilterConfigSchema.parse({ trustedProxyDepth: 0 })).toThrow();
  });
});

describe('guardConfigSchema', () => {
  it('should parse valid full config', () => {
    const result = guardConfigSchema.parse({
      enabled: true,
      keyPrefix: 'test:guard:',
      global: { maxRequests: 1000 },
      globalConcurrency: { maxConcurrent: 50 },
      defaultRateLimit: { maxRequests: 100 },
      defaultConcurrency: { maxConcurrent: 10 },
      defaultTimeout: { executeMs: 30_000 },
      ipFilter: { denyList: ['1.2.3.4'] },
    });

    expect(result.enabled).toBe(true);
    expect(result.keyPrefix).toBe('test:guard:');
    expect(result.global).toBeDefined();
    expect(result.globalConcurrency).toBeDefined();
    expect(result.defaultRateLimit).toBeDefined();
    expect(result.defaultConcurrency).toBeDefined();
    expect(result.defaultTimeout).toBeDefined();
    expect(result.ipFilter).toBeDefined();
  });

  it('should apply default keyPrefix', () => {
    const result = guardConfigSchema.parse({ enabled: true });

    expect(result.keyPrefix).toBe('mcp:guard:');
  });

  it('should allow optional storage as looseObject', () => {
    const result = guardConfigSchema.parse({
      enabled: true,
      storage: { provider: 'redis', host: 'localhost' },
    });

    expect(result.storage).toBeDefined();
  });

  it('should reject missing enabled field', () => {
    expect(() => guardConfigSchema.parse({})).toThrow();
  });

  it('should accept minimal config with only enabled', () => {
    const result = guardConfigSchema.parse({ enabled: false });
    expect(result.enabled).toBe(false);
    expect(result.keyPrefix).toBe('mcp:guard:');
    expect(result.global).toBeUndefined();
  });
});
