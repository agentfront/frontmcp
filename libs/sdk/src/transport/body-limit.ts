/**
 * `http.bodyLimit` for the web-standard transports, parsed once so the web-fetch handler and the MCP
 * transport it runs apply the same limit.
 */

/** The `http.bodyLimit` default (`'4mb'`), in bytes. */
export const DEFAULT_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

const BYTE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

/** Parse `http.bodyLimit` (`'4mb'`, `'512kb'`, or a byte count) the way `bytes`/body-parser does. */
export function parseByteLimit(limit: number | string | undefined): number {
  if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) return limit;
  if (typeof limit === 'string') {
    const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(limit.trim());
    if (match) return Math.floor(Number(match[1]) * BYTE_UNITS[(match[2] ?? 'b').toLowerCase()]);
  }
  return DEFAULT_BODY_LIMIT_BYTES;
}

/**
 * The `maxRequestBodySize` for a `WebStandardStreamableHTTPServerTransport` that reads the request
 * body itself. Since `@modelcontextprotocol/sdk` 1.30.1 that transport refuses a body over 4 MiB
 * unless told otherwise, so it gets the configured `http.bodyLimit` instead: a limit above 4 MiB
 * keeps working on the web-fetch path, as it does on Express. The transport needs a positive
 * bound, so a limit of 0 becomes 1 byte (the web-fetch handler has refused any body by then).
 */
export function mcpTransportBodyLimit(limit: number | string | undefined): number {
  return Math.max(1, parseByteLimit(limit));
}
