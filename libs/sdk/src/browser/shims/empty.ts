/**
 * Empty shim for modules not needed in browser
 *
 * Used as esbuild alias target for ioredis, express, cors, etc.
 * Exports stub classes/values for common named imports that code may reference.
 */

// Default export (for modules using `import X from '...'`)
// Must be a callable function since some modules call the default export as a constructor/factory
function noop() {
  return noop;
}
Object.assign(noop, {
  Router: () => noop,
  json: () => noop,
  urlencoded: () => noop,
  use: noop,
  get: noop,
  post: noop,
  all: noop,
  listen: noop,
});
export default noop;

// Common named exports that Node.js modules provide
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
export class Buffer {
  static from(): Buffer {
    return new Buffer();
  }
  static alloc(): Buffer {
    return new Buffer();
  }
  static isBuffer(): boolean {
    return false;
  }
  toString(): string {
    return '';
  }
}

// HTTP/2 stubs
export class Http2ServerRequest {}
export class Http2ServerResponse {}
