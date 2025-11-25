// file: libs/sdk/src/utils/content.utils.ts
// Content building and sanitization utilities for MCP responses

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
export function sanitizeToJson(value: unknown): unknown {
  const seen = new WeakSet<object>();

  function sanitize(val: unknown): unknown {
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
      const obj: Record<string, unknown> = {};
      for (const [k, v] of val.entries()) {
        obj[String(k)] = sanitize(v);
      }
      return obj;
    }

    if (val instanceof Set) {
      return Array.from(val).map(sanitize);
    }

    if (Array.isArray(val)) {
      return val.map(sanitize);
    }

    if (val && typeof val === 'object') {
      if (seen.has(val)) {
        // Drop circular references
        return undefined;
      }
      seen.add(val);

      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(val)) {
        const clean = sanitize(value);
        if (clean !== undefined) {
          sanitized[key] = clean;
        }
      }
      return sanitized;
    }

    // Primitives pass through
    return val;
  }

  return sanitize(value);
}

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
      mimeType: mimeType || 'text/plain',
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

/**
 * Infer MIME type from file extension or content.
 */
export function inferMimeType(uri: string, content?: unknown): string {
  // Try to infer from URI extension
  const ext = uri.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    ts: 'application/typescript',
    txt: 'text/plain',
    md: 'text/markdown',
    yaml: 'application/yaml',
    yml: 'application/yaml',
    csv: 'text/csv',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
  };

  if (ext && mimeTypes[ext]) {
    return mimeTypes[ext];
  }

  // Try to infer from content
  if (typeof content === 'string') {
    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      return 'application/json';
    }
    if (content.trim().startsWith('<')) {
      return content.includes('<!DOCTYPE html') || content.includes('<html') ? 'text/html' : 'application/xml';
    }
  }

  return 'text/plain';
}
