/**
 * How VercelKvStorageAdapter loads `@vercel/kv` (#680): a dynamic import, so a bundler consuming the
 * ESM build can include it, that accepts both the ESM shape and Node's ESM view of a CJS module.
 */
type AdapterModule = typeof import('../vercel-kv');
type ErrorsModule = typeof import('../../errors');

const client = { exists: jest.fn().mockResolvedValue(1) };

/** Fresh adapter + errors modules, with `@vercel/kv` replaced by `factory`. */
function load(factory: () => unknown): { Adapter: AdapterModule['VercelKvStorageAdapter']; errors: ErrorsModule } {
  jest.resetModules();
  jest.doMock('@vercel/kv', factory);
  return {
    Adapter: (require('../vercel-kv') as AdapterModule).VercelKvStorageAdapter,
    errors: require('../../errors') as ErrorsModule,
  };
}

describe('VercelKvStorageAdapter: loading @vercel/kv', () => {
  afterEach(() => {
    jest.dontMock('@vercel/kv');
    client.exists.mockClear();
  });

  it('uses createClient from the module default when the named export is absent', async () => {
    const createClient = jest.fn(() => client);
    const { Adapter } = load(() => ({ __esModule: true, default: { createClient } }));
    const adapter = new Adapter({ url: 'https://kv.example.com', token: 't' });
    await adapter.connect();
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://kv.example.com', token: 't' }));
  });

  it('says to install @vercel/kv when it cannot be loaded', async () => {
    const { Adapter, errors } = load(() => {
      throw new Error("Cannot find module '@vercel/kv'");
    });
    const adapter = new Adapter({ url: 'https://kv.example.com', token: 't' });
    const failure = await adapter.connect().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(errors.StorageConnectionError);
    expect(String((failure as Error).cause)).toContain('npm install @vercel/kv');
  });

  it('refuses a module without createClient', async () => {
    const { Adapter, errors } = load(() => ({ kv: client }));
    const adapter = new Adapter({ url: 'https://kv.example.com', token: 't' });
    await expect(adapter.connect()).rejects.toBeInstanceOf(errors.StorageConnectionError);
  });
});
