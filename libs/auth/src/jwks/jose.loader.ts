type Jose = typeof import('jose');

let jose: Promise<Jose> | undefined;

/** `jose`, loaded on the first token check; `require` only where the runtime cannot run a dynamic import (Jest). */
export function loadJose(): Promise<Jose> {
  jose ??= import('jose')
    .catch((importError: unknown) => {
      try {
        return require('jose') as Jose;
      } catch {
        throw importError;
      }
    })
    .catch((error: unknown) => {
      jose = undefined;
      throw error;
    });
  return jose;
}
