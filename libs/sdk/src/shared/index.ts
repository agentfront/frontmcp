import { getEnv } from '@frontmcp/utils';

import type { FrontMcpConfigInput, FrontMcpConfigType } from '../common';
import { InvalidSharedServerOptionsError } from '../errors/shared-server.errors';
import { exitOnShutdownSignals, STDIO_SHUTDOWN_DEADLINE_MS } from '../front-mcp/shutdown-signals';
import { redirectConsoleToStderr } from '../front-mcp/stdio-console';
import { SHARED_SERVE_ENV, SHARED_START_LOCK_ENV } from './ensure-shared-server';
import { attachSharedSession } from './shared-attach';
import { runEmbeddedServer } from './shared-embedded';
import { isSharedVersion, MAX_SHARED_VERSION_LENGTH } from './shared-endpoint';
import { serveShared, type SharedServerInstance } from './shared-serve';
import { parseSharedServerOptions } from './shared-server.options';

/**
 * A process a session started serves the key; any other attaches its stdio to the key's server, or runs the server
 * itself when it can't, or may not, attach to one.
 */
export async function runShared(
  config: FrontMcpConfigInput,
  sharedOptions: unknown,
  create: (config: FrontMcpConfigType) => SharedServerInstance,
): Promise<void> {
  const options = parseSharedServerOptions(sharedOptions, process.platform, process.argv[1]);
  const version = config.info?.version;
  if (!isSharedVersion(version)) {
    throw new InvalidSharedServerOptionsError(
      `info.version: a shared server states its version, which must be 1 to ${MAX_SHARED_VERSION_LENGTH} printable ASCII characters`,
    );
  }
  if (getEnv(SHARED_SERVE_ENV) === options.key) {
    const startLockHolder = getEnv(SHARED_START_LOCK_ENV);
    delete process.env[SHARED_SERVE_ENV];
    delete process.env[SHARED_START_LOCK_ENV];
    const server = await serveShared({ config, options, create, startLockHolder, exit: (code) => process.exit(code) });
    exitOnShutdownSignals(() => server.close());
    return;
  }
  redirectConsoleToStderr();
  const session = attachSharedSession({
    ...options,
    version,
    input: process.stdin,
    output: process.stdout,
    embed: () => runEmbeddedServer(config, options.key, create),
  });
  exitOnShutdownSignals(() => session.stop(), {
    deadlineMs: STDIO_SHUTDOWN_DEADLINE_MS,
    whenOrphaned: { stdin: process.stdin },
  });
  await session.attached;
}
