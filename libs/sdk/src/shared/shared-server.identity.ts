import { proveSharedServerIdentity, type SharedServerKeys } from '@frontmcp/auth';
import { sha256, timingSafeEqual } from '@frontmcp/utils';

const BEARER = 'Bearer ';

/** What the shared flows prove and check with: the keys sit in private fields, so no serialized config carries them. */
export class SharedServerIdentity {
  readonly #proofKey: Uint8Array;
  readonly #tokenDigest: Uint8Array;

  constructor(
    keys: SharedServerKeys,
    readonly endpoint: string,
    readonly version: string,
  ) {
    this.#proofKey = keys.proofKey;
    this.#tokenDigest = sha256(keys.token);
  }

  prove(nonce: string): { proof: string; version: string } {
    const proof = proveSharedServerIdentity(this.#proofKey, { endpoint: this.endpoint, nonce, version: this.version });
    return { proof, version: this.version };
  }

  /** Whether an `Authorization` header carries the server's token, compared in constant time. */
  acceptsToken(authorization: unknown): boolean {
    if (typeof authorization !== 'string' || !authorization.startsWith(BEARER)) return false;
    return timingSafeEqual(sha256(authorization.slice(BEARER.length)), this.#tokenDigest);
  }
}
