/**
 * @file attribute-parser.ts
 * @description Attribute parsing utilities for FrontMCP Web Components.
 *
 * Converts HTML attributes to typed options for component rendering.
 * Handles boolean attributes, HTMX attributes, and kebab-to-camel case conversion.
 *
 * @example Attribute parsing
 * ```typescript
 * // variant="primary" -> { variant: 'primary' }
 * // disabled -> { disabled: true }
 * // disabled="false" -> { disabled: false }
 * // hx-get="/api" -> { htmx: { get: '/api' } }
 * ```
 *
 * @module @frontmcp/ui/web-components/core/attribute-parser
 */

import type { ZodSchema } from 'zod';

/**
 * Result of parsing an attribute value
 */
export interface ParsedAttribute {
  /** The option key (camelCase) */
  key: string | null;
  /** The parsed value */
  value: unknown;
  /** Whether this is a nested htmx option */
  isHtmx?: boolean;
  /** Whether this is a data attribute */
  isData?: boolean;
}

/**
 * Parse an HTML attribute into a typed option value.
 *
 * Attribute naming conventions:
 * - Simple: `variant="primary"` -> `{ variant: 'primary' }`
 * - Boolean: `disabled` -> `{ disabled: true }`
 * - Boolean false: `disabled="false"` -> `{ disabled: false }`
 * - HTMX: `hx-get="/api"` -> `{ htmx: { get: '/api' } }`
 * - Data: `data-foo="bar"` -> `{ data: { foo: 'bar' } }`
 *
 * @param attrName - The attribute name (kebab-case)
 * @param value - The attribute value (null for boolean attributes)
 * @returns Parsed attribute with key and typed value
 */
export function parseAttributeValue(attrName: string, value: string | null): ParsedAttribute {
  // Skip internal fmcp attributes
  if (attrName.startsWith('data-fmcp-')) {
    return { key: null, value: undefined };
  }

  // Handle HTMX attributes (hx-* -> htmx.*)
  if (attrName.startsWith('hx-')) {
    const htmxKey = attrName.slice(3); // Remove 'hx-'
    return {
      key: htmxKey,
      value: value ?? '',
      isHtmx: true,
    };
  }

  // Handle data attributes (data-* -> data.*)
  if (attrName.startsWith('data-')) {
    const dataKey = attrName.slice(5); // Remove 'data-'
    return {
      key: dataKey,
      value: value ?? '',
      isData: true,
    };
  }

  // Convert kebab-case to camelCase
  const camelName = kebabToCamel(attrName);

  // Handle boolean attributes (presence = true)
  if (value === null || value === '') {
    return { key: camelName, value: true };
  }

  // Handle explicit boolean strings
  if (value === 'true') {
    return { key: camelName, value: true };
  }
  if (value === 'false') {
    return { key: camelName, value: false };
  }

  // Handle numeric values
  const numValue = Number(value);
  if (!isNaN(numValue) && value.trim() !== '') {
    return { key: camelName, value: numValue };
  }

  // Handle JSON values (for complex objects)
  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      return { key: camelName, value: JSON.parse(value) };
    } catch {
      // Not valid JSON, treat as string
    }
  }

  // Default: string value
  return { key: camelName, value };
}

/**
 * Convert kebab-case to camelCase.
 *
 * @param str - Kebab-case string
 * @returns camelCase string
 *
 * @example
 * kebabToCamel('full-width') // 'fullWidth'
 * kebabToCamel('icon-before') // 'iconBefore'
 */
export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert camelCase to kebab-case.
 *
 * @param str - camelCase string
 * @returns kebab-case string
 *
 * @example
 * camelToKebab('fullWidth') // 'full-width'
 * camelToKebab('iconBefore') // 'icon-before'
 */
export function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Extract observable attribute names from a Zod schema.
 *
 * @param schema - Zod schema to extract keys from
 * @returns Array of kebab-case attribute names
 */
export function getObservedAttributesFromSchema<T>(schema: ZodSchema<T>): string[] {
  const attributes: string[] = [];

  // Extract keys from schema shape (Zod object schemas have a shape property)
  const schemaAny = schema as { shape?: Record<string, unknown> };
  if (schemaAny.shape) {
    for (const key of Object.keys(schemaAny.shape)) {
      // Convert camelCase keys to kebab-case attributes
      attributes.push(camelToKebab(key));
    }
  }

  // Always include common attributes
  const commonAttrs = ['class', 'id', 'style'];
  attributes.push(...commonAttrs);

  // Include HTMX attributes
  const htmxAttrs = [
    'hx-get',
    'hx-post',
    'hx-put',
    'hx-delete',
    'hx-patch',
    'hx-target',
    'hx-swap',
    'hx-trigger',
    'hx-confirm',
    'hx-indicator',
    'hx-push-url',
    'hx-select',
    'hx-vals',
  ];
  attributes.push(...htmxAttrs);

  // Deduplicate
  return [...new Set(attributes)];
}

/**
 * Merge a parsed attribute into an options object.
 *
 * Handles nested objects for htmx and data attributes.
 *
 * @param options - Current options object
 * @param parsed - Parsed attribute result
 * @returns Updated options object
 */
export function mergeAttributeIntoOptions<T>(options: Partial<T>, parsed: ParsedAttribute): Partial<T> {
  if (parsed.key === null || parsed.value === undefined) {
    return options;
  }

  const result = { ...options } as Record<string, unknown>;

  if (parsed.isHtmx) {
    // Merge into htmx nested object
    const htmx = (result['htmx'] as Record<string, unknown>) ?? {};
    htmx[parsed.key] = parsed.value;
    result['htmx'] = htmx;
  } else if (parsed.isData) {
    // Merge into data nested object
    const data = (result['data'] as Record<string, string>) ?? {};
    data[parsed.key] = String(parsed.value);
    result['data'] = data;
  } else {
    // Direct assignment
    result[parsed.key] = parsed.value;
  }

  return result as Partial<T>;
}
