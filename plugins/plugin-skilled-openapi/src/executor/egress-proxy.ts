// file: plugins/plugin-skilled-openapi/src/executor/egress-proxy.ts

interface UndiciModule {
  fetch: (input: string, init: RequestInit & { dispatcher: unknown }) => Promise<Response>;
  ProxyAgent: new (proxyUrl: string) => unknown;
}

const proxiedFetches = new Map<string, Promise<typeof fetch>>();

/**
 * `fetch` that sends every request through `outbound.egressProxy`, one per proxy URL. It uses
 * undici's `ProxyAgent`, so it needs Node.js and the `undici` package, an optional peer loaded only
 * when a proxy is configured: the module name is not a literal, so Worker bundles never pull it in.
 */
export function proxiedFetch(proxyUrl: string): Promise<typeof fetch> {
  let cached = proxiedFetches.get(proxyUrl);
  if (!cached) {
    cached = loadProxiedFetch(proxyUrl);
    proxiedFetches.set(proxyUrl, cached);
  }
  return cached;
}

async function loadProxiedFetch(proxyUrl: string): Promise<typeof fetch> {
  const undiciModuleName = 'undici';
  let undici: UndiciModule;
  try {
    undici = (await import(undiciModuleName)) as UndiciModule;
  } catch {
    throw new Error('outbound.egressProxy needs the undici package on Node.js (npm install undici)');
  }
  const dispatcher = new undici.ProxyAgent(proxyUrl);
  return ((input: string | URL, init?: RequestInit) =>
    undici.fetch(String(input), { ...init, dispatcher })) as typeof fetch;
}
