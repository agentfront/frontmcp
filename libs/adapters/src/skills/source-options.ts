// file: libs/adapters/src/skills/source-options.ts
//
// Source-layer configuration schemas extracted from plugin-skilled-openapi so
// they ship with the standalone Skills Adapter. The plugin's higher-level
// options (outbound/SSRF, credentials) re-import what they need from here.

import { z } from '@frontmcp/lazy-zod';
import type { StorageConfig, StorageType } from '@frontmcp/utils';

// SaaS endpoints carry pinned bearer tokens and JWKS material; both must be
// HTTPS so the JWT and verification keys are not exposed in plaintext.
const httpsUrl = z
  .string()
  .url()
  .refine(
    (v) => {
      try {
        return new URL(v).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'must use https://' },
  );

/** The storage types every replica reaches and can write a key to once, atomically: a replay store needs both. */
const SHARED_REPLAY_STORAGE_TYPES: readonly StorageType[] = ['redis', 'upstash', 'vercel-kv', 'sqlite'];

const pushReplayStorageSchema = z
  .custom<StorageConfig>((value) => typeof value === 'object' && value !== null && !Array.isArray(value), {
    message: 'must be a storage config, such as { type: "redis", redis: { url } }',
  })
  .superRefine((storage, ctx) => {
    if (!storage.type || !SHARED_REPLAY_STORAGE_TYPES.includes(storage.type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['type'],
        message: `must be ${SHARED_REPLAY_STORAGE_TYPES.map((type) => `"${type}"`).join(', ')}: a store every replica shares, with an atomic write-once`,
      });
    }
    if (storage.fallback === 'memory') {
      ctx.addIssue({
        code: 'custom',
        path: ['fallback'],
        message: 'cannot be "memory": each replica would then accept the same push',
      });
    }
  });

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
   * Defaults to true. Provenance verification is not implemented yet, so `true` refuses
   * to load the package; set `false` to load it without a provenance check.
   *
   * With `false`, the package is imported (its code runs) before the bundle is parsed, so
   * bundle signing (`requireSignature` + `trustedKeys`) cannot protect the import itself.
   * Only use it for a package you trust: pin its exact version in `package.json` and
   * install from a lockfile with integrity hashes.
   */
  verifyProvenance: z.boolean().default(true),
});

export const saasSourceSchema = z.object({
  type: z.literal('saas'),
  /** SaaS pull endpoint, e.g. `https://cloud.frontmcp.dev/v1/bundles/<bundleId>`. */
  endpoint: httpsUrl,
  /**
   * Pinned JWT issued by the SaaS for the customer's FrontMCP server. Verified
   * before every pull: signed by a key in `jwksUrl`, `iss` = `expectedIssuer`,
   * `aud` includes `expectedAudience`, not expired. A rejected token stops the pull.
   */
  authToken: z.string().min(1),
  /**
   * RFC 8707 resource indicator the JWT must encode: its `aud` claim must include
   * this value (and its `resource` claim too, when it has one).
   */
  expectedAudience: z.string().min(1),
  /** Polling interval in ms (boot pull is always immediate). Default 300000 (5 min). */
  pollIntervalMs: z.number().int().positive().default(300_000),
  /**
   * Also take bundles the SaaS pushes, at `POST /__skilled_openapi/push`. The push token is checked as `authToken`
   * is, and must carry a `jti` no push used and an `iat` within five minutes; when it carries a `body_sha256` claim,
   * that must be the SHA-256 of the exact body. The body is the bundle as JSON, checked and applied as a pulled one.
   * Default false.
   */
  enableWebhook: z.boolean().default(false),
  /**
   * Refuse a push token without a `body_sha256` claim, the base64url SHA-256 of the exact request body, which binds
   * the token to the bundle it came with. Default false: such a token is accepted, and a warning is logged once.
   */
  requirePushBodyDigest: z.boolean().optional(),
  /**
   * Apply a pulled or pushed bundle older than the one being served (see `compareBundleVersions`). Default false: such
   * a bundle is refused, so a validly signed old bundle can't roll the server back.
   */
  allowRollback: z.boolean().optional(),
  /**
   * Where the replay guard records the push tokens' `jti`s, through `createStorage()` from `@frontmcp/utils`: a store
   * every replica shares (`redis`, `upstash`, `vercel-kv`, or `sqlite` for processes on one machine). Default: this
   * process's memory, enough for a single process. When the store can't be reached, pushes are refused.
   */
  pushReplayStorage: pushReplayStorageSchema.optional(),
  /** JWKS URL for verifying SaaS-issued tokens (fetched without credentials, redirects refused). */
  jwksUrl: httpsUrl,
  /** Expected issuer (`iss`) claim of `authToken`. */
  expectedIssuer: z.string().min(1),
});

export const inlineSourceSchema = z.object({
  type: z.literal('inline'),
  /**
   * The skilled-OpenAPI bundle object, embedded directly (no filesystem, no
   * network). The right source for V8-isolate runtimes (Cloudflare Workers),
   * where `static` (fs) and `npm` can't run and `saas` needs an endpoint. The
   * object is validated by the overlay parser, same as file/remote bundles.
   */
  content: z.unknown(),
});

export const bundleSourceSchema = z.discriminatedUnion('type', [
  staticSourceSchema,
  npmSourceSchema,
  saasSourceSchema,
  inlineSourceSchema,
]);

export type StaticSourceOptions = z.infer<typeof staticSourceSchema>;
export type NpmSourceOptions = z.infer<typeof npmSourceSchema>;
export type SaasSourceOptions = z.infer<typeof saasSourceSchema>;
export type InlineSourceOptions = z.infer<typeof inlineSourceSchema>;
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
