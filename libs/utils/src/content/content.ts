/**
 * Content utilities for JSON sanitization and MIME type inference.
 *
 * Provides functions for safely converting JavaScript values to JSON-compatible
 * formats and inferring content types from file extensions.
 */

/**
 * Sanitize arbitrary JS values into JSON-safe objects.
 *
 * Handles:
 * - Functions and symbols → dropped (undefined)
 * - BigInt → string
 * - Date → ISO string
 * - Error → { name, message, stack }
 * - Map → plain object
 * - Set → array
 * - Circular references → dropped (undefined)
 *
 * @param value - Any JavaScript value
 * @returns JSON-safe version of the value
 *
 * @example
 * sanitizeToJson({ date: new Date(), fn: () => {} })
 * // { date: '2024-01-01T00:00:00.000Z' }
 *
 * sanitizeToJson(new Map([['key', 'value']]))
 * // { key: 'value' }
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
      if (seen.has(val)) {
        return undefined;
      }
      seen.add(val);
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
 * Common MIME types by file extension.
 */
const MIME_TYPES: Record<string, string> = {
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

/**
 * Infer MIME type from file extension or content.
 *
 * @param uri - The URI or filename to infer from
 * @param content - Optional content to help infer type
 * @returns Inferred MIME type, defaults to 'text/plain'
 *
 * @example
 * inferMimeType('document.json') // 'application/json'
 * inferMimeType('image.png') // 'image/png'
 * inferMimeType('unknown', '{"key": "value"}') // 'application/json'
 * inferMimeType('unknown', '<html>') // 'text/html'
 */
export function inferMimeType(uri: string, content?: unknown): string {
  // Try to infer from URI extension
  const ext = uri.split('.').pop()?.toLowerCase();

  if (ext && MIME_TYPES[ext]) {
    return MIME_TYPES[ext];
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
