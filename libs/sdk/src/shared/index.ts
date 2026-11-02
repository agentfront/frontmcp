import { getEnv } from '@frontmcp/utils';

import type { FrontMcpConfigInput, FrontMcpConfigType } from '../common';
import { exitOnShutdownSignals, STDIO_SHUTDOWN_DEADLINE_MS } from '../front-mcp/shutdown-signals';
import { redirectConsoleToStderr } from '../front-mcp/stdio-console';
import { SHARED_SERVE_ENV } from './ensure-shared-server';
import { attachSharedSession } from './shared-attach';
import { serveShared, type SharedServerInstance } from './shared-serve';
import { parseSharedServerOptions } from './shared-server.options';

/** A process a session started serves the key; any other attaches its stdio to the key's server. */
export async function runShared(
  config: FrontMcpConfigInput,
  sharedOptions: unknown,
  create: (config: FrontMcpConfigType) => SharedServerInstance,
): Promise<void> {
  const options = parseSharedServerOptions(sharedOptions);
  if (getEnv(SHARED_SERVE_ENV) === options.key) {
    delete process.env[SHARED_SERVE_ENV];
    const server = await serveShared(config, options, create);
    exitOnShutdownSignals(() => server.close());
    return;
  }
  redirectConsoleToStderr();
  const session = attachSharedSession({ ...options, input: process.stdin, output: process.stdout });
  exitOnShutdownSignals(() => session.stop(), {
    deadlineMs: STDIO_SHUTDOWN_DEADLINE_MS,
    whenOrphaned: { stdin: process.stdin },
  });
  await session.attached;
}
