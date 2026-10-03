/**
 * Preamble for the `--target node` server bundle (`dist/node/<name>.bundle.js`).
 *
 * The runner script (`dist/node/<name>`) supplies two things before it execs the
 * bundle: `FRONTMCP_HTTP_ENTRY_PATH` from `transport.http.path` (#642) and
 * `FRONTMCP_STDIO=1` for `--stdio`. The bundle is also run directly — the
 * generated Dockerfile's `CMD ["node", "dist/node/<name>.bundle.js"]`, an MCP
 * client config pointing at the `.js` file — and then neither applied: the
 * server mounted MCP at `/` and `--stdio` still started HTTP (#680). The
 * bundle now carries both itself, ahead of the `@FrontMcp` decorator that
 * reads them. The runner keeps exporting them too, so either entry works.
 */

import { type FrontmcpExecConfig } from './config';

export interface ServerBundleBannerOptions {
  /**
   * Apply the defaults only when the bundle is the program being run
   * (`require.main === module`). The build `require()`s the bundle in-process
   * for schema extraction and a `--target cli` bundle loads it as a module;
   * neither may change the host process's environment. A single executable
   * (SEA) embeds the bundle as its only script, so it skips the check.
   */
  mainOnly: boolean;
}

export function generateServerBundleBanner(
  config: Pick<FrontmcpExecConfig, 'httpEntryPath'>,
  options: ServerBundleBannerOptions,
): string {
  const lines = [
    "  if (process.argv.slice(2).includes('--stdio')) process.env.FRONTMCP_STDIO = '1';",
    ...(config.httpEntryPath
      ? [
          // An explicit env var (or .env loaded by the runner) still wins.
          `  if (process.env.FRONTMCP_HTTP_ENTRY_PATH === undefined) process.env.FRONTMCP_HTTP_ENTRY_PATH = ${JSON.stringify(config.httpEntryPath)};`,
        ]
      : []),
  ];
  const guard = options.mainOnly ? "typeof require !== 'undefined' && require.main === module" : 'true';
  return [
    // The banner goes ahead of esbuild's own "use strict", which would then no longer be the
    // directive prologue — keep the bundle in strict mode by opening with it.
    "'use strict';",
    '// frontmcp build --target node: run-time defaults the runner script also sets (#680).',
    `if (${guard}) {`,
    ...lines,
    '}',
  ].join('\n');
}
