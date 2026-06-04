/**
 * Server-owned Auth-UI write-shape (#469).
 *
 * This is the SERVER side of the auth-page JSON-serialization boundary. The
 * authorize/callback flows BUILD an {@link AuthFlowState} here and the page
 * builder INJECTS it as `window.__FRONTMCP_AUTH__`; the CLIENT (in the browser)
 * reads the matching read-shape from `@frontmcp/ui/auth`.
 *
 * These types + constants are deliberately a LOCAL copy of the client contract
 * (`@frontmcp/ui/auth`'s `contract.ts`) rather than an import: the SDK must NOT
 * depend on `@frontmcp/ui` (a React package) just to share a handful of plain
 * data shapes + two string literals. Server-owned write-shape + client-owned
 * read-shape across a JSON boundary is intentional. The `demo-e2e-local-auth`
 * e2e asserts the emitted `window.__FRONTMCP_AUTH__` wire shape, which guards
 * against the two copies drifting.
 *
 * @packageDocumentation
 */

/**
 * Which built-in authorization page slot a component renders. Must match
 * `AuthSlot` in `@frontmcp/ui/auth`.
 */
export type AuthSlot = 'login' | 'consent' | 'incremental' | 'federated' | 'error';

/** HTTP method the auth submit/extra requests use. Matches `@frontmcp/ui/auth`. */
export type AuthSubmitMethod = 'GET' | 'POST';

/**
 * A selectable authentication provider surfaced on the federated-login slot.
 * Matches `AuthProvider` in `@frontmcp/ui/auth`. Only display + selection fields
 * are exposed; nothing secret is ever included.
 */
export interface AuthProvider {
  /** Stable provider id submitted back as a `providers` value. */
  id: string;
  /** Human-readable provider name for display. */
  name: string;
  /** Optional provider authorize URL (transparent/remote providers only). */
  url?: string;
  /** Auth mode label (e.g. `local`, `transparent`, `remote`). */
  mode?: string;
  /** App ids associated with this provider (filtered of internal sentinels). */
  appIds?: string[];
  /** Whether this is the primary/parent provider (pre-checked by default). */
  primary?: boolean;
}

/**
 * A selectable tool surfaced on the consent slot. Matches `AuthTool` in
 * `@frontmcp/ui/auth`. The `id` is the effective runtime tool id.
 */
export interface AuthTool {
  /** Effective runtime tool id (submitted back as a `tools` value). */
  id: string;
  /** Display name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Owning app id (for grouping). */
  appId?: string;
  /** Owning app display name (for grouping). */
  appName?: string;
  /** Whether the tool is pre-selected. */
  defaultSelected?: boolean;
}

/**
 * The serialized authorization-flow state the server INJECTS (write-shape).
 * Must match `AuthFlowState` in `@frontmcp/ui/auth` (the client read-shape).
 *
 * NO PII is part of the contract. `clientName`/`clientId` are OAuth client
 * identifiers (not end-user identity); identity values the user enters are
 * carried by the developer's own form fields — never serialized here.
 */
export interface AuthFlowState {
  /** Which page slot this state is for. */
  slot: AuthSlot;
  /** The pending authorization id (`pending_auth_id`). */
  pendingAuthId?: string;
  /** OAuth client display name (CIMD `client_name` or the raw client id). */
  clientName?: string;
  /** OAuth `client_id`. */
  clientId?: string;
  /** Requested OAuth scopes (split from the `scope` param). */
  scopes?: string[];
  /** Validated OAuth `redirect_uri`. */
  redirectUri?: string;
  /** RFC 8707 `resource` indicator, when supplied. */
  resource?: string;
  /** Human-readable error text for the `error` slot (or a failed submit re-render). */
  error?: string;
  /** Anti-CSRF token minted at SSR time; the client echoes it back. */
  csrfToken?: string;
  /** Absolute or app-relative URL the finish submit posts to. */
  submitUrl?: string;
  /** HTTP method for the finish submit. Defaults to `GET`. */
  submitMethod?: AuthSubmitMethod;
  /** Optional dedicated URL for `submitExtra` (the auth-extra endpoint). */
  extraUrl?: string;
  /** Providers offered on the `federated` slot. */
  providers?: AuthProvider[];
  /** Tools offered on the `consent` slot. */
  tools?: AuthTool[];
  /** Server-side accumulators for multi-step inputs, keyed by extra name. */
  addedItems?: Record<string, unknown[]>;
  /** Free-form, slot-specific extras the server passes to the component. */
  extras?: Record<string, unknown>;
}

/**
 * Result of an auth-extra (`auth.extras[name]`) validated-field round-trip, as
 * the server returns it. Matches `AuthExtraResult` in `@frontmcp/ui/auth`.
 */
export interface AuthExtraResult {
  /** Whether the server accepted the field. */
  ok: boolean;
  /** Human-readable validation error when `ok` is false. */
  error?: string;
  /** Updated server-side accumulators (keyed by extra name) after a successful add. */
  addedItems?: Record<string, unknown[]>;
  /** Free-form side-effect data the server chooses to return. */
  sideEffects?: Record<string, unknown>;
}

/** A file-based custom auth-UI slot source (resolved `.tsx`/`.jsx`). */
export interface AuthUiFileSource {
  /** Absolute path to a `.tsx` / `.jsx` component file (default export). */
  file: string;
}

/**
 * The global property name the server injects the {@link AuthFlowState} under.
 * MUST match `AUTH_FLOW_GLOBAL_KEY` in `@frontmcp/ui/auth`.
 */
// must match @frontmcp/ui/auth
export const AUTH_FLOW_GLOBAL_KEY = '__FRONTMCP_AUTH__' as const;

/**
 * The mount id the server SSRs the auth component into (and the client hydrates
 * onto). MUST match `DEFAULT_AUTH_MOUNT_ID` in `@frontmcp/ui/auth`.
 */
// must match @frontmcp/ui/auth
export const AUTH_MOUNT_ID = 'frontmcp-auth-root';

/**
 * Wire-field marker names the server-side {@link AuthFlowState} builders write
 * into `extras` (federated/incremental markers + the target app id). These are
 * the exact params `oauth.callback.flow.ts` reads. The full vocabulary lives in
 * `@frontmcp/ui/auth`'s `AUTH_WIRE_FIELDS`; the server only needs the few keys
 * its builders emit.
 */
// must match @frontmcp/ui/auth
export const AUTH_WIRE_FIELDS = {
  /** Marks a federated submission. */
  federated: 'federated',
  /** Marks an incremental authorization. */
  incremental: 'incremental',
  /** Target app id for incremental authorization. */
  appId: 'app_id',
} as const;
