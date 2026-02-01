/**
 * Shared constants for platform metadata adapters.
 *
 * @packageDocumentation
 */

/**
 * MCP Apps display modes per specification.
 */
export type ExtAppsDisplayMode = 'inline' | 'fullscreen' | 'pip';

/**
 * Mapping from generic display modes to MCP Apps specific values.
 *
 * Maps both standard MCP Apps modes and platform-specific aliases:
 * - inline, fullscreen, pip: Standard MCP Apps modes (pass through)
 * - widget: OpenAI-style alias for 'inline'
 * - panel: OpenAI-style alias for 'fullscreen'
 */
export const DISPLAY_MODE_MAP: Record<string, ExtAppsDisplayMode> = {
  // Standard MCP Apps modes
  inline: 'inline',
  fullscreen: 'fullscreen',
  pip: 'pip',
  // OpenAI-style aliases
  widget: 'inline',
  panel: 'fullscreen',
};

/**
 * Map a display mode string to MCP Apps display mode.
 *
 * @param mode - The display mode string to map
 * @returns The mapped MCP Apps display mode, or undefined if not recognized
 */
export function mapDisplayMode(mode: string): ExtAppsDisplayMode | undefined {
  return DISPLAY_MODE_MAP[mode];
}
