import { readFile, fileExists } from '@frontmcp/utils';
import * as path from 'path';
import { z } from 'zod';

/**
 * Parse a .env file content into key-value pairs.
 * Follows dotenv parsing rules:
 * - Supports KEY=value format
 * - Supports quoted values (single and double quotes)
 * - Supports # comments
 * - Trims whitespace
 * - Expands escape sequences in double-quoted values (\n, \r, \t)
 *
 * @param content - Raw content of a .env file
 * @returns Record of key-value pairs
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Match KEY=value pattern (KEY can contain letters, numbers, underscores)
    const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
    if (match) {
      const key = match[1];
      let value = match[2].trim();
      const originalValue = value;

      // Handle quoted values
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Expand escape sequences in double-quoted values
      // Order matters: handle double-backslash first (as a placeholder),
      // then other escapes, then convert placeholder back
      if (originalValue.startsWith('"')) {
        // Use a unique placeholder for escaped backslashes
        const PLACEHOLDER = '\x00BACKSLASH\x00';
        value = value
          .replace(/\\\\/g, PLACEHOLDER)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(new RegExp(PLACEHOLDER, 'g'), '\\');
      }

      result[key] = value;
    }
  }

  return result;
}

/**
 * Load environment variables from .env files.
 * Follows NestJS-style priority: .env.local overrides .env
 *
 * @param basePath - Base directory to resolve files from
 * @param envPath - Path to base .env file (relative to basePath)
 * @param localEnvPath - Path to local override file (relative to basePath)
 * @returns Record of merged environment variables
 */
export async function loadEnvFiles(
  basePath = process.cwd(),
  envPath = '.env',
  localEnvPath = '.env.local',
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  // Load base .env file
  const envFile = path.resolve(basePath, envPath);
  if (await fileExists(envFile)) {
    const content = await readFile(envFile);
    Object.assign(result, parseEnvContent(content));
  }

  // Load .env.local (overrides base)
  const localFile = path.resolve(basePath, localEnvPath);
  if (await fileExists(localFile)) {
    const content = await readFile(localFile);
    Object.assign(result, parseEnvContent(content));
  }

  return result;
}

/**
 * Synchronously parse environment content.
 * Use this for CLI where async is not needed.
 */
export function parseEnvContentSync(content: string): Record<string, string> {
  return parseEnvContent(content);
}

/**
 * Populate process.env with loaded values.
 * By default, does not override existing values.
 *
 * @param env - Environment variables to populate
 * @param override - Whether to override existing values (default: false)
 */
export function populateProcessEnv(env: Record<string, string>, override = false): void {
  for (const [key, value] of Object.entries(env)) {
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema-based env mapping (convict-style)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keys that are unsafe to use in nested object paths.
 * These can be exploited for prototype pollution attacks.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Check if a key is safe to use in nested object paths.
 * Blocks prototype pollution attack vectors.
 */
function isSafeKey(key: string): boolean {
  return !UNSAFE_KEYS.has(key);
}

/**
 * Convert a schema path to environment variable name.
 * Example: 'database.url' -> 'DATABASE_URL'
 */
export function pathToEnvKey(path: string): string {
  return path.toUpperCase().replace(/\./g, '_');
}

/**
 * Set a value at a nested path in an object.
 * Example: setNestedValue({}, 'database.url', 'x') -> { database: { url: 'x' } }
 *
 * @security Validates keys to prevent prototype pollution attacks.
 * Paths containing __proto__, constructor, or prototype are silently ignored.
 * Uses Object.create(null) for new nested objects to avoid prototype chain.
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');

  // Validate all keys before setting to prevent prototype pollution
  for (const key of keys) {
    if (!isSafeKey(key)) {
      return; // Silently skip unsafe paths
    }
  }

  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    // Explicit inline check to satisfy CodeQL flow analysis
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return;
    }
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      // Use Object.create(null) to create object without prototype chain
      current[key] = Object.create(null);
    }
    current = current[key] as Record<string, unknown>;
  }

  const finalKey = keys[keys.length - 1];
  // Explicit inline check for final key assignment
  if (finalKey === '__proto__' || finalKey === 'constructor' || finalKey === 'prototype') {
    return;
  }
  current[finalKey] = value;
}

/**
 * Get a value from a nested path in an object.
 * Example: getNestedValue({ database: { url: 'x' } }, 'database.url') -> 'x'
 *
 * @security Validates keys to prevent prototype pollution attacks.
 * Paths containing __proto__, constructor, or prototype return undefined.
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');

  // Validate all keys to prevent prototype pollution
  for (const key of keys) {
    if (!isSafeKey(key)) {
      return undefined; // Block unsafe paths
    }
  }

  let current: unknown = obj;

  for (const key of keys) {
    // Explicit inline check to satisfy CodeQL flow analysis
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return undefined;
    }
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Extract all leaf paths from a Zod schema.
 * Handles ZodDefault, ZodOptional, and other wrapper types.
 *
 * Example: z.object({ database: z.object({ url: z.string() }) }) -> ['database.url']
 */
export function extractSchemaPaths(schema: z.ZodType, prefix = ''): string[] {
  // Unwrap default, optional, nullable, etc.
  const unwrapped = unwrapZodType(schema);

  // Check if it's an object schema by looking for 'shape' property
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (unwrapped as any)._zod?.def ?? (unwrapped as any)._def;
  const shape = def?.shape ?? def?.properties;

  if (shape && typeof shape === 'object') {
    const paths: string[] = [];

    for (const key in shape) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      const fieldSchema = shape[key] as z.ZodType;
      const unwrappedField = unwrapZodType(fieldSchema);

      // Check if unwrapped field has a shape (is an object)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fieldDef = (unwrappedField as any)._zod?.def ?? (unwrappedField as any)._def;
      const fieldShape = fieldDef?.shape ?? fieldDef?.properties;

      if (fieldShape && typeof fieldShape === 'object') {
        // Nested object - recurse and also include the parent path
        paths.push(fieldPath);
        paths.push(...extractSchemaPaths(fieldSchema, fieldPath));
      } else {
        // Leaf node
        paths.push(fieldPath);
      }
    }

    return paths;
  }

  return prefix ? [prefix] : [];
}

/**
 * Unwrap Zod wrapper types to get the inner type.
 * Works with both Zod v3 and v4.
 */
function unwrapZodType(schema: z.ZodType): z.ZodType {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as any)._zod?.def ?? (schema as any)._def;

  if (!def) return schema;

  // Handle ZodDefault
  if (def.innerType) {
    return unwrapZodType(def.innerType);
  }

  // Handle ZodEffects (refine, transform)
  if (def.schema) {
    return unwrapZodType(def.schema);
  }

  return schema;
}

/**
 * Map flat environment variables to nested config object.
 * Uses schema paths to determine which env vars to look for.
 *
 * @param env - Flat environment variables (e.g., { DATABASE_URL: '...' })
 * @param paths - Schema paths to look for (e.g., ['database.url', 'database.port'])
 * @returns Nested config object
 */
export function mapEnvToNestedConfig(
  env: Record<string, string | undefined>,
  paths: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const path of paths) {
    const envKey = pathToEnvKey(path);
    const value = env[envKey];

    if (value !== undefined) {
      setNestedValue(result, path, value);
    }
  }

  return result;
}
