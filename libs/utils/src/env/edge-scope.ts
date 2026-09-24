/**
 * Whether the global scope looks like an edge runtime (Cloudflare Workers, Vercel Edge, Deno Deploy):
 * `EdgeRuntime` is defined, or `caches` is present without `window`. A browser Web Worker also has
 * `caches` and no `window`, but only a browser defines its dedicated, shared and service worker scopes.
 */
export function hasEdgeGlobalScope(): boolean {
  if (typeof globalThis === 'undefined') return false;
  if ('EdgeRuntime' in globalThis) return true;
  if (!('caches' in globalThis) || 'window' in globalThis) return false;
  return !isBrowserWorkerScope();
}

function isBrowserWorkerScope(): boolean {
  return ['DedicatedWorkerGlobalScope', 'SharedWorkerGlobalScope', 'ServiceWorkerGlobalScope'].some(
    (scopeName) => scopeName in globalThis,
  );
}
