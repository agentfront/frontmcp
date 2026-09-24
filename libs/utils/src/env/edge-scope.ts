/**
 * Whether the global scope looks like an edge runtime (Cloudflare Workers, Vercel Edge, Deno Deploy):
 * `EdgeRuntime` is defined, or `caches` is present without `window`. A browser Web Worker also has
 * `caches` and no `window`, so a `WorkerGlobalScope` that is not a Cloudflare Worker is not an edge runtime.
 */
export function hasEdgeGlobalScope(): boolean {
  if (typeof globalThis === 'undefined') return false;
  if ('EdgeRuntime' in globalThis) return true;
  if (!('caches' in globalThis) || 'window' in globalThis) return false;
  return !isBrowserWorkerScope();
}

function isBrowserWorkerScope(): boolean {
  const userAgent = (globalThis as { navigator?: { userAgent?: unknown } }).navigator?.userAgent;
  return 'WorkerGlobalScope' in globalThis && userAgent !== 'Cloudflare-Workers';
}
