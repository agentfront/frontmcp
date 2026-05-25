import { persistenceConfigSchema } from '../schema';

describe('persistenceConfigSchema (issue #401)', () => {
  it('accepts a redis-only config', () => {
    const result = persistenceConfigSchema.safeParse({
      redis: { provider: 'redis', host: 'localhost', port: 6379 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a sqlite-only config', () => {
    const result = persistenceConfigSchema.safeParse({
      sqlite: { path: '/tmp/sessions.sqlite' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty config (in-memory)', () => {
    const result = persistenceConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects a config that sets both redis and sqlite (legacy redis shape)', () => {
    const result = persistenceConfigSchema.safeParse({
      redis: { host: 'localhost', port: 6379 },
      sqlite: { path: '/tmp/sessions.sqlite' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/choose either redis or sqlite/);
    }
  });

  it('rejects a config that sets both redis (new provider field) and sqlite', () => {
    const result = persistenceConfigSchema.safeParse({
      redis: { provider: 'redis', host: 'localhost' },
      sqlite: { path: '/tmp/sessions.sqlite' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/choose either redis or sqlite/);
    }
  });

  it('rejects a config that sets both vercel-kv and sqlite', () => {
    const result = persistenceConfigSchema.safeParse({
      redis: { provider: 'vercel-kv' },
      sqlite: { path: '/tmp/sessions.sqlite' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/choose either redis or sqlite/);
    }
  });

  it('forwards defaultTtlMs', () => {
    const result = persistenceConfigSchema.safeParse({
      sqlite: { path: '/tmp/sessions.sqlite' },
      defaultTtlMs: 60000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultTtlMs).toBe(60000);
    }
  });
});
