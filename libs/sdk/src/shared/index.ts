import { getEnv, stat } from '@frontmcp/utils';

import type { FrontMcpConfigInput, FrontMcpConfigType } from '../common';
import { InvalidSharedServerOptionsError } from '../errors/shared-server.errors';
import { exitOnShutdownSignals, STDIO_SHUTDOWN_DEADLINE_MS } from '../front-mcp/shutdown-signals';
import { redirectConsoleToStderr } from '../front-mcp/stdio-console';
import { SHARED_SERVE_ENV, SHARED_START_LOCK_ENV } from './ensure-shared-server';
import { attachSharedSession } from './shared-attach';
import { bootEmbeddedServer } from './shared-embedded';
import { isSharedVersion, MAX_SHARED_VERSION_LENGTH } from './shared-endpoint';
import { serveShared, type SharedServerInstance } from './shared-serve';
import {
  isSharedServerKey,
  readSharedServerKey,
  validateSharedServerOptions,
  type ResolvedSharedServerOptions,
} from './shared-server.options';

async function isFolder(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A process a session started serves the key; any other attaches its stdio to the key's server, or runs the server
 * itself when it can't, or may not, attach to one.
 */
export async function runShared(
  config: FrontMcpConfigInput,
  sharedOptions: unknown,
  create: (config: FrontMcpConfigType) => SharedServerInstance,
): Promise<void> {
  const { key, ...validated } = validateSharedServerOptions(sharedOptions, process.platform, process.argv[1]);
  const version = config.info?.version;
  if (!isSharedVersion(version)) {
    throw new InvalidSharedServerOptionsError(
      `info.version: a shared server states its version, which must be 1 to ${MAX_SHARED_VERSION_LENGTH} printable ASCII characters`,
    );
  }
  if (validated.checkout !== false && !(await isFolder(validated.checkout))) {
    throw new InvalidSharedServerOptionsError(`checkout: ${validated.checkout} is not a folder`);
  }
  // A process a session started serves the key it named: a string key's own, or any key for a function key
  const serveKey = getEnv(SHARED_SERVE_ENV);
  if (serveKey !== undefined && (typeof key === 'string' ? serveKey === key : isSharedServerKey(serveKey))) {
    const options: ResolvedSharedServerOptions = { ...validated, key: serveKey };
    const startLockHolder = getEnv(SHARED_START_LOCK_ENV);
    delete process.env[SHARED_SERVE_ENV];
    delete process.env[SHARED_START_LOCK_ENV];
    const server = await serveShared({ config, options, create, startLockHolder, exit: (code) => process.exit(code) });
    exitOnShutdownSignals(() => server.close());
    return;
  }
  let options: ResolvedSharedServerOptions;
  if (typeof key === 'string') {
    options = { ...validated, key };
  } else {
    const read = await readSharedServerKey(key);
    if ('error' in read) throw new InvalidSharedServerOptionsError(`key: ${read.error}`);
    options = { ...validated, key: read.key, keySource: key };
  }
  redirectConsoleToStderr();
  const session = attachSharedSession({
    ...options,
    name: config.info.name,
    version,
    input: process.stdin,
    output: process.stdout,
    bootEmbedded: (sessionKey) => bootEmbeddedServer(config, { ...options, key: sessionKey }, create),
  });
  exitOnShutdownSignals(() => session.stop(), {
    deadlineMs: STDIO_SHUTDOWN_DEADLINE_MS,
    whenOrphaned: { stdin: process.stdin },
  });
  await session.attached;
}
