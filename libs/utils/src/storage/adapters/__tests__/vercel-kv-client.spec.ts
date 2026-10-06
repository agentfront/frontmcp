/**
 * `createVercelKvClient()`, the one place `@vercel/kv` is loaded (#711): a literal dynamic import a
 * Worker bundle can include, a client of its own with the fetch `cache` mode left unset (Cloudflare
 * Workers reject the `cache: 'default'` the module's `kv` singleton sends), and values read back as
 * stored.
 */
type AdapterModule = typeof import('../vercel-kv');
type ErrorsModule = typeof import('../../errors');

const client = { get: jest.fn() };

function load(factory: () => unknown): {
  createVercelKvClient: AdapterModule['createVercelKvClient'];
  errors: ErrorsModule;
} {
  jest.resetModules();
  jest.doMock('@vercel/kv', factory);
  return {
    createVercelKvClient: (require('../vercel-kv') as AdapterModule).createVercelKvClient,
    errors: require('../../errors') as ErrorsModule,
  };
}

describe('createVercelKvClient', () => {
  const savedEnv = { url: process.env['KV_REST_API_URL'], token: process.env['KV_REST_API_TOKEN'] };

  afterEach(() => {
    jest.dontMock('@vercel/kv');
    process.env['KV_REST_API_URL'] = savedEnv.url;
    process.env['KV_REST_API_TOKEN'] = savedEnv.token;
    if (savedEnv.url === undefined) delete process.env['KV_REST_API_URL'];
    if (savedEnv.token === undefined) delete process.env['KV_REST_API_TOKEN'];
  });

  it('builds a client with the fetch cache mode unset and values read back as stored', async () => {
    const createClient = jest.fn(() => client);
    const { createVercelKvClient } = load(() => ({ createClient }));

    await expect(createVercelKvClient({ url: 'https://kv.example.com', token: 't' })).resolves.toBe(client);
    expect(createClient).toHaveBeenCalledWith({
      url: 'https://kv.example.com',
      token: 't',
      cache: undefined,
      automaticDeserialization: false,
    });
  });

  it('reads KV_REST_API_URL and KV_REST_API_TOKEN when no url and token are passed', async () => {
    process.env['KV_REST_API_URL'] = 'https://env-kv.example.com';
    process.env['KV_REST_API_TOKEN'] = 'env-token';
    const createClient = jest.fn(() => client);
    const { createVercelKvClient } = load(() => ({ __esModule: true, default: { createClient } }));

    await createVercelKvClient();

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://env-kv.example.com', token: 'env-token' }),
    );
  });

  it('refuses to build a client without a url and token', async () => {
    delete process.env['KV_REST_API_URL'];
    delete process.env['KV_REST_API_TOKEN'];
    const { createVercelKvClient, errors } = load(() => ({ createClient: jest.fn(() => client) }));

    await expect(createVercelKvClient()).rejects.toBeInstanceOf(errors.StorageConfigError);
  });

  it('says to install @vercel/kv when it cannot be loaded', async () => {
    const { createVercelKvClient } = load(() => {
      throw new Error("Cannot find module '@vercel/kv'");
    });

    await expect(createVercelKvClient({ url: 'https://kv.example.com', token: 't' })).rejects.toThrow(
      'npm install @vercel/kv',
    );
  });
});
