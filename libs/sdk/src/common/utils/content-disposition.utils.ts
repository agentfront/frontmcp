/**
 * Serialize a `Content-Disposition` header value, the filename quoted with its `"` and `\` escaped. Shared by the
 * Node writer and the Web `Response` renderer.
 */
export function serializeContentDisposition(disposition: 'inline' | 'attachment', filename?: string): string {
  return filename ? `${disposition}; filename="${filename.replace(/["\\]/g, '\\$&')}"` : disposition;
}
