/**
 * @file serving-mode.ts
 * @description Serving mode resolution for auto-detection based on client capabilities.
 *
 * The `'auto'` serving mode automatically selects the appropriate delivery mechanism
 * based on the MCP client's capabilities:
 *
 * - **OpenAI/ext-apps**: Use `'inline'` mode with `_meta['ui/html']`
 * - **Claude**: Use `'inline'` mode with dual-payload format
 * - **Gemini/unsupported**: Skip UI entirely (return JSON only)
 *
 * When a specific mode is forced (not 'auto'), but the client doesn't support it,
 * the UI is skipped to prevent broken experiences.
 */

import type { WidgetServingMode } from '../types';
import type { AIPlatformType } from './platform-meta';

// ============================================
// Types
// ============================================

/**
 * Result of serving mode resolution.
 */
export interface ResolvedServingMode {
  /**
   * The effective serving mode to use.
   * `null` means UI should be skipped entirely.
   */
  effectiveMode: Exclude<WidgetServingMode, 'auto'> | null;

  /**
   * Whether dual-payload format should be used (Claude).
   */
  useDualPayload: boolean;

  /**
   * Whether the client supports widget UI.
   */
  supportsUI: boolean;

  /**
   * Reason for the decision (useful for logging/debugging).
   */
  reason: string;
}

/**
 * Options for resolving serving mode.
 */
export interface ResolveServingModeOptions {
  /**
   * The configured serving mode (from UITemplateConfig).
   * Defaults to 'auto'.
   */
  configuredMode?: WidgetServingMode;

  /**
   * The detected platform type.
   */
  platformType: AIPlatformType;
}

// ============================================
// Platform Capabilities Map
// ============================================

/**
 * Platform UI capabilities.
 */
interface PlatformUICapabilities {
  /** Whether the platform supports widget UI */
  supportsWidgets: boolean;
  /** Whether to use dual-payload format */
  useDualPayload: boolean;
  /** Supported serving modes for this platform */
  supportedModes: Array<Exclude<WidgetServingMode, 'auto'>>;
  /** Default serving mode for auto-detection */
  defaultMode: Exclude<WidgetServingMode, 'auto'>;
}

/**
 * Platform capabilities mapping.
 */
const PLATFORM_CAPABILITIES: Record<AIPlatformType, PlatformUICapabilities> = {
  openai: {
    supportsWidgets: true,
    useDualPayload: false,
    supportedModes: ['inline', 'static', 'hybrid', 'direct-url', 'custom-url'],
    defaultMode: 'inline',
  },
  'ext-apps': {
    supportsWidgets: true,
    useDualPayload: false,
    supportedModes: ['inline', 'static', 'hybrid', 'direct-url', 'custom-url'],
    defaultMode: 'inline',
  },
  claude: {
    supportsWidgets: true,
    useDualPayload: true,
    // Claude supports inline only (no resource fetching for static)
    supportedModes: ['inline'],
    defaultMode: 'inline',
  },
  cursor: {
    // Cursor (IDE) - similar to OpenAI, supports widgets
    supportsWidgets: true,
    useDualPayload: false,
    supportedModes: ['inline', 'static', 'hybrid', 'direct-url', 'custom-url'],
    defaultMode: 'inline',
  },
  continue: {
    // Continue (IDE extension) - basic widget support
    supportsWidgets: true,
    useDualPayload: false,
    supportedModes: ['inline'],
    defaultMode: 'inline',
  },
  cody: {
    // Sourcegraph Cody - basic widget support
    supportsWidgets: true,
    useDualPayload: false,
    supportedModes: ['inline'],
    defaultMode: 'inline',
  },
  'generic-mcp': {
    // Generic MCP clients - assume widget support
    supportsWidgets: true,
    useDualPayload: false,
    supportedModes: ['inline', 'static'],
    defaultMode: 'inline',
  },
  gemini: {
    supportsWidgets: false,
    useDualPayload: false,
    supportedModes: [],
    defaultMode: 'inline', // Not used since supportsWidgets is false
  },
  unknown: {
    // Unknown clients: be conservative, assume no widget support
    supportsWidgets: false,
    useDualPayload: false,
    supportedModes: [],
    defaultMode: 'inline',
  },
};

// ============================================
// Resolver Function
// ============================================

/**
 * Resolve the effective serving mode based on configuration and client capabilities.
 *
 * This function implements the 'auto' serving mode logic:
 * 1. If `configuredMode` is 'auto', select the best mode for the platform
 * 2. If a specific mode is forced, check if the platform supports it
 * 3. If the platform doesn't support the mode, return `null` (skip UI)
 *
 * @example
 * ```typescript
 * const result = resolveServingMode({
 *   configuredMode: 'auto',
 *   platformType: 'openai',
 * });
 * // { effectiveMode: 'inline', useDualPayload: false, supportsUI: true, ... }
 *
 * const claudeResult = resolveServingMode({
 *   configuredMode: 'auto',
 *   platformType: 'claude',
 * });
 * // { effectiveMode: 'inline', useDualPayload: true, supportsUI: true, ... }
 *
 * const geminiResult = resolveServingMode({
 *   configuredMode: 'auto',
 *   platformType: 'gemini',
 * });
 * // { effectiveMode: null, useDualPayload: false, supportsUI: false, ... }
 * ```
 */
export function resolveServingMode(options: ResolveServingModeOptions): ResolvedServingMode {
  const { configuredMode = 'auto', platformType } = options;
  const capabilities = PLATFORM_CAPABILITIES[platformType] || PLATFORM_CAPABILITIES.unknown;

  // If platform doesn't support widgets at all
  if (!capabilities.supportsWidgets) {
    return {
      effectiveMode: null,
      useDualPayload: false,
      supportsUI: false,
      reason: `Platform '${platformType}' does not support widget UI`,
    };
  }

  // Auto mode: use platform's default mode
  if (configuredMode === 'auto') {
    return {
      effectiveMode: capabilities.defaultMode,
      useDualPayload: capabilities.useDualPayload,
      supportsUI: true,
      reason: `Auto-selected '${capabilities.defaultMode}' for platform '${platformType}'`,
    };
  }

  // Specific mode: check if platform supports it
  if (capabilities.supportedModes.includes(configuredMode)) {
    return {
      effectiveMode: configuredMode,
      useDualPayload: capabilities.useDualPayload,
      supportsUI: true,
      reason: `Using configured mode '${configuredMode}' (supported by '${platformType}')`,
    };
  }

  // Mode not supported by platform: skip UI
  return {
    effectiveMode: null,
    useDualPayload: false,
    supportsUI: false,
    reason: `Mode '${configuredMode}' not supported by platform '${platformType}'. Supported: ${
      capabilities.supportedModes.join(', ') || 'none'
    }`,
  };
}

/**
 * Check if a platform supports a specific serving mode.
 */
export function isPlatformModeSupported(platformType: AIPlatformType, mode: WidgetServingMode): boolean {
  const capabilities = PLATFORM_CAPABILITIES[platformType] || PLATFORM_CAPABILITIES.unknown;

  if (mode === 'auto') {
    return capabilities.supportsWidgets;
  }

  return capabilities.supportedModes.includes(mode);
}

/**
 * Get the default serving mode for a platform.
 */
export function getDefaultServingMode(platformType: AIPlatformType): Exclude<WidgetServingMode, 'auto'> | null {
  const capabilities = PLATFORM_CAPABILITIES[platformType] || PLATFORM_CAPABILITIES.unknown;
  return capabilities.supportsWidgets ? capabilities.defaultMode : null;
}

/**
 * Check if a platform uses dual-payload format.
 */
export function platformUsesDualPayload(platformType: AIPlatformType): boolean {
  const capabilities = PLATFORM_CAPABILITIES[platformType] || PLATFORM_CAPABILITIES.unknown;
  return capabilities.useDualPayload;
}

/**
 * Check if a platform supports widget UI via _meta.
 *
 * These platforms can read HTML from _meta['ui/html'] and render it
 * in a sandboxed iframe. They don't need the content blocks filled with
 * formatted data since the widget handles display.
 */
export function platformSupportsWidgets(platformType: AIPlatformType): boolean {
  return platformType === 'openai' || platformType === 'ext-apps' || platformType === 'cursor';
}
