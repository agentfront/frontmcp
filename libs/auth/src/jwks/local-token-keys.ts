import type { CryptoKey, JSONWebKeySet, JWK, JWTPayload, JWTVerifyGetKey, JWTVerifyResult } from 'jose';

import { base64urlDecode, sha256Base64url } from '@frontmcp/utils';

import { SigningKeyInvalidError } from '../errors/auth-internal.errors';
import { loadJose } from './jose.loader';

/** The signing options of a mode: `auth.local` in local and remote mode, `auth` in public mode. */
export interface LocalSigningKeyConfig {
  signKey?: JWK | Uint8Array;
  jwks?: JSONWebKeySet;
}

type AsymmetricKty = 'RSA' | 'EC' | 'OKP';
type PublishedKey = JWK & { kid: string; alg: string };

const HMAC_MIN_BYTES: Record<string, number> = { HS256: 32, HS384: 48, HS512: 64 };

const ALGS_BY_KTY: Record<AsymmetricKty, readonly string[]> = {
  RSA: ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'],
  EC: ['ES256', 'ES384', 'ES512'],
  OKP: ['EdDSA', 'Ed25519'],
};

const EC_ALG_BY_CURVE: Record<string, string> = { 'P-256': 'ES256', 'P-384': 'ES384', 'P-521': 'ES512' };

const PUBLIC_MEMBERS: Record<AsymmetricKty, readonly (keyof JWK)[]> = {
  RSA: ['e', 'kty', 'n'],
  EC: ['crv', 'kty', 'x', 'y'],
  OKP: ['crv', 'kty', 'x'],
};

const MIN_RSA_MODULUS_BYTES = 256;

function isAsymmetricKty(kty: unknown): kty is AsymmetricKty {
  return kty === 'RSA' || kty === 'EC' || kty === 'OKP';
}

/** The keys a server signs and verifies its own tokens with: `signKey`, else HS256 with `JWT_SECRET`. */
export class LocalTokenKeys {
  private importedKey?: Promise<CryptoKey | Uint8Array>;
  /** The published keys as one JWK set, built once: the set imports each key on its first use and keeps it. */
  private publicKeySet?: JWTVerifyGetKey;

  private constructor(
    readonly alg: string,
    readonly kid: string | undefined,
    /** What `/.well-known/jwks.json` serves: public keys only, none for an HMAC key. */
    readonly publicJwks: JSONWebKeySet,
    private readonly algorithms: string[],
    private readonly hmacKey: Uint8Array | undefined,
    private readonly privateJwk: JWK | undefined,
  ) {}

  /** Throws {@link SigningKeyInvalidError} when a configured key can't sign or be published. */
  static fromConfig(config: LocalSigningKeyConfig, fallbackSecret: Uint8Array, optionPath: string): LocalTokenKeys {
    const { signKey, jwks } = config;
    if (signKey !== undefined && !(signKey instanceof Uint8Array) && signKey.kty !== 'oct') {
      return LocalTokenKeys.asymmetric(signKey, jwks?.keys ?? [], optionPath);
    }
    if (jwks?.keys?.length) {
      const hmacSource = signKey ? `${optionPath}.signKey` : 'JWT_SECRET';
      throw new SigningKeyInvalidError(
        `${optionPath}.jwks is set, but tokens are signed with an HMAC key (${hmacSource}), which is never ` +
          `published. Set an RSA, EC or Ed25519 private key as ${optionPath}.signKey.`,
      );
    }
    const hmac = LocalTokenKeys.hmacKeyOf(signKey, fallbackSecret, `${optionPath}.signKey`);
    return new LocalTokenKeys(hmac.alg, hmac.kid, { keys: [] }, [hmac.alg], hmac.key, undefined);
  }

  protectedHeader(): { alg: string; typ: 'JWT'; kid?: string } {
    return this.kid ? { alg: this.alg, typ: 'JWT', kid: this.kid } : { alg: this.alg, typ: 'JWT' };
  }

  /** The key `SignJWT.sign` takes; a private JWK is imported once. */
  signingKey(): Promise<CryptoKey | Uint8Array> {
    if (this.hmacKey) return Promise.resolve(this.hmacKey);
    this.importedKey ??= loadJose()
      .then(({ importJWK }) => importJWK(this.privateJwk as JWK, this.alg))
      .catch((error: unknown) => {
        this.importedKey = undefined;
        const reason = error instanceof Error ? error.message : String(error);
        throw new SigningKeyInvalidError(`The configured signKey can't be imported: ${reason}`);
      });
    return this.importedKey;
  }

  /** Verify a token's signature, pinned to the algorithms these keys sign with. */
  async verify(
    token: string,
    options: { issuer: string | string[]; requiredClaims: string[] },
  ): Promise<JWTVerifyResult<JWTPayload>> {
    const { createLocalJWKSet, jwtVerify } = await loadJose();
    const verifyOptions = { ...options, algorithms: this.algorithms };
    if (this.hmacKey) return jwtVerify(token, this.hmacKey, verifyOptions);
    this.publicKeySet ??= createLocalJWKSet(this.publicJwks);
    return jwtVerify(token, this.publicKeySet, verifyOptions);
  }

  private static asymmetric(signKey: JWK, jwksKeys: JWK[], optionPath: string): LocalTokenKeys {
    const signing = LocalTokenKeys.publicKeyOf(signKey, `${optionPath}.signKey`, 'private');
    const published = [signing];
    jwksKeys.forEach((key, index) => {
      const publicKey = LocalTokenKeys.publicKeyOf(key, `${optionPath}.jwks.keys[${index}]`, 'public');
      if (!published.some((existing) => existing.kid === publicKey.kid)) published.push(publicKey);
    });
    const algorithms = [...new Set(published.map((key) => key.alg))];
    return new LocalTokenKeys(signing.alg, signing.kid, { keys: published }, algorithms, undefined, signKey);
  }

  private static hmacKeyOf(
    signKey: JWK | Uint8Array | undefined,
    fallbackSecret: Uint8Array,
    path: string,
  ): { alg: string; kid?: string; key: Uint8Array } {
    if (signKey === undefined) return { alg: 'HS256', key: fallbackSecret };
    if (signKey instanceof Uint8Array) return { alg: 'HS256', key: LocalTokenKeys.longEnough(signKey, 'HS256', path) };
    const alg = signKey.alg ?? 'HS256';
    if (!(alg in HMAC_MIN_BYTES)) {
      throw new SigningKeyInvalidError(`${path} is an oct key with alg "${alg}"; use HS256, HS384 or HS512.`);
    }
    if (typeof signKey.k !== 'string' || signKey.k.length === 0) {
      throw new SigningKeyInvalidError(`${path} is an oct key without "k".`);
    }
    return { alg, kid: signKey.kid, key: LocalTokenKeys.longEnough(base64urlDecode(signKey.k), alg, path) };
  }

  private static longEnough(key: Uint8Array, alg: string, path: string): Uint8Array {
    const minBytes = HMAC_MIN_BYTES[alg];
    if (key.length < minBytes) {
      throw new SigningKeyInvalidError(
        `${path} is ${key.length} bytes; ${alg} requires at least ${minBytes} (RFC 7518 §3.2).`,
      );
    }
    return key;
  }

  /** The public half of `key` with its `kid` (else its RFC 7638 thumbprint), `alg` and `use`. */
  private static publicKeyOf(key: JWK, path: string, expected: 'private' | 'public'): PublishedKey {
    if (!isAsymmetricKty(key.kty)) {
      throw new SigningKeyInvalidError(`${path} has kty "${String(key.kty)}"; use an RSA, EC or OKP key.`);
    }
    const isPrivate = typeof key.d === 'string';
    if (expected === 'private' && !isPrivate) {
      throw new SigningKeyInvalidError(`${path} is a public key (it has no "d"); it must be the private key.`);
    }
    if (expected === 'public' && isPrivate) {
      throw new SigningKeyInvalidError(
        `${path} holds a private key; the jwks are published, so list public keys only.`,
      );
    }
    if (key.use !== undefined && key.use !== 'sig') {
      throw new SigningKeyInvalidError(`${path} has use "${key.use}"; a signing key needs use "sig" or none.`);
    }
    const alg = key.alg ?? LocalTokenKeys.defaultAlg(key);
    if (!ALGS_BY_KTY[key.kty].includes(alg)) {
      throw new SigningKeyInvalidError(`${path} has alg "${alg}", which ${key.kty} keys can't sign with.`);
    }
    if (key.kty === 'EC' && EC_ALG_BY_CURVE[key.crv ?? ''] !== alg) {
      throw new SigningKeyInvalidError(
        `${path} has curve "${String(key.crv)}" and alg "${alg}"; use P-256/ES256, P-384/ES384 or P-521/ES512.`,
      );
    }
    if (key.kty === 'OKP' && key.crv !== 'Ed25519') {
      throw new SigningKeyInvalidError(`${path} is an OKP key on "${String(key.crv)}"; only Ed25519 signs.`);
    }
    const members = PUBLIC_MEMBERS[key.kty];
    const missing = members.filter((member) => typeof key[member] !== 'string');
    if (missing.length > 0) {
      throw new SigningKeyInvalidError(`${path} is missing ${missing.map((member) => `"${member}"`).join(', ')}.`);
    }
    if (key.kty === 'RSA' && base64urlDecode(key.n as string).length < MIN_RSA_MODULUS_BYTES) {
      throw new SigningKeyInvalidError(`${path} is an RSA key shorter than 2048 bits.`);
    }
    const publicMembers = Object.fromEntries(members.map((member) => [member, key[member]]));
    const kid = key.kid ?? sha256Base64url(JSON.stringify(publicMembers));
    return { ...publicMembers, kid, alg, use: 'sig' };
  }

  private static defaultAlg(key: JWK): string {
    if (key.kty === 'RSA') return 'RS256';
    if (key.kty === 'OKP') return 'EdDSA';
    return EC_ALG_BY_CURVE[key.crv ?? ''] ?? 'ES256';
  }
}
