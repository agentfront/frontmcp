/**
 * Browser shim for node:crypto
 *
 * Provides minimal compatibility for code that imports node:crypto.
 * All real crypto operations should use @frontmcp/utils which supports
 * both Node.js and browser (Web Crypto API / @noble/*).
 *
 * This shim delegates to the Web Crypto API where possible and
 * provides no-op/throw stubs for Node.js-specific functionality.
 */

function notAvailable(method: string): never {
  throw new Error(
    `crypto.${method}() is not available in the browser. ` +
      'Use @frontmcp/utils for cross-platform crypto operations.',
  );
}

export function randomBytes(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export function createHash(): never {
  return notAvailable('createHash');
}

export function createHmac(): never {
  return notAvailable('createHmac');
}

export function createCipheriv(): never {
  return notAvailable('createCipheriv');
}

export function createDecipheriv(): never {
  return notAvailable('createDecipheriv');
}

export function pbkdf2(): never {
  return notAvailable('pbkdf2');
}

export function scrypt(): never {
  return notAvailable('scrypt');
}

export function generateKeyPair(): never {
  return notAvailable('generateKeyPair');
}

const cryptoShim = {
  randomBytes,
  randomUUID,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  pbkdf2,
  scrypt,
  generateKeyPair,
  webcrypto: typeof globalThis !== 'undefined' ? globalThis.crypto : undefined,
};

export default cryptoShim;
