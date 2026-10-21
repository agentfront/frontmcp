// Its own module, which the builds emit unminified: a bundler leaves the import alone only because of its comments.
/**
 * Dynamic `import()` of a runtime-computed specifier.
 *
 * This loader's only job is to import npm packages / bundles from disk, blob, or
 * temp files — a Node/browser concern that never executes on a V8 isolate
 * (Cloudflare Workers). `export * from './esm-loader'` in the SDK barrel still
 * pulls this module into a worker bundle, so the dynamic specifier carries the
 * `webpackIgnore` + `@vite-ignore` magic comments to tell bundlers not to try to
 * resolve it at build time; the call site is simply never reached in a worker.
 *
 * It MUST stay a real `import()` expression (not hidden behind `new Function`):
 * Jest's swc transform rewrites a literal `import()` to a runtime it can execute,
 * whereas a `new Function('s','return import(s)')` body becomes a native VM
 * dynamic import that throws `A dynamic import callback was invoked without
 * --experimental-vm-modules` (and that flag breaks the rest of the suite). The
 * `webpackIgnore`/`@vite-ignore` comments already keep the worker bundle happy
 * (verified by the demo-e2e-cloudflare workerd boot), so no further indirection
 * is needed.
 */
export function importComputed(specifier: string): Promise<unknown> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ specifier);
}
