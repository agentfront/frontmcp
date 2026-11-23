// file: plugins/plugin-skilled-openapi/src/executor/egress-proxy.ts

import type { LookupAddress } from 'node:dns';

interface ConnectOptions {
  host: string;
  hostname: string;
  port: string;
}

type Connector = (options: ConnectOptions, callback: (...results: unknown[]) => void) => void;

interface PoolOptions {
  connect: Connector;
}

interface ProxyAgentOptions {
  uri: string;
  proxyTunnel: true;
  factory?: (origin: string, options: PoolOptions) => unknown;
}

interface UndiciModule {
  fetch: (input: string, init: RequestInit & { dispatcher: unknown }) => Promise<Response>;
  ProxyAgent: new (options: ProxyAgentOptions) => unknown;
  Pool: new (origin: string, options: PoolOptions) => unknown;
}

/** The agents of one proxy: one for a URL whose host is sent as it is, one per hostname and checked address. */
class EgressProxy {
  private readonly agent: unknown;
  private readonly pinnedAgents = new Map<string, unknown>();

  constructor(
    readonly undici: UndiciModule,
    private readonly proxyUrl: string,
  ) {
    this.agent = new undici.ProxyAgent({ uri: proxyUrl, proxyTunnel: true });
  }

  agentFor(hostname: string, address: LookupAddress | undefined): unknown {
    if (!address) return this.agent;
    const key = `${hostname} ${address.address}`;
    let pinnedAgent = this.pinnedAgents.get(key);
    if (!pinnedAgent) {
      pinnedAgent = this.createPinnedAgent(hostname, address);
      this.pinnedAgents.set(key, pinnedAgent);
    }
    return pinnedAgent;
  }

  /**
   * An agent whose tunnels to `hostname` the proxy opens to `address`. The URL keeps the hostname,
   * so `Host` and the TLS server name (SNI and the certificate check) still name it.
   */
  private createPinnedAgent(hostname: string, address: LookupAddress): unknown {
    const addressHost = address.family === 6 ? `[${address.address}]` : address.address;
    return new this.undici.ProxyAgent({
      uri: this.proxyUrl,
      proxyTunnel: true,
      factory: (origin, options) => {
        if (new URL(origin).hostname !== hostname) return new this.undici.Pool(origin, options);
        const connect: Connector = (connectOptions, callback) => {
          const host = connectOptions.port ? `${addressHost}:${connectOptions.port}` : addressHost;
          options.connect({ ...connectOptions, host, hostname: address.address }, callback);
        };
        return new this.undici.Pool(origin, { ...options, connect });
      },
    });
  }
}

const egressProxies = new Map<string, Promise<EgressProxy>>();

/**
 * `fetch` that sends every request through `outbound.egressProxy`. Given `addresses`, the ones the
 * outbound check approved, the proxy is asked to connect to the first of them rather than to resolve
 * the hostname itself.
 *
 * It uses undici's `ProxyAgent`, so it needs Node.js and the `undici` package, an optional peer
 * loaded only when a proxy is configured: the module name is not a literal, so Worker bundles never
 * pull it in. A failed load is not kept, so a later call retries once the cause is fixed.
 */
export async function proxiedFetch(proxyUrl: string, addresses: readonly LookupAddress[] = []): Promise<typeof fetch> {
  const proxy = await egressProxy(proxyUrl);
  const [address] = addresses;
  return ((input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    return proxy.undici.fetch(url.href, { ...init, dispatcher: proxy.agentFor(url.hostname, address) });
  }) as typeof fetch;
}

function egressProxy(proxyUrl: string): Promise<EgressProxy> {
  let cached = egressProxies.get(proxyUrl);
  if (!cached) {
    cached = loadEgressProxy(proxyUrl);
    egressProxies.set(proxyUrl, cached);
    cached.catch(() => egressProxies.delete(proxyUrl));
  }
  return cached;
}

async function loadEgressProxy(proxyUrl: string): Promise<EgressProxy> {
  const undiciModuleName = 'undici';
  let undici: UndiciModule;
  try {
    undici = (await import(undiciModuleName)) as UndiciModule;
  } catch {
    throw new Error('outbound.egressProxy needs the undici package on Node.js (npm install undici)');
  }
  return new EgressProxy(undici, proxyUrl);
}
