// file: plugins/plugin-skilled-openapi/src/executor/credential-resolver.ts

/**
 * Resolves a `vaultRef` string from an `AuthBinding` to a credential value.
 *
 * In production, this would be backed by `libs/auth`'s vault. v1.2.0 OSS
 * ships an in-memory implementation suitable for static-source / npm-source
 * deployments and demo scenarios; SaaS-managed deployments wire their own
 * resolver against the customer's secret manager via plugin DI overrides.
 *
 * Resolved credentials are scoped: the caller MUST supply a `bundleId` so
 * the resolver can enforce per-bundle credential allowlists (planned v1.2.x
 * feature; the interface is shaped for it now).
 */
export interface CredentialResolver {
  /**
   * Resolve a vault reference. Returns the credential value (e.g. an API key
   * or bearer token). Returns undefined if the ref is unknown — callers MUST
   * fail closed (do NOT call without credentials).
   */
  resolve(ref: string, opts: { bundleId: string }): Promise<string | undefined>;
}

/**
 * In-memory resolver — values supplied at construction time. Suitable for
 * dev / demo / single-tenant. Trim values to defeat trailing-newline mishaps.
 */
export class MemoryCredentialResolver implements CredentialResolver {
  constructor(private readonly map: Record<string, string>) {}
  async resolve(ref: string): Promise<string | undefined> {
    const v = this.map[ref];
    return typeof v === 'string' ? v.trim() : undefined;
  }
}
