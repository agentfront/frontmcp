// common/types/options/cloud/interfaces.ts
//
// Cloud integration options. When set, the SDK lazy-loads `@frontmcp/plugin-frontegg`
// at scope bootstrap and wires up OAuth, gateway proxying, approvals, and
// guardrails against a Frontegg tenant.
//
// The SDK owns the full option contract (this file + schema.ts) so users get typed
// autocomplete on `@FrontMcp({ cloud: { ... } })` from `@frontmcp/sdk` directly,
// without needing to import the plugin package for types. The plugin is only
// required at runtime.

/**
 * Sync options for app-integration push.
 *
 * Controls how FrontMCP pushes its runtime catalog (tools, resources, prompts,
 * agents) to Frontegg's app-integrations service so admins can see live
 * entries in the portal and attach policies to them.
 */
export interface CloudAppIntegrationSyncOptions {
  /**
   * - `full`: re-push the entire catalog on every flush.
   * - `incremental` (default): initial full snapshot, then only deltas.
   * - `disabled`: don't push anything (enforcement may still run).
   */
  mode?: 'full' | 'incremental' | 'disabled';

  /**
   * Which entry types to sync. Defaults to all four.
   */
  entryTypes?: Array<'tool' | 'resource' | 'prompt' | 'agent'>;

  /**
   * How long to wait after a registry event before flushing to Frontegg.
   * Coalesces bursts (e.g. adapter discovery) into batched upserts.
   * @default 150
   */
  debounceMs?: number;

  /**
   * Maximum entries per bulk upsert request.
   * @default 50
   */
  batchSize?: number;

  /**
   * On startup, list entitlements already in Frontegg under our prefix and
   * diff against local catalog to surface drift.
   * @default true
   */
  reconcileOnStartup?: boolean;

  /**
   * Delete entitlements in Frontegg when the server shuts down. Off by
   * default so a restart doesn't flicker the admin UI.
   * @default false
   */
  deleteOnShutdown?: boolean;
}

/**
 * Policy options for app-integration enforcement.
 *
 * Controls how the plugin fetches policies from Frontegg and what to do when
 * the fetch fails at tool-call time.
 */
export interface CloudAppIntegrationPolicyOptions {
  /**
   * Evaluate Frontegg policies at the `checkEntryAuthorities` stage and deny
   * the call when a policy denies. Disable to sync without enforcing.
   * @default true
   */
  enforce?: boolean;

  /**
   * Policy cache refresh cadence in milliseconds.
   * @default 60_000
   */
  refreshIntervalMs?: number;

  /**
   * What to do when a policy fetch fails mid-call.
   * - `deny`: fail-closed — deny the call.
   * - `allow`: fail-open — permit the call (not recommended).
   * - `lastKnown` (default): evaluate against the most recent successful
   *   fetch; deny if no prior success exists.
   */
  onFetchFailure?: 'deny' | 'allow' | 'lastKnown';

  /**
   * Optional HTTP path mounted to receive Frontegg webhook invalidations.
   * When set, POSTs here clear the policy cache and trigger an immediate
   * refetch.
   */
  invalidateWebhookPath?: string;
}

/**
 * App-integration options nested under `cloud.appIntegration`.
 *
 * When `enabled: true`, the plugin:
 * 1. Subscribes to all four registries and pushes entries to Frontegg under
 *    a configurable prefix (default `frontmcp:<type>:<name>`).
 * 2. Fetches ABAC / RBAC policies Frontegg admins attach to those entries
 *    and enforces them at tool-call time via the `checkEntryAuthorities`
 *    flow stage.
 */
export interface CloudAppIntegrationOptions {
  /**
   * Master toggle for the whole subsystem. Defaults to `false` so existing
   * cloud integrations continue to behave exactly as before.
   * @default false
   */
  enabled?: boolean;

  /**
   * ID prefix used for every synced entry so Frontegg admins can identify
   * entries that originated from a FrontMCP server. Final ID shape:
   * `<prefix>:<type>:<stableKey>`.
   * @default 'frontmcp'
   */
  prefix?: string;

  /** Sync-specific options (push direction). */
  sync?: CloudAppIntegrationSyncOptions;

  /** Policy-specific options (enforcement direction). */
  policy?: CloudAppIntegrationPolicyOptions;
}

/**
 * Approval-flow options nested under `cloud.approvals`.
 */
export interface CloudApprovalsOptions {
  /**
   * How approval decisions reach the server.
   * - `recheck` (default): poll Frontegg's execution-data endpoint until the flow resolves.
   * - `webhook`: register an HTTP callback that Frontegg POSTs to when decisions are made.
   */
  mode?: 'recheck' | 'webhook';

  /**
   * Path mounted for webhook callbacks when `mode` is `webhook`.
   * @default '/cloud/approvals/callback'
   */
  webhookPath?: string;

  /**
   * Polling interval when `mode` is `recheck`.
   * @default 2000
   */
  pollIntervalMs?: number;
}

/**
 * Frontegg cloud integration options.
 *
 * Setting this object triggers auto-load of `@frontmcp/plugin-frontegg` which
 * wires up (by default, all four enabled):
 * - Incoming bearer validation via Frontegg JWKS
 * - Remote MCP server proxying via Frontegg's MCP gateway
 * - Tool approval flows
 * - Masking/RBAC guardrails
 *
 * @example
 * ```ts
 * @FrontMcp({
 *   cloud: {
 *     clientId: process.env.FRONTEGG_CLIENT_ID!,
 *     secret: process.env.FRONTEGG_SECRET!,
 *   },
 * })
 * class Server {}
 * ```
 */
export interface CloudOptions {
  /** Client ID from the Frontegg portal. */
  clientId: string;

  /**
   * Client secret from the Frontegg portal.
   * Used for the server-side `client_credentials` OAuth grant to call
   * Frontegg admin APIs (gateway catalog, policies, approval flows).
   */
  secret: string;

  /**
   * Frontegg API base domain.
   * @default 'api.frontegg.com'
   */
  domain?: string;

  /**
   * MCP gateway URL override. When omitted, derived from `domain`
   * (`https://mcp-gw.<tenantDomain>`).
   */
  mcpGatewayUrl?: string;

  /**
   * Optional admin API key for Frontegg endpoints that require vendor-only access.
   */
  apiKey?: string;

  /**
   * Application ID override for multi-app tenants.
   */
  appId?: string;

  /**
   * Gateway catalog refresh cadence in milliseconds.
   * @default 60_000
   */
  refreshIntervalMs?: number;

  /**
   * Validate incoming bearer tokens as Frontegg JWTs (JWKS-backed).
   * @default true
   */
  auth?: boolean;

  /**
   * Route tool approvals through Frontegg approval flows.
   * Pass `true` to enable with defaults, `false` to disable, or an object
   * to configure polling/webhook details.
   * @default true
   */
  approvals?: boolean | CloudApprovalsOptions;

  /**
   * Proxy MCP servers pulled from the Frontegg MCP gateway.
   * @default true
   */
  gateway?: boolean;

  /**
   * Enforce masking/RBAC policies from Frontegg on every tool call.
   * @default true
   */
  guardrails?: boolean;

  /**
   * Push FrontMCP's runtime catalog (tools/resources/prompts/agents) into
   * Frontegg's app-integrations service and enforce ABAC policies admins
   * attach there. Opt-in — defaults to disabled so existing cloud
   * integrations are unaffected.
   */
  appIntegration?: CloudAppIntegrationOptions;
}
