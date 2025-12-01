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
 * Detected intent of a tool based on its name and description.
 */
export type ToolIntent = 'create' | 'list' | 'get' | 'update' | 'delete' | 'search' | 'action' | 'unknown';

/**
 * Patterns for detecting tool intent from the action verb.
 * These patterns use the same synonym groups as the search service.
 */
const INTENT_PATTERNS: Record<Exclude<ToolIntent, 'action' | 'unknown'>, RegExp> = {
  create:
    /^(create|add|new|insert|make|append|register|generate|produce|build|construct|provision|instantiate|define|compose|draft)/i,
  delete: /^(delete|remove|destroy|drop|erase|clear|purge|discard|eliminate|unbind|unregister)/i,
  get: /^(get|fetch|retrieve|read|obtain|load|pull|access|grab|receive)/i,
  update:
    /^(update|edit|modify|change|patch|set|alter|revise|adjust|amend|correct|fix|refresh|sync|upgrade|downgrade)/i,
  list: /^(list|all|index|enumerate|show|display|view|browse|scan|inventory)/i,
  search: /^(search|find|query|lookup|locate|discover|explore|seek|match|filter)/i,
};

/**
 * Detect the intent of a tool from its name.
 * Extracts the action verb from tool names like "users:create" or "orders:list".
 */
export function detectToolIntent(toolName: string, description?: string): ToolIntent {
  // Extract action verb from tool name (e.g., "users:create" -> "create")
  const parts = toolName.split(':');
  const actionPart = parts.length > 1 ? parts[parts.length - 1] : toolName;

  // Check each intent pattern
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS) as [ToolIntent, RegExp][]) {
    if (pattern.test(actionPart)) {
      return intent;
    }
  }

  // Fallback: check description for clues
  if (description) {
    const descLower = description.toLowerCase();
    if (/creates?\s|adding\s|inserts?/i.test(descLower)) return 'create';
    if (/deletes?\s|removes?\s|destroys?/i.test(descLower)) return 'delete';
    if (/gets?\s|fetche?s?\s|retrieves?/i.test(descLower)) return 'get';
    if (/updates?\s|modif(?:y|ies)\s|edits?/i.test(descLower)) return 'update';
    if (/lists?\s|shows?\s|displays?/i.test(descLower)) return 'list';
    if (/search(?:es)?\s|find(?:s)?\s|quer(?:y|ies)/i.test(descLower)) return 'search';
  }

  return 'unknown';
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

// ==========================================
// Intent-Specific Example Generators
// ==========================================

/**
 * Extract entity name from tool name (e.g., "users:create" -> "user")
 */
function extractEntityName(toolName: string): string {
  const parts = toolName.split(':');
  const entity = parts.length > 1 ? parts[0] : toolName;
  // Singularize simple plurals
  return entity.endsWith('s') && !entity.endsWith('ss') ? entity.slice(0, -1) : entity;
}

/**
 * Generate a create example for a tool.
 * Shows required parameters with contextual sample values.
 */
export function generateCreateExample(toolName: string, inputSchema?: JsonSchema): ToolUsageExample {
  const entity = extractEntityName(toolName);
  const params = generateSampleParams(inputSchema);
  const paramsStr = params ? JSON.stringify(params, null, 2) : '{ /* required fields */ }';

  return {
    description: `Create a new ${entity}`,
    code: `const result = await callTool('${toolName}', ${paramsStr});
return result;`,
  };
}

/**
 * Generate a get (retrieve single item) example for a tool.
 */
export function generateGetExample(toolName: string, inputSchema?: JsonSchema): ToolUsageExample {
  const entity = extractEntityName(toolName);
  const idParam = findIdParameter(inputSchema);

  if (idParam) {
    return {
      description: `Get ${entity} by ${idParam}`,
      code: `const ${entity} = await callTool('${toolName}', { ${idParam}: 'abc123' });
return ${entity};`,
    };
  }

  // Fallback to basic example if no ID parameter found
  const params = generateSampleParams(inputSchema);
  const paramsStr = params ? JSON.stringify(params, null, 2) : '{}';

  return {
    description: `Get ${entity} details`,
    code: `const ${entity} = await callTool('${toolName}', ${paramsStr});
return ${entity};`,
  };
}

/**
 * Generate a list example for a tool.
 */
export function generateListExample(toolName: string, inputSchema?: JsonSchema): ToolUsageExample {
  const entity = extractEntityName(toolName);

  return {
    description: `List all ${entity}s`,
    code: `const result = await callTool('${toolName}', {});
return result.items || result;`,
  };
}

/**
 * Generate an update example for a tool.
 */
export function generateUpdateExample(toolName: string, inputSchema?: JsonSchema): ToolUsageExample {
  const entity = extractEntityName(toolName);
  const idParam = findIdParameter(inputSchema);

  // Generate sample update fields (excluding ID fields)
  const updateFields = generateUpdateFields(inputSchema);
  const fieldsStr = updateFields
    ? JSON.stringify(updateFields, null, 2).replace(/\n/g, '\n  ')
    : '{ /* fields to update */ }';

  if (idParam) {
    return {
      description: `Update ${entity} by ${idParam}`,
      code: `const updated = await callTool('${toolName}', {
  ${idParam}: 'abc123',
  ...${fieldsStr}
});
return updated;`,
    };
  }

  return {
    description: `Update ${entity}`,
    code: `const updated = await callTool('${toolName}', ${fieldsStr});
return updated;`,
  };
}

/**
 * Generate a delete example for a tool.
 */
export function generateDeleteExample(toolName: string, inputSchema?: JsonSchema): ToolUsageExample {
  const entity = extractEntityName(toolName);
  const idParam = findIdParameter(inputSchema);

  if (idParam) {
    return {
      description: `Delete ${entity} by ${idParam}`,
      code: `const result = await callTool('${toolName}', { ${idParam}: 'abc123' });
return result;`,
    };
  }

  const params = generateSampleParams(inputSchema);
  const paramsStr = params ? JSON.stringify(params, null, 2) : '{ /* identifier */ }';

  return {
    description: `Delete ${entity}`,
    code: `const result = await callTool('${toolName}', ${paramsStr});
return result;`,
  };
}

/**
 * Generate a search example for a tool.
 */
export function generateSearchExample(toolName: string, inputSchema?: JsonSchema): ToolUsageExample {
  const entity = extractEntityName(toolName);
  const queryParam = findQueryParameter(inputSchema);

  if (queryParam) {
    return {
      description: `Search for ${entity}s`,
      code: `const results = await callTool('${toolName}', { ${queryParam}: 'search term' });
return results.items || results;`,
    };
  }

  return {
    description: `Search for ${entity}s`,
    code: `const results = await callTool('${toolName}', { query: 'search term' });
return results.items || results;`,
  };
}

/**
 * Find an ID-like parameter in the schema.
 */
function findIdParameter(schema?: JsonSchema): string | null {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return null;
  }

  const props = Object.keys(schema.properties);
  const required = new Set(schema.required || []);

  // Prioritize required ID fields
  const idPatterns = ['id', 'Id', 'ID', '_id', 'uuid', 'key'];
  for (const pattern of idPatterns) {
    const found = props.find((p) => (p === pattern || p.endsWith(pattern)) && required.has(p));
    if (found) return found;
  }

  // Fall back to any ID-like field
  for (const pattern of idPatterns) {
    const found = props.find((p) => p === pattern || p.endsWith(pattern));
    if (found) return found;
  }

  return null;
}

/**
 * Find a query-like parameter in the schema.
 */
function findQueryParameter(schema?: JsonSchema): string | null {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return null;
  }

  const props = Object.keys(schema.properties);
  const queryPatterns = ['query', 'search', 'q', 'term', 'keyword', 'filter'];

  for (const pattern of queryPatterns) {
    const found = props.find((p) => p.toLowerCase() === pattern || p.toLowerCase().includes(pattern));
    if (found) return found;
  }

  return null;
}

/**
 * Generate sample update fields (excluding ID-like fields).
 */
function generateUpdateFields(schema?: JsonSchema): Record<string, unknown> | null {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return null;
  }

  const fields: Record<string, unknown> = {};
  const idPatterns = ['id', 'Id', 'ID', '_id', 'uuid', 'key'];

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (typeof propSchema === 'boolean') continue;

    // Skip ID-like fields
    const isIdField = idPatterns.some((p) => key === p || key.endsWith(p));
    if (isIdField) continue;

    // Include a few non-ID fields for the update example
    if (Object.keys(fields).length < 2) {
      fields[key] = getSampleValue(propSchema, key);
    }
  }

  return Object.keys(fields).length > 0 ? fields : null;
}

/**
 * Smart example generator that uses intent detection.
 * This is the main entry point for generating examples.
 */
export function generateSmartExample(
  toolName: string,
  inputSchema?: JsonSchema,
  description?: string,
): ToolUsageExample {
  const intent = detectToolIntent(toolName, description);

  switch (intent) {
    case 'create':
      return generateCreateExample(toolName, inputSchema);
    case 'get':
      return generateGetExample(toolName, inputSchema);
    case 'list':
      // For list tools, still use pagination example if available
      return hasPaginationParams(inputSchema)
        ? generatePaginationExample(toolName)
        : generateListExample(toolName, inputSchema);
    case 'update':
      return generateUpdateExample(toolName, inputSchema);
    case 'delete':
      return generateDeleteExample(toolName, inputSchema);
    case 'search':
      return generateSearchExample(toolName, inputSchema);
    default:
      // Fallback to basic example for unknown intents
      return generateBasicExample(toolName, inputSchema);
  }
}
