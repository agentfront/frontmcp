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

export const deploymentTargetSchema = z.discriminatedUnion('target', [
  nodeDeploymentSchema,
  distributedDeploymentSchema,
  cliDeploymentSchema,
  vercelDeploymentSchema,
  lambdaDeploymentSchema,
  cloudflareDeploymentSchema,
  browserDeploymentSchema,
  sdkDeploymentSchema,
]);

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
  })
  .strict();

export type FrontMcpConfigInput = z.input<typeof frontmcpConfigSchema>;
export type FrontMcpConfigParsed = z.output<typeof frontmcpConfigSchema>;
