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
