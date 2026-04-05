import { healthOptionsSchema, healthReadyzOptionsSchema } from '../health';

describe('healthReadyzOptionsSchema', () => {
  it('should apply default timeoutMs', () => {
    const result = healthReadyzOptionsSchema.parse({});
    expect(result.timeoutMs).toBe(5000);
  });

  it('should accept custom timeoutMs', () => {
    const result = healthReadyzOptionsSchema.parse({ timeoutMs: 10000 });
    expect(result.timeoutMs).toBe(10000);
  });

  it('should accept enabled flag', () => {
    const result = healthReadyzOptionsSchema.parse({ enabled: false });
    expect(result.enabled).toBe(false);
  });

  it('should reject negative timeoutMs', () => {
    expect(() => healthReadyzOptionsSchema.parse({ timeoutMs: -1 })).toThrow();
  });

  it('should reject zero timeoutMs', () => {
    expect(() => healthReadyzOptionsSchema.parse({ timeoutMs: 0 })).toThrow();
  });
});

describe('healthOptionsSchema', () => {
  it('should apply all defaults', () => {
    const result = healthOptionsSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.healthzPath).toBe('/healthz');
    expect(result.readyzPath).toBe('/readyz');
    expect(result.probes).toEqual([]);
  });

  it('should accept custom paths', () => {
    const result = healthOptionsSchema.parse({
      healthzPath: '/live',
      readyzPath: '/ready',
    });
    expect(result.healthzPath).toBe('/live');
    expect(result.readyzPath).toBe('/ready');
  });

  it('should accept enabled=false', () => {
    const result = healthOptionsSchema.parse({ enabled: false });
    expect(result.enabled).toBe(false);
  });

  it('should accept includeDetails', () => {
    const result = healthOptionsSchema.parse({ includeDetails: true });
    expect(result.includeDetails).toBe(true);
  });

  it('should accept readyz sub-config', () => {
    const result = healthOptionsSchema.parse({
      readyz: { enabled: true, timeoutMs: 3000 },
    });
    expect(result.readyz?.enabled).toBe(true);
    expect(result.readyz?.timeoutMs).toBe(3000);
  });

  it('should accept probes array (opaque to Zod)', () => {
    const probe = { name: 'test', check: async () => ({ status: 'healthy' }) };
    const result = healthOptionsSchema.parse({ probes: [probe] });
    expect(result.probes).toHaveLength(1);
  });

  it('should default probes to empty array', () => {
    const result = healthOptionsSchema.parse({});
    expect(result.probes).toEqual([]);
  });
});
