/**
 * Dependency Resolution Schemas
 *
 * Zod validation schemas for CDN dependency configuration,
 * bundle options, and file template configurations.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ============================================
// CDN Provider Schema
// ============================================

/**
 * Supported CDN providers.
 */
export const cdnProviderSchema = z.enum(['cloudflare', 'jsdelivr', 'unpkg', 'esm.sh', 'skypack']);

/**
 * Platform types that affect CDN selection.
 */
export const cdnPlatformTypeSchema = z.enum(['claude', 'openai', 'cursor', 'gemini', 'continue', 'cody', 'unknown']);

// ============================================
// CDN Dependency Schema
// ============================================

/**
 * Schema for validating CDN dependency configuration.
 */
export const cdnDependencySchema = z
  .object({
    /**
     * CDN URL (must be HTTPS).
     */
    url: z
      .string()
      .url()
      .refine((url) => url.startsWith('https://'), {
        message: 'CDN URLs must use HTTPS',
      }),

    /**
     * SRI integrity hash.
     */
    integrity: z
      .string()
      .regex(/^sha(256|384|512)-[A-Za-z0-9+/=]+$/, {
        message: 'Invalid SRI hash format. Must be sha256-, sha384-, or sha512- followed by base64',
      })
      .optional(),

    /**
     * Global variable name for UMD builds.
     */
    global: z.string().min(1).optional(),

    /**
     * Named exports from the library.
     */
    exports: z.array(z.string().min(1)).optional(),

    /**
     * Whether this is an ES module.
     */
    esm: z.boolean().optional(),

    /**
     * Cross-origin attribute.
     */
    crossorigin: z.enum(['anonymous', 'use-credentials']).optional(),

    /**
     * Peer dependencies (npm package names).
     */
    peerDependencies: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type CDNDependencyInput = z.input<typeof cdnDependencySchema>;
export type CDNDependencyOutput = z.output<typeof cdnDependencySchema>;

// ============================================
// Bundle Options Schema
// ============================================

/**
 * Target JavaScript version.
 */
export const bundleTargetSchema = z.enum(['es2018', 'es2019', 'es2020', 'es2021', 'es2022', 'esnext']);

/**
 * Schema for file bundle options.
 */
export const fileBundleOptionsSchema = z
  .object({
    /**
     * Minify output.
     */
    minify: z.boolean().optional(),

    /**
     * Generate source maps.
     */
    sourceMaps: z.boolean().optional(),

    /**
     * Target JavaScript version.
     */
    target: bundleTargetSchema.optional(),

    /**
     * Enable tree shaking.
     */
    treeShake: z.boolean().optional(),

    /**
     * JSX factory function.
     */
    jsxFactory: z.string().min(1).optional(),

    /**
     * JSX fragment factory.
     */
    jsxFragment: z.string().min(1).optional(),

    /**
     * JSX import source.
     */
    jsxImportSource: z.string().min(1).optional(),
  })
  .strict();

export type FileBundleOptionsInput = z.input<typeof fileBundleOptionsSchema>;
export type FileBundleOptionsOutput = z.output<typeof fileBundleOptionsSchema>;

// ============================================
// File Template Config Schema
// ============================================

/**
 * Schema for file-based template configuration.
 * These fields extend UITemplateConfig for file-based templates.
 */
export const fileTemplateConfigSchema = z
  .object({
    /**
     * Packages to load from CDN.
     */
    externals: z.array(z.string().min(1)).optional(),

    /**
     * Explicit CDN dependency overrides.
     */
    dependencies: z.record(z.string().min(1), cdnDependencySchema).optional(),

    /**
     * Bundle options.
     */
    bundleOptions: fileBundleOptionsSchema.optional(),
  })
  .strict();

export type FileTemplateConfigInput = z.input<typeof fileTemplateConfigSchema>;
export type FileTemplateConfigOutput = z.output<typeof fileTemplateConfigSchema>;

// ============================================
// Import Map Schema
// ============================================

/**
 * Schema for browser import maps.
 */
export const importMapSchema = z
  .object({
    /**
     * Module specifier to URL mappings.
     */
    imports: z.record(
      z.string().min(1),
      z
        .string()
        .url()
        .refine((url) => url.startsWith('https://'), {
          message: 'Import map URLs must use HTTPS',
        }),
    ),

    /**
     * Scoped mappings.
     */
    scopes: z.record(z.string().min(1), z.record(z.string().min(1), z.string().url())).optional(),

    /**
     * Integrity hashes.
     */
    integrity: z.record(z.string().url(), z.string().regex(/^sha(256|384|512)-[A-Za-z0-9+/=]+$/)).optional(),
  })
  .strict();

export type ImportMapInput = z.input<typeof importMapSchema>;
export type ImportMapOutput = z.output<typeof importMapSchema>;

// ============================================
// Resolved Dependency Schema
// ============================================

/**
 * Schema for a resolved dependency entry.
 */
export const resolvedDependencySchema = z
  .object({
    packageName: z.string().min(1),
    version: z.string().min(1),
    cdnUrl: z.string().url(),
    integrity: z.string().optional(),
    global: z.string().optional(),
    esm: z.boolean(),
    provider: cdnProviderSchema,
  })
  .strict();

export type ResolvedDependencyInput = z.input<typeof resolvedDependencySchema>;
export type ResolvedDependencyOutput = z.output<typeof resolvedDependencySchema>;

// ============================================
// Component Build Manifest Schema
// ============================================

/**
 * Schema for build manifest metadata.
 */
export const buildManifestMetadataSchema = z
  .object({
    createdAt: z.string().datetime(),
    buildTimeMs: z.number().nonnegative(),
    totalSize: z.number().nonnegative(),
    bundlerVersion: z.string().optional(),
  })
  .strict();

/**
 * Schema for build outputs.
 */
export const buildManifestOutputsSchema = z
  .object({
    code: z.string(),
    sourceMap: z.string().optional(),
    ssrHtml: z.string().optional(),
  })
  .strict();

/**
 * Schema for component build manifest.
 */
export const componentBuildManifestSchema = z
  .object({
    version: z.literal('1.0'),
    buildId: z.string().uuid(),
    toolName: z.string().min(1),
    entryPath: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/, {
      message: 'Content hash must be a 64-character SHA-256 hex string',
    }),
    dependencies: z.array(resolvedDependencySchema),
    outputs: buildManifestOutputsSchema,
    importMap: importMapSchema,
    metadata: buildManifestMetadataSchema,
  })
  .strict();

export type ComponentBuildManifestInput = z.input<typeof componentBuildManifestSchema>;
export type ComponentBuildManifestOutput = z.output<typeof componentBuildManifestSchema>;

// ============================================
// CDN Registry Entry Schema
// ============================================

/**
 * Schema for CDN provider configuration.
 */
export const cdnProviderConfigSchema = z.record(cdnProviderSchema, cdnDependencySchema);

/**
 * Schema for package metadata in registry.
 */
export const packageMetadataSchema = z
  .object({
    description: z.string().optional(),
    homepage: z.string().url().optional(),
    license: z.string().optional(),
  })
  .strict();

/**
 * Schema for a CDN registry entry.
 */
export const cdnRegistryEntrySchema = z
  .object({
    packageName: z.string().min(1),
    defaultVersion: z.string().min(1),
    providers: cdnProviderConfigSchema,
    preferredProviders: z.array(cdnProviderSchema).optional(),
    metadata: packageMetadataSchema.optional(),
  })
  .strict();

export type CDNRegistryEntryInput = z.input<typeof cdnRegistryEntrySchema>;
export type CDNRegistryEntryOutput = z.output<typeof cdnRegistryEntrySchema>;

// ============================================
// Dependency Resolver Options Schema
// ============================================

/**
 * Schema for dependency resolver options.
 */
export const dependencyResolverOptionsSchema = z
  .object({
    platform: cdnPlatformTypeSchema.optional(),
    preferredProviders: z.array(cdnProviderSchema).optional(),
    customRegistry: z.record(z.string().min(1), cdnRegistryEntrySchema).optional(),
    strictMode: z.boolean().optional(),
    requireIntegrity: z.boolean().optional(),
  })
  .strict();

export type DependencyResolverOptionsInput = z.input<typeof dependencyResolverOptionsSchema>;
export type DependencyResolverOptionsOutput = z.output<typeof dependencyResolverOptionsSchema>;

// ============================================
// Parsed Import Schema
// ============================================

/**
 * Import type enumeration.
 */
export const importTypeSchema = z.enum(['named', 'default', 'namespace', 'side-effect', 'dynamic']);

/**
 * Schema for a parsed import statement.
 */
export const parsedImportSchema = z
  .object({
    statement: z.string(),
    specifier: z.string().min(1),
    type: importTypeSchema,
    namedImports: z.array(z.string().min(1)).optional(),
    defaultImport: z.string().min(1).optional(),
    namespaceImport: z.string().min(1).optional(),
    line: z.number().int().positive(),
    column: z.number().int().nonnegative(),
  })
  .strict();

export type ParsedImportInput = z.input<typeof parsedImportSchema>;
export type ParsedImportOutput = z.output<typeof parsedImportSchema>;

/**
 * Schema for parsed import results.
 */
export const parsedImportResultSchema = z
  .object({
    imports: z.array(parsedImportSchema),
    externalImports: z.array(parsedImportSchema),
    relativeImports: z.array(parsedImportSchema),
    externalPackages: z.array(z.string().min(1)),
  })
  .strict();

export type ParsedImportResultInput = z.input<typeof parsedImportResultSchema>;
export type ParsedImportResultOutput = z.output<typeof parsedImportResultSchema>;

// ============================================
// Cache Stats Schema
// ============================================

/**
 * Schema for cache statistics.
 */
export const cacheStatsSchema = z
  .object({
    entries: z.number().int().nonnegative(),
    totalSize: z.number().nonnegative(),
    hits: z.number().int().nonnegative(),
    misses: z.number().int().nonnegative(),
    hitRate: z.number().min(0).max(1),
  })
  .strict();

export type CacheStatsInput = z.input<typeof cacheStatsSchema>;
export type CacheStatsOutput = z.output<typeof cacheStatsSchema>;

// ============================================
// Validation Helpers
// ============================================

/**
 * Safe parse result type.
 */
export type SafeParseResult<T> = { success: true; data: T } | { success: false; error: z.ZodError };

/**
 * Validate a CDN dependency configuration.
 *
 * @param data - Data to validate
 * @returns Validated CDN dependency or throws ZodError
 */
export function validateCDNDependency(data: unknown): CDNDependencyOutput {
  return cdnDependencySchema.parse(data);
}

/**
 * Safely validate a CDN dependency configuration.
 *
 * @param data - Data to validate
 * @returns Safe parse result with success flag
 */
export function safeParseCDNDependency(data: unknown): SafeParseResult<CDNDependencyOutput> {
  return cdnDependencySchema.safeParse(data) as SafeParseResult<CDNDependencyOutput>;
}

/**
 * Validate file template configuration.
 *
 * @param data - Data to validate
 * @returns Validated file template config or throws ZodError
 */
export function validateFileTemplateConfig(data: unknown): FileTemplateConfigOutput {
  return fileTemplateConfigSchema.parse(data);
}

/**
 * Safely validate file template configuration.
 *
 * @param data - Data to validate
 * @returns Safe parse result with success flag
 */
export function safeParseFileTemplateConfig(data: unknown): SafeParseResult<FileTemplateConfigOutput> {
  return fileTemplateConfigSchema.safeParse(data) as SafeParseResult<FileTemplateConfigOutput>;
}

/**
 * Validate a component build manifest.
 *
 * @param data - Data to validate
 * @returns Validated manifest or throws ZodError
 */
export function validateBuildManifest(data: unknown): ComponentBuildManifestOutput {
  return componentBuildManifestSchema.parse(data);
}

/**
 * Safely validate a component build manifest.
 *
 * @param data - Data to validate
 * @returns Safe parse result with success flag
 */
export function safeParseBuildManifest(data: unknown): SafeParseResult<ComponentBuildManifestOutput> {
  return componentBuildManifestSchema.safeParse(data) as SafeParseResult<ComponentBuildManifestOutput>;
}
