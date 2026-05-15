// libs/cli/src/commands/dev/port.ts
//
// Port-probing helpers for `frontmcp dev`. Extracted so they can be unit-tested
// against real ephemeral ports without spawning the dev pipeline (issue #398).

import { execFile } from 'node:child_process';
import * as net from 'node:net';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_HOST = '127.0.0.1';
const MAX_AUTO_PORT_PROBES = 50;

/**
 * Probe a TCP port by binding a throwaway server.
 *
 * Resolves `true` when the port is free (bind succeeds; the server is closed
 * immediately) and `false` when bind fails with `EADDRINUSE`. Other errors
 * (permission denied on privileged ports, invalid host, …) are rethrown so
 * callers see the real cause instead of a misleading "in use" signal.
 */
export async function isPortFree(port: number, host: string = DEFAULT_HOST): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeAllListeners();
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        reject(err);
      }
    };
    server.once('error', onError);
    server.once('listening', () => {
      server.removeAllListeners();
      server.close(() => resolve(true));
    });
    // exclusive: true so we don't share via SO_REUSEPORT.
    server.listen({ port, host, exclusive: true });
  });
}

/**
 * Walk forward from `start` until a free TCP port is found. Caps the probe
 * count to avoid pathological scans when an attacker / mistake holds a huge
 * contiguous range.
 *
 * @throws Error when no free port is found within the cap.
 */
export async function findNextFreePort(
  start: number,
  host: string = DEFAULT_HOST,
  maxProbes: number = MAX_AUTO_PORT_PROBES,
): Promise<number> {
  for (let i = 0; i < maxProbes; i++) {
    const port = start + i;
    if (port > 65535) break;

    if (await isPortFree(port, host)) return port;
  }
  throw new Error(`No free TCP port found in range ${start}..${start + maxProbes - 1}.`);
}

/**
 * Identify which process is holding a port. Opt-in via `--show-conflict`
 * because lsof can be slow and is unavailable on Windows. Returns
 * `undefined` when lsof is not on PATH or the lookup produced no rows.
 */
export async function lookupPortOwner(port: number): Promise<string | undefined> {
  if (process.platform === 'win32') {
    // `lsof` isn't a thing here; netstat is the equivalent but its output
    // shape varies across Windows versions, so leave this out for now.
    return undefined;
  }
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      timeout: 1500,
    });
    const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) return undefined;
    return lines.slice(1).join('\n').trim();
  } catch {
    return undefined;
  }
}
