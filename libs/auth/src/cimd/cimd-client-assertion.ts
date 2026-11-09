/**
 * `private_key_jwt` client authentication (RFC 7523 §2.2 and §3, RFC 7521 §4.2) for clients whose client ID
 * metadata document declares it: the client signs a short-lived JWT with a key from its `jwks` / `jwks_uri`.
 */
import type { JSONWebKeySet, JWTPayload } from 'jose';

import { sha256Hex } from '@frontmcp/utils';

import { loadJose } from '../jwks/jose.loader';
import { CimdClientAssertionError, CimdError, type ClientAssertionRefusal } from './cimd.errors';

/** The `client_assertion_type` of a JWT client assertion (RFC 7523 §2.2). */
export const CLIENT_ASSERTION_TYPE_JWT_BEARER = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/** The signature algorithms a client assertion may use: asymmetric only, so never `none` or `HS*`. */
export const CLIENT_ASSERTION_SIGNING_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
  'Ed25519',
];

/** How far in the future an assertion's `exp` may be. */
export const MAX_CLIENT_ASSERTION_LIFETIME_SECONDS = 600;

const CLOCK_TOLERANCE_SECONDS = 30;
const MAX_CLIENT_ASSERTION_LENGTH = 16_384;

/** What a token request carries to authenticate a `private_key_jwt` client. */
export interface ClientAssertionInput {
  /** The request's `client_assertion_type`. */
  type?: string;
  /** The request's `client_assertion`. */
  assertion?: string;
  /** What the assertion's `aud` may name: this server's token endpoint and its issuer. */
  audiences: readonly string[];
}

/** {@link ClientAssertionInput}, with the store that makes each assertion's `jti` single-use. */
export interface ClientAssertionCheck extends ClientAssertionInput {
  /**
   * Claim `key` for `ttlMs`, exactly once across the deployment.
   * @returns `true` for the first claim, `false` when the key was already claimed or the store is unavailable
   */
  claimOnce(key: string, ttlMs: number): Promise<boolean>;
}

interface ClientAssertionContext extends ClientAssertionCheck {
  clientId: string;
  /** The client's keys; `refresh` asks for a fresh copy when the assertion names a key the cached one lacks. */
  keys(refresh: boolean): Promise<JSONWebKeySet>;
}

type Jose = Awaited<ReturnType<typeof loadJose>>;

/**
 * Verify a client assertion: an asymmetric signature by one of the client's keys; `iss` and `sub` equal to the
 * `client_id`; an `aud` naming this server; an `exp` at most {@link MAX_CLIENT_ASSERTION_LIFETIME_SECONDS} ahead;
 * `nbf` and `iat` not in the future; and a `jti` never seen before within the assertion's lifetime.
 *
 * @throws CimdClientAssertionError naming the check that refused it
 */
export async function verifyClientAssertion(context: ClientAssertionContext): Promise<void> {
  const { clientId, assertion } = context;
  const refuse = (reason: ClientAssertionRefusal) => new CimdClientAssertionError(clientId, reason);

  if (!assertion) throw refuse('missing_assertion');
  if (context.type !== CLIENT_ASSERTION_TYPE_JWT_BEARER) throw refuse('unsupported_assertion_type');
  if (assertion.length > MAX_CLIENT_ASSERTION_LENGTH) throw refuse('malformed');

  const jose = await loadJose();
  let algorithm: unknown;
  try {
    algorithm = jose.decodeProtectedHeader(assertion).alg;
  } catch {
    throw refuse('malformed');
  }
  if (typeof algorithm !== 'string' || !CLIENT_ASSERTION_SIGNING_ALGORITHMS.includes(algorithm)) {
    throw refuse('unsupported_algorithm');
  }

  let payload: JWTPayload;
  try {
    payload = await verifySignedClaims(jose, context);
  } catch (error) {
    if (error instanceof CimdError) throw error;
    throw refuse(refusalFor(error));
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = payload.exp ?? now;
  if (expiresAt - now > MAX_CLIENT_ASSERTION_LIFETIME_SECONDS) throw refuse('lifetime_too_long');
  if (typeof payload.iat === 'number' && payload.iat > now + CLOCK_TOLERANCE_SECONDS) throw refuse('not_yet_valid');
  if (typeof payload.jti !== 'string' || payload.jti.length === 0) throw refuse('missing_claim');

  const ttlMs = (expiresAt - now + CLOCK_TOLERANCE_SECONDS) * 1000;
  const claimed = await context.claimOnce(`client-assertion:${sha256Hex(`${clientId}\n${payload.jti}`)}`, ttlMs);
  if (!claimed) throw refuse('replayed');
}

/** Verify the signature and the registered claims, fetching the keys again once when none matches the header. */
async function verifySignedClaims(jose: Jose, context: ClientAssertionContext): Promise<JWTPayload> {
  const options = {
    algorithms: CLIENT_ASSERTION_SIGNING_ALGORITHMS,
    issuer: context.clientId,
    subject: context.clientId,
    audience: [...context.audiences],
    requiredClaims: ['exp', 'jti'],
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  };
  const verifyWith = async (refresh: boolean) => {
    const keys = jose.createLocalJWKSet(await context.keys(refresh));
    return (await jose.jwtVerify(context.assertion ?? '', keys, options)).payload;
  };
  try {
    return await verifyWith(false);
  } catch (error) {
    if (errorCode(error) !== 'ERR_JWKS_NO_MATCHING_KEY') throw error;
    return verifyWith(true);
  }
}

/** The refusal a `jose` error stands for, read from its `code` (the class may come from either module build). */
function refusalFor(error: unknown): ClientAssertionRefusal {
  const { claim, reason } = error as { claim?: string; reason?: string };
  switch (errorCode(error)) {
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
      return 'unsupported_algorithm';
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
    case 'ERR_JWKS_INVALID':
    case 'ERR_JWK_INVALID':
      return 'unknown_key';
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return 'bad_signature';
    case 'ERR_JWT_EXPIRED':
      return 'expired';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      if (reason === 'missing') return 'missing_claim';
      if (claim === 'iss') return 'wrong_issuer';
      if (claim === 'sub') return 'wrong_subject';
      if (claim === 'aud') return 'wrong_audience';
      if (claim === 'nbf') return 'not_yet_valid';
      return 'malformed';
    default:
      return 'malformed';
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
}
