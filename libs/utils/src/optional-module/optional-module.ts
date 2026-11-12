const BUNDLED_OPTIONAL_MODULES = Symbol.for('frontmcp.bundledOptionalModules');

/** The modules a bundle registered, kept on `globalThis` so every copy of a FrontMCP package sees them. */
function bundledOptionalModules(): Map<string, unknown> {
  const registryHost = globalThis as typeof globalThis & { [BUNDLED_OPTIONAL_MODULES]?: Map<string, unknown> };
  registryHost[BUNDLED_OPTIONAL_MODULES] ??= new Map<string, unknown>();
  return registryHost[BUNDLED_OPTIONAL_MODULES];
}

/**
 * Hand FrontMCP an optional package (`@frontmcp/observability`, `@frontmcp/storage-sqlite`) that the
 * bundle already contains. On Cloudflare Workers `require()` cannot reach bundled
 * modules, so the worker entry registers them here (#768). Kept on
 * `globalThis` so a second copy of a FrontMCP package in the same bundle sees it too.
 */
export function registerOptionalModule(moduleName: string, moduleExports: unknown): void {
  bundledOptionalModules().set(moduleName, moduleExports);
}

/**
 * Return a module registered with {@link registerOptionalModule}, or run
 * `load` — pass a literal `() => require('pkg')` so bundlers still see it.
 */
export function requireOptionalModule<T>(moduleName: string, load: () => T): T {
  const registry = bundledOptionalModules();
  return registry.has(moduleName) ? (registry.get(moduleName) as T) : load();
}
