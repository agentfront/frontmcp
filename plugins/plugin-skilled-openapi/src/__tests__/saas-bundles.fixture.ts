// Bundles, their signatures, and the pull and push tokens of a SaaS bundle server, made for each test run; a push
// token can be bound to the body it is issued for.
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import {
  bundleDigest,
  canonicalize,
  PUSH_BODY_DIGEST_CLAIM,
  pushBodyDigest,
  type ResolvedBundle,
} from '@frontmcp/adapters/skills';
import { generateRsaKeyPair, randomUUID, rsaSignBase64Url } from '@frontmcp/utils';

export const ISSUER = 'https://cloud.example.dev';
export const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
export const ENDPOINT = `${ISSUER}/v1/bundles/acme`;
export const AUDIENCE = 'acme:prod';
const SIGNING_KEY_ID = 'push-test-signing';

const signingKeys = generateRsaKeyPair();
export const trustedKey = {
  keyId: SIGNING_KEY_ID,
  alg: 'RS256' as const,
  publicKeyPem: String(signingKeys.publicKey.export({ type: 'spki', format: 'pem' })),
};

export function bundle(version: string, skillIds: string[]): ResolvedBundle {
  return {
    schemaVersion: 1,
    bundleId: 'acme:billing',
    version,
    generatedAt: '2026-11-04T12:00:00.000Z',
    sourceDigest: '0'.repeat(64),
    services: [{ id: 'billing', baseUrl: 'https://billing.example.dev' }],
    authBindings: { none: { kind: 'none' } },
    skills: skillIds.map((id) => ({
      id,
      name: id,
      description: `The ${id} skill.`,
      instructions: `# ${id}`,
      operationIds: [],
    })),
    operations: {},
  };
}

export function signed(unsigned: ResolvedBundle): ResolvedBundle {
  const signature = rsaSignBase64Url(
    'RS256',
    new TextEncoder().encode(canonicalize(unsigned)),
    signingKeys.privateKey.export({ format: 'jwk' }),
  );
  return { ...unsigned, integrity: { alg: 'RS256', keyId: SIGNING_KEY_ID, digest: bundleDigest(unsigned), signature } };
}

export async function tokenIssuer(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  const sign = (claims: Record<string, unknown>) =>
    new SignJWT({ iss: ISSUER, aud: AUDIENCE, ...claims })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  /** A push token; issued `forBody`, it carries the `body_sha256` claim that binds it to that exact body. */
  const pushToken = (forBody?: string) =>
    sign({
      jti: randomUUID(),
      ...(forBody === undefined ? {} : { [PUSH_BODY_DIGEST_CLAIM]: pushBodyDigest(forBody) }),
    });
  return { jwks: { keys: [jwk] }, sign, pushToken };
}
