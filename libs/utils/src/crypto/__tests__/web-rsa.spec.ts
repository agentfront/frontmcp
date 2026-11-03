import { generateRsaKeyPair, rsaSignBase64Url } from '../node';
import { rsaVerifyBrowser } from '../web-rsa';

const data = new TextEncoder().encode('header.payload');

describe('rsaVerifyBrowser', () => {
  it.each(['RS256', 'PS256', 'PS384', 'PS512'])('verifies a %s signature with WebCrypto', async (alg) => {
    const { privateKey, publicJwk } = generateRsaKeyPair(2048, alg);
    const signature = Buffer.from(
      rsaSignBase64Url(alg, data, privateKey.export({ format: 'jwk' }) as JsonWebKey),
      'base64url',
    );

    await expect(rsaVerifyBrowser(alg, data, publicJwk, signature)).resolves.toBe(true);
    await expect(rsaVerifyBrowser(alg, new TextEncoder().encode('tampered'), publicJwk, signature)).resolves.toBe(
      false,
    );
  });

  it('fails without WebCrypto', async () => {
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      await expect(rsaVerifyBrowser('RS256', data, {}, new Uint8Array())).rejects.toThrow('crypto.subtle');
    } finally {
      delete (globalThis.crypto as { subtle?: SubtleCrypto }).subtle;
    }
  });
});

describe('rsaVerify outside Node', () => {
  it('verifies with WebCrypto', async () => {
    jest.resetModules();
    jest.doMock('../runtime', () => ({ ...jest.requireActual('../runtime'), isNode: () => false }));
    const { rsaVerify } = require('../index') as typeof import('../index');
    const { privateKey, publicJwk } = generateRsaKeyPair(2048, 'RS256');
    const signature = Buffer.from(
      rsaSignBase64Url('RS256', data, privateKey.export({ format: 'jwk' }) as JsonWebKey),
      'base64url',
    );

    await expect(rsaVerify('RS256', data, publicJwk, signature)).resolves.toBe(true);
    jest.dontMock('../runtime');
  });
});
