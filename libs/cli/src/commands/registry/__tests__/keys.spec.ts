import * as crypto from 'crypto';

import { RegistryError } from '../errors';
import {
  formatProofRecord,
  generateRegistryKeyPair,
  parsePrivateKey,
  parseProofRecord,
  publicKeyBase64,
  registryTimestamp,
  signTimestamp,
} from '../keys';

// RFC 8032 test 1 seed; the expected values come from Go's crypto/ed25519, the Registry's verifier.
const TEST_SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const TEST_PUBLIC_KEY = '11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=';
const TEST_TIMESTAMP = '2026-10-11T09:30:00Z';
const TEST_SIGNATURE_HEX =
  'ce6c56a7218577a4a04845e2c4264c409067f403ef09e52320786e03c6e4b01df7251ecd97d5db86d7e905fc8f3ad97f6cb5bfce78a2e6e621c152edaba37e04';

describe('Registry keys', () => {
  it('signs the timestamp bytes exactly as Go ed25519.Sign does', () => {
    const privateKey = parsePrivateKey(TEST_SEED_HEX);
    expect(publicKeyBase64(privateKey)).toBe(TEST_PUBLIC_KEY);
    expect(signTimestamp(privateKey, TEST_TIMESTAMP)).toBe(TEST_SIGNATURE_HEX);
  });

  it('reads a hex seed and the matching PEM as the same key', () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const seedHex = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex');
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

    const fromSeed = parsePrivateKey(`${seedHex.toUpperCase()}\n`);
    const fromPem = parsePrivateKey(pem);
    expect(publicKeyBase64(fromSeed)).toBe(publicKeyBase64(fromPem));
    expect(publicKeyBase64(fromSeed)).toBe(
      crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
    );

    const signature = Buffer.from(signTimestamp(fromSeed, TEST_TIMESTAMP), 'hex');
    expect(signature).toHaveLength(64);
    expect(crypto.verify(null, Buffer.from(TEST_TIMESTAMP), crypto.createPublicKey(privateKey), signature)).toBe(true);
    expect(signTimestamp(fromPem, TEST_TIMESTAMP)).toBe(signature.toString('hex'));
  });

  it('generates a key pair whose seed parses back to its public key', () => {
    const { privateKeySeedHex, publicKeyBase64: publicKey } = generateRegistryKeyPair();
    expect(privateKeySeedHex).toMatch(/^[0-9a-f]{64}$/);
    expect(publicKey).toHaveLength(44);
    expect(publicKeyBase64(parsePrivateKey(privateKeySeedHex))).toBe(publicKey);
  });

  it('rejects keys that are not Ed25519 without echoing them', () => {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(() => parsePrivateKey(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString())).toThrow(/is ec/);
    expect(() => parsePrivateKey('-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----')).toThrow(
      'The private key PEM could not be read.',
    );
    const secretLooking = 'abc123-not-a-key';
    let thrown: unknown;
    try {
      parsePrivateKey(secretLooking);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RegistryError);
    expect((thrown as Error).message).not.toContain(secretLooking);
  });

  it('formats the timestamp as RFC 3339 UTC without fractional seconds', () => {
    expect(registryTimestamp(new Date('2026-10-11T09:30:00.987Z'))).toBe('2026-10-11T09:30:00Z');
    expect(registryTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('formats and parses the proof record as the Registry does', () => {
    expect(formatProofRecord(TEST_PUBLIC_KEY)).toBe(`v=MCPv1; k=ed25519; p=${TEST_PUBLIC_KEY}`);
    expect(parseProofRecord(`  v=MCPv1;k=ed25519;p=${TEST_PUBLIC_KEY}\n`)).toEqual({
      algorithm: 'ed25519',
      publicKey: TEST_PUBLIC_KEY,
    });
    expect(parseProofRecord('v=MCPv1; k=ecdsap384; p=AAAA v=MCPv1; k=ed25519; p=BBBB')).toEqual({
      algorithm: 'ecdsap384',
      publicKey: 'AAAA',
    });
    expect(parseProofRecord('<html>not found</html>')).toBeUndefined();
  });
});
