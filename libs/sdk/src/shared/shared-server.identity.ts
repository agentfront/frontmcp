import { proveSharedServerIdentity } from '@frontmcp/auth';

/** What the identify flow proves with: the proof key, kept in a private field so no serialized config carries it. */
export class SharedServerIdentity {
  readonly #proofKey: Uint8Array;

  constructor(
    proofKey: Uint8Array,
    readonly endpoint: string,
  ) {
    this.#proofKey = proofKey;
  }

  prove(nonce: string): string {
    return proveSharedServerIdentity(this.#proofKey, this.endpoint, nonce);
  }
}
