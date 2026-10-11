// common/types/options/registry/utils.ts

import { base64Decode } from '@frontmcp/utils';

export const DEFAULT_REGISTRY_PUBLIC_KEY_ENV = 'MCP_REGISTRY_PUBLIC_KEY';

export const REGISTRY_SERVER_NAME_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]\/[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/;

const REGISTRY_AUTH_RECORD_PATTERN = /^v=MCPv1;\s*k=([^;]+);\s*p=([A-Za-z0-9+/=]+)$/;
const PADDED_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const ED25519_PUBLIC_KEY_BYTES = 32;
const PUBLIC_KEY_BYTES_BY_ALGORITHM = new Map([
  ['ed25519', ED25519_PUBLIC_KEY_BYTES],
  ['ecdsap384', 49],
]);

function isBase64OfByteLength(value: string, byteLength: number | undefined): boolean {
  if (byteLength === undefined || value.length % 4 !== 0 || !PADDED_BASE64_PATTERN.test(value)) return false;
  return base64Decode(value).length === byteLength;
}

/** A bare base64 Ed25519 key becomes `v=MCPv1; k=ed25519; p=<key>`, a whole record is kept; anything else is `undefined`. */
export function toRegistryAuthRecord(value: string): string | undefined {
  const trimmed = value.trim();
  const record = REGISTRY_AUTH_RECORD_PATTERN.exec(trimmed);
  if (!record) {
    return isBase64OfByteLength(trimmed, ED25519_PUBLIC_KEY_BYTES) ? `v=MCPv1; k=ed25519; p=${trimmed}` : undefined;
  }
  const [, algorithm, publicKey] = record;
  return isBase64OfByteLength(publicKey, PUBLIC_KEY_BYTES_BY_ALGORITHM.get(algorithm)) ? trimmed : undefined;
}
