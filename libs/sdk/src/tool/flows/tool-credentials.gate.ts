/**
 * Tool credential gate (call-tool flow `checkToolCredentials` stage).
 *
 * Reads a tool's normalized `authProviders` and, for every provider declared
 * `required: true` (the default), determines whether a credential is available
 * for the CURRENT authenticated session. Providers whose credential is missing
 * are reported back to the stage, which aborts the call before `execute()` runs.
 *
 * Availability is checked against whichever credential accessor is wired into
 * the running scope — both are resolved defensively:
 *
 *  1. {@link AUTH_PROVIDERS_ACCESSOR} — the documented `this.authProviders`
 *     vault. `accessor.get(name)` triggers a vault/factory load (so a lazily
 *     acquirable credential is honored, matching "loaded before execute()")
 *     and yields `ResolvedCredential | null`.
 *  2. {@link CREDENTIALS_ACCESSOR} — the per-session `this.credentials` vault
 *     (local/remote auth modes). `accessor.requireConnect({ key })` reports
 *     `connected` and, when absent, returns a framework-signed `resumeUrl` we
 *     surface as the `authUrl`.
 *
 * When NEITHER accessor is configured (public mode, no auth, or the vault
 * subsystem simply isn't enabled), the gate reports "no checker" and the stage
 * skips entirely — preserving the pre-existing call-tool behavior exactly.
 */
import { AUTH_PROVIDERS_ACCESSOR, CREDENTIALS_ACCESSOR } from '@frontmcp/auth';
import type { Token } from '@frontmcp/di';

import type { NormalizedToolAuthProvider } from '../../common/metadata/tool.metadata';

/** Outcome for a single required provider whose credential is unavailable. */
export interface MissingProvider {
  /** Provider id (the credential key / registered provider name). */
  name: string;
  /** Best-effort connect/authorize URL to (re)authorize, if resolvable. */
  authUrl?: string;
}

/** Result of evaluating the credential gate for a tool. */
export interface CredentialGateResult {
  /**
   * `true` when a credential accessor was available and the providers were
   * actually evaluated; `false` when no accessor is configured (gate skipped).
   */
  evaluated: boolean;
  /** Required providers whose credential was not available. */
  missing: MissingProvider[];
}

/** Minimal shape of the documented `this.authProviders` accessor we depend on. */
interface AuthProvidersLike {
  get(name: string): Promise<unknown | null>;
}

/** Minimal shape of the wired `this.credentials` accessor we depend on. */
interface CredentialsLike {
  requireConnect(options: { key: string }): Promise<{ connected: boolean; resumeUrl?: string }>;
}

function isAuthProvidersLike(v: unknown): v is AuthProvidersLike {
  return typeof v === 'object' && v !== null && typeof (v as AuthProvidersLike).get === 'function';
}

function isCredentialsLike(v: unknown): v is CredentialsLike {
  return typeof v === 'object' && v !== null && typeof (v as CredentialsLike).requireConnect === 'function';
}

/**
 * Evaluate the credential gate for a tool's normalized auth providers.
 *
 * @param providers - normalized auth-provider refs (defaults already applied).
 * @param tryGet - defensive DI resolver (e.g. the tool context's `tryGet`) that
 *   returns `undefined` (rather than throwing) when a token is not registered
 *   or is out of scope. This lets the gate transparently skip when no
 *   credential accessor is wired.
 * @returns whether the gate was evaluated and which required providers are missing.
 */
export async function evaluateToolCredentialGate(
  providers: NormalizedToolAuthProvider[],
  tryGet: <T>(token: Token<T>) => T | undefined,
): Promise<CredentialGateResult> {
  const required = providers.filter((p) => p.required);
  if (required.length === 0) {
    // Nothing to gate (no required providers) — but this is still "no work",
    // not "no accessor". Report evaluated:true with no missing entries.
    return { evaluated: true, missing: [] };
  }

  const authProviders = resolveAccessor<AuthProvidersLike>(tryGet, AUTH_PROVIDERS_ACCESSOR, isAuthProvidersLike);
  const credentials = resolveAccessor<CredentialsLike>(tryGet, CREDENTIALS_ACCESSOR, isCredentialsLike);

  // No credential accessor wired anywhere → cannot gate; preserve legacy behavior.
  if (!authProviders && !credentials) {
    return { evaluated: false, missing: [] };
  }

  const missing: MissingProvider[] = [];
  for (const provider of required) {
    const { available, authUrl } = await checkProvider(provider.name, authProviders, credentials);
    if (!available) {
      missing.push({ name: provider.name, ...(authUrl ? { authUrl } : {}) });
    }
  }

  return { evaluated: true, missing };
}

/**
 * Resolve an accessor defensively via a `tryGet`-style resolver, returning
 * undefined when the token is not wired or the resolved value doesn't match
 * the expected accessor shape.
 */
function resolveAccessor<T>(
  tryGet: <R>(token: Token<R>) => R | undefined,
  token: Token<unknown>,
  guard: (v: unknown) => v is T,
): T | undefined {
  const value = tryGet(token as Token<unknown>);
  return guard(value) ? value : undefined;
}

/**
 * Determine availability for a single provider, preferring the documented
 * `this.authProviders` vault and falling back to the `this.credentials` vault
 * (which also yields a connect URL when absent).
 */
async function checkProvider(
  name: string,
  authProviders: AuthProvidersLike | undefined,
  credentials: CredentialsLike | undefined,
): Promise<{ available: boolean; authUrl?: string }> {
  // 1. authProviders vault — get() triggers load; non-null ⇒ available.
  if (authProviders) {
    try {
      const resolved = await authProviders.get(name);
      if (resolved) {
        return { available: true };
      }
    } catch {
      // Fall through to the credentials vault on resolver failure.
    }
  }

  // 2. credentials vault — requireConnect reports connectivity + a resume URL.
  if (credentials) {
    try {
      const res = await credentials.requireConnect({ key: name });
      if (res.connected) {
        return { available: true };
      }
      return { available: false, authUrl: res.resumeUrl };
    } catch {
      // Resolver failure ⇒ treat as unavailable with no URL.
      return { available: false };
    }
  }

  // authProviders existed but returned null and no credentials fallback.
  return { available: false };
}
