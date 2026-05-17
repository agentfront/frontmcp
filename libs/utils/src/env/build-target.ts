/**
 * Build-target detection (issue #417).
 *
 * The CLI's `build` command knows the target name (`cli`, `node`,
 * `vercel`, `lambda`, `cloudflare`, `browser`, `sdk`, `mcpb`,
 * `distributed`) but doesn't tell the runtime today. This helper exposes
 * it so `@Tool({ availableWhen: { target: ['cli'] } })` can express
 * "this tool is only valid in the compiled CLI bundle."
 *
 * Resolution order:
 *
 *   1. `globalThis.FRONTMCP_BUILD_TARGET` — preferred. Build adapters
 *      inline `const FRONTMCP_BUILD_TARGET = '<target>';` into the
 *      emitted entry shim before any user code runs, so this constant
 *      is correct from the very first line of imports.
 *   2. `process.env.FRONTMCP_BUILD_TARGET` — set by the build adapter
 *      via the runtime env when inlining isn't viable (e.g. SEA).
 *   3. `'unknown'` — dev mode, tests, or any context the build command
 *      hasn't touched.
 *
 * The supported values match `frontmcp build --target <name>` plus
 * `'unknown'` for the dev path.
 */

export type BuildTarget =
  | 'unknown'
  | 'node'
  | 'distributed'
  | 'cli'
  | 'vercel'
  | 'lambda'
  | 'cloudflare'
  | 'browser'
  | 'sdk'
  | 'mcpb';

let cached: BuildTarget | undefined;

export function getBuildTarget(): BuildTarget {
  if (cached) return cached;
  cached = resolveBuildTarget();
  return cached;
}

function resolveBuildTarget(): BuildTarget {
  // Prefer the build-inlined constant — it's set before any imports run.
  const globalAny = globalThis as unknown as { FRONTMCP_BUILD_TARGET?: string };
  const fromGlobal = globalAny.FRONTMCP_BUILD_TARGET;
  if (typeof fromGlobal === 'string' && isKnownTarget(fromGlobal)) return fromGlobal;

  const fromEnv = typeof process !== 'undefined' ? process.env?.['FRONTMCP_BUILD_TARGET'] : undefined;
  if (typeof fromEnv === 'string' && isKnownTarget(fromEnv)) return fromEnv;

  return 'unknown';
}

function isKnownTarget(value: string): value is BuildTarget {
  return (
    value === 'unknown' ||
    value === 'node' ||
    value === 'distributed' ||
    value === 'cli' ||
    value === 'vercel' ||
    value === 'lambda' ||
    value === 'cloudflare' ||
    value === 'browser' ||
    value === 'sdk' ||
    value === 'mcpb'
  );
}

/** Test helper — reset the cache between specs. */
export function resetBuildTargetCacheForTesting(): void {
  cached = undefined;
}
