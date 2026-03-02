/**
 * Browser shim for node:os
 *
 * Returns browser-safe defaults for OS-related queries.
 */

export function platform(): string {
  return 'browser';
}

export function hostname(): string {
  return typeof globalThis !== 'undefined' && 'location' in globalThis
    ? (globalThis as unknown as { location: { hostname: string } }).location.hostname
    : 'localhost';
}

export function tmpdir(): string {
  return '/tmp';
}

export function homedir(): string {
  return '/';
}

export function cpus(): { model: string; speed: number }[] {
  return [{ model: 'browser', speed: 0 }];
}

export function totalmem(): number {
  return 0;
}

export function freemem(): number {
  return 0;
}

export function type(): string {
  return 'Browser';
}

export const EOL = '\n';

export default { platform, hostname, tmpdir, homedir, cpus, totalmem, freemem, type, EOL };
