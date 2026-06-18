// file: libs/adapters/src/skills/source-options.ts
//
// Source-layer configuration schemas extracted from plugin-skilled-openapi so
// they ship with the standalone Skills Adapter. The plugin's higher-level
// options (outbound/SSRF, credentials) re-import what they need from here.

import { z } from '@frontmcp/lazy-zod';

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
  endpoint: httpsUrl,
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
  jwksUrl: httpsUrl,
  /** Expected issuer (`iss`) claim. */
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
