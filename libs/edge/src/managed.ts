/**
 * Managed edge mode — an auto-updating, skilled-OpenAPI-backed edge server.
 *
 * Points the edge runtime at a SaaS endpoint that serves a signed
 * **skilled-openapi** bundle (OpenAPI specs compiled into MCP skills + tools).
 * The bundle is pulled on boot and kept fresh by polling (and/or a push
 * webhook), so the server's capabilities update **without redeploying** —
 * backed by the existing `@frontmcp/plugin-skilled-openapi` SaaS-pull source
 * (which handles signature verification, replay/SSRF guards, and last-good
 * cache fallback).
 */
import type { EdgeBundleCacheFactory, EdgeBundleCacheStore } from './kv-cache';

export interface ManagedEdgeOptions {
  /** SaaS pull endpoint serving the signed bundle (HTTPS). */
  endpoint: string;
  /** Pinned JWT the SaaS issued for this server. */
  authToken: string;
  /** RFC 8707 resource indicator the JWT must encode (verified on pull/push). */
  expectedAudience: string;
  /** JWKS URL for verifying SaaS-issued tokens (HTTPS). */
  jwksUrl: string;
  /** Expected `iss` (issuer) claim. */
  expectedIssuer: string;
  /**
   * Auto-update polling interval in ms (the boot pull is always immediate).
   * Default 300000 (5 min) — the plugin re-pulls and hot-swaps on change.
   */
  pollIntervalMs?: number;
  /** Also mount a push webhook (`POST /__skilled_openapi/push`) for synchronous updates. */
  enableWebhook?: boolean;
  /** Require a signed bundle. Default true. */
  requireSignature?: boolean;
  /** Trusted public keys for bundle signature verification. */
  trustedKeys?: unknown[];
  /** Dev mode — bypass signature checks + relax defaults (loud warning). Never in production. */
  dev?: boolean;
  /** Static credential map seeded into the executor's resolver (dev / single-tenant). */
  credentials?: Record<string, string>;
  /** Outbound HTTP / SSRF options for the executor. */
  outbound?: Record<string, unknown>;
  /**
   * Cache dir for the last-good bundle (boot fallback when a fresh pull fails).
   * Filesystem-only — a no-op on a Worker (there is no filesystem); use {@link
   * ManagedEdgeOptions.cache} there instead.
   */
  bundleCacheDir?: string;
  /**
   * Pluggable last-good bundle cache, replacing the on-disk cache entirely.
   *
   * On Cloudflare Workers a KV binding lives on the per-request `env`, not in
   * module scope, so prefer the `env`-resolving factory form — e.g.
   * `cache: kvBundleCacheFromEnv('BUNDLE_CACHE')` (or a custom
   * `(env) => createKvBundleCache(env.MY_KV)`). A plain store is also accepted
   * for runtimes where the cache is available at construction time.
   */
  cache?: EdgeBundleCacheStore | EdgeBundleCacheFactory;
}

/**
 * Map {@link ManagedEdgeOptions} → the options object that
 * `@frontmcp/plugin-skilled-openapi`'s `init(...)` accepts (a `saas` bundle
 * source + plugin flags). Pure + dependency-free so it's unit-testable without
 * loading the plugin.
 */
export function buildManagedOpenApiPluginOptions(managed: ManagedEdgeOptions): Record<string, unknown> {
  const source: Record<string, unknown> = {
    type: 'saas',
    endpoint: managed.endpoint,
    authToken: managed.authToken,
    expectedAudience: managed.expectedAudience,
    jwksUrl: managed.jwksUrl,
    expectedIssuer: managed.expectedIssuer,
  };
  if (managed.pollIntervalMs !== undefined) source['pollIntervalMs'] = managed.pollIntervalMs;
  if (managed.enableWebhook !== undefined) source['enableWebhook'] = managed.enableWebhook;

  const options: Record<string, unknown> = { source };
  if (managed.requireSignature !== undefined) options['requireSignature'] = managed.requireSignature;
  if (managed.trustedKeys !== undefined) options['trustedKeys'] = managed.trustedKeys;
  if (managed.dev !== undefined) options['dev'] = managed.dev;
  if (managed.credentials !== undefined) options['credentials'] = managed.credentials;
  if (managed.outbound !== undefined) options['outbound'] = managed.outbound;
  if (managed.bundleCacheDir !== undefined) options['bundleCacheDir'] = managed.bundleCacheDir;
  return options;
}
