/**
 * UI Resource URI Utilities
 *
 * Standalone utilities for parsing and building ui:// resource URIs.
 * Used for static widget serving mode where widgets are pre-compiled
 * at startup and fetched via resources/read.
 *
 * @packageDocumentation
 */

import type { AIPlatformType } from '../adapters';

/**
 * UI resource URI scheme
 */
export const UI_RESOURCE_SCHEME = 'ui://';

/**
 * Pattern for static widget URIs: ui://widget/{toolName}.html
 * This format is used by OpenAI at discovery time (tools/list)
 */
const UI_WIDGET_PATTERN = /^ui:\/\/widget\/([^/]+)\.html$/;

/**
 * Parsed static widget URI
 */
export interface ParsedWidgetUri {
  toolName: string;
  fullUri: string;
}

/**
 * Check if a URI is a UI resource URI
 *
 * @param uri - URI to check
 * @returns True if the URI starts with ui://
 */
export function isUIResourceUri(uri: string): boolean {
  return uri.startsWith(UI_RESOURCE_SCHEME);
}

/**
 * Parse a static widget URI into its components
 *
 * @param uri - URI to parse (format: ui://widget/{toolName}.html)
 * @returns Parsed components or undefined if invalid
 */
export function parseWidgetUri(uri: string): ParsedWidgetUri | undefined {
  const match = uri.match(UI_WIDGET_PATTERN);
  if (!match) {
    return undefined;
  }

  return {
    toolName: decodeURIComponent(match[1]),
    fullUri: uri,
  };
}

/**
 * Check if URI is a static widget URI (ui://widget/{toolName}.html)
 */
export function isStaticWidgetUri(uri: string): boolean {
  return UI_WIDGET_PATTERN.test(uri);
}

/**
 * Build a static widget URI from tool name
 *
 * @param toolName - Name of the tool
 * @returns Static widget URI (ui://widget/{toolName}.html)
 */
export function buildStaticWidgetUri(toolName: string): string {
  return `ui://widget/${encodeURIComponent(toolName)}.html`;
}

/**
 * Get the MIME type for UI resources based on platform.
 *
 * Per user requirement: OpenAI or default uses 'text/html+skybridge'
 *
 * @param platformType - The detected platform type
 * @returns The appropriate MIME type
 */
export function getUIResourceMimeType(platformType?: AIPlatformType): string {
  // Per requirement: "for openai or default text/html+skybridge"
  // This aligns with OpenAI's skybridge widget protocol
  switch (platformType) {
    case 'claude':
      // Claude uses standard text/html (network-blocked environment)
      return 'text/html';
    case 'gemini':
      // Gemini uses standard text/html
      return 'text/html';
    case 'openai':
    case 'cursor':
    case 'continue':
    case 'cody':
    case 'generic-mcp':
    case 'ext-apps':
    case 'unknown':
    default:
      // OpenAI and default use skybridge MIME type
      return 'text/html+skybridge';
  }
}
