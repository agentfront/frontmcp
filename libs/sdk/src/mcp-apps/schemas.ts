/**
 * @file schemas.ts
 * @description Zod schemas for MCP Apps specification validation.
 *
 * @module @frontmcp/sdk/mcp-apps/schemas
 */

import { z } from 'zod';
import { MCP_APPS_MIME_TYPE, MCP_APPS_PROTOCOL_VERSION } from './types';

// ============================================
// Basic Schemas
// ============================================

/**
 * MCP Apps MIME type schema.
 */
export const McpAppsMimeTypeSchema = z.literal(MCP_APPS_MIME_TYPE);

/**
 * Display mode schema.
 */
export const McpAppsDisplayModeSchema = z.enum(['inline', 'fullscreen', 'pip']);

/**
 * Platform type schema.
 */
export const McpAppsPlatformSchema = z.enum(['web', 'desktop', 'mobile']);

/**
 * Theme schema.
 */
export const ThemeSchema = z.enum(['light', 'dark']);

// ============================================
// CSP Schema
// ============================================

/**
 * Content Security Policy schema.
 */
export const McpAppsCSPSchema = z
  .object({
    connectDomains: z.array(z.string().url()).optional(),
    resourceDomains: z.array(z.string().url()).optional(),
  })
  .strict();

// ============================================
// UI Resource Schemas
// ============================================

/**
 * UI Resource metadata schema.
 */
export const UIResourceMetaSchema = z
  .object({
    csp: McpAppsCSPSchema.optional(),
    domain: z.string().optional(),
    prefersBorder: z.boolean().optional(),
  })
  .strict();

/**
 * UI Resource schema.
 */
export const UIResourceSchema = z
  .object({
    uri: z.string().startsWith('ui://'),
    name: z.string().min(1),
    description: z.string().optional(),
    mimeType: McpAppsMimeTypeSchema,
    _meta: z
      .object({
        ui: UIResourceMetaSchema.optional(),
      })
      .optional(),
  })
  .strict();

// ============================================
// Host Context Schemas
// ============================================

/**
 * Device capabilities schema.
 */
export const DeviceCapabilitiesSchema = z
  .object({
    touch: z.boolean().optional(),
    hover: z.boolean().optional(),
  })
  .strict();

/**
 * Safe area insets schema.
 */
export const SafeAreaInsetsSchema = z
  .object({
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
  })
  .strict();

/**
 * Viewport info schema.
 */
export const ViewportInfoSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    maxHeight: z.number().positive().optional(),
    maxWidth: z.number().positive().optional(),
  })
  .strict();

/**
 * Tool info schema.
 */
export const ToolInfoSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    tool: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      inputSchema: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .strict();

/**
 * Host context schema.
 */
export const McpAppsHostContextSchema = z
  .object({
    toolInfo: ToolInfoSchema.optional(),
    theme: ThemeSchema.optional(),
    displayMode: McpAppsDisplayModeSchema.optional(),
    viewport: ViewportInfoSchema.optional(),
    locale: z.string().optional(),
    timeZone: z.string().optional(),
    platform: McpAppsPlatformSchema.optional(),
    deviceCapabilities: DeviceCapabilitiesSchema.optional(),
    safeAreaInsets: SafeAreaInsetsSchema.optional(),
  })
  .strict();

// ============================================
// JSON-RPC Schemas
// ============================================

/**
 * JSON-RPC error schema.
 */
export const JsonRpcErrorSchema = z
  .object({
    code: z.number().int(),
    message: z.string(),
    data: z.unknown().optional(),
  })
  .strict();

/**
 * JSON-RPC request schema.
 */
export const JsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

/**
 * JSON-RPC response schema.
 */
export const JsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]),
    result: z.unknown().optional(),
    error: JsonRpcErrorSchema.optional(),
  })
  .strict();

/**
 * JSON-RPC notification schema.
 */
export const JsonRpcNotificationSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

// ============================================
// MCP Apps Protocol Message Schemas
// ============================================

/**
 * UI Initialize params schema.
 */
export const McpUiInitializeParamsSchema = z
  .object({
    protocolVersion: z.string(),
    capabilities: z
      .object({
        messages: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .strict();

/**
 * UI Initialize result schema.
 */
export const McpUiInitializeResultSchema = z
  .object({
    protocolVersion: z.string(),
    capabilities: z.object({
      extensions: z.record(z.string(), z.unknown()).optional(),
    }),
    hostContext: McpAppsHostContextSchema,
  })
  .strict();

/**
 * Tool input params schema.
 */
export const McpUiToolInputParamsSchema = z
  .object({
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

/**
 * Tool input partial params schema.
 */
export const McpUiToolInputPartialParamsSchema = z
  .object({
    argumentsDelta: z.string(),
  })
  .strict();

/**
 * Tool result content item schema.
 */
export const ToolResultContentItemSchema = z.object({
  type: z.enum(['text', 'image', 'resource']),
  text: z.string().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
  uri: z.string().optional(),
});

/**
 * Tool result params schema.
 */
export const McpUiToolResultParamsSchema = z
  .object({
    content: z.array(ToolResultContentItemSchema),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * Tool cancelled params schema.
 */
export const McpUiToolCancelledParamsSchema = z
  .object({
    reason: z.string().optional(),
  })
  .strict();

/**
 * Size change params schema.
 */
export const McpUiSizeChangeParamsSchema = z
  .object({
    viewport: ViewportInfoSchema,
  })
  .strict();

/**
 * Host context change params schema.
 */
export const McpUiHostContextChangeParamsSchema = z
  .object({
    changes: McpAppsHostContextSchema.partial(),
  })
  .strict();

/**
 * Open link params schema.
 */
export const McpUiOpenLinkParamsSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

/**
 * Message params schema.
 */
export const McpUiMessageParamsSchema = z
  .object({
    content: z.string().min(1),
  })
  .strict();

// ============================================
// Extension Capability Schema
// ============================================

/**
 * MCP Apps extension capability schema.
 */
export const McpAppsExtensionCapabilitySchema = z
  .object({
    mimeTypes: z.array(McpAppsMimeTypeSchema),
  })
  .strict();

// ============================================
// Tool Metadata Extension Schema
// ============================================

/**
 * Tool UI metadata schema.
 */
export const ToolUIMetaSchema = z
  .object({
    'ui/resourceUri': z.string().startsWith('ui://').optional(),
    'ui/mimeType': McpAppsMimeTypeSchema.optional(),
  })
  .passthrough(); // Allow additional platform-specific fields

// ============================================
// Validation Helpers
// ============================================

/**
 * Validate a UI resource URI.
 */
export function isValidUIResourceUri(uri: string): boolean {
  return uri.startsWith('ui://') && uri.length > 5;
}

/**
 * Validate MCP Apps protocol version.
 */
export function isValidProtocolVersion(version: string): boolean {
  // Accept current version or future versions
  return /^\d{4}-\d{2}-\d{2}$/.test(version);
}

/**
 * Parse and validate UI resource.
 */
export function parseUIResource(data: unknown): z.infer<typeof UIResourceSchema> | null {
  const result = UIResourceSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Parse and validate host context.
 */
export function parseHostContext(data: unknown): z.infer<typeof McpAppsHostContextSchema> | null {
  const result = McpAppsHostContextSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Default protocol version.
 */
export const DEFAULT_PROTOCOL_VERSION = MCP_APPS_PROTOCOL_VERSION;
