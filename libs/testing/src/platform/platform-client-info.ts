/**
 * @file platform-client-info.ts
 * @description Client info, User-Agent mappings, and capabilities for each platform.
 *
 * These mappings enable platform detection in MCP servers via:
 * - User-Agent header (most platforms)
 * - Client capabilities (ext-apps via io.modelcontextprotocol/ui extension)
 *
 * @example
 * ```typescript
 * import { getPlatformClientInfo, getPlatformCapabilities } from '@frontmcp/testing';
 *
 * const client = McpTestClient.create({ baseUrl })
 *   .withPlatform('ext-apps')  // Auto-sets clientInfo AND capabilities
 *   .buildAndConnect();
 * ```
 */

import type { TestPlatformType } from './platform-types';

/**
 * MCP Apps extension key used for ext-apps platform detection.
 */
export const MCP_APPS_EXTENSION_KEY = 'io.modelcontextprotocol/ui' as const;

/**
 * Client info for MCP initialization.
 * Matches the Implementation type from @modelcontextprotocol/sdk.
 */
export interface TestClientInfo {
  /** Client name (used for User-Agent header) */
  name: string;
  /** Client version */
  version: string;
}

/**
 * Get client info for a specific platform.
 *
 * These values are used to:
 * 1. Set the clientInfo during MCP initialize
 * 2. Generate the User-Agent header for platform detection
 */
export function getPlatformClientInfo(platform: TestPlatformType): TestClientInfo {
  switch (platform) {
    case 'openai':
      return {
        name: 'ChatGPT',
        version: '1.0',
      };
    case 'ext-apps':
      return {
        name: 'mcp-ext-apps',
        version: '1.0',
      };
    case 'claude':
      return {
        name: 'claude-desktop',
        version: '1.0',
      };
    case 'cursor':
      return {
        name: 'cursor',
        version: '1.0',
      };
    case 'continue':
      return {
        name: 'continue',
        version: '1.0',
      };
    case 'cody':
      return {
        name: 'cody',
        version: '1.0',
      };
    case 'gemini':
      return {
        name: 'gemini',
        version: '1.0',
      };
    case 'generic-mcp':
      return {
        name: 'generic-mcp-client',
        version: '1.0',
      };
    case 'unknown':
    default:
      return {
        name: 'mcp-test-client',
        version: '1.0',
      };
  }
}

/**
 * Build User-Agent header string from client info.
 *
 * Format: "{name}/{version}"
 *
 * Examples:
 * - "ChatGPT/1.0" (OpenAI)
 * - "mcp-ext-apps/1.0" (ext-apps)
 * - "claude-desktop/1.0" (Claude)
 */
export function buildUserAgent(clientInfo: TestClientInfo): string {
  return `${clientInfo.name}/${clientInfo.version}`;
}

/**
 * Get the User-Agent string for a platform.
 */
export function getPlatformUserAgent(platform: TestPlatformType): string {
  return buildUserAgent(getPlatformClientInfo(platform));
}

/**
 * Platform detection patterns for parsing User-Agent headers.
 * These are the patterns that MCP servers use to detect platforms.
 *
 * Note: ext-apps is detected via capabilities, not User-Agent.
 */
export const PLATFORM_DETECTION_PATTERNS: Record<TestPlatformType, RegExp> = {
  openai: /chatgpt/i,
  'ext-apps': /mcp-ext-apps/i, // Note: Actual detection uses capabilities
  claude: /claude|claude-desktop/i,
  cursor: /cursor/i,
  continue: /continue/i,
  cody: /cody/i,
  gemini: /gemini/i,
  'generic-mcp': /generic-mcp/i,
  unknown: /.*/, // Matches anything (fallback)
};

// ═══════════════════════════════════════════════════════════════════
// PLATFORM CAPABILITIES
// ═══════════════════════════════════════════════════════════════════

/**
 * MCP Apps extension capability for ext-apps platform detection.
 */
export interface McpAppsExtension {
  /** Supported MIME types */
  mimeTypes?: string[];
}

/**
 * Experimental capabilities for MCP clients.
 */
export interface ExperimentalCapabilities {
  [MCP_APPS_EXTENSION_KEY]?: McpAppsExtension;
  [key: string]: unknown;
}

/**
 * Form elicitation capability options.
 */
export interface FormElicitationCapability {
  /** Whether to apply default values from the schema */
  applyDefaults?: boolean;
}

/**
 * Elicitation capabilities for interactive user input.
 * Note: MCP SDK expects form/url to be objects, not booleans.
 */
export interface ElicitationCapabilities {
  /** Support for form-based elicitation - use empty object {} to enable */
  form?: FormElicitationCapability | Record<string, unknown>;
  /** Support for URL-based elicitation - use empty object {} to enable */
  url?: Record<string, unknown>;
}

/**
 * Client capabilities sent during MCP initialization.
 */
export interface TestClientCapabilities {
  sampling?: Record<string, unknown>;
  elicitation?: ElicitationCapabilities;
  experimental?: ExperimentalCapabilities;
}

/**
 * Get client capabilities for a specific platform.
 *
 * Currently only ext-apps requires special capabilities:
 * - ext-apps: Sets io.modelcontextprotocol/ui extension for platform detection
 *
 * @param platform - The platform type
 * @returns Client capabilities to send during initialization
 */
export function getPlatformCapabilities(platform: TestPlatformType): TestClientCapabilities {
  const baseCapabilities: TestClientCapabilities = {
    sampling: {},
    // Include elicitation.form by default for testing elicitation workflows
    // Note: MCP SDK expects form to be an object, not boolean
    elicitation: {
      form: {},
    },
  };

  // ext-apps requires the io.modelcontextprotocol/ui extension for detection
  if (platform === 'ext-apps') {
    return {
      ...baseCapabilities,
      experimental: {
        [MCP_APPS_EXTENSION_KEY]: {
          mimeTypes: ['text/html+mcp'],
        },
      },
    };
  }

  return baseCapabilities;
}

/**
 * Check if a platform requires capability-based detection (vs User-Agent).
 */
export function requiresCapabilityDetection(platform: TestPlatformType): boolean {
  return platform === 'ext-apps';
}
