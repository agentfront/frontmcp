/**
 * Load a module lazily with a dynamic `import()`, falling back to `require` when the runtime
 * cannot run the dynamic import.
 *
 * The SDK's CommonJS build keeps `import()` for lazily loaded packages. Jest runs CommonJS
 * modules in a `vm` context, where a dynamic `import()` throws
 * `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` unless the whole run uses
 * `--experimental-vm-modules` — and with that flag on, Jest's ESM loader can fail on a CommonJS
 * package instead. Either way a FrontMCP server started inside a test (`createHandler()`,
 * `createDirect()`, `connect()`) died on the first lazy import (#680).
 *
 * The dynamic import is tried first, so bundlers (browser, worker) and native ESM keep their
 * behaviour; `require` is only used after it failed and where one exists. When the fallback fails
 * too, the ORIGINAL error is rethrown, so a genuinely missing package is still reported as such.
 *
 * Pass literal specifiers in both callbacks (`() => import('pkg')`, `() => require('pkg')`) so
 * bundlers can see them.
 */
export async function importWithRequireFallback<T>(
  dynamicImport: () => Promise<T>,
  requireFallback: () => T,
): Promise<T> {
  try {
    return await dynamicImport();
  } catch (importError) {
    try {
      return requireFallback();
    } catch {
      throw importError;
    }
  }
}
