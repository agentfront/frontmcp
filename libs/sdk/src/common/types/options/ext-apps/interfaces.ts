// common/types/options/ext-apps/interfaces.ts
// Explicit TypeScript interfaces for ext-apps configuration

// Re-export ExtAppsHostCapabilities from ext-apps for convenience
export type { ExtAppsHostCapabilities } from '../../../../ext-apps';

/**
 * Host capabilities configuration for ext-apps.
 *
 * Defines which features the host advertises to widgets during the ui/initialize handshake.
 */
export interface ExtAppsHostCapabilitiesInterface {
  /**
   * Host supports proxying tool calls to the MCP server via ui/callServerTool.
   * @default true (when extApps.enabled is true)
   */
  serverToolProxy?: boolean;

  /**
   * Host supports opening links via ui/openLink.
   * @default false
   */
  openLink?: boolean;

  /**
   * Host supports model context updates via ui/updateModelContext.
   * @default false
   */
  modelContextUpdate?: boolean;

  /**
   * Host supports widget-defined tools via ui/registerTool and ui/unregisterTool.
   * @default false
   */
  widgetTools?: boolean;

  /**
   * Supported display modes that the host can render.
   * - 'inline': Widget embedded in conversation flow
   * - 'fullscreen': Widget takes full screen
   * - 'pip': Picture-in-picture mode
   */
  displayModes?: ('inline' | 'fullscreen' | 'pip')[];

  /**
   * Host supports widget logging via ui/log.
   * @default true (when extApps.enabled is true)
   */
  logging?: boolean;
}

/**
 * Ext-apps configuration options.
 *
 * Controls MCP Apps (ext-apps) widget-to-host communication over HTTP transport.
 */
export interface ExtAppsOptionsInterface {
  /**
   * Whether ext-apps handling is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * Host capabilities to advertise to widgets during ui/initialize.
   */
  hostCapabilities?: ExtAppsHostCapabilitiesInterface;
}
