/**
 * Dependency Resolution Schemas
 *
 * Zod validation schemas for CDN dependency configuration,
 * bundle options, and file template configurations.
 *
 * @packageDocumentation
 */
import { z } from 'zod';
/**
 * Supported CDN providers.
 */
export declare const cdnProviderSchema: z.ZodEnum<{
  cloudflare: 'cloudflare';
  jsdelivr: 'jsdelivr';
  unpkg: 'unpkg';
  'esm.sh': 'esm.sh';
  skypack: 'skypack';
}>;
/**
 * Platform types that affect CDN selection.
 */
export declare const cdnPlatformTypeSchema: z.ZodEnum<{
  openai: 'openai';
  claude: 'claude';
  unknown: 'unknown';
  gemini: 'gemini';
  cursor: 'cursor';
  continue: 'continue';
  cody: 'cody';
}>;
/**
 * Schema for validating CDN dependency configuration.
 */
export declare const cdnDependencySchema: z.ZodObject<
  {
    url: z.ZodString;
    integrity: z.ZodOptional<z.ZodString>;
    global: z.ZodOptional<z.ZodString>;
    exports: z.ZodOptional<z.ZodArray<z.ZodString>>;
    esm: z.ZodOptional<z.ZodBoolean>;
    crossorigin: z.ZodOptional<
      z.ZodEnum<{
        anonymous: 'anonymous';
        'use-credentials': 'use-credentials';
      }>
    >;
    peerDependencies: z.ZodOptional<z.ZodArray<z.ZodString>>;
  },
  z.core.$strict
>;
export type CDNDependencyInput = z.input<typeof cdnDependencySchema>;
export type CDNDependencyOutput = z.output<typeof cdnDependencySchema>;
/**
 * Target JavaScript version.
 */
export declare const bundleTargetSchema: z.ZodEnum<{
  es2018: 'es2018';
  es2019: 'es2019';
  es2020: 'es2020';
  es2021: 'es2021';
  es2022: 'es2022';
  esnext: 'esnext';
}>;
/**
 * Schema for file bundle options.
 */
export declare const fileBundleOptionsSchema: z.ZodObject<
  {
    minify: z.ZodOptional<z.ZodBoolean>;
    sourceMaps: z.ZodOptional<z.ZodBoolean>;
    target: z.ZodOptional<
      z.ZodEnum<{
        es2018: 'es2018';
        es2019: 'es2019';
        es2020: 'es2020';
        es2021: 'es2021';
        es2022: 'es2022';
        esnext: 'esnext';
      }>
    >;
    treeShake: z.ZodOptional<z.ZodBoolean>;
    jsxFactory: z.ZodOptional<z.ZodString>;
    jsxFragment: z.ZodOptional<z.ZodString>;
    jsxImportSource: z.ZodOptional<z.ZodString>;
  },
  z.core.$strict
>;
export type FileBundleOptionsInput = z.input<typeof fileBundleOptionsSchema>;
export type FileBundleOptionsOutput = z.output<typeof fileBundleOptionsSchema>;
/**
 * Schema for file-based template configuration.
 * These fields extend UITemplateConfig for file-based templates.
 */
export declare const fileTemplateConfigSchema: z.ZodObject<
  {
    externals: z.ZodOptional<z.ZodArray<z.ZodString>>;
    dependencies: z.ZodOptional<
      z.ZodRecord<
        z.ZodString,
        z.ZodObject<
          {
            url: z.ZodString;
            integrity: z.ZodOptional<z.ZodString>;
            global: z.ZodOptional<z.ZodString>;
            exports: z.ZodOptional<z.ZodArray<z.ZodString>>;
            esm: z.ZodOptional<z.ZodBoolean>;
            crossorigin: z.ZodOptional<
              z.ZodEnum<{
                anonymous: 'anonymous';
                'use-credentials': 'use-credentials';
              }>
            >;
            peerDependencies: z.ZodOptional<z.ZodArray<z.ZodString>>;
          },
          z.core.$strict
        >
      >
    >;
    bundleOptions: z.ZodOptional<
      z.ZodObject<
        {
          minify: z.ZodOptional<z.ZodBoolean>;
          sourceMaps: z.ZodOptional<z.ZodBoolean>;
          target: z.ZodOptional<
            z.ZodEnum<{
              es2018: 'es2018';
              es2019: 'es2019';
              es2020: 'es2020';
              es2021: 'es2021';
              es2022: 'es2022';
              esnext: 'esnext';
            }>
          >;
          treeShake: z.ZodOptional<z.ZodBoolean>;
          jsxFactory: z.ZodOptional<z.ZodString>;
          jsxFragment: z.ZodOptional<z.ZodString>;
          jsxImportSource: z.ZodOptional<z.ZodString>;
        },
        z.core.$strict
      >
    >;
  },
  z.core.$strict
>;
export type FileTemplateConfigInput = z.input<typeof fileTemplateConfigSchema>;
export type FileTemplateConfigOutput = z.output<typeof fileTemplateConfigSchema>;
/**
 * Schema for browser import maps.
 */
export declare const importMapSchema: z.ZodObject<
  {
    imports: z.ZodRecord<z.ZodString, z.ZodString>;
    scopes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodString>>>;
    integrity: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  },
  z.core.$strict
>;
export type ImportMapInput = z.input<typeof importMapSchema>;
export type ImportMapOutput = z.output<typeof importMapSchema>;
/**
 * Schema for a resolved dependency entry.
 */
export declare const resolvedDependencySchema: z.ZodObject<
  {
    packageName: z.ZodString;
    version: z.ZodString;
    cdnUrl: z.ZodString;
    integrity: z.ZodOptional<z.ZodString>;
    global: z.ZodOptional<z.ZodString>;
    esm: z.ZodBoolean;
    provider: z.ZodEnum<{
      cloudflare: 'cloudflare';
      jsdelivr: 'jsdelivr';
      unpkg: 'unpkg';
      'esm.sh': 'esm.sh';
      skypack: 'skypack';
    }>;
  },
  z.core.$strict
>;
export type ResolvedDependencyInput = z.input<typeof resolvedDependencySchema>;
export type ResolvedDependencyOutput = z.output<typeof resolvedDependencySchema>;
/**
 * Schema for build manifest metadata.
 */
export declare const buildManifestMetadataSchema: z.ZodObject<
  {
    createdAt: z.ZodString;
    buildTimeMs: z.ZodNumber;
    totalSize: z.ZodNumber;
    bundlerVersion: z.ZodOptional<z.ZodString>;
  },
  z.core.$strict
>;
/**
 * Schema for build outputs.
 */
export declare const buildManifestOutputsSchema: z.ZodObject<
  {
    code: z.ZodString;
    sourceMap: z.ZodOptional<z.ZodString>;
    ssrHtml: z.ZodOptional<z.ZodString>;
  },
  z.core.$strict
>;
/**
 * Schema for component build manifest.
 */
export declare const componentBuildManifestSchema: z.ZodObject<
  {
    version: z.ZodLiteral<'1.0'>;
    buildId: z.ZodString;
    toolName: z.ZodString;
    entryPath: z.ZodString;
    contentHash: z.ZodString;
    dependencies: z.ZodArray<
      z.ZodObject<
        {
          packageName: z.ZodString;
          version: z.ZodString;
          cdnUrl: z.ZodString;
          integrity: z.ZodOptional<z.ZodString>;
          global: z.ZodOptional<z.ZodString>;
          esm: z.ZodBoolean;
          provider: z.ZodEnum<{
            cloudflare: 'cloudflare';
            jsdelivr: 'jsdelivr';
            unpkg: 'unpkg';
            'esm.sh': 'esm.sh';
            skypack: 'skypack';
          }>;
        },
        z.core.$strict
      >
    >;
    outputs: z.ZodObject<
      {
        code: z.ZodString;
        sourceMap: z.ZodOptional<z.ZodString>;
        ssrHtml: z.ZodOptional<z.ZodString>;
      },
      z.core.$strict
    >;
    importMap: z.ZodObject<
      {
        imports: z.ZodRecord<z.ZodString, z.ZodString>;
        scopes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodString>>>;
        integrity: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
      },
      z.core.$strict
    >;
    metadata: z.ZodObject<
      {
        createdAt: z.ZodString;
        buildTimeMs: z.ZodNumber;
        totalSize: z.ZodNumber;
        bundlerVersion: z.ZodOptional<z.ZodString>;
      },
      z.core.$strict
    >;
  },
  z.core.$strict
>;
export type ComponentBuildManifestInput = z.input<typeof componentBuildManifestSchema>;
export type ComponentBuildManifestOutput = z.output<typeof componentBuildManifestSchema>;
/**
 * Schema for CDN provider configuration.
 */
export declare const cdnProviderConfigSchema: z.ZodRecord<
  z.ZodEnum<{
    cloudflare: 'cloudflare';
    jsdelivr: 'jsdelivr';
    unpkg: 'unpkg';
    'esm.sh': 'esm.sh';
    skypack: 'skypack';
  }>,
  z.ZodObject<
    {
      url: z.ZodString;
      integrity: z.ZodOptional<z.ZodString>;
      global: z.ZodOptional<z.ZodString>;
      exports: z.ZodOptional<z.ZodArray<z.ZodString>>;
      esm: z.ZodOptional<z.ZodBoolean>;
      crossorigin: z.ZodOptional<
        z.ZodEnum<{
          anonymous: 'anonymous';
          'use-credentials': 'use-credentials';
        }>
      >;
      peerDependencies: z.ZodOptional<z.ZodArray<z.ZodString>>;
    },
    z.core.$strict
  >
>;
/**
 * Schema for package metadata in registry.
 */
export declare const packageMetadataSchema: z.ZodObject<
  {
    description: z.ZodOptional<z.ZodString>;
    homepage: z.ZodOptional<z.ZodString>;
    license: z.ZodOptional<z.ZodString>;
  },
  z.core.$strict
>;
/**
 * Schema for a CDN registry entry.
 */
export declare const cdnRegistryEntrySchema: z.ZodObject<
  {
    packageName: z.ZodString;
    defaultVersion: z.ZodString;
    providers: z.ZodRecord<
      z.ZodEnum<{
        cloudflare: 'cloudflare';
        jsdelivr: 'jsdelivr';
        unpkg: 'unpkg';
        'esm.sh': 'esm.sh';
        skypack: 'skypack';
      }>,
      z.ZodObject<
        {
          url: z.ZodString;
          integrity: z.ZodOptional<z.ZodString>;
          global: z.ZodOptional<z.ZodString>;
          exports: z.ZodOptional<z.ZodArray<z.ZodString>>;
          esm: z.ZodOptional<z.ZodBoolean>;
          crossorigin: z.ZodOptional<
            z.ZodEnum<{
              anonymous: 'anonymous';
              'use-credentials': 'use-credentials';
            }>
          >;
          peerDependencies: z.ZodOptional<z.ZodArray<z.ZodString>>;
        },
        z.core.$strict
      >
    >;
    preferredProviders: z.ZodOptional<
      z.ZodArray<
        z.ZodEnum<{
          cloudflare: 'cloudflare';
          jsdelivr: 'jsdelivr';
          unpkg: 'unpkg';
          'esm.sh': 'esm.sh';
          skypack: 'skypack';
        }>
      >
    >;
    metadata: z.ZodOptional<
      z.ZodObject<
        {
          description: z.ZodOptional<z.ZodString>;
          homepage: z.ZodOptional<z.ZodString>;
          license: z.ZodOptional<z.ZodString>;
        },
        z.core.$strict
      >
    >;
  },
  z.core.$strict
>;
export type CDNRegistryEntryInput = z.input<typeof cdnRegistryEntrySchema>;
export type CDNRegistryEntryOutput = z.output<typeof cdnRegistryEntrySchema>;
/**
 * Schema for dependency resolver options.
 */
export declare const dependencyResolverOptionsSchema: z.ZodObject<
  {
    platform: z.ZodOptional<
      z.ZodEnum<{
        openai: 'openai';
        claude: 'claude';
        unknown: 'unknown';
        gemini: 'gemini';
        cursor: 'cursor';
        continue: 'continue';
        cody: 'cody';
      }>
    >;
    preferredProviders: z.ZodOptional<
      z.ZodArray<
        z.ZodEnum<{
          cloudflare: 'cloudflare';
          jsdelivr: 'jsdelivr';
          unpkg: 'unpkg';
          'esm.sh': 'esm.sh';
          skypack: 'skypack';
        }>
      >
    >;
    customRegistry: z.ZodOptional<
      z.ZodRecord<
        z.ZodString,
        z.ZodObject<
          {
            packageName: z.ZodString;
            defaultVersion: z.ZodString;
            providers: z.ZodRecord<
              z.ZodEnum<{
                cloudflare: 'cloudflare';
                jsdelivr: 'jsdelivr';
                unpkg: 'unpkg';
                'esm.sh': 'esm.sh';
                skypack: 'skypack';
              }>,
              z.ZodObject<
                {
                  url: z.ZodString;
                  integrity: z.ZodOptional<z.ZodString>;
                  global: z.ZodOptional<z.ZodString>;
                  exports: z.ZodOptional<z.ZodArray<z.ZodString>>;
                  esm: z.ZodOptional<z.ZodBoolean>;
                  crossorigin: z.ZodOptional<
                    z.ZodEnum<{
                      anonymous: 'anonymous';
                      'use-credentials': 'use-credentials';
                    }>
                  >;
                  peerDependencies: z.ZodOptional<z.ZodArray<z.ZodString>>;
                },
                z.core.$strict
              >
            >;
            preferredProviders: z.ZodOptional<
              z.ZodArray<
                z.ZodEnum<{
                  cloudflare: 'cloudflare';
                  jsdelivr: 'jsdelivr';
                  unpkg: 'unpkg';
                  'esm.sh': 'esm.sh';
                  skypack: 'skypack';
                }>
              >
            >;
            metadata: z.ZodOptional<
              z.ZodObject<
                {
                  description: z.ZodOptional<z.ZodString>;
                  homepage: z.ZodOptional<z.ZodString>;
                  license: z.ZodOptional<z.ZodString>;
                },
                z.core.$strict
              >
            >;
          },
          z.core.$strict
        >
      >
    >;
    strictMode: z.ZodOptional<z.ZodBoolean>;
    requireIntegrity: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strict
>;
export type DependencyResolverOptionsInput = z.input<typeof dependencyResolverOptionsSchema>;
export type DependencyResolverOptionsOutput = z.output<typeof dependencyResolverOptionsSchema>;
/**
 * Import type enumeration.
 */
export declare const importTypeSchema: z.ZodEnum<{
  default: 'default';
  named: 'named';
  namespace: 'namespace';
  'side-effect': 'side-effect';
  dynamic: 'dynamic';
}>;
/**
 * Schema for a parsed import statement.
 */
export declare const parsedImportSchema: z.ZodObject<
  {
    statement: z.ZodString;
    specifier: z.ZodString;
    type: z.ZodEnum<{
      default: 'default';
      named: 'named';
      namespace: 'namespace';
      'side-effect': 'side-effect';
      dynamic: 'dynamic';
    }>;
    namedImports: z.ZodOptional<z.ZodArray<z.ZodString>>;
    defaultImport: z.ZodOptional<z.ZodString>;
    namespaceImport: z.ZodOptional<z.ZodString>;
    line: z.ZodNumber;
    column: z.ZodNumber;
  },
  z.core.$strict
>;
export type ParsedImportInput = z.input<typeof parsedImportSchema>;
export type ParsedImportOutput = z.output<typeof parsedImportSchema>;
/**
 * Schema for parsed import results.
 */
export declare const parsedImportResultSchema: z.ZodObject<
  {
    imports: z.ZodArray<
      z.ZodObject<
        {
          statement: z.ZodString;
          specifier: z.ZodString;
          type: z.ZodEnum<{
            default: 'default';
            named: 'named';
            namespace: 'namespace';
            'side-effect': 'side-effect';
            dynamic: 'dynamic';
          }>;
          namedImports: z.ZodOptional<z.ZodArray<z.ZodString>>;
          defaultImport: z.ZodOptional<z.ZodString>;
          namespaceImport: z.ZodOptional<z.ZodString>;
          line: z.ZodNumber;
          column: z.ZodNumber;
        },
        z.core.$strict
      >
    >;
    externalImports: z.ZodArray<
      z.ZodObject<
        {
          statement: z.ZodString;
          specifier: z.ZodString;
          type: z.ZodEnum<{
            default: 'default';
            named: 'named';
            namespace: 'namespace';
            'side-effect': 'side-effect';
            dynamic: 'dynamic';
          }>;
          namedImports: z.ZodOptional<z.ZodArray<z.ZodString>>;
          defaultImport: z.ZodOptional<z.ZodString>;
          namespaceImport: z.ZodOptional<z.ZodString>;
          line: z.ZodNumber;
          column: z.ZodNumber;
        },
        z.core.$strict
      >
    >;
    relativeImports: z.ZodArray<
      z.ZodObject<
        {
          statement: z.ZodString;
          specifier: z.ZodString;
          type: z.ZodEnum<{
            default: 'default';
            named: 'named';
            namespace: 'namespace';
            'side-effect': 'side-effect';
            dynamic: 'dynamic';
          }>;
          namedImports: z.ZodOptional<z.ZodArray<z.ZodString>>;
          defaultImport: z.ZodOptional<z.ZodString>;
          namespaceImport: z.ZodOptional<z.ZodString>;
          line: z.ZodNumber;
          column: z.ZodNumber;
        },
        z.core.$strict
      >
    >;
    externalPackages: z.ZodArray<z.ZodString>;
  },
  z.core.$strict
>;
export type ParsedImportResultInput = z.input<typeof parsedImportResultSchema>;
export type ParsedImportResultOutput = z.output<typeof parsedImportResultSchema>;
/**
 * Schema for cache statistics.
 */
export declare const cacheStatsSchema: z.ZodObject<
  {
    entries: z.ZodNumber;
    totalSize: z.ZodNumber;
    hits: z.ZodNumber;
    misses: z.ZodNumber;
    hitRate: z.ZodNumber;
  },
  z.core.$strict
>;
export type CacheStatsInput = z.input<typeof cacheStatsSchema>;
export type CacheStatsOutput = z.output<typeof cacheStatsSchema>;
/**
 * Safe parse result type.
 */
export type SafeParseResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: z.ZodError;
    };
/**
 * Validate a CDN dependency configuration.
 *
 * @param data - Data to validate
 * @returns Validated CDN dependency or throws ZodError
 */
export declare function validateCDNDependency(data: unknown): CDNDependencyOutput;
/**
 * Safely validate a CDN dependency configuration.
 *
 * @param data - Data to validate
 * @returns Safe parse result with success flag
 */
export declare function safeParseCDNDependency(data: unknown): SafeParseResult<CDNDependencyOutput>;
/**
 * Validate file template configuration.
 *
 * @param data - Data to validate
 * @returns Validated file template config or throws ZodError
 */
export declare function validateFileTemplateConfig(data: unknown): FileTemplateConfigOutput;
/**
 * Safely validate file template configuration.
 *
 * @param data - Data to validate
 * @returns Safe parse result with success flag
 */
export declare function safeParseFileTemplateConfig(data: unknown): SafeParseResult<FileTemplateConfigOutput>;
/**
 * Validate a component build manifest.
 *
 * @param data - Data to validate
 * @returns Validated manifest or throws ZodError
 */
export declare function validateBuildManifest(data: unknown): ComponentBuildManifestOutput;
/**
 * Safely validate a component build manifest.
 *
 * @param data - Data to validate
 * @returns Safe parse result with success flag
 */
export declare function safeParseBuildManifest(data: unknown): SafeParseResult<ComponentBuildManifestOutput>;
//# sourceMappingURL=schemas.d.ts.map
