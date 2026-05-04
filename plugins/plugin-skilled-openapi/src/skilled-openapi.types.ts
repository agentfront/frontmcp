// file: plugins/plugin-skilled-openapi/src/skilled-openapi.types.ts

import { z } from '@frontmcp/lazy-zod';

// ─── Bundle source configurations ──────────────────────────────────────────

export const staticSourceSchema = z.object({
  type: z.literal('static'),
  /** Path to the bundle directory (containing spec.yaml + overlay.yaml) or a single overlay file. */
  path: z.string().min(1),
  /** Watch the path for changes (fs.watch). Default false. */
  watch: z.boolean().default(false),
});

export const npmSourceSchema = z.object({
  type: z.literal('npm'),
  /** npm package specifier, e.g. `@acme/frontmcp-billing-bundle`. */
  packageName: z.string().min(1),
  /** Optional named export to read; default is the package's default export. */
  exportName: z.string().optional(),
  /**
   * Verify GitHub artifact attestation / npm provenance for the package before loading.
   * Defaults to true. Set false (with warning) only for local development packages.
   */
  verifyProvenance: z.boolean().default(true),
});

export const saasSourceSchema = z.object({
  type: z.literal('saas'),
  /** SaaS pull endpoint, e.g. `https://cloud.frontmcp.dev/v1/bundles/<bundleId>`. */
  endpoint: z.string().url(),
  /** Pinned JWT issued by the SaaS for the customer's FrontMCP server. */
  authToken: z.string().min(1),
  /**
   * RFC 8707 resource indicator the JWT must encode. The plugin verifies
   * `resource` AND `aud` claims match this on every push/pull.
   */
  expectedAudience: z.string().min(1),
  /** Polling interval in ms (boot pull is always immediate). Default 300000 (5 min). */
  pollIntervalMs: z.number().int().positive().default(300_000),
  /**
   * Mount a webhook handler at `POST /__skilled_openapi/push` so the SaaS can push
   * updates synchronously. Default false in v1.2 (interval polling only).
   */
  enableWebhook: z.boolean().default(false),
  /** JWKS URL for verifying SaaS-issued tokens. */
  jwksUrl: z.string().url(),
  /** Expected issuer (`iss`) claim. */
  expectedIssuer: z.string().min(1),
});

export const bundleSourceSchema = z.discriminatedUnion('type', [staticSourceSchema, npmSourceSchema, saasSourceSchema]);

export type StaticSourceOptions = z.infer<typeof staticSourceSchema>;
export type NpmSourceOptions = z.infer<typeof npmSourceSchema>;
export type SaasSourceOptions = z.infer<typeof saasSourceSchema>;
export type BundleSourceOptions = z.infer<typeof bundleSourceSchema>;

// ─── Signature verification ────────────────────────────────────────────────

export const signatureKeySchema = z.object({
  /** Stable key id (matches `kid` claim in the bundle JWT). */
  keyId: z.string().min(1),
  /** Algorithm for the signing key. */
  alg: z.enum(['RS256', 'EdDSA']),
  /** PEM-encoded public key (RSA SPKI or Ed25519). */
  publicKeyPem: z.string().min(1),
});

export type SignatureKey = z.infer<typeof signatureKeySchema>;

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
