// file: libs/sdk/src/tool/tool.utils.ts
import {
  ToolMetadata,
  FrontMcpToolTokens,
  ToolType,
  Token,
  ToolRecord,
  ToolKind,
  EntryLineage,
  Type,
  ToolContext,
  extendedToolMetadata,
  ParsedToolResult,
} from '../common';
import { depsOfClass, depsOfFunc, isClass } from '../utils/token.utils';
import { getMetadata } from '../utils/metadata.utils';
import { NameCase } from './tool.types';
import {
  AudioContent,
  ContentBlock,
  EmbeddedResource,
  ImageContent,
  ResourceLink,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';
import { z, ZodBigInt, ZodBoolean, ZodDate, ZodNumber, ZodString } from 'zod';

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

// Allowed chars per MCP spec: a-zA-Z0-9 _ -. /
const MCP_ALLOWED = /[A-Za-z0-9_\-./]/;

export function splitWords(input: string): string[] {
  const parts: string[] = [];
  let buff = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const isAlphaNum = /[A-Za-z0-9]/.test(ch);
    if (!isAlphaNum) {
      if (buff) {
        parts.push(buff);
        buff = '';
      }
      continue;
    }
    if (buff && /[a-z]/.test(buff[buff.length - 1]) && /[A-Z]/.test(ch)) {
      parts.push(buff);
      buff = ch;
    } else {
      buff += ch;
    }
  }
  if (buff) parts.push(buff);
  return parts;
}

export function toCase(words: string[], kind: NameCase): string {
  const safe = words.filter(Boolean);
  switch (kind) {
    case 'snake':
      return safe.map((w) => w.toLowerCase()).join('_');
    case 'kebab':
      return safe.map((w) => w.toLowerCase()).join('-');
    case 'dot':
      return safe.map((w) => w.toLowerCase()).join('.');
    case 'camel':
      if (safe.length === 0) return '';
      return (
        safe[0].toLowerCase() +
        safe
          .slice(1)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join('')
      );
  }
}

export function normalizeSegment(raw: string, kind: NameCase): string {
  const words = splitWords(raw);
  let cased = toCase(words, kind);
  cased = [...cased].filter((ch) => MCP_ALLOWED.test(ch)).join('');
  return cased || 'x';
}

export function normalizeProviderId(raw: string | undefined, kind: NameCase): string | undefined {
  if (!raw) return undefined;
  const tokens = raw.split(/\W+/);
  const cased = toCase(tokens, kind);
  const safe = [...cased].filter((ch) => MCP_ALLOWED.test(ch)).join('');
  return safe || undefined;
}

export function normalizeOwnerPath(ownerKey: string, kind: NameCase): string {
  const levels = ownerKey.split('/');
  const normLevels = levels.map((level) => {
    const parts = level.split(':'); // ["app","Portal"]
    return parts
      .map((p) => normalizeSegment(p, kind))
      .join(kind === 'snake' ? '_' : kind === 'kebab' ? '-' : kind === 'dot' ? '.' : '');
  });
  if (kind === 'camel') return normLevels.map((seg) => seg.charAt(0).toLowerCase() + seg.slice(1)).join('');
  const sep = kind === 'snake' ? '_' : kind === 'kebab' ? '-' : '.';
  return normLevels.join(sep);
}

export function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i);
  return (h >>> 0).toString(16).slice(-6).padStart(6, '0');
}

export function ensureMaxLen(name: string, max: number): string {
  if (name.length <= max) return name;
  const hash = shortHash(name);
  const lastSep = Math.max(name.lastIndexOf('_'), name.lastIndexOf('-'), name.lastIndexOf('.'), name.lastIndexOf('/'));
  const tail = lastSep > 0 ? name.slice(lastSep + 1) : name.slice(-Math.max(3, Math.min(16, Math.floor(max / 4))));
  const budget = Math.max(1, max - (1 + hash.length + 1 + tail.length));
  const prefix = name.slice(0, budget);
  return `${prefix}-${hash}-${tail}`.slice(0, max);
}

export function sepFor(kind: NameCase): string {
  return kind === 'snake' ? '_' : kind === 'kebab' ? '-' : kind === 'dot' ? '.' : '';
}

export function ownerKeyOf(lineage: EntryLineage): string {
  return lineage.map((o) => `${o.kind}:${o.id}`).join('/');
}

export function qualifiedNameOf(lineage: EntryLineage, name: string): string {
  return `${ownerKeyOf(lineage)}:${name}`;
}

export function buildParsedToolResult(descriptor: any, raw: unknown): ParsedToolResult {
  const content: ContentBlock[] = [];
  let hasJsonStructured = false;

  // No outputSchema → the best effort: treat the result as structured JSON and text fallback
  if (!descriptor) {
    const structuredContent = getStructuredContent(raw);
    const sanitized = structuredContent ?? raw;
    content.push(makeJsonTextContent(sanitized));
    return { content, structuredContent };
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
    result.structuredContent = getStructuredContent(raw);
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
  const sanitized = getStructuredContent(value);
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
function getStructuredContent(value: unknown): z.ParseResult['data'] | undefined {
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
    return undefined;
  }
}
