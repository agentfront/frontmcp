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

interface Dispatcher {
  close(): Promise<void>;
}

interface UndiciModule {
  fetch: (input: string, init: RequestInit & { dispatcher: Dispatcher }) => Promise<Response>;
  ProxyAgent: new (options: ProxyAgentOptions) => Dispatcher;
  Pool: new (origin: string, options: PoolOptions) => Dispatcher;
}

/** The most hostname and address pairs whose agents a proxy keeps; the least recently used one is closed. */
const MAX_PINNED_AGENTS = 64;

/** The agents of one proxy: one for a URL whose host is sent as it is, one per hostname and checked address. */
class EgressProxy {
  private readonly agent: Dispatcher;
  private readonly pinnedAgents = new Map<string, Dispatcher>();

  constructor(
    readonly undici: UndiciModule,
    private readonly proxyUrl: string,
  ) {
    this.agent = new undici.ProxyAgent({ uri: proxyUrl, proxyTunnel: true });
  }

  agentFor(hostname: string, address: LookupAddress | undefined): Dispatcher {
    if (!address) return this.agent;
    const key = `${hostname} ${address.address}`;
    const pinnedAgent = this.pinnedAgents.get(key) ?? this.createPinnedAgent(hostname, address);
    this.pinnedAgents.delete(key);
    this.pinnedAgents.set(key, pinnedAgent);
    if (this.pinnedAgents.size > MAX_PINNED_AGENTS) this.closeLeastRecentlyUsed();
    return pinnedAgent;
  }

  private closeLeastRecentlyUsed(): void {
    const [key, leastRecentlyUsed] = this.pinnedAgents.entries().next().value as [string, Dispatcher];
    this.pinnedAgents.delete(key);
    leastRecentlyUsed.close().catch(() => undefined);
  }

  /**
   * An agent whose tunnels to `hostname` the proxy opens to `address`. The URL keeps the hostname,
   * so `Host` and the TLS server name (SNI and the certificate check) still name it.
   */
  private createPinnedAgent(hostname: string, address: LookupAddress): Dispatcher {
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
 * outbound check approved, the proxy is asked to connect to them rather than to resolve the hostname
 * itself: IPv4 first, so a proxy without IPv6 egress still reaches a dual-stack API, and the next one
 * when the proxy refuses the tunnel, before anything was sent to the API.
 *
 * It uses undici's `ProxyAgent`, so it needs Node.js and the `undici` package, an optional peer
 * loaded only when a proxy is configured: the module name is not a literal, so Worker bundles never
 * pull it in. A failed load is not kept, so a later call retries once the cause is fixed.
 */
export async function proxiedFetch(proxyUrl: string, addresses: readonly LookupAddress[] = []): Promise<typeof fetch> {
  const proxy = await egressProxy(proxyUrl);
  const approvedAddresses = [...addresses].sort((left, right) => left.family - right.family);
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (approvedAddresses.length === 0) {
      return proxy.undici.fetch(url.href, { ...init, dispatcher: proxy.agentFor(url.hostname, undefined) });
    }
    let tunnelRefusal: unknown;
    for (const address of approvedAddresses) {
      try {
        return await proxy.undici.fetch(url.href, { ...init, dispatcher: proxy.agentFor(url.hostname, address) });
      } catch (error) {
        if (!isTunnelRefusal(error)) throw error;
        tunnelRefusal = error;
      }
    }
    throw tunnelRefusal;
  }) as typeof fetch;
}

/**
 * Whether undici failed a fetch because the proxy answered its `CONNECT` with anything but 200. The causes are read
 * by shape: undici builds one of them in another realm, so it isn't `instanceof Error` here.
 */
function isTunnelRefusal(error: unknown): boolean {
  let cause = error as { message?: unknown; cause?: unknown } | null | undefined;
  while (typeof cause === 'object' && cause !== null) {
    if (
      typeof cause.message === 'string' &&
      /^Proxy response \(\d+\) !== 200 when HTTP Tunneling$/.test(cause.message)
    ) {
      return true;
    }
    cause = cause.cause as typeof cause;
  }
  return false;
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
