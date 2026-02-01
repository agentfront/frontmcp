// common/types/options/ext-apps/schema.ts
// Zod schema for ext-apps configuration

import { z } from 'zod';

/**
 * Host capabilities schema for ext-apps.
 *
 * Defines which features the host advertises to widgets during the ui/initialize handshake.
 * Widgets use these capabilities to determine which features are available.
 *
 * @example
 * ```typescript
 * const capabilities: ExtAppsHostCapabilities = {
 *   serverToolProxy: true,    // Allow ui/callServerTool
 *   logging: true,            // Allow ui/log
 *   openLink: true,           // Allow ui/openLink
 *   modelContextUpdate: true, // Allow ui/updateModelContext
 *   widgetTools: true,        // Allow ui/registerTool and ui/unregisterTool
 *   displayModes: ['inline', 'fullscreen', 'pip'],
 * };
 * ```
 */
export const extAppsHostCapabilitiesSchema = z.object({
  /**
   * Host supports proxying tool calls to the MCP server via ui/callServerTool.
   * When enabled, widgets can invoke any MCP tool through the host.
   * @default true (when extApps.enabled is true)
   */
  serverToolProxy: z.boolean().optional(),

  /**
   * Host supports opening links via ui/openLink.
   * When enabled, widgets can request the host to open URLs (only http/https allowed).
   * @default false
   */
  openLink: z.boolean().optional(),

  /**
   * Host supports model context updates via ui/updateModelContext.
   * When enabled, widgets can update the AI model's context with widget state.
   * @default false
   */
  modelContextUpdate: z.boolean().optional(),

  /**
   * Host supports widget-defined tools via ui/registerTool and ui/unregisterTool.
   * When enabled, widgets can dynamically register and unregister tools.
   * @default false
   */
  widgetTools: z.boolean().optional(),

  /**
   * Supported display modes that the host can render.
   * Widgets can request mode changes via ui/setDisplayMode.
   * - 'inline': Widget embedded in conversation flow
   * - 'fullscreen': Widget takes full screen
   * - 'pip': Picture-in-picture mode
   */
  displayModes: z.array(z.enum(['inline', 'fullscreen', 'pip'])).optional(),

  /**
   * Host supports widget logging via ui/log.
   * When enabled, widgets can send structured log messages to the host.
   * @default true (when extApps.enabled is true)
   */
  logging: z.boolean().optional(),
});

/**
 * Ext-apps options Zod schema.
 *
 * Controls MCP Apps (ext-apps) widget-to-host communication over HTTP transport.
 *
 * @example Minimal configuration (uses defaults)
 * ```typescript
 * extApps: { enabled: true }
 * ```
 *
 * @example Full configuration
 * ```typescript
 * extApps: {
 *   enabled: true,
 *   hostCapabilities: {
 *     serverToolProxy: true,
 *     logging: true,
 *     openLink: true,
 *     modelContextUpdate: true,
 *     widgetTools: true,
 *     displayModes: ['inline', 'fullscreen'],
 *   },
 * }
 * ```
 */
export const extAppsOptionsSchema = z.object({
  /**
   * Whether ext-apps handling is enabled.
   * When enabled, `ui/*` JSON-RPC methods are routed through session validation
   * and the ExtAppsMessageHandler.
   * @default true
   */
  enabled: z.boolean().optional().default(true),

  /**
   * Host capabilities to advertise to widgets during ui/initialize.
   * These capabilities determine which ext-apps features the server supports.
   *
   * If not specified, defaults to:
   * - serverToolProxy: true
   * - logging: true
   */
  hostCapabilities: extAppsHostCapabilitiesSchema.optional(),
});

/**
 * Ext-apps options type (with defaults applied).
 */
export type ExtAppsOptions = z.infer<typeof extAppsOptionsSchema>;

/**
 * Ext-apps options input type (for user configuration).
 */
export type ExtAppsOptionsInput = z.input<typeof extAppsOptionsSchema>;
