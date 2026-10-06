import { proxiedFetch } from '../executor/egress-proxy';

/**
 * `proxiedFetch` caches one proxied fetch per proxy URL (#767). A failed load must not stay cached,
 * or every later call fails with the same error until the process restarts.
 */
let failNextProxyAgent = false;

jest.mock('undici', () => ({
  ProxyAgent: class {
    constructor(readonly proxyUrl: string) {
      if (failNextProxyAgent) {
        failNextProxyAgent = false;
        throw new Error('invalid proxy URL');
      }
    }
  },
  fetch: async () => new Response('ok'),
}));

describe('proxiedFetch', () => {
  it('retries a proxy whose first load failed', async () => {
    failNextProxyAgent = true;

    await expect(proxiedFetch('http://proxy-a.internal:3128')).rejects.toThrow('invalid proxy URL');
    await expect(proxiedFetch('http://proxy-a.internal:3128')).resolves.toBeInstanceOf(Function);
  });

  it('reuses the proxied fetch of a proxy that loaded', async () => {
    const first = await proxiedFetch('http://proxy-b.internal:3128');

    expect(await proxiedFetch('http://proxy-b.internal:3128')).toBe(first);
  });
});
