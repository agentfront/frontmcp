/**
 * Framework-free Auth-UI contract (no React).
 *
 * This module is the SINGLE SOURCE OF TRUTH for the CLIENT side of the bridge
 * between a FrontMCP authorization page (a thin server shell) and the client
 * code that renders + drives it. It is the canonical client API, so it lives in
 * `@frontmcp/ui/auth` (this package) co-located with the vanilla helpers + React
 * hooks/mount that consume it. It has ZERO React dependency on purpose so the
 * vanilla helpers (and a non-React page) can use it directly.
 *
 * The SERVER side (`@frontmcp/sdk`'s `auth-ui` module) does NOT import this
 * file — it owns its own minimal write-shape types + the two runtime protocol
 * constants as local literals, kept in sync with the values declared here. That
 * JSON-serialization boundary (server-owned write-shape, client-owned
 * read-shape) is intentional and deliberately avoids an `sdk → ui` dependency;
 * the local-auth e2e asserts the `window.__FRONTMCP_AUTH__` wire shape to guard
 * against drift.
 *
 * ## How the bridge works
 *
 * 1. When serving the shell the server serializes an {@link AuthFlowState} into
 *    a `<script>` that assigns it to the global named by
 *    {@link AUTH_FLOW_GLOBAL_KEY} (`window.__FRONTMCP_AUTH__`). This mirrors the
 *    `window.__mcp*` / `window.FrontMcpBridge` injection pattern used by
 *    `@frontmcp/uipack` and `@frontmcp/ui` for tool widgets.
 * 2. The client bundle (the developer's `@AuthUi` component, client-rendered via
 *    `mountAuthPage` from `@frontmcp/ui/auth`) reads that global through
 *    `getAuthFlow()` and drives the OAuth flow with `submitFinish` /
 *    `submitExtra`.
 *
 * The server owns CSP, anti-clickjacking headers, and minting the
 * {@link AuthFlowState.csrfToken}; the client only consumes the token and posts
 * it back. No PII is part of the required contract — identity values the user
 * types are carried by the developer's own form fields, not by this state.
 *
 * @packageDocumentation
 */

/**
 * Which built-in authorization page slot a component renders.
 *
 * Mirrors the server-side `@AuthUi({ slot })` slots from issue #469 and the
 * existing in-tree pages produced by the OAuth authorize/callback flows:
 *
 * - `login`       — the local sign-in page (`renderLocalLoginPage`).
 * - `consent`     — the tool-consent screen (`buildToolConsentPage`).
 * - `incremental` — single-app incremental authorization (`buildIncrementalAuthPage`).
 * - `federated`   — multi-provider selection (`buildFederatedLoginPage`).
 * - `error`       — the OAuth error page.
 */
export type AuthSlot = 'login' | 'consent' | 'incremental' | 'federated' | 'error';

/**
 * The HTTP method the auth submit/extra requests use.
 *
 * The in-tree pages today POST the consent app-cards but GET the login,
 * federated, consent, and incremental forms back to `/oauth/callback` (a GET
 * round-trip mirroring the federated page). The contract carries the method so
 * stage 2 can pick per-slot without the client hardcoding it; it defaults to
 * `GET` to match the current callback flow.
 */
export type AuthSubmitMethod = 'GET' | 'POST';

/**
 * A selectable authentication provider surfaced on the federated-login slot.
 *
 * Derived from the `ProviderCard` the authorize flow builds for
 * `buildFederatedLoginPage`. Only display + selection fields are exposed to the
 * client; nothing secret (client secrets, provider tokens) is ever included.
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
 * A selectable tool surfaced on the consent slot.
 *
 * Derived from the `ToolCard` the callback flow builds for
 * `buildToolConsentPage`. The `id` is the effective runtime tool id submitted
 * back as a `tools` value and enforced at call time.
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
 * The serialized authorization-flow state the server injects and the client
 * reads. Field names map to what `oauth.authorize.flow.ts` /
 * `oauth.callback.flow.ts` already compute for the built-in pages, so stage 2
 * can populate this from existing flow state without new plumbing.
 *
 * NO PII is part of the contract. `clientName`/`clientId` are OAuth client
 * identifiers (not end-user identity), and identity values the user enters are
 * carried by the developer's own form fields — never serialized here.
 */
export interface AuthFlowState {
  /** Which page slot this state is for. */
  slot: AuthSlot;

  /**
   * The pending authorization id (`pending_auth_id`). Round-tripped on every
   * submit/extra request so the server can correlate the flow. Optional only
   * for the `error` slot, which may render before a pending record exists.
   */
  pendingAuthId?: string;

  /** OAuth client display name (CIMD `client_name` or the raw client id). */
  clientName?: string;
  /** OAuth `client_id`. */
  clientId?: string;
  /** Requested OAuth scopes (split from the `scope` param). */
  scopes?: string[];
  /** Validated OAuth `redirect_uri` (where the server sends the code). */
  redirectUri?: string;
  /** RFC 8707 `resource` indicator, when supplied. */
  resource?: string;

  /** Human-readable error text for the `error` slot (or a failed submit re-render). */
  error?: string;

  /**
   * Anti-CSRF token the server minted at SSR time. The client posts it back in
   * the `csrf` field on every submit/extra. Minting + verifying it is the
   * SERVER's responsibility (stage 2); the client only echoes it.
   */
  csrfToken?: string;

  /**
   * Absolute or app-relative URL the finish submit posts to. The in-tree pages
   * use `${scope.fullPath}/oauth/callback`. Required for any interactive slot.
   */
  submitUrl?: string;

  /**
   * HTTP method for the finish submit. Defaults to {@link DEFAULT_SUBMIT_METHOD}
   * (`GET`) to match the current callback round-trip.
   */
  submitMethod?: AuthSubmitMethod;

  /**
   * Optional dedicated URL for `submitExtra` (the `@AuthExtra` validated-field
   * endpoint, issue #469). When omitted, extras post to {@link submitUrl} with
   * an {@link AUTH_EXTRA_FIELD action} field naming the extra. Stage 2 may
   * expose a separate endpoint and set this.
   */
  extraUrl?: string;

  /** Providers offered on the `federated` slot. */
  providers?: AuthProvider[];
  /** Tools offered on the `consent` slot. */
  tools?: AuthTool[];

  /**
   * Server-side accumulators for multi-step inputs, keyed by extra name. Each
   * value is the list of items the server has accepted so far (e.g. the
   * `envs` a user added). Read by `getAddedItems(name)` / `useAddedItems(name)`.
   * The server replaces this on each re-render / extra response.
   */
  addedItems?: Record<string, unknown[]>;

  /**
   * Free-form, slot-specific extras the server wants to pass to the component
   * (e.g. logo URI, custom messages, incremental target app). Kept open so
   * stage 2 can extend per-slot without a contract change.
   */
  extras?: Record<string, unknown>;
}

/**
 * The global property name the server injects the {@link AuthFlowState} under.
 *
 * Analogous to `window.FrontMcpBridge` (the tool-widget bridge) but for auth:
 * `window.__FRONTMCP_AUTH__: AuthFlowState`. The double-underscore form matches
 * the `window.__mcp*` data-injection convention in `@frontmcp/uipack`.
 *
 * The server declares this same literal locally (`@frontmcp/sdk`'s `auth-ui`
 * module) — keep the two in sync.
 */
export const AUTH_FLOW_GLOBAL_KEY = '__FRONTMCP_AUTH__' as const;

/**
 * Default HTTP method for the finish submit when the state omits one. `GET`
 * matches the current `/oauth/callback` round-trip used by the in-tree login,
 * consent, federated, and incremental pages.
 */
export const DEFAULT_SUBMIT_METHOD: AuthSubmitMethod = 'GET';

/**
 * Canonical wire field names shared by the server flows and the client helpers.
 *
 * These mirror the exact params the OAuth callback flow reads today
 * (`oauth.callback.flow.ts`), so the client posts what the server already
 * understands and stage 2 does not have to invent a new vocabulary.
 */
export const AUTH_WIRE_FIELDS = {
  /** Pending authorization id. */
  pendingAuthId: 'pending_auth_id',
  /** Anti-CSRF token. */
  csrf: 'csrf',
  /** Marks a consent-form submission (distinguishes empty-select from first visit). */
  consentSubmitted: 'consent_submitted',
  /** Repeated checkbox field carrying selected tool ids on the consent slot. */
  tools: 'tools',
  /** Marks a federated submission. */
  federated: 'federated',
  /** Repeated checkbox field carrying selected provider ids on the federated slot. */
  providers: 'providers',
  /** Marks an incremental authorization. */
  incremental: 'incremental',
  /** Target app id for incremental authorization. */
  appId: 'app_id',
  /** Generic action discriminator (e.g. consent `authorize`/`skip`, or an extra name). */
  action: 'action',
} as const;

/**
 * The value placed in the {@link AUTH_WIRE_FIELDS.consentSubmitted} field to
 * mark a consent submission (the callback flow checks for the literal `'1'`).
 */
export const CONSENT_SUBMITTED_VALUE = '1' as const;

/**
 * The value placed in the {@link AUTH_WIRE_FIELDS.federated} /
 * {@link AUTH_WIRE_FIELDS.incremental} markers (the callback flow checks for
 * the literal `'true'`).
 */
export const WIRE_TRUE = 'true' as const;

/**
 * The field name used to carry the extra/action name when `submitExtra` posts
 * to the shared {@link AuthFlowState.submitUrl} (no dedicated `extraUrl`). The
 * server's `@AuthExtra(name)` handler reads this to route the validated field.
 */
export const AUTH_EXTRA_FIELD = AUTH_WIRE_FIELDS.action;

/**
 * Default mount id the server SSRs the auth component into (and the client
 * hydrates onto). The server declares this same literal locally (`@frontmcp/sdk`'s
 * `auth-ui` module) — keep the two in sync.
 */
export const DEFAULT_AUTH_MOUNT_ID = 'frontmcp-auth-root';

/**
 * Result of a `submitExtra` call (a validated `@AuthExtra` field round-trip).
 *
 * Mirrors the server-side `@AuthExtra(name)` return shape from issue #469
 * (`{ ok, error?, sideEffects? }`). `addedItems` lets a successful extra hand
 * back the updated accumulator so the client can refresh without a full reload.
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

/**
 * Form data accepted by `submitFinish` / `submitExtra`. Either a real
 * `FormData`, a plain record, or a form `EventTarget` (so a React/DOM
 * `onSubmit` handler can pass `event.currentTarget` directly).
 */
export type AuthFormInput = FormData | Record<string, unknown> | HTMLFormElement;

/**
 * Augment the global object so `window.__FRONTMCP_AUTH__` is typed wherever the
 * contract is in scope. Declared on both `Window` and `globalThis` so it works
 * in the browser and under jsdom/node test environments.
 */
declare global {
  interface Window {
    [AUTH_FLOW_GLOBAL_KEY]?: AuthFlowState;
  }
  var __FRONTMCP_AUTH__: AuthFlowState | undefined;
}
