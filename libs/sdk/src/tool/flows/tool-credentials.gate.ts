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
 *     surface as the `authUrl`, or `signInRequired` for a caller that isn't
 *     signed in.
 *
 * When NEITHER accessor is configured (public mode, no auth, or the vault
 * subsystem simply isn't enabled), the gate reports "no checker" and the stage
 * skips entirely — preserving the pre-existing call-tool behavior exactly.
 *
 * A client that declared URL-mode elicitation is asked to open each missing
 * provider's connect page ({@link askToOpenConnectPages}), so the link reaches
 * the user rather than the model.
 */
import { AUTH_PROVIDERS_ACCESSOR, CREDENTIALS_ACCESSOR } from '@frontmcp/auth';
import type { Token } from '@frontmcp/di';
import { internalZ as z } from '@frontmcp/lazy-zod';

import type { NormalizedToolAuthProvider } from '../../common/metadata/tool.metadata';
import type { FrontMcpContext } from '../../context';
import { performElicit } from '../../elicitation/helpers/elicit.helper';
import { InputRequiredSignal, ToolCredentialsRequiredError } from '../../errors';
import { supportsElicitation, type ClientCapabilities } from '../../notification';

/** Outcome for a single required provider whose credential is unavailable. */
export interface MissingProvider {
  /** Provider id (the credential key / registered provider name). */
  name: string;
  /** Best-effort connect/authorize URL to (re)authorize, if resolvable. */
  authUrl?: string;
  /** Set when the caller has to sign in to this server before it can connect the provider. */
  signInRequired?: true;
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
  requireConnect(options: { key: string }): Promise<{ connected: boolean; resumeUrl?: string; signInRequired?: true }>;
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
    const missingProvider = await missingProviderOf(provider.name, authProviders, credentials);
    if (missingProvider) missing.push(missingProvider);
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
 * The provider when its credential is unavailable (undefined when available), preferring the documented
 * `this.authProviders` vault and falling back to the `this.credentials` vault (which also yields a connect URL, or
 * says the caller has to sign in, when absent).
 */
async function missingProviderOf(
  name: string,
  authProviders: AuthProvidersLike | undefined,
  credentials: CredentialsLike | undefined,
): Promise<MissingProvider | undefined> {
  // 1. authProviders vault — get() triggers load; non-null ⇒ available.
  if (authProviders) {
    try {
      const resolved = await authProviders.get(name);
      if (resolved) {
        return undefined;
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
        return undefined;
      }
      return {
        name,
        ...(res.resumeUrl ? { authUrl: res.resumeUrl } : {}),
        ...(res.signInRequired ? { signInRequired: true } : {}),
      };
    } catch {
      // Resolver failure ⇒ treat as unavailable with no URL.
      return { name };
    }
  }

  // authProviders existed but returned null and no credentials fallback.
  return { name };
}

/**
 * The error a call missing these credentials answers with: every missing provider id, the first connect URL (callers
 * connect one provider at a time), and whether the caller has to sign in first.
 */
export function credentialsRequiredErrorOf(toolId: string, missing: MissingProvider[]): ToolCredentialsRequiredError {
  return new ToolCredentialsRequiredError({
    toolId,
    providers: missing.map((provider) => provider.name),
    authUrl: missing.find((provider) => provider.authUrl)?.authUrl,
    signInRequired: missing.some((provider) => provider.signInRequired),
  });
}

/** What asking the client to open a connect page needs: the call's context, and the server's elicitation setting. */
export interface ConnectPageAsk {
  context: FrontMcpContext | undefined;
  getClientCapabilities: (sessionId: string) => ClientCapabilities | undefined;
  elicitationEnabled: boolean;
  toolId: string;
  toolInput: unknown;
  signal?: AbortSignal;
}

/**
 * Ask the client to open the connect page of each missing provider (URL-mode elicitation), when the server enables
 * elicitation, the client declared URL mode, and every missing provider has a page. True when the user accepted every
 * page, so the gate checks the credentials again. On protocol 2026-07-28 the first ask answers the call with an
 * `input_required` result, and the client's retry carries the answer.
 */
export async function askToOpenConnectPages(ask: ConnectPageAsk, missing: MissingProvider[]): Promise<boolean> {
  const everyProviderHasPage = missing.every((provider) => provider.authUrl);
  if (!ask.elicitationEnabled || !everyProviderHasPage || !clientTakesUrlElicitation(ask)) return false;

  for (const provider of missing) {
    try {
      const answer = await performElicit(
        {
          sessionId: ask.context?.sessionId,
          getClientCapabilities: ask.getClientCapabilities,
          tryGetContext: () => ask.context,
          entryName: ask.toolId,
          entryInput: ask.toolInput,
          elicitationEnabled: ask.elicitationEnabled,
          signal: ask.signal,
          inputKey: `connect-${provider.name}`,
        },
        `Connect ${provider.name} to continue: tool "${ask.toolId}" needs it.`,
        z.object({}),
        { mode: 'url', url: provider.authUrl },
      );
      if (answer.status !== 'accept') return false;
    } catch (error) {
      if (error instanceof InputRequiredSignal) throw error;
      return false;
    }
  }
  return true;
}

/** Whether the client declared URL-mode elicitation: in this request on protocol 2026-07-28, else for its session. */
function clientTakesUrlElicitation(ask: ConnectPageAsk): boolean {
  const exchange = ask.context?.getMrtrExchange?.();
  if (exchange) return exchange.supportsElicitation?.('url') === true;
  const sessionId = ask.context?.sessionId;
  return sessionId !== undefined && supportsElicitation(ask.getClientCapabilities(sessionId), 'url');
}
