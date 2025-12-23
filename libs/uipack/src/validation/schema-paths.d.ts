/**
 * Schema Path Extractor
 *
 * Extracts valid paths from Zod schemas for template validation.
 *
 * @packageDocumentation
 */
import { z } from 'zod';
/**
 * Information about a path in a schema.
 */
export interface SchemaPath {
  /** The full path (e.g., "output.user.name") */
  path: string;
  /** The Zod type at this path */
  zodType: z.ZodTypeAny;
  /** Whether this path is optional */
  optional: boolean;
  /** Whether this path is nullable */
  nullable: boolean;
  /** Whether this is an array item path (contains []) */
  isArrayItem: boolean;
  /** Description from .describe() if present */
  description?: string;
}
/**
 * Options for path extraction.
 */
export interface ExtractPathsOptions {
  /** Maximum depth to recurse (default: 10) */
  maxDepth?: number;
  /** Include array item paths with [] notation */
  includeArrayItems?: boolean;
}
/**
 * Extract all valid paths from a Zod schema.
 *
 * @param schema - The Zod schema to extract paths from
 * @param prefix - Path prefix (default: "output")
 * @param options - Extraction options
 * @returns Array of schema paths with metadata
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   temperature: z.number(),
 *   user: z.object({
 *     name: z.string(),
 *     email: z.string().optional(),
 *   }),
 * });
 *
 * const paths = extractSchemaPaths(schema, 'output');
 * // [
 * //   { path: 'output', ... },
 * //   { path: 'output.temperature', ... },
 * //   { path: 'output.user', ... },
 * //   { path: 'output.user.name', ... },
 * //   { path: 'output.user.email', optional: true, ... },
 * // ]
 * ```
 */
export declare function extractSchemaPaths(
  schema: z.ZodTypeAny,
  prefix?: string,
  options?: ExtractPathsOptions,
): SchemaPath[];
/**
 * Get just the path strings from a schema.
 *
 * @param schema - The Zod schema
 * @param prefix - Path prefix (default: "output")
 * @returns Set of valid path strings
 */
export declare function getSchemaPathStrings(schema: z.ZodTypeAny, prefix?: string): Set<string>;
/**
 * Check if a path exists in a schema.
 *
 * @param schema - The Zod schema
 * @param path - The path to check
 * @returns true if the path exists
 *
 * @example
 * ```typescript
 * const schema = z.object({ name: z.string() });
 * isValidSchemaPath(schema, 'output.name'); // true
 * isValidSchemaPath(schema, 'output.age');  // false
 * ```
 */
export declare function isValidSchemaPath(schema: z.ZodTypeAny, path: string): boolean;
/**
 * Get the Zod type at a specific path.
 *
 * @param schema - The Zod schema
 * @param path - The path to look up
 * @returns The Zod type or undefined if not found
 */
export declare function getTypeAtPath(schema: z.ZodTypeAny, path: string): z.ZodTypeAny | undefined;
/**
 * Get schema path info at a specific path.
 *
 * @param schema - The Zod schema
 * @param path - The path to look up
 * @returns SchemaPath info or undefined if not found
 */
export declare function getPathInfo(schema: z.ZodTypeAny, path: string): SchemaPath | undefined;
/**
 * Get all field names at the root level of a schema.
 *
 * @param schema - The Zod schema (should be ZodObject)
 * @returns Array of field names
 */
export declare function getRootFieldNames(schema: z.ZodTypeAny): string[];
/**
 * Get a human-readable type description for a path.
 *
 * @param schema - The Zod schema
 * @param path - The path to describe
 * @returns Human-readable type string
 */
export declare function getTypeDescription(schema: z.ZodTypeAny, path: string): string;
//# sourceMappingURL=schema-paths.d.ts.map
