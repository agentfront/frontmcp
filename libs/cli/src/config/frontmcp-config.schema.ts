/**
 * FrontMCP Config — Zod Validation Schema
 *
 * Validates and normalizes `frontmcp.config` files.
 * The schema is also the source of truth for JSON Schema generation.
 */

// Lazy-by-default `z`. Same API as `zod`'s `z`, but compound schemas
// (`z.object`, `z.union`, `z.discriminatedUnion`, `z.intersection`,
// `z.record`, `z.tuple`) defer construction until first `.parse()`.
// This schema is parsed at CLI startup — using lazy-z keeps module load
// from materializing every nested config-shape eagerly.
//
// Imported directly from `@frontmcp/lazy-zod` (not the `@frontmcp/sdk`
// barrel) to keep this leaf module lightweight — pulling the full SDK
// barrel into Jest's transform chain trips on `jose`'s ESM-only build.
import { z } from '@frontmcp/lazy-zod';

// ============================================
// Server Defaults
// ============================================

export const corsConfigSchema = z
  .object({
    origins: z.array(z.string()).optional(),
    credentials: z.boolean().optional(),
    maxAge: z.number().int().positive().optional(),
  })
  .strict();

export const cspConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    directives: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    reportUri: z.string().optional(),
    reportOnly: z.boolean().optional(),
  })
  .strict();

export const cookiesConfigSchema = z
  .object({
    affinity: z.string().optional(),
    domain: z.string().optional(),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
  })
  .strict();

export const securityHeadersSchema = z
  .object({
    hsts: z.union([z.string(), z.literal(false)]).optional(),
    contentTypeOptions: z.union([z.string(), z.literal(false)]).optional(),
    frameOptions: z.union([z.string(), z.literal(false)]).optional(),
    custom: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const httpConfigSchema = z
  .object({
    port: z.number().int().min(0).max(65535).optional(),
    socketPath: z.string().optional(),
    entryPath: z.string().optional(),
    cors: corsConfigSchema.optional(),
  })
  .strict();

export const serverDefaultsSchema = z
  .object({
    http: httpConfigSchema.optional(),
    csp: cspConfigSchema.optional(),
    cookies: cookiesConfigSchema.optional(),
    headers: securityHeadersSchema.optional(),
  })
  .strict();

// ============================================
// Build Options
// ============================================

export const esbuildOptionsSchema = z
  .object({
    external: z.array(z.string()).optional(),
    define: z.record(z.string(), z.string()).optional(),
    target: z.string().optional(),
    minify: z.boolean().optional(),
  })
  .strict();

export const buildOptionsSchema = z
  .object({
    esbuild: esbuildOptionsSchema.optional(),
    dependencies: z
      .object({
        system: z.array(z.string()).optional(),
        nativeAddons: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    storage: z
      .object({
        type: z.enum(['sqlite', 'redis', 'none']),
        required: z.boolean().optional(),
      })
      .strict()
      .optional(),
    network: z
      .object({
        defaultPort: z.number().int().optional(),
        supportsSocket: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ============================================
// Deployment Targets
// ============================================

export const haConfigSchema = z
  .object({
    heartbeatIntervalMs: z.number().int().positive().optional(),
    heartbeatTtlMs: z.number().int().positive().optional(),
    takeoverGracePeriodMs: z.number().int().positive().optional(),
    redisKeyPrefix: z.string().optional(),
  })
  .strict();

export const cliTargetConfigSchema = z
  .object({
    description: z.string().optional(),
    outputDefault: z.enum(['text', 'json']).optional(),
    authRequired: z.boolean().optional(),
    excludeTools: z.array(z.string()).optional(),
    oauth: z
      .object({
        serverUrl: z.string().optional(),
        clientId: z.string().optional(),
        defaultScope: z.string().optional(),
        portRange: z.tuple([z.number(), z.number()]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const wranglerConfigSchema = z
  .object({
    name: z.string().optional(),
    compatibilityDate: z.string().optional(),
  })
  .strict();

const deploymentBaseSchema = z.object({
  outDir: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const nodeDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('node'),
    server: serverDefaultsSchema.optional(),
  })
  .strict();

export const distributedDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('distributed'),
    server: serverDefaultsSchema.optional(),
    ha: haConfigSchema.optional(),
  })
  .strict();

export const cliDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('cli'),
    js: z.boolean().optional(),
    cli: cliTargetConfigSchema.optional(),
    sea: z.object({ enabled: z.boolean().optional() }).strict().optional(),
  })
  .strict();

export const vercelDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('vercel'),
    server: serverDefaultsSchema.optional(),
  })
  .strict();

export const lambdaDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('lambda'),
    server: serverDefaultsSchema.optional(),
  })
  .strict();

export const cloudflareDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('cloudflare'),
    server: serverDefaultsSchema.optional(),
    wrangler: wranglerConfigSchema.optional(),
  })
  .strict();

export const browserDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('browser'),
  })
  .strict();

export const sdkDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('sdk'),
  })
  .strict();

// ============================================
// MCPB (MCP Bundles) target — produces a .mcpb ZIP archive
// per https://github.com/modelcontextprotocol/mcpb (manifest_version 0.3)
// ============================================

export const mcpbAuthorSchema = z
  .object({
    name: z.string(),
    email: z.string().email().optional(),
    url: z.string().url().optional(),
  })
  .strict();

export const mcpbUserConfigEntrySchema = z
  .object({
    type: z.enum(['string', 'number', 'boolean', 'directory', 'file']),
    title: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    multiple: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict();

export const mcpbCompatibilitySchema = z
  .object({
    claude_desktop: z.string().optional(),
    platforms: z.array(z.enum(['darwin', 'win32', 'linux'])).optional(),
    runtimes: z
      .object({
        node: z.string().optional(),
        python: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const mcpbRepositorySchema = z.union([
  z.string(),
  z
    .object({
      type: z.string(),
      url: z.string(),
    })
    .strict(),
]);

export const mcpbDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('mcpb'),
    /** Human-friendly display name shown in installer dialog. */
    displayName: z.string().optional(),
    /** Long markdown description shown in extension details. */
    longDescription: z.string().optional(),
    /** Author object (name/email/url). Overrides parsed package.json.author. */
    author: mcpbAuthorSchema.optional(),
    /** SPDX license identifier. Overrides package.json.license. */
    license: z.string().optional(),
    /** Project homepage URL. */
    homepage: z.string().url().optional(),
    /** Source repository (string URL or {type, url}). */
    repository: mcpbRepositorySchema.optional(),
    /** Documentation URL. */
    documentation: z.string().url().optional(),
    /** Support URL (issues/contact). */
    support: z.string().optional(),
    /** Path to icon (PNG) relative to project root. */
    icon: z.string().optional(),
    /** Keywords for search. */
    keywords: z.array(z.string()).optional(),
    /** Privacy policy URLs for external services this bundle talks to. */
    privacyPolicies: z.array(z.string()).optional(),
    /** Runtime/platform/client compatibility constraints. */
    compatibility: mcpbCompatibilitySchema.optional(),
    /** User-configurable inputs (injected as env vars at runtime). */
    userConfig: z.record(z.string(), mcpbUserConfigEntrySchema).optional(),
    /** Single-executable-application binary integration. */
    sea: z
      .object({
        /** Build SEA binary for host platform and include via platform_overrides. */
        enabled: z.boolean().optional(),
        /** Directory of pre-built SEA binaries to merge (e.g., CI artifacts). */
        mergeFrom: z.string().optional(),
      })
      .strict()
      .optional(),
    /** Include node_modules/ in archive (opt-in, defaults off). */
    includeNodeModules: z.boolean().optional(),
    /** Produce byte-identical archives across builds. @default true */
    deterministic: z.boolean().optional(),
  })
  .strict();

export const deploymentTargetSchema = z.discriminatedUnion('target', [
  nodeDeploymentSchema,
  distributedDeploymentSchema,
  cliDeploymentSchema,
  vercelDeploymentSchema,
  lambdaDeploymentSchema,
  cloudflareDeploymentSchema,
  browserDeploymentSchema,
  sdkDeploymentSchema,
  mcpbDeploymentSchema,
]);

// ============================================
// Transport defaults (issue #400)
// ============================================
//
// Per-protocol defaults consumed by `dev` / `inspector` / `pm start` / `pm
// socket` so server-startup flags don't have to be re-typed on every CLI
// invocation. Per-deployment `server.http.port` still wins where set.

export const transportHttpSchema = z
  .object({
    port: z.number().int().min(0).max(65535).optional(),
    path: z.string().optional(),
    host: z.string().optional(),
  })
  .strict();

export const transportStdioSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
  })
  .strict();

export const transportConfigSchema = z
  .object({
    default: z.enum(['http', 'sse', 'stdio']).optional(),
    http: transportHttpSchema.optional(),
    stdio: transportStdioSchema.optional(),
  })
  .strict();

// ============================================
// Env overlays (issue #400)
// ============================================
//
// `shared` applies to every mode; mode-specific overlays (`dev`, `test`,
// `ship`) are merged on top. Effective env = `shared` ⊕ `<mode>` (later
// wins). Loaded by `dev`/`test`/`pm` in addition to `.env`/`.env.local`
// — file-based env still wins for parity with existing behavior.

export const envOverlaysSchema = z
  .object({
    shared: z.record(z.string(), z.string()).optional(),
    dev: z.record(z.string(), z.string()).optional(),
    test: z.record(z.string(), z.string()).optional(),
    ship: z.record(z.string(), z.string()).optional(),
  })
  .strict();

// ============================================
// MCP client connection snippets (issue #400)
// ============================================
//
// Per-client connection descriptors consumed by `frontmcp eject-mcp-config
// <client>` to emit ready-to-paste `.mcp.json` / `claude_desktop_config.json`
// / Cursor / Windsurf / VS Code snippets.

export const clientConnectionSchema = z
  .object({
    name: z.string().optional(),
    transport: z.enum(['http', 'sse', 'stdio']),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
  })
  .strict();

export const clientsConfigSchema = z.record(
  z.enum(['claude-code', 'claude-desktop', 'cursor', 'windsurf', 'vscode']),
  clientConnectionSchema,
);

// ============================================
// Test runner defaults (issue #400)
// ============================================
//
// `frontmcp test` defaults — overridden by CLI flags (`--timeout`,
// `--runInBand`, `--coverage`, `<patterns>`).

export const testConfigSchema = z
  .object({
    timeoutMs: z.number().int().positive().optional(),
    runInBand: z.boolean().optional(),
    testMatch: z.array(z.string()).optional(),
    coverage: z.boolean().optional(),
  })
  .strict();

// ============================================
// Skills install / export defaults (issue #400)
// ============================================
//
// `frontmcp skills install` / `export` defaults — `install` is the list of
// catalog skill names a project depends on so `frontmcp skills install`
// with no arguments installs the curated set.

export const skillsCliConfigSchema = z
  .object({
    provider: z.enum(['claude', 'codex']).optional(),
    bundle: z.enum(['recommended', 'minimal', 'full', 'none']).optional(),
    install: z.array(z.string()).optional(),
    exportTarget: z.enum(['cursor', 'windsurf', 'copilot']).optional(),
  })
  .strict();

// ============================================
// Top-Level Config
// ============================================

export const frontmcpConfigSchema = z
  .object({
    $schema: z.string().optional(),
    name: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9._-]+$/, 'Must be alphanumeric with .-_ only'),
    version: z.string().optional(),
    entry: z.string().optional(),
    nodeVersion: z.string().optional(),
    deployments: z.array(deploymentTargetSchema).min(1, 'At least one deployment target required'),
    build: buildOptionsSchema.optional(),

    // Issue #400 — config drives every command, not just `build`
    transport: transportConfigSchema.optional(),
    env: envOverlaysSchema.optional(),
    clients: clientsConfigSchema.optional(),
    test: testConfigSchema.optional(),
    skills: skillsCliConfigSchema.optional(),
  })
  .strict();

export type FrontMcpConfigInput = z.input<typeof frontmcpConfigSchema>;
export type FrontMcpConfigParsed = z.output<typeof frontmcpConfigSchema>;
