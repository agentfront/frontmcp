/**
 * Helpers for probing optional peer dependencies that are loaded lazily via
 * `require()` (e.g. `@frontmcp/observability`).
 *
 * A bare `try { require(pkg) } catch { warn("not installed") }` is misleading:
 * `require()` throws for many reasons OTHER than the package being absent — an
 * export-condition or transpile mismatch (a dev runtime such as tsx resolving a
 * package's TS source entry under yarn), a missing transitive peer, or a load-time
 * error in the module itself. In all of those the package IS installed and
 * resolvable, yet the user is told to reinstall it, which never helps (#453).
 */

/**
 * Outcome of classifying a failed `require()` of an optional dependency.
 */
export interface OptionalDependencyProbe {
  /**
   * - `not-installed` — the module is genuinely unresolvable (reinstalling helps).
   * - `load-failed`   — the module resolves but `require()` threw (a load / export
   *   condition / transpile / peer mismatch; reinstalling will NOT help).
   */
  status: 'not-installed' | 'load-failed';
  /** Path returned by the runtime resolver, present only when `load-failed`. */
  resolvedPath?: string;
  /** Message from the original `require()` error. */
  error: string;
}

/**
 * Classify why `require(moduleName)` failed by re-probing with the SAME resolver
 * the runtime uses, so the verdict matches reality instead of always blaming a
 * missing install.
 *
 * @param moduleName - the specifier that failed to `require()`.
 * @param loadError - the error thrown by the failed `require()`.
 * @param resolve - resolver to probe existence with. Pass `require.resolve` from
 *   the caller; kept injectable so this stays unit-testable and ESM-safe (the
 *   helper module itself never references `require`).
 */
export function probeOptionalDependency(
  moduleName: string,
  loadError: unknown,
  resolve: (id: string) => string,
): OptionalDependencyProbe {
  let resolvedPath: string | undefined;
  try {
    resolvedPath = resolve(moduleName);
  } catch {
    // Genuinely unresolvable from this root — the package is not installed.
    resolvedPath = undefined;
  }

  const error = loadError instanceof Error ? loadError.message : String(loadError);
  return resolvedPath ? { status: 'load-failed', resolvedPath, error } : { status: 'not-installed', error };
}

/**
 * Lazily load an OPTIONAL peer dependency, turning a failed load into a clear,
 * accurate error instead of an opaque `ERR_MODULE_NOT_FOUND`.
 *
 * Pairs with {@link probeOptionalDependency}: on failure it classifies the cause
 * so the message tells the truth (#453):
 *   - `not-installed` → "install the peer" (reinstalling helps).
 *   - `load-failed`   → "resolved but failed to load" (reinstalling will NOT
 *     help; it's an export-condition / transpile / transitive-peer mismatch).
 *
 * Loading an optional peer eagerly at module scope crashes every consumer that
 * never uses the feature — so the import MUST be deferred to the feature's
 * use-site and routed through here.
 *
 * @param moduleName - bare specifier of the optional peer (used in messages + probe).
 * @param importer - loader for the module. Pass a literal `() => import('pkg')`
 *   so the bundler keeps it a real dynamic import; a variable specifier would
 *   defeat static analysis.
 * @param resolve - resolver used to classify the failure; pass `require.resolve`.
 *   Kept injectable so this stays unit-testable and ESM-safe (this module never
 *   references `require` itself).
 * @param feature - short phrase naming what needs the peer, woven into the hint
 *   (e.g. `'skill storage'`).
 */
export async function importOptionalPeer<T>(
  moduleName: string,
  importer: () => Promise<T>,
  resolve: (id: string) => string,
  feature: string,
): Promise<T> {
  try {
    return await importer();
  } catch (cause) {
    const probe = probeOptionalDependency(moduleName, cause, resolve);
    if (probe.status === 'not-installed') {
      throw new Error(
        `@frontmcp/sdk ${feature} needs the optional peer dependency '${moduleName}'. ` +
          `Install it in your project (e.g. \`npm i ${moduleName}\`).`,
        { cause },
      );
    }
    throw new Error(
      `@frontmcp/sdk ${feature} found '${moduleName}' at ${probe.resolvedPath} but it failed to load — ` +
        `reinstalling will not help. This is usually an export-condition, transpile, or transitive-peer ` +
        `mismatch. Original error: ${probe.error}`,
      { cause },
    );
  }
}

const BUNDLED_OPTIONAL_MODULES = Symbol.for('frontmcp.bundledOptionalModules');

function bundledOptionalModules(): Map<string, unknown> {
  const registryHost = globalThis as typeof globalThis & { [BUNDLED_OPTIONAL_MODULES]?: Map<string, unknown> };
  registryHost[BUNDLED_OPTIONAL_MODULES] ??= new Map<string, unknown>();
  return registryHost[BUNDLED_OPTIONAL_MODULES];
}

/**
 * Hand the SDK an optional peer (e.g. `@frontmcp/observability`) that the bundle
 * already contains. On Cloudflare Workers `require()` cannot reach bundled
 * modules, so the generated worker entry registers them here (#768). Kept on
 * `globalThis` so a second copy of the SDK in the same bundle sees it too.
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
