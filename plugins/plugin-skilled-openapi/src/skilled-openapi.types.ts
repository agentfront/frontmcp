// file: plugins/plugin-skilled-openapi/src/skilled-openapi.types.ts

import { bundleSourceSchema, signatureKeySchema } from '@frontmcp/adapters/skills';
import { z } from '@frontmcp/lazy-zod';

// Re-export source-layer schemas/types from the Skills Adapter so existing
// consumers of @frontmcp/plugin-skilled-openapi keep working without a code
// change. New code should import these directly from @frontmcp/adapters/skills.
export {
  bundleSourceSchema,
  npmSourceSchema,
  saasSourceSchema,
  signatureKeySchema,
  staticSourceSchema,
} from '@frontmcp/adapters/skills';
export type {
  BundleSourceOptions,
  NpmSourceOptions,
  SaasSourceOptions,
  SignatureKey,
  StaticSourceOptions,
} from '@frontmcp/adapters/skills';

// ─── Outbound execution / SSRF ─────────────────────────────────────────────

export const outboundOptionsSchema = z
  .object({
    /**
     * Allow outbound connections to private/loopback/link-local IPs.
     * MUST stay false in production. Set true only for self-hosted scenarios
     * where the customer's REST API legitimately lives on a private network.
     */
    allowPrivateNetworks: z.boolean().default(false),
    /**
     * Proxy URL every outbound REST call goes through (undici's `ProxyAgent`: Node.js, with the
     * `undici` package installed). Without it, Node's `fetch` uses `HTTPS_PROXY` only when started
     * with `NODE_USE_ENV_PROXY=1`.
     */
    egressProxy: z.string().url().optional(),
    /** Per-host concurrent request cap. */
    maxConcurrencyPerHost: z.number().int().positive().default(10),
    /** Default per-op HTTP timeout in milliseconds. */
    defaultTimeoutMs: z.number().int().positive().default(30_000),
    /** Default response size cap in bytes. Per-op overrides apply. */
    defaultMaxResponseBytes: z
      .number()
      .int()
      .positive()
      .default(256 * 1024),
    /**
     * Permit `http:` URLs in addition to `https:`. Off by default; only enable
     * for local dev where the mock REST server doesn't have a TLS cert.
     */
    allowHttp: z.boolean().default(false),
    /**
     * What a failed action reports to the workflow script (and so to the model): `'include'` adds the API's error
     * body, redacted and cut to 2 KB, to the status; `'status-only'` reports the status alone, for APIs whose error
     * bodies hold internal details.
     */
    errorBodies: z.enum(['include', 'status-only']).default('include'),
  })
  .default({
    allowPrivateNetworks: false,
    maxConcurrencyPerHost: 10,
    defaultTimeoutMs: 30_000,
    defaultMaxResponseBytes: 256 * 1024,
    allowHttp: false,
    errorBodies: 'include',
  });

export type OutboundOptions = z.infer<typeof outboundOptionsSchema>;

/** Whether a failed action reports the API's error body with its status, or the status alone. */
export type ErrorBodiesPolicy = OutboundOptions['errorBodies'];

// ─── Confirming actions ────────────────────────────────────────────────────

export const confirmOptionsSchema = z
  .object({
    /** HTTP methods whose actions ask the user first, such as `['DELETE']`. */
    methods: z.array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])).optional(),
    /** Tags whose actions ask the user first: a tag of the action's operation, or of a skill that lists it. */
    tags: z.array(z.string().min(1).max(256)).optional(),
    /** The ids (operationIds) of actions that ask the user first. */
    operations: z.array(z.string().min(1).max(256)).optional(),
    /** For a client that can't show the question: `'refuse'` the action, or `'allow'` it without asking. */
    whenUnsupported: z.enum(['refuse', 'allow']).default('refuse'),
  })
  .strict();

export type ConfirmOptions = z.infer<typeof confirmOptionsSchema>;

/** What happens to an action that needs confirmation when the client can't ask the user. */
export type WhenConfirmationUnsupported = ConfirmOptions['whenUnsupported'];

// ─── Plugin-level options ──────────────────────────────────────────────────

const skilledOpenApiPluginOptionsObjectSchema = z.object({
  /** Bundle source — static, npm, or saas. */
  source: bundleSourceSchema,

  /**
   * Require a valid bundle signature. Defaults to true, or to false with
   * `dev: true`; an explicit value always wins. Never set false (unsigned mode)
   * in production.
   */
  requireSignature: z.boolean().optional(),

  /**
   * Trusted public keys for bundle signature verification. At least one must
   * match the bundle's signed `kid` for the bundle to load.
   */
  trustedKeys: z.array(signatureKeySchema).default([]),

  /**
   * Development mode: bypass signature verification (unless `requireSignature`
   * is set explicitly) and allow http: upstreams. Loud startup warning. Never
   * true in production.
   */
  dev: z.boolean().default(false),

  /** Outbound HTTP / SSRF defenses for the executor. */
  outbound: outboundOptionsSchema,

  /**
   * How to treat operations that carry NO required-authorities policy (neither
   * skill-level nor op-level) on the execution surface (`run_workflow` and the
   * internal per-op tools):
   *
   * - `'allow'` (default, backward compatible): policy-less ops are callable —
   *   origin trust comes from the signed bundle. Appropriate when every op in
   *   the bundle is genuinely public (e.g. a public REST API).
   * - `'deny'`: default-deny the execution surface — a policy-less op is blocked
   *   unless the bundle explicitly marks it `public: true`. **Recommended for
   *   production**: it ensures a single missing `requiredAuthorities` line can't
   *   silently expose a protected op (closes SECURITY-REVIEW C1/C3).
   */
  unprotectedOps: z.enum(['allow', 'deny']).default('allow'),

  /**
   * Source-conflict policy when more than one source registers a skill with
   * the same id. Default: locally-pinned static beats npm beats saas.
   */
  sourceConflictPolicy: z.enum(['static-wins', 'last-wins', 'reject']).default('static-wins'),

  /**
   * Cache directory for the last successfully loaded SaaS bundle, used as a
   * fallback if a fresh pull fails at boot. Defaults to `.frontmcp/skilled-openapi/`.
   * Only applies to source.type === 'saas'.
   */
  bundleCacheDir: z.string().optional(),

  /**
   * Static credential map seeded into the in-memory `CredentialResolver` for
   * dev / demo / single-tenant deployments. Keys match `vaultRef` strings on
   * the bundle's `authBindings`. Production deployments should provide a
   * `SkilledOpenApiCredentialResolver` that reads a vault instead, in
   * `init({ providers })`, the app or the server: it replaces this map.
   */
  credentials: z.record(z.string().min(1).max(256), z.string().min(1)).optional(),

  /**
   * Auth bindings that send each caller's own credential, keyed by `vaultRef`: the value names the auth provider the
   * caller connected the service as. The credential is read from the caller's vault (`this.authProviders`, else
   * `this.credentials`), never from `credentials` or a resolver, and a caller who hasn't connected it gets a
   * `ToolCredentialsRequiredError`.
   */
  authProviders: z.record(z.string().min(1).max(256), z.string().min(1)).optional(),

  /**
   * Register each bundle operation as an internal SDK tool (visibility:
   * 'internal') so other tools, agents, CodeCall scripts, and jobs can
   * compose with it via `this.callTool('<bundleId>.<operationId>', args)`.
   *
   * Internal tools are excluded from `tools/list` and rejected for external
   * `tools/call` requests — only callable in-process via the SDK helper.
   * `execute_action` runs an action through its operation tool, so the
   * `tools:call-tool` hooks run for it; without these tools it runs the same
   * checks itself.
   *
   * Default: true. Disable for very large bundles where the additional tool
   * registry pressure outweighs the composition convenience, or when the
   * meta-tools are sufficient.
   */
  exposeOperationsAsInternalTools: z.boolean().default(true),

  /**
   * Actions that ask the user before their request is sent, through an MCP elicitation the client shows as a yes/no
   * question: an action matches by its HTTP method, a tag of its operation or of a skill listing it, or its id. A
   * workflow asks once, before its script starts. Needs `elicitation: { enabled: true }` on the server. Without this
   * option nothing asks.
   */
  confirm: confirmOptionsSchema.optional(),
});

const DEFAULT_OUTBOUND_OPTIONS: OutboundOptions = {
  allowPrivateNetworks: false,
  maxConcurrencyPerHost: 10,
  defaultTimeoutMs: 30_000,
  defaultMaxResponseBytes: 256 * 1024,
  allowHttp: false,
  errorBodies: 'include',
};

export const skilledOpenApiPluginOptionsSchema = skilledOpenApiPluginOptionsObjectSchema.transform((opts) => {
  // Merge user-provided outbound overrides on top of the SSRF/timeouts default.
  // `dev: true` widens this further by allowing http:// upstreams (the docstring
  // for `dev` advertises this behavior; without applying it here, callers
  // reading the parsed config still see allowHttp=false and lose the relaxation).
  const outbound: OutboundOptions = {
    ...DEFAULT_OUTBOUND_OPTIONS,
    ...(opts.outbound ?? {}),
  };
  if (opts.dev) {
    outbound.allowHttp = true;
  }
  return {
    ...opts,
    // `dev: true` turns the signature requirement off, as it advertises; an explicit
    // `requireSignature` (either way) is kept.
    requireSignature: opts.requireSignature ?? !opts.dev,
    outbound,
    bundleCacheDir: opts.bundleCacheDir ?? '.frontmcp/skilled-openapi/',
  };
});

/** Parsed options with defaults applied — internal plugin use. */
export type SkilledOpenApiPluginOptions = z.infer<typeof skilledOpenApiPluginOptionsSchema>;

/** User-facing input shape — defaults are optional. */
export type SkilledOpenApiPluginOptionsInput = z.input<typeof skilledOpenApiPluginOptionsObjectSchema>;
