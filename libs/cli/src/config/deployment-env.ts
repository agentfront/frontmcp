/**
 * Run-time defaults a built deployment carries from `frontmcp.config` (#680).
 *
 * `frontmcp.config` describes a deployment; `@FrontMcp()` configures the server.
 * The bridge is the environment: the build writes each deployment's settings into
 * the artifact as variables the SDK reads at start-up — set only where the
 * platform (or the operator) has not already set them, so an explicit env var
 * always wins, and an explicit `@FrontMcp()` value wins over both.
 */

import type { ServerDefaults } from './frontmcp-config.types';
import { securityHeadersEnv } from './security-headers-env';

/** Values of `frontmcp build --target`; mirrors `BuildTarget` in `@frontmcp/utils`. */
export type BuildTargetName =
  | 'node'
  | 'distributed'
  | 'cli'
  | 'vercel'
  | 'lambda'
  | 'cloudflare'
  | 'browser'
  | 'sdk'
  | 'mcpb';

/**
 * Statement recording the build target for `getBuildTarget()` (what
 * `availableWhen: { target: [...] }` checks). The first artifact to run wins, so a
 * `--target cli` binary that loads its server bundle stays `'cli'`.
 */
export function buildTargetStatement(target: BuildTargetName): string {
  return `globalThis.FRONTMCP_BUILD_TARGET = globalThis.FRONTMCP_BUILD_TARGET || ${JSON.stringify(target)};\n`;
}

/**
 * `PORT` / `FRONTMCP_*` defaults for a deployment's `server.http` and `server.cookies`.
 *
 * - `http.port` → `PORT`, `http.socketPath` → `FRONTMCP_DAEMON_SOCKET` — only where the
 *   build controls the listener (`listens`: node, distributed); serverless platforms pick it.
 * - `http.cors` → `FRONTMCP_CORS_ORIGINS` (JSON) / `_CREDENTIALS` / `_MAX_AGE`.
 * - `cookies` → `FRONTMCP_AFFINITY_COOKIE` / `_DOMAIN` / `_SAMESITE` (the load-balancer
 *   affinity cookie of a distributed deployment).
 *
 * `http.entryPath` is not here: it travels with `transport.http.path` as
 * `FRONTMCP_HTTP_ENTRY_PATH` (see {@link deploymentHttpPath}).
 */
export function serverRuntimeEnv(
  server: ServerDefaults | undefined,
  options: { listens: boolean },
): Record<string, string> {
  const env: Record<string, string> = {};
  const http = server?.http;
  if (options.listens) {
    if (http?.port !== undefined) env['PORT'] = String(http.port);
    if (http?.socketPath) env['FRONTMCP_DAEMON_SOCKET'] = http.socketPath;
  }
  const origins = http?.cors?.origins?.filter((origin) => origin.trim().length > 0);
  if (origins && origins.length > 0) {
    env['FRONTMCP_CORS_ORIGINS'] = JSON.stringify(origins);
    if (http?.cors?.credentials !== undefined) env['FRONTMCP_CORS_CREDENTIALS'] = String(http.cors.credentials);
    if (http?.cors?.maxAge !== undefined) env['FRONTMCP_CORS_MAX_AGE'] = String(http.cors.maxAge);
  }
  const cookies = server?.cookies;
  if (cookies?.affinity) env['FRONTMCP_AFFINITY_COOKIE'] = cookies.affinity;
  if (cookies?.domain) env['FRONTMCP_AFFINITY_COOKIE_DOMAIN'] = cookies.domain;
  if (cookies?.sameSite) env['FRONTMCP_AFFINITY_COOKIE_SAMESITE'] = cookies.sameSite;
  return env;
}

/**
 * The MCP mount path of a deployment: its own `server.http.entryPath`, else the
 * project-wide `transport.http.path`.
 */
export function deploymentHttpPath(
  server: ServerDefaults | undefined,
  transportHttpPath: string | undefined,
): string | undefined {
  return server?.http?.entryPath ?? transportHttpPath;
}

/** Statements that set each variable only when it is not already defined. */
export function envDefaultStatements(env: Record<string, string>): string {
  return Object.entries(env)
    .map(
      ([key, value]) =>
        `if (process.env[${JSON.stringify(key)}] === undefined) process.env[${JSON.stringify(key)}] = ${JSON.stringify(value)};\n`,
    )
    .join('');
}

/**
 * esbuild banner for a server bundle (`--target node` / `cli` / `mcpb`): records the
 * build target and sets the deployment's run-time defaults ahead of the user's
 * entry (and so ahead of the `@FrontMcp` decorator that reads them).
 *
 * The defaults apply only when the bundle is the program being run
 * (`require.main === module`, or always for a single executable): the build
 * `require()`s the bundle in-process for schema extraction, and a `--target cli`
 * binary loads it as a module, and neither may have its environment changed.
 */
export function serverBundleBanner(options: {
  target: BuildTargetName;
  server?: ServerDefaults;
  /** The deployment's own `env` (`deployments[].env`). */
  env?: Record<string, string>;
  /** True for a single-executable (SEA) bundle, which is always the program being run. */
  singleExecutable?: boolean;
}): string {
  const env = {
    ...securityHeadersEnv(options.server),
    ...serverRuntimeEnv(options.server, { listens: true }),
    ...options.env,
  };
  const guard = options.singleExecutable ? 'true' : "typeof require !== 'undefined' && require.main === module";
  const lines = [
    // A banner goes ahead of esbuild's own "use strict", which would then no longer be the
    // directive prologue — keep the bundle in strict mode by opening with it.
    "'use strict';",
    `// frontmcp build --target ${options.target}: frontmcp.config run-time defaults (#680)`,
    `if (${guard}) {`,
    buildTargetStatement(options.target).trimEnd(),
    ...envDefaultStatements(env).trimEnd().split('\n').filter(Boolean),
    '}',
  ];
  return lines.join('\n');
}
