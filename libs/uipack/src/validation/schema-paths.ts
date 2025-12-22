/**
 * Schema Path Extractor
 *
 * Extracts valid paths from Zod schemas for template validation.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ============================================
// Types
// ============================================

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

// ============================================
// Core Functions
// ============================================

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
export function extractSchemaPaths(
  schema: z.ZodTypeAny,
  prefix = 'output',
  options: ExtractPathsOptions = {},
): SchemaPath[] {
  const { maxDepth = 10, includeArrayItems = true } = options;
  const paths: SchemaPath[] = [];
  const visited = new Set<string>();

  function recurse(
    currentSchema: z.ZodTypeAny,
    currentPath: string,
    depth: number,
    isOptional: boolean,
    isNullable: boolean,
    isArrayItem: boolean,
  ): void {
    // Prevent infinite recursion
    if (depth > maxDepth) return;

    // Avoid duplicate paths
    const pathKey = `${currentPath}:${depth}`;
    if (visited.has(pathKey)) return;
    visited.add(pathKey);

    // Get description if available
    const description = currentSchema.description;

    // Unwrap effects (refinements, transforms, etc.)
    const innerType = unwrapType(currentSchema);

    // Add current path
    paths.push({
      path: currentPath,
      zodType: currentSchema,
      optional: isOptional,
      nullable: isNullable,
      isArrayItem,
      description,
    });

    // Handle different Zod types
    if (innerType instanceof z.ZodObject) {
      const shape = innerType.shape;
      for (const [key, value] of Object.entries(shape)) {
        const childSchema = value as z.ZodTypeAny;
        const childOptional = isOptional || isOptionalType(childSchema);
        const childNullable = isNullable || isNullableType(childSchema);
        recurse(childSchema, `${currentPath}.${key}`, depth + 1, childOptional, childNullable, false);
      }
    } else if (innerType instanceof z.ZodArray && includeArrayItems) {
      // Add array item path with [] notation
      const itemSchema = innerType.element as z.ZodTypeAny;
      recurse(itemSchema, `${currentPath}.[]`, depth + 1, isOptional, isNullable, true);
    } else if (innerType instanceof z.ZodUnion || innerType instanceof z.ZodDiscriminatedUnion) {
      // Recurse into all union variants
      const options = 'options' in innerType ? innerType.options : [];
      for (const option of options) {
        recurse(option as z.ZodTypeAny, currentPath, depth, isOptional, isNullable, isArrayItem);
      }
    } else if (innerType instanceof z.ZodIntersection) {
      // Handle intersections
      recurse(innerType._def.left as z.ZodTypeAny, currentPath, depth, isOptional, isNullable, isArrayItem);
      recurse(innerType._def.right as z.ZodTypeAny, currentPath, depth, isOptional, isNullable, isArrayItem);
    } else if (innerType instanceof z.ZodRecord) {
      // Records have dynamic keys - add wildcard path
      const valueSchema = innerType._def.valueType as z.ZodTypeAny;
      recurse(valueSchema, `${currentPath}.[]`, depth + 1, isOptional, isNullable, true);
    } else if (innerType instanceof z.ZodTuple) {
      // Handle tuple types
      const items = innerType._def.items as z.ZodTypeAny[];
      items.forEach((item: z.ZodTypeAny, index: number) => {
        recurse(item, `${currentPath}.${index}`, depth + 1, isOptional, isNullable, true);
      });
    }
  }

  recurse(schema, prefix, 0, false, false, false);

  // Deduplicate paths (keep first occurrence)
  const seen = new Set<string>();
  return paths.filter((p) => {
    if (seen.has(p.path)) return false;
    seen.add(p.path);
    return true;
  });
}

/**
 * Unwrap Zod type wrappers (optional, nullable, default, etc.).
 * Compatible with Zod v4.
 */
function unwrapType(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional) {
    return unwrapType(schema.unwrap() as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodNullable) {
    return unwrapType(schema.unwrap() as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodDefault) {
    return unwrapType(schema._def.innerType as z.ZodTypeAny);
  }
  // Handle catch (if innerType exists)
  if (schema instanceof z.ZodCatch && 'innerType' in schema._def) {
    return unwrapType(schema._def.innerType as z.ZodTypeAny);
  }
  return schema;
}

/**
 * Check if a schema is optional.
 */
function isOptionalType(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodOptional) return true;
  if (schema instanceof z.ZodDefault) return true;
  if (schema instanceof z.ZodNullable) return isOptionalType(schema.unwrap() as z.ZodTypeAny);
  return false;
}

/**
 * Check if a schema is nullable.
 */
function isNullableType(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodNullable) return true;
  if (schema instanceof z.ZodOptional) return isNullableType(schema.unwrap() as z.ZodTypeAny);
  return false;
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Get just the path strings from a schema.
 *
 * @param schema - The Zod schema
 * @param prefix - Path prefix (default: "output")
 * @returns Set of valid path strings
 */
export function getSchemaPathStrings(schema: z.ZodTypeAny, prefix = 'output'): Set<string> {
  const paths = extractSchemaPaths(schema, prefix);
  return new Set(paths.map((p) => p.path));
}

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
export function isValidSchemaPath(schema: z.ZodTypeAny, path: string): boolean {
  // Determine prefix from path
  const prefix = path.split('.')[0];
  const paths = getSchemaPathStrings(schema, prefix);

  // Check exact match
  if (paths.has(path)) return true;

  // Check with array wildcard normalization
  // e.g., output.items.0.name -> output.items.[].name
  const normalizedPath = normalizePath(path);
  if (paths.has(normalizedPath)) return true;

  // Check parent paths for array access
  // e.g., output.items.0 should match output.items.[]
  const pathParts = path.split('.');
  for (let i = pathParts.length - 1; i >= 0; i--) {
    const part = pathParts[i];
    if (/^\d+$/.test(part)) {
      // This is a numeric index, check if parent has [] path
      const parentPath = pathParts.slice(0, i).join('.');
      const wildcardPath = `${parentPath}.[]`;
      if (paths.has(wildcardPath)) {
        // Check rest of path after index
        const restPath = pathParts.slice(i + 1).join('.');
        if (restPath) {
          const fullWildcardPath = `${wildcardPath}.${restPath}`;
          const normalizedFullPath = normalizePath(fullWildcardPath);
          if (paths.has(normalizedFullPath)) return true;
        } else {
          return true; // Just array index access
        }
      }
    }
  }

  return false;
}

/**
 * Normalize a path by converting numeric indices to [].
 */
function normalizePath(path: string): string {
  return path
    .replace(/\.\d+\./g, '.[].')
    .replace(/\.\d+$/g, '.[]')
    .replace(/\[\d+\]/g, '.[]');
}

/**
 * Get the Zod type at a specific path.
 *
 * @param schema - The Zod schema
 * @param path - The path to look up
 * @returns The Zod type or undefined if not found
 */
export function getTypeAtPath(schema: z.ZodTypeAny, path: string): z.ZodTypeAny | undefined {
  const prefix = path.split('.')[0];
  const paths = extractSchemaPaths(schema, prefix);

  // Try exact match first
  let schemaPath = paths.find((p) => p.path === path);

  // Try normalized path
  if (!schemaPath) {
    const normalizedPath = normalizePath(path);
    schemaPath = paths.find((p) => p.path === normalizedPath);
  }

  return schemaPath?.zodType;
}

/**
 * Get schema path info at a specific path.
 *
 * @param schema - The Zod schema
 * @param path - The path to look up
 * @returns SchemaPath info or undefined if not found
 */
export function getPathInfo(schema: z.ZodTypeAny, path: string): SchemaPath | undefined {
  const prefix = path.split('.')[0];
  const paths = extractSchemaPaths(schema, prefix);

  // Try exact match first
  let schemaPath = paths.find((p) => p.path === path);

  // Try normalized path
  if (!schemaPath) {
    const normalizedPath = normalizePath(path);
    schemaPath = paths.find((p) => p.path === normalizedPath);
  }

  return schemaPath;
}

/**
 * Get all field names at the root level of a schema.
 *
 * @param schema - The Zod schema (should be ZodObject)
 * @returns Array of field names
 */
export function getRootFieldNames(schema: z.ZodTypeAny): string[] {
  const unwrapped = unwrapType(schema);

  if (unwrapped instanceof z.ZodObject) {
    return Object.keys(unwrapped.shape);
  }

  return [];
}

/**
 * Get a human-readable type description for a path.
 *
 * @param schema - The Zod schema
 * @param path - The path to describe
 * @returns Human-readable type string
 */
export function getTypeDescription(schema: z.ZodTypeAny, path: string): string {
  const zodType = getTypeAtPath(schema, path);
  if (!zodType) return 'unknown';

  return describeZodType(zodType);
}

/**
 * Get a human-readable description of a Zod type.
 */
function describeZodType(schema: z.ZodTypeAny): string {
  const inner = unwrapType(schema);

  if (inner instanceof z.ZodString) return 'string';
  if (inner instanceof z.ZodNumber) return 'number';
  if (inner instanceof z.ZodBoolean) return 'boolean';
  if (inner instanceof z.ZodDate) return 'Date';
  if (inner instanceof z.ZodBigInt) return 'bigint';
  if (inner instanceof z.ZodSymbol) return 'symbol';
  if (inner instanceof z.ZodUndefined) return 'undefined';
  if (inner instanceof z.ZodNull) return 'null';
  if (inner instanceof z.ZodVoid) return 'void';
  if (inner instanceof z.ZodAny) return 'any';
  if (inner instanceof z.ZodUnknown) return 'unknown';
  if (inner instanceof z.ZodNever) return 'never';
  if (inner instanceof z.ZodLiteral) return `literal(${JSON.stringify(inner.value)})`;
  if (inner instanceof z.ZodEnum) return `enum(${inner.options.join(' | ')})`;
  if (inner instanceof z.ZodArray) return `${describeZodType(inner.element as z.ZodTypeAny)}[]`;
  if (inner instanceof z.ZodObject) return 'object';
  if (inner instanceof z.ZodUnion) return 'union';
  if (inner instanceof z.ZodDiscriminatedUnion) return 'discriminatedUnion';
  if (inner instanceof z.ZodIntersection) return 'intersection';
  if (inner instanceof z.ZodTuple) return 'tuple';
  if (inner instanceof z.ZodRecord) return `Record<string, ${describeZodType(inner._def.valueType as z.ZodTypeAny)}>`;
  if (inner instanceof z.ZodMap) return 'Map';
  if (inner instanceof z.ZodSet) return 'Set';
  if (inner instanceof z.ZodFunction) return 'function';
  if (inner instanceof z.ZodPromise) return 'Promise';

  // Handle optional/nullable wrappers
  if (schema instanceof z.ZodOptional) {
    return `${describeZodType(schema.unwrap() as z.ZodTypeAny)}?`;
  }
  if (schema instanceof z.ZodNullable) {
    return `${describeZodType(schema.unwrap() as z.ZodTypeAny)} | null`;
  }

  return 'unknown';
}
