/**
 * Zod schemas for x-frontmcp OpenAPI extension validation.
 *
 * The x-frontmcp extension allows embedding FrontMCP-specific configuration
 * directly in OpenAPI specs. This module provides versioned schema validation
 * to ensure only valid data is used and invalid fields are warned about.
 */

import { z } from 'zod';
import type { FrontMcpLogger } from '@frontmcp/sdk';

/**
 * Current schema version for x-frontmcp extension.
 * Increment when making breaking changes to the schema.
 */
export const FRONTMCP_SCHEMA_VERSION = '1.0' as const;

/**
 * Supported schema versions.
 */
export const SUPPORTED_VERSIONS = ['1.0'] as const;
export type FrontMcpSchemaVersion = (typeof SUPPORTED_VERSIONS)[number];

// ============================================================================
// Annotations Schema (v1.0)
// ============================================================================

/**
 * Tool annotations schema - hints about tool behavior for AI clients.
 */
export const FrontMcpAnnotationsSchema = z.object({
  /** Human-readable title for the tool */
  title: z.string().optional(),
  /** If true, the tool does not modify its environment */
  readOnlyHint: z.boolean().optional(),
  /** If true, the tool may perform destructive updates */
  destructiveHint: z.boolean().optional(),
  /** If true, calling repeatedly with same args has no additional effect */
  idempotentHint: z.boolean().optional(),
  /** If true, tool may interact with external entities */
  openWorldHint: z.boolean().optional(),
});

export type FrontMcpAnnotations = z.infer<typeof FrontMcpAnnotationsSchema>;

// ============================================================================
// Cache Schema (v1.0)
// ============================================================================

/**
 * Cache configuration schema.
 */
export const FrontMcpCacheSchema = z.object({
  /** Time-to-live in seconds for cached responses */
  ttl: z.number().int().positive().optional(),
  /** If true, cache window slides on each access */
  slideWindow: z.boolean().optional(),
});

export type FrontMcpCache = z.infer<typeof FrontMcpCacheSchema>;

// ============================================================================
// CodeCall Schema (v1.0)
// ============================================================================

/**
 * CodeCall plugin configuration schema.
 */
export const FrontMcpCodeCallSchema = z.object({
  /** Whether this tool can be used via CodeCall */
  enabledInCodeCall: z.boolean().optional(),
  /** If true, stays visible in list_tools when CodeCall is active */
  visibleInListTools: z.boolean().optional(),
});

export type FrontMcpCodeCall = z.infer<typeof FrontMcpCodeCallSchema>;

// ============================================================================
// Example Schema (v1.0)
// ============================================================================

/**
 * Tool usage example schema.
 */
export const FrontMcpExampleSchema = z.object({
  /** Description of the example */
  description: z.string(),
  /** Example input values */
  input: z.record(z.string(), z.any()),
  /** Expected output (optional) */
  output: z.any().optional(),
});

export type FrontMcpExample = z.infer<typeof FrontMcpExampleSchema>;

// ============================================================================
// Known Fields for Validation
// ============================================================================

/** Known field names for validation */
const KNOWN_EXTENSION_FIELDS = new Set([
  'version',
  'annotations',
  'cache',
  'codecall',
  'tags',
  'hideFromDiscovery',
  'examples',
]);

const KNOWN_ANNOTATION_FIELDS = new Set([
  'title',
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
]);

const KNOWN_CACHE_FIELDS = new Set(['ttl', 'slideWindow']);
const KNOWN_CODECALL_FIELDS = new Set(['enabledInCodeCall', 'visibleInListTools']);

// ============================================================================
// Validated Extension Type (after parsing)
// ============================================================================

/**
 * Validated x-frontmcp extension data.
 * This is the output after schema validation.
 */
export interface ValidatedFrontMcpExtension {
  version: FrontMcpSchemaVersion;
  annotations?: FrontMcpAnnotations;
  cache?: FrontMcpCache;
  codecall?: FrontMcpCodeCall;
  tags?: string[];
  hideFromDiscovery?: boolean;
  examples?: FrontMcpExample[];
}

// ============================================================================
// Validation Result
// ============================================================================

export interface FrontMcpValidationResult {
  /** Whether validation succeeded (may still have warnings) */
  success: boolean;
  /** Validated data (only valid fields) */
  data: ValidatedFrontMcpExtension | null;
  /** Validation warnings (invalid fields that were ignored) */
  warnings: string[];
}

// ============================================================================
// Schema Validation Functions
// ============================================================================

/**
 * Validate and parse x-frontmcp extension data.
 *
 * This function:
 * 1. Detects the schema version (defaults to current)
 * 2. Validates each field against the appropriate schema
 * 3. Returns only valid fields, ignoring invalid ones
 * 4. Collects warnings for invalid/unknown fields
 *
 * @param rawData - Raw x-frontmcp data from OpenAPI spec
 * @param toolName - Tool name for error context
 * @param logger - Logger for warnings
 * @returns Validation result with valid data and warnings
 */
export function validateFrontMcpExtension(
  rawData: unknown,
  toolName: string,
  logger: FrontMcpLogger,
): FrontMcpValidationResult {
  const warnings: string[] = [];

  // Handle null/undefined
  if (rawData === null || rawData === undefined) {
    return { success: true, data: null, warnings: [] };
  }

  // Must be an object
  if (typeof rawData !== 'object' || Array.isArray(rawData)) {
    warnings.push(`x-frontmcp must be an object, got ${Array.isArray(rawData) ? 'array' : typeof rawData}`);
    logger.warn(`[${toolName}] Invalid x-frontmcp extension: ${warnings[0]}`);
    return { success: false, data: null, warnings };
  }

  const data = rawData as Record<string, unknown>;

  // Detect version
  const version = typeof data['version'] === 'string' ? data['version'] : FRONTMCP_SCHEMA_VERSION;

  // Check if version is supported
  if (!SUPPORTED_VERSIONS.includes(version as FrontMcpSchemaVersion)) {
    warnings.push(`Unsupported x-frontmcp version '${version}'. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}`);
    logger.warn(`[${toolName}] ${warnings[0]}`);
    return { success: false, data: null, warnings };
  }

  // Extract valid fields and collect warnings
  const validData = extractValidFields(data, version, warnings);

  if (warnings.length > 0) {
    logger.warn(`[${toolName}] x-frontmcp extension has invalid fields that were ignored:`);
    warnings.forEach((w) => logger.warn(`  - ${w}`));
  }

  return {
    success: true,
    data: validData,
    warnings,
  };
}

/**
 * Extract valid fields from x-frontmcp data, collecting warnings for invalid fields.
 */
function extractValidFields(
  data: Record<string, unknown>,
  version: string,
  warnings: string[],
): ValidatedFrontMcpExtension {
  const result: ValidatedFrontMcpExtension = {
    version: version as FrontMcpSchemaVersion,
  };

  // Warn about unknown top-level fields
  for (const key of Object.keys(data)) {
    if (!KNOWN_EXTENSION_FIELDS.has(key)) {
      warnings.push(`Unknown field '${key}' in x-frontmcp (will be ignored)`);
    }
  }

  // Validate annotations
  if (data['annotations'] !== undefined) {
    const annotationsResult = FrontMcpAnnotationsSchema.safeParse(data['annotations']);
    if (annotationsResult.success) {
      result.annotations = annotationsResult.data;
    } else {
      const issues = formatZodIssues(annotationsResult.error.issues, 'annotations');
      warnings.push(...issues);
      // Try to extract valid annotation fields
      result.annotations = extractValidAnnotations(data['annotations'], warnings);
    }
  }

  // Validate cache
  if (data['cache'] !== undefined) {
    const cacheResult = FrontMcpCacheSchema.safeParse(data['cache']);
    if (cacheResult.success) {
      result.cache = cacheResult.data;
    } else {
      const issues = formatZodIssues(cacheResult.error.issues, 'cache');
      warnings.push(...issues);
      // Try to extract valid cache fields
      result.cache = extractValidCache(data['cache'], warnings);
    }
  }

  // Validate codecall
  if (data['codecall'] !== undefined) {
    const codecallResult = FrontMcpCodeCallSchema.safeParse(data['codecall']);
    if (codecallResult.success) {
      result.codecall = codecallResult.data;
    } else {
      const issues = formatZodIssues(codecallResult.error.issues, 'codecall');
      warnings.push(...issues);
      // Try to extract valid codecall fields
      result.codecall = extractValidCodeCall(data['codecall'], warnings);
    }
  }

  // Validate tags
  if (data['tags'] !== undefined) {
    const tagsSchema = z.array(z.string());
    const tagsResult = tagsSchema.safeParse(data['tags']);
    if (tagsResult.success) {
      result.tags = tagsResult.data;
    } else {
      warnings.push(`Invalid 'tags': expected array of strings`);
      // Try to extract valid tags
      result.tags = extractValidTags(data['tags']);
    }
  }

  // Validate hideFromDiscovery
  if (data['hideFromDiscovery'] !== undefined) {
    if (typeof data['hideFromDiscovery'] === 'boolean') {
      result.hideFromDiscovery = data['hideFromDiscovery'];
    } else {
      warnings.push(`Invalid 'hideFromDiscovery': expected boolean, got ${typeof data['hideFromDiscovery']}`);
    }
  }

  // Validate examples
  if (data['examples'] !== undefined) {
    const examplesSchema = z.array(FrontMcpExampleSchema);
    const examplesResult = examplesSchema.safeParse(data['examples']);
    if (examplesResult.success) {
      result.examples = examplesResult.data;
    } else {
      warnings.push(`Invalid 'examples': some examples have invalid format`);
      // Try to extract valid examples
      result.examples = extractValidExamples(data['examples'], warnings);
    }
  }

  return result;
}

/**
 * Extract valid annotation fields.
 */
function extractValidAnnotations(data: unknown, warnings: string[]): FrontMcpAnnotations | undefined {
  if (typeof data !== 'object' || data === null) return undefined;

  const obj = data as Record<string, unknown>;
  const result: FrontMcpAnnotations = {};

  for (const field of KNOWN_ANNOTATION_FIELDS) {
    if (obj[field] !== undefined) {
      if (field === 'title' && typeof obj[field] === 'string') {
        result.title = obj[field] as string;
      } else if (field !== 'title' && typeof obj[field] === 'boolean') {
        (result as Record<string, unknown>)[field] = obj[field];
      }
    }
  }

  // Warn about unknown annotation fields
  for (const key of Object.keys(obj)) {
    if (!KNOWN_ANNOTATION_FIELDS.has(key)) {
      warnings.push(`Unknown field 'annotations.${key}' (will be ignored)`);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Extract valid cache fields.
 */
function extractValidCache(data: unknown, warnings: string[]): FrontMcpCache | undefined {
  if (typeof data !== 'object' || data === null) return undefined;

  const obj = data as Record<string, unknown>;
  const result: FrontMcpCache = {};

  if (typeof obj['ttl'] === 'number' && Number.isInteger(obj['ttl']) && obj['ttl'] > 0) {
    result.ttl = obj['ttl'];
  } else if (obj['ttl'] !== undefined) {
    warnings.push(`Invalid 'cache.ttl': expected positive integer`);
  }

  if (typeof obj['slideWindow'] === 'boolean') {
    result.slideWindow = obj['slideWindow'];
  } else if (obj['slideWindow'] !== undefined) {
    warnings.push(`Invalid 'cache.slideWindow': expected boolean`);
  }

  // Warn about unknown cache fields
  for (const key of Object.keys(obj)) {
    if (!KNOWN_CACHE_FIELDS.has(key)) {
      warnings.push(`Unknown field 'cache.${key}' (will be ignored)`);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Extract valid codecall fields.
 */
function extractValidCodeCall(data: unknown, warnings: string[]): FrontMcpCodeCall | undefined {
  if (typeof data !== 'object' || data === null) return undefined;

  const obj = data as Record<string, unknown>;
  const result: FrontMcpCodeCall = {};

  if (typeof obj['enabledInCodeCall'] === 'boolean') {
    result.enabledInCodeCall = obj['enabledInCodeCall'];
  } else if (obj['enabledInCodeCall'] !== undefined) {
    warnings.push(`Invalid 'codecall.enabledInCodeCall': expected boolean`);
  }

  if (typeof obj['visibleInListTools'] === 'boolean') {
    result.visibleInListTools = obj['visibleInListTools'];
  } else if (obj['visibleInListTools'] !== undefined) {
    warnings.push(`Invalid 'codecall.visibleInListTools': expected boolean`);
  }

  // Warn about unknown codecall fields
  for (const key of Object.keys(obj)) {
    if (!KNOWN_CODECALL_FIELDS.has(key)) {
      warnings.push(`Unknown field 'codecall.${key}' (will be ignored)`);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Extract valid tags from array.
 */
function extractValidTags(data: unknown): string[] | undefined {
  if (!Array.isArray(data)) return undefined;

  const validTags = data.filter((item): item is string => typeof item === 'string');
  return validTags.length > 0 ? validTags : undefined;
}

/**
 * Extract valid examples from array.
 */
function extractValidExamples(data: unknown, warnings: string[]): FrontMcpExample[] | undefined {
  if (!Array.isArray(data)) return undefined;

  const validExamples: FrontMcpExample[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const result = FrontMcpExampleSchema.safeParse(item);
    if (result.success) {
      validExamples.push(result.data);
    } else {
      warnings.push(
        `Invalid example at index ${i}: ${formatZodIssues(result.error.issues, `examples[${i}]`).join(', ')}`,
      );
    }
  }

  return validExamples.length > 0 ? validExamples : undefined;
}

/** Zod issue shape for formatting */
interface ZodIssue {
  path: PropertyKey[];
  message: string;
}

/**
 * Format Zod validation issues into readable messages.
 */
function formatZodIssues(issues: ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? `${prefix}.${issue.path.join('.')}` : prefix;
    return `Invalid '${path}': ${issue.message}`;
  });
}
