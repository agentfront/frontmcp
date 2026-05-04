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
 *
 * Bundle scoping: the constructor seeds tenant-wide credentials (the natural
 * shape of the plugin's `credentials` option for single-tenant demos). When a
 * bundle needs an override (e.g. a multi-tenant deployment where every bundle
 * carries its own secret for the same `vaultRef`), call `setForBundle()`. On
 * resolve, the per-bundle entry wins over the tenant-wide default; if neither
 * exists the call returns undefined and the executor fails closed.
 */
export class MemoryCredentialResolver implements CredentialResolver {
  private readonly defaults: Map<string, string>;
  private readonly perBundle = new Map<string, Map<string, string>>();

  constructor(defaults: Record<string, string> = {}) {
    this.defaults = new Map(Object.entries(defaults));
  }

  /**
   * Override (or add) a credential for a specific bundle. Per-bundle entries
   * take precedence over the tenant-wide defaults supplied to the constructor.
   */
  setForBundle(bundleId: string, ref: string, value: string): void {
    let bundle = this.perBundle.get(bundleId);
    if (!bundle) {
      bundle = new Map();
      this.perBundle.set(bundleId, bundle);
    }
    bundle.set(ref, value);
  }

  async resolve(ref: string, opts: { bundleId: string }): Promise<string | undefined> {
    const scoped = this.perBundle.get(opts.bundleId)?.get(ref);
    if (typeof scoped === 'string') return scoped.trim();
    const fallback = this.defaults.get(ref);
    return typeof fallback === 'string' ? fallback.trim() : undefined;
  }
}
