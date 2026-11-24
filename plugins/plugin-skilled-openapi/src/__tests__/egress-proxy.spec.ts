import { proxiedFetch } from '../executor/egress-proxy';

/**
 * `proxiedFetch` caches one proxy per proxy URL (#767). A failed load must not stay cached,
 * or every later call fails with the same error until the process restarts.
 */
let failNextProxyAgent = false;

type Connector = (options: Record<string, string>, callback: () => void) => void;

interface PoolOptions {
  connect: Connector;
}

interface ProxyAgentOptions {
  uri: string;
  proxyTunnel: true;
  factory?: (origin: string, options: PoolOptions) => { origin: string; options: PoolOptions };
}

interface MockProxyAgent {
  options: ProxyAgentOptions;
  closed: boolean;
}

const sentRequests: Array<{ url: string; agent: ProxyAgentOptions; dispatcher: MockProxyAgent }> = [];

jest.mock('undici', () => ({
  ProxyAgent: class {
    closed = false;

    async close(): Promise<void> {
      this.closed = true;
    }

    constructor(readonly options: ProxyAgentOptions) {
      if (failNextProxyAgent) {
        failNextProxyAgent = false;
        throw new Error('invalid proxy URL');
      }
    }
  },
  Pool: class {
    constructor(
      readonly origin: string,
      readonly options: PoolOptions,
    ) {}
  },
  fetch: async (url: string, init: RequestInit & { dispatcher: MockProxyAgent }) => {
    sentRequests.push({ url, agent: init.dispatcher.options, dispatcher: init.dispatcher });
    return new Response('ok');
  },
}));

const TUNNEL_TO_API = {
  host: 'api.example.com:8443',
  hostname: 'api.example.com',
  port: '8443',
  protocol: 'https:',
  servername: 'api.example.com',
};

/** What the pinned agent's pool for `origin` passes to the proxy's tunnel connector. */
function tunnelOptions(agent: ProxyAgentOptions, origin: string): Record<string, string> {
  const tunnelConnect = jest.fn<void, Parameters<Connector>>();
  const factory = agent.factory;
  if (!factory) throw new Error('the agent has no factory');
  factory(origin, { connect: tunnelConnect }).options.connect(TUNNEL_TO_API, () => undefined);
  return tunnelConnect.mock.calls[0][0];
}

beforeEach(() => {
  sentRequests.length = 0;
});

describe('proxiedFetch', () => {
  it('retries a proxy whose first load failed', async () => {
    failNextProxyAgent = true;

    await expect(proxiedFetch('http://proxy-a.internal:3128')).rejects.toThrow('invalid proxy URL');
    await expect(proxiedFetch('http://proxy-a.internal:3128')).resolves.toBeInstanceOf(Function);
  });

  it('sends a request with no checked addresses through the proxy as it is', async () => {
    const send = await proxiedFetch('http://proxy-b.internal:3128');

    await send('https://203.0.113.7/v1/items');

    expect(sentRequests).toEqual([
      expect.objectContaining({
        url: 'https://203.0.113.7/v1/items',
        agent: { uri: 'http://proxy-b.internal:3128', proxyTunnel: true },
      }),
    ]);
  });

  it('asks the proxy for the first checked address, keeping the hostname and TLS server name', async () => {
    const send = await proxiedFetch('http://proxy-b.internal:3128', [
      { address: '2001:db8::7', family: 6 },
      { address: '203.0.113.7', family: 4 },
    ]);

    await send('https://api.example.com:8443/v1/items?page=2');

    const [request] = sentRequests;
    expect(request.url).toBe('https://api.example.com:8443/v1/items?page=2');
    expect(tunnelOptions(request.agent, 'https://api.example.com:8443')).toEqual({
      ...TUNNEL_TO_API,
      host: '[2001:db8::7]:8443',
      hostname: '2001:db8::7',
    });
  });

  it('leaves a connection to any other origin as it is', async () => {
    const send = await proxiedFetch('http://proxy-b.internal:3128', [{ address: '203.0.113.7', family: 4 }]);

    await send('https://api.example.com/');

    expect(tunnelOptions(sentRequests[0].agent, 'http://proxy-b.internal:3128')).toEqual(TUNNEL_TO_API);
  });

  it('keeps one agent per hostname and address, so a pooled tunnel never leads elsewhere', async () => {
    const send = await proxiedFetch('http://proxy-c.internal:3128', [{ address: '203.0.113.7', family: 4 }]);
    const moved = await proxiedFetch('http://proxy-c.internal:3128', [{ address: '203.0.113.8', family: 4 }]);

    await send('https://a.example.com/');
    await send('https://a.example.com/again');
    await send('https://b.example.com/');
    await moved('https://a.example.com/');

    const [first, again, otherHost, otherAddress] = sentRequests.map((request) => request.agent);
    expect(again).toBe(first);
    expect(otherHost).not.toBe(first);
    expect(otherAddress).not.toBe(first);
  });
  it('closes the least recently used agent once it keeps more than 64', async () => {
    const send = await proxiedFetch('http://proxy-d.internal:3128', [{ address: '203.0.113.7', family: 4 }]);

    for (let index = 0; index <= 64; index++) await send(`https://host-${index}.example.com/`);
    const [host0, host1, host2] = sentRequests.map((request) => request.dispatcher);
    expect([host0.closed, host1.closed]).toEqual([true, false]);

    await send('https://host-0.example.com/');

    expect(sentRequests[sentRequests.length - 1].dispatcher).not.toBe(host0);
    expect([host1.closed, host2.closed]).toEqual([true, false]);
  });
});
