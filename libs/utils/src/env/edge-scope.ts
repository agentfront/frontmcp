/**
 * Whether the global scope looks like an edge runtime (Cloudflare Workers, Vercel Edge, Deno Deploy):
 * `EdgeRuntime` is defined, or `caches` is present without `window`. A browser Web Worker also has
 * `caches` and no `window`, and defines its dedicated, shared or service worker scope. Cloudflare's workerd
 * defines `ServiceWorkerGlobalScope` too, so it is told apart by its user agent, or by having no `navigator`.
 */
export function hasEdgeGlobalScope(): boolean {
  if (typeof globalThis === 'undefined') return false;
  if ('EdgeRuntime' in globalThis) return true;
  if (!('caches' in globalThis) || 'window' in globalThis) return false;
  return !isBrowserWorkerScope();
}

function isBrowserWorkerScope(): boolean {
  const userAgent = typeof navigator === 'undefined' ? undefined : navigator.userAgent;
  if (userAgent === undefined || userAgent === 'Cloudflare-Workers') return false;
  return ['DedicatedWorkerGlobalScope', 'SharedWorkerGlobalScope', 'ServiceWorkerGlobalScope'].some(
    (scopeName) => scopeName in globalThis,
  );
}
