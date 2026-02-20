/**
 * Lazy-loader for @clack/prompts (ESM-only package).
 *
 * The CLI compiles as CJS, so a static `import` would compile to `require()`
 * and fail at runtime. This helper uses a dynamic `await import()` and caches
 * the module after first load.
 */
let _p: typeof import('@clack/prompts') | undefined;

export async function clack(): Promise<typeof import('@clack/prompts')> {
  if (!_p) _p = await import('@clack/prompts');
  return _p;
}
