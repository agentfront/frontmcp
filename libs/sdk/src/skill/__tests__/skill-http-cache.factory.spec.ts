import type { ScopeEntry } from '../../common';
import { createSkillHttpCache } from '../cache/skill-http-cache.factory';
import { disposeAllCaches, getSkillHttpCache } from '../cache/skill-http-cache.holder';

const mockStoredValues = new Map<string, string>();

function mockKvClient(config: { automaticDeserialization?: boolean }) {
  const readStoredValue = (raw: string): unknown => (config.automaticDeserialization === false ? raw : JSON.parse(raw));
  return {
    get: jest.fn(async (key: string) => {
      const raw = mockStoredValues.get(key);
      return raw === undefined ? null : readStoredValue(raw);
    }),
    setex: jest.fn(async (key: string, _seconds: number, value: string) => {
      mockStoredValues.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async () => 0),
    keys: jest.fn(async () => []),
  };
}

const mockCreateClient = jest.fn(mockKvClient);

jest.mock('@vercel/kv', () => ({ createClient: mockCreateClient, kv: mockKvClient({}) }));

describe('createSkillHttpCache with the vercel-kv provider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockStoredValues.clear();
    mockCreateClient.mockClear();
    process.env['KV_REST_API_URL'] = 'https://kv.example.com';
    process.env['KV_REST_API_TOKEN'] = 'token';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('creates the client without automatic JSON deserialization (#716)', async () => {
    const { type } = await createSkillHttpCache({ redis: { provider: 'vercel-kv' } });

    expect(type).toBe('redis');
    expect(mockCreateClient).toHaveBeenCalledWith({
      url: 'https://kv.example.com',
      token: 'token',
      automaticDeserialization: false,
    });
  });

  it('reads cached entries back from the stored JSON strings', async () => {
    const { cache } = await createSkillHttpCache({ redis: { provider: 'vercel-kv' } });

    await cache.setLlmTxt('# Skills');
    await cache.setSkill('skill-1', { name: 'skill-1' });

    await expect(cache.getLlmTxt()).resolves.toBe('# Skills');
    await expect(cache.getSkill('skill-1')).resolves.toEqual({ name: 'skill-1' });
  });

  it('falls back to the memory cache when the KV environment variables are missing', async () => {
    delete process.env['KV_REST_API_URL'];

    const { type } = await createSkillHttpCache({ redis: { provider: 'vercel-kv' } });

    expect(type).toBe('memory');
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("warns through the scope's logger when a scope's configured cache falls back to memory", async () => {
    delete process.env['KV_REST_API_URL'];
    const warn = jest.fn();
    const scope = {
      metadata: {
        id: 'kv-fallback-scope',
        skillsConfig: { cache: { enabled: true, redis: { provider: 'vercel-kv' } } },
      },
      logger: { warn, verbose: jest.fn() },
    } as unknown as ScopeEntry;

    try {
      await getSkillHttpCache(scope);
      expect(warn).toHaveBeenCalledWith('Failed to create Redis cache, falling back to memory', expect.any(Object));
    } finally {
      await disposeAllCaches();
    }
  });
});
