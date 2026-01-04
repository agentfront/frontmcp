// file: libs/sdk/src/utils/content.utils.ts
// MCP-specific content building utilities

import { sanitizeToJson, inferMimeType } from '@frontmcp/utils';

/**
 * Convert a value to MCP structuredContent format.
 * Returns Record<string, unknown> or undefined (matching MCP's structuredContent type).
 * Primitives and arrays are wrapped in { value: ... }.
 */
export function toStructuredContent(value: unknown): Record<string, unknown> | undefined {
  const result = sanitizeToJson(value);
  if (result === undefined || result === null) return undefined;
  if (typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  // Wrap primitives and arrays in an object
  return { value: result };
}

/** MCP-compatible text resource content */
export type TextContent = {
  uri: string;
  mimeType?: string;
  text: string;
};

/** MCP-compatible blob resource content */
export type BlobContent = {
  uri: string;
  mimeType?: string;
  blob: string;
};

/** MCP-compatible resource content (text or blob) */
export type ResourceContent = TextContent | BlobContent;

/**
 * Build a resource content item for MCP ReadResourceResult format.
 * Handles both text and binary (blob) content.
 *
 * @param uri - The resource URI
 * @param content - The content to serialize (string, Buffer, object, etc.)
 * @param mimeType - Optional MIME type override
 */
export function buildResourceContent(uri: string, content: unknown, mimeType?: string): ResourceContent {
  // If content is already in the expected format
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if ('blob' in obj && typeof obj['blob'] === 'string') {
      return {
        uri,
        mimeType: (obj['mimeType'] as string) || mimeType,
        blob: obj['blob'],
      };
    }
    if ('text' in obj && typeof obj['text'] === 'string') {
      return {
        uri,
        mimeType: (obj['mimeType'] as string) || mimeType,
        text: obj['text'],
      };
    }
  }

  // Binary content (Buffer, Uint8Array)
  if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    return {
      uri,
      mimeType: mimeType || 'application/octet-stream',
      blob: buffer.toString('base64'),
    };
  }

  // String content
  if (typeof content === 'string') {
    return {
      uri,
      mimeType: mimeType || inferMimeType(uri, content),
      text: content,
    };
  }

  // JSON-serializable content
  try {
    return {
      uri,
      mimeType: mimeType || 'application/json',
      text: JSON.stringify(content),
    };
  } catch {
    return {
      uri,
      mimeType: mimeType || 'text/plain',
      text: String(content),
    };
  }
}
