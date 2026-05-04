// file: plugins/plugin-skilled-openapi/src/skilled-openapi.types.ts

import {
  bundleSourceSchema,
  npmSourceSchema,
  saasSourceSchema,
  signatureKeySchema,
  staticSourceSchema,
} from '@frontmcp/adapters/skills';
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
  type BundleSourceOptions,
  type NpmSourceOptions,
  type SaasSourceOptions,
  type SignatureKey,
  type StaticSourceOptions,
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
    /** Optional egress proxy URL (honors HTTPS_PROXY env if not set). */
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
  })
  .default({
    allowPrivateNetworks: false,
    maxConcurrencyPerHost: 10,
    defaultTimeoutMs: 30_000,
    defaultMaxResponseBytes: 256 * 1024,
    allowHttp: false,
  });

export type OutboundOptions = z.infer<typeof outboundOptionsSchema>;

// ─── Plugin-level options ──────────────────────────────────────────────────

const skilledOpenApiPluginOptionsObjectSchema = z.object({
  /** Bundle source — static, npm, or saas. */
  source: bundleSourceSchema,

  /**
   * Require a valid bundle signature. Defaults to true. Setting `dev: true`
   * disables the requirement and emits a startup warning. Never set false
   * (unsigned mode) silently in production.
   */
  requireSignature: z.boolean().default(true),

  /**
   * Trusted public keys for bundle signature verification. At least one must
   * match the bundle's signed `kid` for the bundle to load.
   */
  trustedKeys: z.array(signatureKeySchema).default([]),

  /**
   * Development mode: bypass signature verification and relax some defaults
   * (e.g. allow http:). Loud startup warning. Never true in production.
   */
  dev: z.boolean().default(false),

  /** Outbound HTTP / SSRF defenses for the executor. */
  outbound: outboundOptionsSchema,

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
   * the bundle's `authBindings`. Production deployments should override the
   * `SkilledOpenApiCredentialResolver` provider with a libs/auth-vault-backed
   * resolver instead of using this option.
   */
  credentials: z.record(z.string().min(1).max(256), z.string().min(1)).optional(),

  /**
   * Register each bundle operation as an internal SDK tool (visibility:
   * 'internal') so other tools, agents, CodeCall scripts, and jobs can
   * compose with it via `this.callTool('<bundleId>.<operationId>', args)`.
   *
   * Internal tools are excluded from `tools/list` and rejected for external
   * `tools/call` requests — only callable in-process via the SDK helper.
   *
   * Default: true. Disable for very large bundles where the additional tool
   * registry pressure outweighs the composition convenience, or when the
   * three meta-tools are sufficient.
   */
  exposeOperationsAsInternalTools: z.boolean().default(true),
});

const DEFAULT_OUTBOUND_OPTIONS: OutboundOptions = {
  allowPrivateNetworks: false,
  maxConcurrencyPerHost: 10,
  defaultTimeoutMs: 30_000,
  defaultMaxResponseBytes: 256 * 1024,
  allowHttp: false,
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
    outbound,
    bundleCacheDir: opts.bundleCacheDir ?? '.frontmcp/skilled-openapi/',
  };
});

/** Parsed options with defaults applied — internal plugin use. */
export type SkilledOpenApiPluginOptions = z.infer<typeof skilledOpenApiPluginOptionsSchema>;

/** User-facing input shape — defaults are optional. */
export type SkilledOpenApiPluginOptionsInput = z.input<typeof skilledOpenApiPluginOptionsObjectSchema>;
