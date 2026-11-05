/** Raised at startup when one `vaultRef` is given both a server credential (`credentials`) and a caller's (`authProviders`). */
export class VaultRefListedTwiceError extends Error {
  constructor(public readonly vaultRefs: string[]) {
    const listed = vaultRefs.map((vaultRef) => `"${vaultRef}"`).join(', ');
    super(
      `SkilledOpenApiPlugin: vaultRef ${listed} is listed under both credentials and authProviders, so its binding ` +
        "would send the caller's own credential and never the server's. Keep each vaultRef in one of the two.",
    );
    this.name = 'VaultRefListedTwiceError';
  }
}
