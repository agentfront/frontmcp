import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

import { RegistryError } from './errors';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const HEX_SEED_PATTERN = /^[0-9a-fA-F]{64}$/;
const PROOF_RECORD_PATTERN = /v=MCPv1;\s*k=([^;]+);\s*p=([A-Za-z0-9+/=]+)/;

export interface RegistryKeyPair {
  privateKeySeedHex: string;
  publicKeyBase64: string;
}

export interface ProofRecord {
  algorithm: string;
  publicKey: string;
}

export function defaultKeyPath(): string {
  return path.join(os.homedir(), '.frontmcp', 'keys', 'mcp-registry.key');
}

export function generateRegistryKeyPair(): RegistryKeyPair {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  return {
    privateKeySeedHex: pkcs8.subarray(-32).toString('hex'),
    publicKeyBase64: publicKeyBase64(privateKey),
  };
}

export function parsePrivateKey(text: string): crypto.KeyObject {
  const trimmed = text.trim();
  if (HEX_SEED_PATTERN.test(trimmed)) {
    const der = Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(trimmed, 'hex')]);
    return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  }
  if (!trimmed.startsWith('-----BEGIN')) {
    throw new RegistryError('The private key must be a 64-character hex Ed25519 seed (what keygen writes) or a PEM.');
  }
  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey(trimmed);
  } catch {
    throw new RegistryError('The private key PEM could not be read.');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new RegistryError(`The private key is ${privateKey.asymmetricKeyType}; the Registry login needs Ed25519.`);
  }
  return privateKey;
}

export function publicKeyBase64(privateKey: crypto.KeyObject): string {
  const spki = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return spki.subarray(-32).toString('base64');
}

/** RFC 3339 UTC without fractional seconds, the exact text the Registry verifies. */
export function registryTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function signTimestamp(privateKey: crypto.KeyObject, timestamp: string): string {
  return crypto.sign(null, Buffer.from(timestamp, 'utf8'), privateKey).toString('hex');
}

export function formatProofRecord(publicKey: string): string {
  return `v=MCPv1; k=ed25519; p=${publicKey}`;
}

export function parseProofRecord(text: string): ProofRecord | undefined {
  const match = PROOF_RECORD_PATTERN.exec(text);
  return match ? { algorithm: match[1].trim(), publicKey: match[2] } : undefined;
}
