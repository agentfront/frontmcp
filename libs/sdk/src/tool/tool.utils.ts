// file: libs/sdk/src/tool/tool.utils.ts
import {
  ToolMetadata,
  FrontMcpToolTokens,
  ToolType,
  Token,
  ToolRecord,
  ToolKind,
  Type,
  ToolContext,
  ToolEntry,
  extendedToolMetadata,
  ParsedToolResult,
  AgentToolDefinition,
} from '../common';
import { depsOfClass, depsOfFunc, isClass } from '../utils/token.utils';
import { getMetadata } from '../utils/metadata.utils';
import { toStructuredContent } from '../utils/content.utils';
import {
  AudioContent,
  ContentBlock,
  EmbeddedResource,
  ImageContent,
  ResourceLink,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';
import { z, ZodBigInt, ZodBoolean, ZodDate, ZodNumber, ZodString } from 'zod';
import { toJSONSchema } from 'zod/v4';

// Re-export shared naming utilities for backwards compatibility
export {
  type NameCase,
  splitWords,
  toCase,
  sepFor,
  normalizeSegment,
  normalizeProviderId,
  normalizeOwnerPath,
  shortHash,
  ensureMaxLen,
} from '../utils/naming.utils';

// Re-export shared lineage utilities for backwards compatibility
export { ownerKeyOf, qualifiedNameOf } from '../utils/lineage.utils';

export function collectToolMetadata(cls: ToolType): ToolMetadata {
  const extended = getMetadata(extendedToolMetadata, cls);
  const seed = (extended ? { ...extended } : {}) as ToolMetadata;
  return Object.entries(FrontMcpToolTokens).reduce((metadata, [key, token]) => {
    const value = getMetadata(token, cls);
    if (value) {
      return Object.assign(metadata, {
        [key]: value,
      });
    } else {
      return metadata;
    }
  }, seed);
}

export function normalizeTool(item: any): ToolRecord {
  if (
    item &&
    typeof item === 'function' &&
    item[FrontMcpToolTokens.type] === 'function-tool' &&
    item[FrontMcpToolTokens.metadata]
  ) {
    return {
      kind: ToolKind.FUNCTION,
      provide: item(),
      metadata: item[FrontMcpToolTokens.metadata] as ToolMetadata,
    };
  }

  if (isClass(item)) {
    // read McpToolMetadata from class
    const metadata = collectToolMetadata(item);
    return { kind: ToolKind.CLASS_TOKEN, provide: item as Type<ToolContext>, metadata };
  }
  const name = (item as any)?.name ?? String(item);
  throw new Error(`Invalid adapter '${name}'. Expected a class or a adapter object.`);
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - FUNCTION: get function params without the first argument (the tool input)
 * - CLASS_TOKEN: deps come from the class constructor
 */
export function toolDiscoveryDeps(rec: ToolRecord): Token[] {
  switch (rec.kind) {
    case ToolKind.FUNCTION: {
      return depsOfFunc(rec.provide, 'discovery');
    }
    case ToolKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');
  }
}

export function buildParsedToolResult(descriptor: any, raw: unknown): ParsedToolResult {
  const content: ContentBlock[] = [];
  let structuredData: Record<string, any> | undefined;

  // No outputSchema → the best effort: treat the result as structured JSON and text fallback
  if (!descriptor) {
    const structuredContent = toStructuredContent(raw);
    const sanitized = structuredContent ?? raw;
    content.push(makeJsonTextContent(sanitized));
    return { content, structuredContent };
  }

  if (Array.isArray(descriptor)) {
    // Multiple content items; expect raw to be an array of the same length.
    const values = Array.isArray(raw) ? raw : [raw];
    const parsedItems: Array<{ blocks: ContentBlock[]; parsedValue?: any; isPrimitive: boolean }> = [];

    // Parse all items first
    descriptor.forEach((singleDescriptor: any, idx: number) => {
      const value = values[idx];
      const { blocks, parsedValue, isPrimitive } = parseSingleValue(singleDescriptor, value);
      parsedItems.push({ blocks, parsedValue, isPrimitive });
      content.push(...blocks);
    });

    // Check if we have at least one non-primitive item
    const hasNonPrimitive = parsedItems.some((item) => !item.isPrimitive);

    if (hasNonPrimitive && parsedItems.length > 1) {
      // Multiple items with at least one non-string/primitive: use numeric indices
      structuredData = {};
      parsedItems.forEach((item, idx) => {
        if (item.parsedValue !== undefined) {
          structuredData![idx] = item.parsedValue;
        }
      });
    } else if (parsedItems.length === 1 && parsedItems[0].parsedValue !== undefined) {
      // Single item: wrap primitives in {content: value}, use objects directly
      if (parsedItems[0].isPrimitive) {
        structuredData = { content: parsedItems[0].parsedValue };
      } else if (typeof parsedItems[0].parsedValue === 'object' && parsedItems[0].parsedValue !== null) {
        // Non-primitive object (date, json, etc.) - use directly
        structuredData = parsedItems[0].parsedValue;
      } else {
        // Non-primitive but not an object (shouldn't happen, but handle it)
        structuredData = { content: parsedItems[0].parsedValue };
      }
    } else if (hasNonPrimitive) {
      // Multiple items but only one has a value
      structuredData = {};
      parsedItems.forEach((item, idx) => {
        if (item.parsedValue !== undefined) {
          structuredData![idx] = item.parsedValue;
        }
      });
    }
  } else {
    const { blocks, parsedValue, isPrimitive } = parseSingleValue(descriptor, raw);
    content.push(...blocks);

    // Single item: wrap primitives in {content: value}, use objects directly
    if (parsedValue !== undefined) {
      if (isPrimitive) {
        structuredData = { content: parsedValue };
      } else if (typeof parsedValue === 'object' && parsedValue !== null) {
        // Non-primitive object (date, json, etc.) - use directly
        structuredData = parsedValue;
      } else {
        // Non-primitive but not an object (number, boolean, etc.) - wrap it
        structuredData = { content: parsedValue };
      }
    }
  }

  const result: ParsedToolResult = { content };

  // Add structuredContent if we have structured data
  if (structuredData !== undefined) {
    result.structuredContent = structuredData;
  }

  return result;
}

/**
 * Parse a single schema descriptor + value into one or more ContentBlocks.
 *
 * Returns:
 *   - blocks: content blocks to append
 *   - parsedValue: the parsed/validated value (for structuredContent)
 *   - isPrimitive: whether this is a primitive string type
 */
function parseSingleValue(
  descriptor: any,
  value: unknown,
): { blocks: ContentBlock[]; parsedValue?: any; isPrimitive: boolean } {
  // Literal primitives + special content types
  if (typeof descriptor === 'string') {
    switch (descriptor) {
      case 'string':
        return {
          blocks: [makePrimitiveTextContent(value)],
          parsedValue: value,
          isPrimitive: true,
        };

      case 'number': {
        const numValue = typeof value === 'number' ? value : Number(value);
        return {
          blocks: [makePrimitiveTextContent(value)],
          parsedValue: isNaN(numValue) ? null : numValue,
          isPrimitive: false,
        };
      }

      case 'boolean': {
        const boolValue = typeof value === 'boolean' ? value : Boolean(value);
        return {
          blocks: [makePrimitiveTextContent(value)],
          parsedValue: boolValue,
          isPrimitive: false,
        };
      }

      case 'date': {
        let dateValue: Date | null = null;
        if (value instanceof Date) {
          dateValue = value;
        } else if (typeof value === 'string' || typeof value === 'number') {
          const parsed = new Date(value);
          if (!isNaN(parsed.getTime())) {
            dateValue = parsed;
          }
        }

        return {
          blocks: [makePrimitiveTextContent(value)],
          parsedValue: dateValue
            ? {
                iso: dateValue.toISOString(),
                timeInMilli: dateValue.getTime(),
              }
            : null,
          isPrimitive: false,
        };
      }

      case 'image':
        return {
          blocks: toContentArray<ImageContent>('image', value),
          parsedValue: undefined,
          isPrimitive: false,
        };

      case 'audio':
        return {
          blocks: toContentArray<AudioContent>('audio', value),
          parsedValue: undefined,
          isPrimitive: false,
        };

      case 'resource':
        return {
          blocks: toContentArray<EmbeddedResource>('resource', value),
          parsedValue: undefined,
          isPrimitive: false,
        };

      case 'resource_link':
        return {
          blocks: toContentArray<ResourceLink>('resource_link', value),
          parsedValue: undefined,
          isPrimitive: false,
        };

      default:
        // Unknown literal: just stringify as text
        return {
          blocks: [makePrimitiveTextContent(value)],
          parsedValue: value,
          isPrimitive: true,
        };
    }
  }

  // Zod primitives
  if (descriptor instanceof ZodString) {
    return {
      blocks: [makePrimitiveTextContent(value)],
      parsedValue: value,
      isPrimitive: true,
    };
  }

  if (descriptor instanceof ZodNumber) {
    const parseResult = descriptor.safeParse(value);
    const numValue = parseResult.success ? parseResult.data : typeof value === 'number' ? value : Number(value);
    return {
      blocks: [makePrimitiveTextContent(value)],
      parsedValue: isNaN(numValue) ? null : numValue,
      isPrimitive: false,
    };
  }

  if (descriptor instanceof ZodBoolean) {
    const parseResult = descriptor.safeParse(value);
    const boolValue = parseResult.success ? parseResult.data : Boolean(value);
    return {
      blocks: [makePrimitiveTextContent(value)],
      parsedValue: boolValue,
      isPrimitive: false,
    };
  }

  if (descriptor instanceof ZodBigInt) {
    const parseResult = descriptor.safeParse(value);
    const bigIntValue = parseResult.success ? parseResult.data : typeof value === 'bigint' ? value : null;
    return {
      blocks: [makePrimitiveTextContent(value)],
      parsedValue: bigIntValue !== null ? bigIntValue.toString() : null,
      isPrimitive: false,
    };
  }

  if (descriptor instanceof ZodDate) {
    const parseResult = descriptor.safeParse(value);
    const dateValue = parseResult.success ? parseResult.data : value instanceof Date ? value : null;
    return {
      blocks: [makePrimitiveTextContent(value)],
      parsedValue: dateValue
        ? {
            iso: dateValue.toISOString(),
            timeInMilli: dateValue.getTime(),
          }
        : null,
      isPrimitive: false,
    };
  }

  // Anything else (Zod object/array/union, ZodRawShape, plain object) → JSON/structured
  // Use Zod parsing if it's a Zod schema
  let parsedValue: any;

  if (descriptor instanceof z.ZodType) {
    // Use Zod to parse and validate
    const parseResult = descriptor.safeParse(value);
    if (parseResult.success) {
      parsedValue = toStructuredContent(parseResult.data);
    } else {
      // Validation failed, use sanitized raw value
      parsedValue = toStructuredContent(value);
    }
  } else if (typeof descriptor === 'object' && descriptor !== null) {
    // ZodRawShape or plain object - try to create a Zod object schema
    try {
      const schema = z.object(descriptor);
      const parseResult = schema.safeParse(value);
      if (parseResult.success) {
        parsedValue = toStructuredContent(parseResult.data);
      } else {
        parsedValue = toStructuredContent(value);
      }
    } catch {
      // Fallback to sanitized content
      parsedValue = toStructuredContent(value);
    }
  } else {
    parsedValue = toStructuredContent(value);
  }

  return {
    blocks: [makeJsonTextContent(parsedValue)],
    parsedValue,
    isPrimitive: false,
  };
}

function makePrimitiveTextContent(value: unknown): TextContent {
  return {
    type: 'text',
    text: value == null ? '' : String(value),
  };
}

function makeJsonTextContent(jsonValue: unknown): TextContent {
  let text: string;
  try {
    text = JSON.stringify(jsonValue);
  } catch {
    text = jsonValue == null ? '' : String(jsonValue);
  }
  return { type: 'text', text };
}

/**
 * Normalize any `value` into an array of content objects with the given MCP `type`.
 * If `value` is already a single content object (with a matching type), it's wrapped.
 * If it's an array, every element is assumed to already be a content object.
 */
function toContentArray<T extends ContentBlock>(expectedType: T['type'], value: unknown): ContentBlock[] {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((v) => v as T);
  }

  if (value && typeof value === 'object' && (value as Record<string, unknown>)['type'] === expectedType) {
    return [value as T];
  }

  // If the value is null/undefined or doesn't match, we just skip it.
  return [];
}

// ============================================================================
// Tool Definition Utilities for Agents
// ============================================================================

/**
 * Build agent tool definitions from tool entries.
 *
 * Converts `ToolEntry[]` to `AgentToolDefinition[]` format suitable for
 * passing to an LLM adapter. This is a simpler format than full MCP Tool
 * definitions, containing only the information needed by the LLM.
 *
 * @param tools - Array of tool entries from the tool registry
 * @returns Array of agent tool definitions
 *
 * @example
 * ```typescript
 * const tools = scope.tools.getTools(true);
 * const definitions = buildAgentToolDefinitions(tools);
 * ```
 */
export function buildAgentToolDefinitions(tools: ToolEntry[]): AgentToolDefinition[] {
  return tools.map((tool) => {
    // Get the input schema - prefer rawInputSchema (JSON Schema), then convert from tool.inputSchema
    let parameters: Record<string, unknown>;
    if (tool.rawInputSchema) {
      // Already converted to JSON Schema
      parameters = tool.rawInputSchema;
    } else if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
      // tool.inputSchema is a ZodRawShape (extracted .shape from ZodObject in ToolInstance constructor)
      // Convert to JSON Schema using the same approach as tools-list.flow.ts
      try {
        parameters = toJSONSchema(z.object(tool.inputSchema)) as Record<string, unknown>;
      } catch {
        parameters = { type: 'object', properties: {} };
      }
    } else {
      // No schema defined - use empty object schema
      parameters = { type: 'object', properties: {} };
    }

    return {
      name: tool.metadata.id ?? tool.metadata.name,
      description: tool.metadata.description ?? '',
      parameters,
    };
  });
}
