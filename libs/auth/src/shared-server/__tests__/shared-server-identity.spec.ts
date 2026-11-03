import { base64urlDecode, base64urlEncode } from '@frontmcp/utils';

import {
  createSharedServerNonce,
  createSharedServerSecret,
  deriveSharedServerKeys,
  isSharedServerNonce,
  proveSharedServerIdentity,
  verifySharedServerIdentity,
} from '../shared-server-identity';

const ENDPOINT = 'unix:/home/me/.frontmcp/shared/notes/server.sock';

describe('shared server identity', () => {
  it('creates a fresh 32-byte secret and nonce each time', () => {
    const secrets = new Set([createSharedServerSecret(), createSharedServerSecret()]);
    const nonces = new Set([createSharedServerNonce(), createSharedServerNonce()]);
    expect(secrets.size).toBe(2);
    expect(nonces.size).toBe(2);
    for (const value of [...secrets, ...nonces]) expect(base64urlDecode(value)).toHaveLength(32);
  });

  it('derives a proof key and a token that differ from each other and from the secret', () => {
    const secret = createSharedServerSecret();
    const keys = deriveSharedServerKeys(secret);
    expect(keys.proofKey).toHaveLength(32);
    expect(base64urlDecode(keys.token)).toHaveLength(32);
    expect(keys.token).not.toBe(secret);
    expect(base64urlEncode(keys.proofKey)).not.toBe(keys.token);
    expect(deriveSharedServerKeys(secret)).toEqual(keys);
  });

  it('refuses a secret that is not 32 bytes of base64url', () => {
    expect(() => deriveSharedServerKeys('short')).toThrow('a shared server secret is 32 bytes of base64url');
    expect(() => deriveSharedServerKeys('!'.repeat(43))).toThrow('a shared server secret is 32 bytes of base64url');
  });

  it('accepts only a nonce shaped like one it creates', () => {
    expect(isSharedServerNonce(createSharedServerNonce())).toBe(true);
    expect(isSharedServerNonce('a'.repeat(42))).toBe(false);
    expect(isSharedServerNonce(`${'a'.repeat(42)}=`)).toBe(false);
    expect(isSharedServerNonce(42)).toBe(false);
  });

  describe('a proof', () => {
    const { proofKey } = deriveSharedServerKeys(createSharedServerSecret());

    it('verifies for the key, endpoint and nonce it was made for', () => {
      const nonce = createSharedServerNonce();
      const proof = proveSharedServerIdentity(proofKey, ENDPOINT, nonce);
      expect(verifySharedServerIdentity(proofKey, ENDPOINT, nonce, proof)).toBe(true);
    });

    it('is refused when replayed for another nonce', () => {
      const proof = proveSharedServerIdentity(proofKey, ENDPOINT, createSharedServerNonce());
      expect(verifySharedServerIdentity(proofKey, ENDPOINT, createSharedServerNonce(), proof)).toBe(false);
    });

    it('is refused when made for another endpoint', () => {
      const nonce = createSharedServerNonce();
      const proof = proveSharedServerIdentity(proofKey, 'http://127.0.0.1:4000', nonce);
      expect(verifySharedServerIdentity(proofKey, 'http://127.0.0.1:4001', nonce, proof)).toBe(false);
    });

    it('is refused when stale: made with the key of an earlier server', () => {
      const earlier = deriveSharedServerKeys(createSharedServerSecret()).proofKey;
      const nonce = createSharedServerNonce();
      const proof = proveSharedServerIdentity(earlier, ENDPOINT, nonce);
      expect(verifySharedServerIdentity(proofKey, ENDPOINT, nonce, proof)).toBe(false);
    });

    it('is refused when it is not a proof at all', () => {
      const nonce = createSharedServerNonce();
      for (const proof of [undefined, 42, '', 'not base64url!', base64urlEncode(new Uint8Array(31))]) {
        expect(verifySharedServerIdentity(proofKey, ENDPOINT, nonce, proof)).toBe(false);
      }
    });

    it('cannot be shifted between the endpoint and the nonce', () => {
      const nonce = createSharedServerNonce();
      const proof = proveSharedServerIdentity(proofKey, `${ENDPOINT}\n`, nonce);
      expect(verifySharedServerIdentity(proofKey, ENDPOINT, `\n${nonce}`, proof)).toBe(false);
    });
  });
});
