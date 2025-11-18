// file: libs/sdk/src/tool/tool.instance.ts

import {
  EntryOwnerRef,
  ToolCallArgs,
  ToolCallExtra,
  ToolContext,
  ToolCtorArgs,
  ToolEntry,
  ToolFunctionTokenRecord,
  ToolInputType,
  ToolKind,
  ToolOutputType,
  ToolRecord,
  ParsedToolResult,
} from '../common';
import ProviderRegistry from '../provider/provider.registry';
import { z, ZodString, ZodNumber, ZodBoolean, ZodBigInt, ZodDate } from 'zod';
import HookRegistry from '../hooks/hook.registry';
import { Scope } from '../scope';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import type {
  TextContent,
  ImageContent,
  AudioContent,
  ResourceLink,
  EmbeddedResource,
  ContentBlock,
} from '@modelcontextprotocol/sdk/types.js';

export class ToolInstance<In extends ToolInputType, Out extends ToolOutputType> extends ToolEntry<In, Out> {
  private readonly providers: ProviderRegistry;
  readonly name: string;
  readonly scope: Scope;
  readonly hooks: HookRegistry;

  constructor(record: ToolRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this.providers = providers;
    this.name = record.metadata.id || record.metadata.name;
    this.scope = this.providers.getActiveScope();
    this.hooks = this.scope.providers.getHooksRegistry();

    const schema: any = record.metadata.inputSchema;
    // Support both Zod objects and raw ZodRawShape
    this.inputSchema = schema && typeof schema.parse === 'function' ? schema : z.object(schema ?? {});
    // Whatever JSON schema representation you’re storing for inputs
    this.inputJsonSchema = (record.metadata as any).inputJsonSchema;

    // IMPORTANT: keep the *raw* outputSchema (string literal, zod, raw shape, or array)
    this.outputSchema = (record.metadata as any).outputSchema;

    this.ready = this.initialize();
  }

  protected async initialize() {
    const hooks = normalizeHooksFromCls(this.record.provide).filter(
      (hook) => hook.metadata.flow === 'tools:call-tool' || hook.metadata.flow === 'tools:list-tools',
    );
    if (hooks.length > 0) {
      await this.hooks.registerHooks(true, ...hooks);
    }
    return Promise.resolve();
  }

  getMetadata() {
    return this.record.metadata;
  }

  /**
   * Expose the raw metadata.outputSchema through the wrapper.
   * This is what you'll later turn into MCP JSON Schema for tools/list.
   */
  override getOutputSchema() {
    return this.outputSchema;
  }

  override create(input: ToolCallArgs, ctx: ToolCallExtra): ToolContext<In, Out> {
    const metadata = this.metadata;
    const providers = this.providers;
    const scope = this.providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = ctx.authInfo;

    const toolCtorArgs: ToolCtorArgs<In> = {
      metadata,
      input: input as In,
      providers,
      logger,
      authInfo,
    };
    switch (this.record.kind) {
      case ToolKind.CLASS_TOKEN:
        return new this.record.provide(toolCtorArgs);
      case ToolKind.FUNCTION:
        return new FunctionToolContext<In, Out>(this.record, toolCtorArgs);
    }
  }

  /**
   * Turn the raw tool function result into an MCP-compliant CallToolResult:
   *   - `content`: list of ContentBlocks (text / image / audio / resource / resource_link)
   *   - `structuredContent`: sanitized JSON when outputSchema is "json-like"
   *
   * Rules:
   *   - If outputSchema is a JS array → multiple content items, each with its own type.
   *   - Primitive → stringifies into a TextContent block.
   *   - image/audio/resource/resource_link → passed through as-is.
   *   - JSON / structured → JSON.stringify for text, and full sanitized JSON in structuredContent.
   */
  override parseOutput(raw: Out): ParsedToolResult {
    const descriptor = this.outputSchema as any;

    return buildParsedToolResult(descriptor, raw);
  }
}

class FunctionToolContext<In extends object = any, Out = any> extends ToolContext<In, Out> {
  constructor(private readonly record: ToolFunctionTokenRecord, args: ToolCtorArgs<In>) {
    super(args);
  }

  execute(input: In): Promise<Out> {
    return this.record.provide(input, this);
  }
}

// ---------------------------------------------------------------------------
// Helper logic for parsing outputs based on outputSchema
// ---------------------------------------------------------------------------

function buildParsedToolResult(descriptor: any, raw: unknown): ParsedToolResult {
  const content: ContentBlock[] = [];
  let hasJsonStructured = false;

  // No outputSchema → the best effort: treat the result as structured JSON and text fallback
  if (!descriptor) {
    const sanitized = sanitizeForJson(raw);
    content.push(makeJsonTextContent(sanitized));
    return {
      content,
      structuredContent: sanitized,
    };
  }

  if (Array.isArray(descriptor)) {
    // Multiple content items; expect raw to be an array of the same length.
    const values = Array.isArray(raw) ? raw : [raw];

    descriptor.forEach((singleDescriptor: any, idx: number) => {
      const value = values[idx];
      const { blocks, isJson } = parseSingleValue(singleDescriptor, value);
      content.push(...blocks);
      if (isJson) {
        hasJsonStructured = true;
      }
    });
  } else {
    const { blocks, isJson } = parseSingleValue(descriptor, raw);
    content.push(...blocks);
    hasJsonStructured = isJson;
  }

  const result: ParsedToolResult = { content };

  // If any schema entry is JSON-like, expose the *whole* raw value as structuredContent.
  if (hasJsonStructured) {
    result.structuredContent = sanitizeForJson(raw);
  }

  return result;
}

/**
 * Parse a single schema descriptor + value into one or more ContentBlocks.
 *
 * Returns:
 *   - blocks: content blocks to append
 *   - isJson: whether this descriptor should trigger structuredContent
 */
function parseSingleValue(descriptor: any, value: unknown): { blocks: ContentBlock[]; isJson: boolean } {
  // Literal primitives + special content types
  if (typeof descriptor === 'string') {
    switch (descriptor) {
      case 'string':
      case 'number':
      case 'boolean':
      case 'date':
        return {
          blocks: [makePrimitiveTextContent(value)],
          isJson: false,
        };

      case 'image':
        return { blocks: toContentArray<ImageContent>('image', value), isJson: false };

      case 'audio':
        return { blocks: toContentArray<AudioContent>('audio', value), isJson: false };

      case 'resource':
        return {
          blocks: toContentArray<EmbeddedResource>('resource', value),
          isJson: false,
        };

      case 'resource_link':
        return {
          blocks: toContentArray<ResourceLink>('resource_link', value),
          isJson: false,
        };

      default:
        // Unknown literal: just stringify as text
        return {
          blocks: [makePrimitiveTextContent(value)],
          isJson: false,
        };
    }
  }

  // Zod primitive → treat as primitive text
  if (
    descriptor instanceof ZodString ||
    descriptor instanceof ZodNumber ||
    descriptor instanceof ZodBoolean ||
    descriptor instanceof ZodBigInt ||
    descriptor instanceof ZodDate
  ) {
    return {
      blocks: [makePrimitiveTextContent(value)],
      isJson: false,
    };
  }

  // Anything else (Zod object/array/union, ZodRawShape, plain object) → JSON/structured
  const sanitized = sanitizeForJson(value);
  return {
    blocks: [makeJsonTextContent(sanitized)],
    isJson: true,
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
    text = JSON.stringify(jsonValue, null, 2);
  } catch {
    text = jsonValue == null ? '' : String(jsonValue);
  }
  return { type: 'text', text };
}

/**
 * Normalize any `value` into an array of content objects with the given MCP `type`.
 * If `value` is already a single content object (with a matching type), it’s wrapped.
 * If it's an array, every element is assumed to already be a content object.
 */
function toContentArray<T extends ContentBlock>(expectedType: T['type'], value: unknown): ContentBlock[] {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((v) => v as T);
  }

  if (value && typeof value === 'object' && (value as any).type === expectedType) {
    return [value as T];
  }

  // If the value is null/undefined or doesn't match, we just skip it.
  return [];
}

/**
 * Sanitize arbitrary JS values into JSON-safe objects suitable for:
 *   - MCP `structuredContent`
 *   - JSON.stringify without circular reference errors
 *
 * Rules:
 *   - Drop functions and symbols.
 *   - BigInt → string.
 *   - Date → ISO string.
 *   - Error → { name, message, stack }.
 *   - Map → plain object.
 *   - Set → array.
 *   - Protect against circular references via WeakSet.
 */
function sanitizeForJson(value: unknown): unknown {
  const seen = new WeakSet<object>();

  const replacer = (_key: string, val: any) => {
    if (typeof val === 'function' || typeof val === 'symbol') {
      return undefined;
    }

    if (typeof val === 'bigint') {
      return val.toString();
    }

    if (val instanceof Date) {
      return val.toISOString();
    }

    if (val instanceof Error) {
      return {
        name: val.name,
        message: val.message,
        stack: val.stack,
      };
    }

    if (val instanceof Map) {
      return Object.fromEntries(val);
    }

    if (val instanceof Set) {
      return Array.from(val);
    }

    if (val && typeof val === 'object') {
      if (seen.has(val)) {
        // Drop circular references
        return undefined;
      }
      seen.add(val);
    }

    return val;
  };

  try {
    const json = JSON.stringify(value, replacer);
    if (json === undefined) return undefined;
    return JSON.parse(json);
  } catch {
    // Last-resort fallback: readable string
    return value == null ? undefined : String(value);
  }
}
