/**
 * MCP Apps Protocol Constants
 *
 * Aligned with the MCP Apps specification:
 * https://modelcontextprotocol.io/extensions/apps/overview
 *
 * @packageDocumentation
 */

/**
 * MIME type for MCP Apps HTML content.
 * Per the MCP Apps spec: `text/html;profile=mcp-app`
 */
export const MCP_APPS_MIME_TYPE = 'text/html;profile=mcp-app' as const;

/**
 * Extension ID for MCP Apps in capabilities.experimental.
 */
export const MCP_APPS_EXTENSION_ID = 'io.modelcontextprotocol/ui' as const;
