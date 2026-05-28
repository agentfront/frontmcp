// file: libs/adapters/src/skills/deploy/deploy-manifest.schema.ts
//
// Zod schema for `frontmcp.deploy.yaml` v1 — the declarative manifest a
// GitHub Action consumes on every push, packages into a signed bundle, and
// POSTs to the Cloudflare Worker running FrontMCP. The Worker hot-reloads.
//
// Design borrows from:
//   - Wrangler (`compatibilityDate`, binding shapes, env overlay semantics)
//   - FastMCP (top-level `$schema` + `version` discriminators)
//   - Smithery (`runtime` discriminator; configSchema-as-secret-contract)
//   - Docker Compose (secrets-by-name)
//   - OpenAPI (root `tags[]` + per-component `tags: []`)
//
// All field names are camelCase for consistency with the rest of the codebase.
// The Action can emit a wrangler.toml from this manifest for users who want
// to mix-and-match (see DesignNotes in WORK_LOG.md).

import { z } from '@frontmcp/lazy-zod';

// ============================================================================
// Primitive grammars
// ============================================================================

/** Kebab- or camel-case identifier; what the user types in YAML keys. */
const IDENT_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Conservative spec id grammar — matches op-reference harvester's SPEC_ID_RE. */
const SPEC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** SecretName: SCREAMING_SNAKE_CASE — matches GH Actions / wrangler convention. */
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/** Cloudflare binding name — same convention as SecretName. */
const BINDING_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/** ISO-8601 date (YYYY-MM-DD) for compatibilityDate. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================================
// Server identity
// ============================================================================

const serverInfoSchema = z
  .object({
    name: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
    title: z.string().min(1).max(256).optional(),
  })
  .strict();

const serverSchema = z
  .object({
    info: serverInfoSchema,
    /**
     * Top-level server instructions injected at `initialize` time. Picked up
     * by the existing `skillsConfig.injectInstructions` machinery (defaults
     * to `append` so the skill catalog summary follows).
     */
    instructions: z
      .string()
      .max(16 * 1024)
      .optional(),
  })
  .strict();

// ============================================================================
// Runtime target
// ============================================================================

const runtimeSchema = z
  .object({
    /** Only `cloudflare-worker` in v1. Future: `vercel-edge`, `deno-deploy`. */
    target: z.literal('cloudflare-worker'),
    compatibilityDate: z.string().regex(ISO_DATE_RE, 'compatibilityDate must be ISO-8601 (YYYY-MM-DD)'),
    /** Worker compatibility flags (e.g. `nodejs_compat`). */
    compatibilityFlags: z.array(z.string().min(1).max(128)).max(32).optional(),
  })
  .strict();

// ============================================================================
// OpenAPI specs (capability inventory; never directly exposed)
// ============================================================================

const specSourceSchema = z.union([
  /** Local file path or HTTPS URL to a single spec. Spec id = filename stem. */
  z.string().min(1).max(2048),
  z
    .object({
      id: z.string().min(1).max(128).regex(SPEC_ID_RE, 'spec id must be a URI-safe identifier'),
      spec: z.string().min(1).max(2048),
      baseUrl: z.string().url('baseUrl must be a valid URL').optional(),
      /** Optional namespace override for AgentScript bindings (default = `id`). */
      bindingName: z.string().min(1).max(64).regex(IDENT_RE).optional(),
    })
    .strict(),
]);

const specsSchema = z.union([
  /** Single directory path; the loader auto-discovers `*.yaml` / `*.json`. */
  z.string().min(1).max(2048),
  /** Explicit list (mixed strings and detail objects allowed). */
  z.array(specSourceSchema).max(64),
]);

// ============================================================================
// Skills
// ============================================================================

const skillsSchema = z
  .object({
    /** Directory under the manifest. Defaults to `./skills/`. */
    source: z.string().min(1).max(2048).default('./skills/'),
    /**
     * IDs of skills the worker pre-loads into every `execute()` regardless
     * of which skills the agent passed. Mirrors the per-skill
     * `alwaysLoad: true` frontmatter, but lets the server force it.
     */
    alwaysLoad: z.array(z.string().min(1).max(128)).max(32).optional(),
    /** Optional tag filter applied at deploy time. */
    tags: z
      .object({
        include: z.array(z.string().min(1).max(64)).max(64).optional(),
        exclude: z.array(z.string().min(1).max(64)).max(64).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ============================================================================
// Tag dictionary (OpenAPI-shaped)
// ============================================================================

const tagSchema = z
  .object({
    name: z.string().min(1).max(64),
    description: z.string().min(1).max(512).optional(),
  })
  .strict();

// ============================================================================
// OpenAPI → MCP classification overrides
// ============================================================================

const classificationRuleSchema = z
  .object({
    /**
     * Match pattern: METHOD followed by a path-glob, e.g.
     * `POST <star>/reset-<star>` (where <star> is the literal `*` glob).
     * Written this way to avoid prematurely closing the JSDoc with star-slash.
     */
    match: z.string().min(1).max(256),
    /**
     * Override the MCP surface for matching operations: tool (default for
     * mutations), resource (default for GET list / GET path-param), or both
     * (default for GET path-param). Omit to leave the classifier's default.
     */
    expose: z.enum(['tool', 'resource', 'both']).optional(),
    /**
     * Resource-update emit target. `self` (mutation on its own resource),
     * `parent` (mutation that affects the parent collection / parent path),
     * or `none` (suppress). Defaults from the HTTP-semantics classifier.
     */
    emits: z.enum(['self', 'parent', 'none']).optional(),
  })
  .strict();

const classificationSchema = z
  .object({
    rules: z.array(classificationRuleSchema).max(64).optional(),
  })
  .strict();

// ============================================================================
// Cloudflare bindings (mirror wrangler shapes; renamed to camelCase)
// ============================================================================

const durableObjectBindingSchema = z
  .object({
    binding: z.string().min(1).max(128).regex(BINDING_NAME_RE),
    className: z.string().min(1).max(128).regex(IDENT_RE),
    scriptName: z.string().min(1).max(128).optional(),
  })
  .strict();

const d1BindingSchema = z
  .object({
    binding: z.string().min(1).max(128).regex(BINDING_NAME_RE),
    databaseName: z.string().min(1).max(256),
    databaseId: z.string().min(1).max(128),
  })
  .strict();

const kvBindingSchema = z
  .object({
    binding: z.string().min(1).max(128).regex(BINDING_NAME_RE),
    id: z.string().min(1).max(128),
  })
  .strict();

const r2BindingSchema = z
  .object({
    binding: z.string().min(1).max(128).regex(BINDING_NAME_RE),
    bucketName: z.string().min(1).max(256),
  })
  .strict();

const bindingsSchema = z
  .object({
    durableObjects: z.array(durableObjectBindingSchema).max(32).optional(),
    d1Databases: z.array(d1BindingSchema).max(16).optional(),
    kvNamespaces: z.array(kvBindingSchema).max(32).optional(),
    r2Buckets: z.array(r2BindingSchema).max(16).optional(),
    /** Plaintext vars surfaced as `env.<name>` on the Worker. */
    vars: z.record(z.string().min(1).max(128), z.string().max(4096)).optional(),
  })
  .strict();

// ============================================================================
// Signing + replay protection (reuses the v1.2 bundle signing primitives)
// ============================================================================

const trustRootSchema = z
  .object({
    /** Key id — matches the JWS `kid` header on the signed bundle. */
    kid: z.string().min(1).max(128),
    /** Name of the secret binding holding the PEM-encoded public key. */
    publicKeySecret: z.string().min(1).max(128).regex(SECRET_NAME_RE),
  })
  .strict();

const replayGuardSchema = z
  .object({
    /** Acceptable clock skew; rejects bundles older than this. */
    windowSeconds: z.number().int().min(10).max(3600).default(300),
    /** KV binding name that stores nonces for replay protection. */
    nonceKv: z.string().min(1).max(128).regex(BINDING_NAME_RE),
  })
  .strict();

const signingSchema = z
  .object({
    algorithm: z.enum(['ed25519', 'rs256']),
    trustRoots: z.array(trustRootSchema).min(1).max(8),
    replay: replayGuardSchema,
  })
  .strict();

// ============================================================================
// Auth
// ============================================================================

const fronteggAuthSchema = z
  .object({
    tenantResolver: z.enum(['subdomain', 'header', 'jwt-claim']).default('subdomain'),
    audience: z.string().min(1).max(256),
    /** Secret name holding the issuer URL. */
    issuerSecret: z.string().min(1).max(128).regex(SECRET_NAME_RE),
  })
  .strict();

const oauthAuthSchema = z
  .object({
    issuer: z.string().url(),
    audience: z.string().min(1).max(256),
    /** Optional secret name for client credentials (machine-to-machine). */
    credentialsSecret: z.string().min(1).max(128).regex(SECRET_NAME_RE).optional(),
  })
  .strict();

const apiKeyAuthSchema = z
  .object({
    /** Header name carrying the key (e.g. `X-API-Key`). */
    header: z.string().min(1).max(64).default('X-API-Key'),
    /** Secret name holding the allowlist (newline-separated keys). */
    allowlistSecret: z.string().min(1).max(128).regex(SECRET_NAME_RE),
  })
  .strict();

const authSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('none') }).strict(),
  z.object({ provider: z.literal('frontegg'), frontegg: fronteggAuthSchema }).strict(),
  z.object({ provider: z.literal('oauth'), oauth: oauthAuthSchema }).strict(),
  z.object({ provider: z.literal('apiKey'), apiKey: apiKeyAuthSchema }).strict(),
]);

// ============================================================================
// Secrets (names only — values bound out-of-band)
// ============================================================================

const secretSchema = z
  .object({
    name: z.string().min(1).max(128).regex(SECRET_NAME_RE),
    required: z.boolean().default(true),
    description: z.string().min(1).max(512).optional(),
  })
  .strict();

// ============================================================================
// Environment overlays (Wrangler-style)
// ============================================================================
//
// Overlays are PARTIAL: scalars and nested objects deep-merge, but `bindings`
// REPLACES (matches wrangler "[env.X] bindings are not inheritable"). The
// merge is the loader's job; the schema just describes what's expressible.

const environmentOverlaySchema = z
  .object({
    server: serverSchema.partial().optional(),
    specs: specsSchema.optional(),
    skills: skillsSchema.partial().optional(),
    classification: classificationSchema.optional(),
    bindings: bindingsSchema.optional(),
    auth: authSchema.optional(),
    vars: z.record(z.string().min(1).max(128), z.string().max(4096)).optional(),
  })
  .strict();

// ============================================================================
// Top-level
// ============================================================================

export const deployManifestSchema = z
  .object({
    /** Optional JSON Schema URL — accepted for editor autocompletion. */
    $schema: z.string().url().optional(),

    /** Schema version. Only `1` accepted in v1.3. */
    version: z.literal(1),

    /** Project name (for logs + the Worker's `worker.name`). */
    name: z.string().min(1).max(128).regex(IDENT_RE),

    runtime: runtimeSchema,
    server: serverSchema,
    specs: specsSchema,
    skills: skillsSchema.default({ source: './skills/' }),
    tags: z.array(tagSchema).max(64).optional(),
    classification: classificationSchema.optional(),
    bindings: bindingsSchema,
    signing: signingSchema,
    auth: authSchema,
    secrets: z.array(secretSchema).max(64).optional(),
    environments: z.record(z.string().min(1).max(64).regex(IDENT_RE), environmentOverlaySchema).optional(),
  })
  .strict();

/** Type-safe parsed manifest. */
export type DeployManifest = z.infer<typeof deployManifestSchema>;

/** Individual sub-schema type exports (handy for loaders / docs). */
export type DeployManifestRuntime = z.infer<typeof runtimeSchema>;
export type DeployManifestServer = z.infer<typeof serverSchema>;
export type DeployManifestSkills = z.infer<typeof skillsSchema>;
export type DeployManifestBindings = z.infer<typeof bindingsSchema>;
export type DeployManifestSigning = z.infer<typeof signingSchema>;
export type DeployManifestAuth = z.infer<typeof authSchema>;
export type DeployManifestSecret = z.infer<typeof secretSchema>;
export type DeployManifestClassificationRule = z.infer<typeof classificationRuleSchema>;
export type DeployManifestEnvironmentOverlay = z.infer<typeof environmentOverlaySchema>;

// ============================================================================
// Cross-field validation pass
// ============================================================================

/**
 * Apply an environment overlay onto the base manifest, returning the
 * effective manifest for that environment.
 *
 * Semantics, locked by deploy-manifest.mdx:
 *   - `server`, `skills` — shallow-merge (overlay fields override base
 *     fields of the same name; unspecified fields fall through).
 *   - `specs`, `classification`, `bindings`, `auth` — REPLACE wholesale
 *     when present (mirrors wrangler's `[env.<name>]` non-inheritance).
 *     `bindings` REPLACING is load-bearing for env-aware validation:
 *     a prod overlay can swap the entire KV/DO inventory.
 *   - `signing`, `secrets`, `tags`, `environments` — not overridable
 *     (no field on the overlay schema); copied through from base.
 *
 * Exposed publicly so consumers (deploy CLI, worker-runtime) reuse this
 * single source of truth rather than re-implementing merge rules. The
 * tetros-side `applyEnvironmentOverlay` mirror in
 * `worker-runtime/src/envelope.ts` should pull from here once the OSS
 * package is published.
 */
export function applyEnvironmentOverlay(
  base: DeployManifest,
  overlay: DeployManifestEnvironmentOverlay,
): DeployManifest {
  return {
    ...base,
    server: overlay.server ? { ...base.server, ...overlay.server } : base.server,
    specs: overlay.specs ?? base.specs,
    skills: overlay.skills ? { ...base.skills, ...overlay.skills } : base.skills,
    classification: overlay.classification ?? base.classification,
    // Bindings REPLACE per wrangler semantics — an env that touches
    // `bindings` declares its entire DO/KV inventory; nothing from base
    // is inherited.
    bindings: overlay.bindings ?? base.bindings,
    auth: overlay.auth ?? base.auth,
  };
}

/**
 * Run the schema-can't-express checks against ONE effective manifest
 * (either the base or a per-environment overlay). Pushes its findings
 * into `errors`, prefixed by `label` so a multi-env report stays
 * unambiguous about which env each error came from.
 *
 * Extracted from `crossValidateManifest` so the base manifest AND every
 * env overlay get the SAME validation pass — silent skipping of env-
 * specific overrides was the bug that motivated the refactor.
 */
function validateEffectiveManifest(manifest: DeployManifest, label: string, errors: string[]): void {
  // 1. All referenced secrets must be declared. Note: `secrets[]` is NOT
  //    overridable per-env (not in the overlay schema), so we always
  //    cross-check against the base's declarations regardless of which
  //    env's effective manifest is being inspected.
  const declaredSecrets = new Set((manifest.secrets ?? []).map((s) => s.name));

  const refs: Array<{ where: string; name: string }> = [];
  if (manifest.auth.provider === 'frontegg') {
    refs.push({ where: 'auth.frontegg.issuerSecret', name: manifest.auth.frontegg.issuerSecret });
  } else if (manifest.auth.provider === 'oauth' && manifest.auth.oauth.credentialsSecret) {
    refs.push({ where: 'auth.oauth.credentialsSecret', name: manifest.auth.oauth.credentialsSecret });
  } else if (manifest.auth.provider === 'apiKey') {
    refs.push({ where: 'auth.apiKey.allowlistSecret', name: manifest.auth.apiKey.allowlistSecret });
  }
  for (const root of manifest.signing.trustRoots) {
    refs.push({ where: `signing.trustRoots[kid=${root.kid}].publicKeySecret`, name: root.publicKeySecret });
  }

  for (const ref of refs) {
    if (!declaredSecrets.has(ref.name)) {
      errors.push(`${label}Secret "${ref.name}" referenced at ${ref.where} is not declared in secrets[]`);
    }
  }

  // 2. signing.replay.nonceKv must reference a declared KV binding in the
  //    EFFECTIVE bindings (env can replace bindings wholesale).
  const declaredKv = new Set((manifest.bindings.kvNamespaces ?? []).map((kv) => kv.binding));
  if (!declaredKv.has(manifest.signing.replay.nonceKv)) {
    errors.push(
      `${label}signing.replay.nonceKv "${manifest.signing.replay.nonceKv}" does not match any bindings.kvNamespaces[].binding`,
    );
  }

  // 3. Every alwaysLoad id should look like a valid skill name (loader will
  //    confirm the skill exists in the source dir; here we only catch
  //    obvious typos at the syntactic level).
  for (const id of manifest.skills.alwaysLoad ?? []) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      errors.push(`${label}skills.alwaysLoad entry "${id}" is not a valid kebab-case skill id`);
    }
  }

  // 4. Tag-filter sets must reference declared tags if any tags[] is
  //    present. `tags[]` lives only at the top level — an env overlay
  //    can override the tag FILTER (`skills.tags`) but not the
  //    declarations themselves.
  if (manifest.tags) {
    const declaredTags = new Set(manifest.tags.map((t) => t.name));
    const tagFilter = manifest.skills.tags;
    for (const t of [...(tagFilter?.include ?? []), ...(tagFilter?.exclude ?? [])]) {
      if (!declaredTags.has(t)) {
        errors.push(`${label}skills.tags references unknown tag "${t}" (not in tags[])`);
      }
    }
  }
}

/**
 * Validations that the Zod schema can't express in a single pass — e.g.
 * "every secret referenced from auth/signing/bindings appears in secrets[]".
 *
 * Iterates `manifest.environments` AFTER checking the base manifest, so
 * an env overlay that replaces `bindings` or `auth` is held to the same
 * contract — a prod-only typo can no longer slip past validation by
 * hiding inside an `environments.production` block.
 *
 * Run AFTER `deployManifestSchema.parse(...)` succeeds.
 */
export function crossValidateManifest(manifest: DeployManifest): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  // Base manifest validation: errors come back un-prefixed (preserves the
  // pre-refactor message shape that callers + tests pin against).
  validateEffectiveManifest(manifest, '', errors);

  // Per-environment validation: re-run every check against the effective
  // manifest with the overlay applied. Prefix each error with the env
  // name so a multi-env report unambiguously identifies the source.
  for (const [envName, overlay] of Object.entries(manifest.environments ?? {})) {
    const effective = applyEnvironmentOverlay(manifest, overlay);
    validateEffectiveManifest(effective, `environments.${envName}: `, errors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
