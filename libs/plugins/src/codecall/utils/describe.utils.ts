// file: libs/plugins/src/codecall/utils/describe.utils.ts

import type { JSONSchema } from 'zod/v4/core';

/** JSON Schema type from Zod v4 */
type JsonSchema = JSONSchema.JSONSchema;

/**
 * Tool example for describe output
 */
export interface ToolUsageExample {
  description: string;
  code: string;
}

/**
 * Generate a TypeScript-like function signature from a JSON Schema.
 *
 * @example
 * Input: { type: 'object', properties: { id: { type: 'string' }, limit: { type: 'number' } }, required: ['id'] }
 * Output: "(id: string, limit?: number) => unknown"
 */
export function jsonSchemaToSignature(toolName: string, inputSchema?: JsonSchema, outputSchema?: JsonSchema): string {
  const inputPart = schemaToTypeString(inputSchema, 'input');
  const outputPart = schemaToTypeString(outputSchema, 'output');

  return `callTool('${toolName}', ${inputPart}) => Promise<${outputPart}>`;
}

/**
 * Convert JSON Schema to a TypeScript-like type string.
 */
function schemaToTypeString(schema: JsonSchema | undefined | null, context: 'input' | 'output'): string {
  if (!schema) {
    return context === 'input' ? '{}' : 'unknown';
  }

  if (schema.type === 'object' && schema.properties) {
    const props: string[] = [];
    const required = new Set(schema.required || []);

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (typeof propSchema === 'boolean') continue;

      const isRequired = required.has(key);
      const typeStr = getTypeString(propSchema);
      props.push(`${key}${isRequired ? '' : '?'}: ${typeStr}`);
    }

    if (props.length === 0) {
      return '{}';
    }

    return `{ ${props.join(', ')} }`;
  }

  return getTypeString(schema);
}

/**
 * Get a simple type string for a schema.
 */
function getTypeString(schema: JsonSchema): string {
  if (schema.enum) {
    return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  }

  if (schema.type) {
    if (Array.isArray(schema.type)) {
      return schema.type.join(' | ');
    }

    switch (schema.type) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'null':
        return 'null';
      case 'array':
        if (schema.items && typeof schema.items !== 'boolean') {
          return `${getTypeString(schema.items as JsonSchema)}[]`;
        }
        return 'unknown[]';
      case 'object':
        if (schema.properties) {
          return schemaToTypeString(schema, 'input');
        }
        return 'Record<string, unknown>';
      default:
        return 'unknown';
    }
  }

  if (schema.oneOf || schema.anyOf) {
    // We've confirmed at least one is truthy, so use non-null assertion
    const options = (schema.oneOf ?? schema.anyOf)!;
    return options
      .filter((s): s is JsonSchema => typeof s !== 'boolean')
      .map((s) => getTypeString(s))
      .join(' | ');
  }

  return 'unknown';
}

/**
 * Generate a natural language summary of a schema.
 */
export function jsonSchemaToNaturalLanguage(
  schema: JsonSchema | undefined | null,
  direction: 'input' | 'output',
): string {
  if (!schema) {
    return direction === 'input' ? 'No input parameters' : 'Returns unspecified data';
  }

  if (schema.description) {
    return schema.description;
  }

  if (schema.type === 'object' && schema.properties) {
    const required = new Set(schema.required || []);
    const props = Object.entries(schema.properties);

    if (props.length === 0) {
      return direction === 'input' ? 'No parameters required' : 'Returns an empty object';
    }

    const requiredProps = props.filter(([key]) => required.has(key));
    const optionalProps = props.filter(([key]) => !required.has(key));

    const parts: string[] = [];

    if (requiredProps.length > 0) {
      parts.push(`Required: ${requiredProps.map(([k]) => k).join(', ')}`);
    }

    if (optionalProps.length > 0) {
      parts.push(`Optional: ${optionalProps.map(([k]) => k).join(', ')}`);
    }

    return parts.join('. ');
  }

  return direction === 'input' ? `Takes a ${schema.type || 'value'}` : `Returns a ${schema.type || 'value'}`;
}

/**
 * Generate a basic usage example for a tool.
 */
export function generateBasicExample(toolName: string, inputSchema?: JsonSchema): ToolUsageExample {
  const params = generateSampleParams(inputSchema);
  const paramsStr = params ? JSON.stringify(params, null, 2) : '{}';

  return {
    description: `Basic usage of ${toolName}`,
    code: `const result = await callTool('${toolName}', ${paramsStr});
return result;`,
  };
}

/**
 * Generate sample parameters from a schema.
 */
function generateSampleParams(schema?: JsonSchema): Record<string, unknown> | null {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return null;
  }

  const params: Record<string, unknown> = {};
  const required = new Set(schema.required || []);

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (typeof propSchema === 'boolean') continue;

    // Only include required params and a couple optional ones for example
    if (!required.has(key)) continue;

    params[key] = getSampleValue(propSchema, key);
  }

  return Object.keys(params).length > 0 ? params : null;
}

/**
 * Generate a sample value for a schema property.
 */
function getSampleValue(schema: JsonSchema, key: string): unknown {
  if (schema.default !== undefined) {
    return schema.default;
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (schema.const !== undefined) {
    return schema.const;
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case 'string':
      // Generate contextual sample based on key name
      if (key.toLowerCase().includes('id')) return 'abc123';
      if (key.toLowerCase().includes('email')) return 'user@example.com';
      if (key.toLowerCase().includes('name')) return 'Example';
      if (key.toLowerCase().includes('url')) return 'https://example.com';
      return 'string';

    case 'number':
    case 'integer':
      if (key.toLowerCase().includes('limit')) return 10;
      if (key.toLowerCase().includes('offset')) return 0;
      if (key.toLowerCase().includes('page')) return 1;
      return 0;

    case 'boolean':
      return true;

    case 'array':
      return [];

    case 'object':
      return {};

    default:
      return null;
  }
}

/**
 * Check if a schema has pagination parameters.
 */
export function hasPaginationParams(schema?: JsonSchema): boolean {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return false;
  }

  const props = Object.keys(schema.properties);
  return props.some((p) => ['limit', 'offset', 'page', 'pageSize', 'cursor'].includes(p.toLowerCase()));
}

/**
 * Check if a schema has filter-like parameters.
 */
export function hasFilterParams(schema?: JsonSchema): boolean {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return false;
  }

  const props = Object.keys(schema.properties);
  return props.some(
    (p) =>
      p.toLowerCase().includes('filter') ||
      p.toLowerCase().includes('query') ||
      p.toLowerCase().includes('search') ||
      p.toLowerCase() === 'status' ||
      p.toLowerCase() === 'type' ||
      p.toLowerCase() === 'role',
  );
}

/**
 * Get filter-like property names from a schema.
 */
export function getFilterProperties(schema?: JsonSchema): string[] {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return [];
  }

  return Object.keys(schema.properties).filter(
    (p) =>
      p.toLowerCase().includes('filter') ||
      p.toLowerCase().includes('query') ||
      p.toLowerCase().includes('search') ||
      p.toLowerCase() === 'status' ||
      p.toLowerCase() === 'type' ||
      p.toLowerCase() === 'role',
  );
}

/**
 * Generate a pagination example for a tool.
 */
export function generatePaginationExample(toolName: string): ToolUsageExample {
  return {
    description: `Pagination example for ${toolName}`,
    code: `// Fetch first page
const page1 = await callTool('${toolName}', { limit: 10, offset: 0 });

// Fetch second page
const page2 = await callTool('${toolName}', { limit: 10, offset: 10 });

// Combine results
return [...page1.items, ...page2.items];`,
  };
}

/**
 * Generate a filter example for a tool.
 */
export function generateFilterExample(toolName: string, filterProp: string): ToolUsageExample {
  return {
    description: `Filter by ${filterProp}`,
    code: `const filtered = await callTool('${toolName}', { ${filterProp}: 'value' });
return filtered.items || filtered;`,
  };
}
