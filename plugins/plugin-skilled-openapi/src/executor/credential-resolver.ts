// file: plugins/plugin-skilled-openapi/src/executor/credential-resolver.ts

import { type Token } from '@frontmcp/di';
import type { ExecutionContextBase } from '@frontmcp/sdk';

import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from '../skilled-openapi.symbols';
import { connectedCredentialOf } from './connected-credential';

/** The verified auth info of the caller a request is made for: its token, user claims and session. */
export type CallerAuthInfo = ExecutionContextBase['authInfo'];

/** What a resolver is told about the credential it is asked for. */
export interface CredentialResolveOptions {
  /** The bundle whose auth binding names the `vaultRef`. */
  bundleId: string;
  /** The caller the request is made for. A resolver that serves several callers or tenants picks the credential by it. */
  authInfo: CallerAuthInfo;
}

/**
 * Resolves a `vaultRef` string from an `AuthBinding` to a credential value, such as an API key or bearer token.
 * Returns undefined if the ref is unknown: callers MUST fail closed (do NOT call without credentials).
 */
export interface CredentialResolver {
  resolve(ref: string, opts: CredentialResolveOptions): Promise<string | undefined>;
}

/**
 * In-memory resolver — values supplied at construction time. Suitable for
 * dev / demo / single-tenant. Trailing-newline normalization is applied once
 * at ingestion (constructor / setForBundle) so resolve() returns the stored
 * value verbatim and never mutates an intentional secret.
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
    this.defaults = new Map(Object.entries(defaults).map(([k, v]) => [k, normalizeSecret(v)]));
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
    bundle.set(ref, normalizeSecret(value));
  }

  async resolve(ref: string, opts: Pick<CredentialResolveOptions, 'bundleId'>): Promise<string | undefined> {
    const scoped = this.perBundle.get(opts.bundleId)?.get(ref);
    if (typeof scoped === 'string') return scoped;
    const fallback = this.defaults.get(ref);
    return typeof fallback === 'string' ? fallback : undefined;
  }
}

/** The providers and identity of the tool call a credential is resolved for. */
interface ToolCallLookup {
  get<T>(token: Token<T>): T;
  tryGet<T>(token: Token<T>): T | undefined;
  metadata: { name: string };
}

/**
 * The credentials one tool call sends. A `vaultRef` the `authProviders` option names is the caller's own credential,
 * from the vault the caller connected it in; any other comes from the nearest resolver declared as
 * `SkilledOpenApiCredentialResolver`, in `init({ providers })`, the `@App` that installs the plugin or
 * `@FrontMcp({ providers })`, and without one from the built-in resolver, which reads `credentials`.
 */
export function credentialResolverOf(toolCall: ToolCallLookup): CredentialResolver {
  const resolver = toolCall.tryGet(SkilledOpenApiCredentialResolver) ?? toolCall.get(MemoryCredentialResolver);
  const { authProviders } = toolCall.get(SkilledOpenApiConfig);
  return {
    resolve: (ref, opts) => {
      const provider = authProviders.get(ref);
      return provider ? connectedCredentialOf(provider, toolCall) : resolver.resolve(ref, opts);
    },
  };
}

// Strip a single trailing CR/LF that a file-sourced secret commonly picks up,
// without touching whitespace that may be part of the credential itself.
function normalizeSecret(value: string): string {
  return value.replace(/\r?\n$/, '');
}
