/**
 * Serving Mode Resolution
 *
 * Platform-aware serving mode resolution for MCP tool UI.
 *
 * @packageDocumentation
 */

/**
 * Platform types recognized by the serving mode resolver.
 */
export type AdapterPlatformType = 'openai' | 'ext-apps' | 'claude' | 'gemini' | 'generic-mcp' | 'unknown' | string;

/**
 * Input for serving mode resolution.
 */
export interface ResolveServingModeOptions {
  /** The configured serving mode from the tool's UI config */
  configuredMode: string;
  /** The detected platform type */
  platformType: AdapterPlatformType;
}

/**
 * Result of serving mode resolution.
 */
export interface ServingModeResult {
  /** The original configured mode */
  mode: string;
  /** Whether the platform supports UI rendering */
  supportsUI: boolean;
  /** The effective serving mode to use, or null if UI not supported */
  effectiveMode: string | null;
  /** Whether to include structuredContent in the tool response */
  useStructuredContent: boolean;
  /** Reason for the decision (for logging) */
  reason?: string;
}

/**
 * Resolve the effective serving mode based on platform capabilities.
 *
 * - Gemini: No UI support
 * - OpenAI, ext-apps, claude, generic-mcp, unknown: UI supported, inline mode
 * - OpenAI/ext-apps/generic-mcp/unknown: include structuredContent
 */
export function resolveServingMode(options: ResolveServingModeOptions): ServingModeResult {
  const { configuredMode, platformType } = options;

  // Gemini does not support MCP UI
  if (platformType === 'gemini') {
    return {
      mode: configuredMode,
      supportsUI: false,
      effectiveMode: null,
      useStructuredContent: false,
      reason: 'Gemini does not support MCP Apps UI',
    };
  }

  // Determine effective mode
  const effectiveMode: string | null = configuredMode === 'auto' ? 'inline' : configuredMode;

  // Hybrid mode is only supported by widget-capable platforms
  if (effectiveMode === 'hybrid') {
    const hybridCapable = platformType === 'openai' || platformType === 'ext-apps' || platformType === 'cursor';
    if (!hybridCapable) {
      return {
        mode: configuredMode,
        supportsUI: false,
        effectiveMode: null,
        useStructuredContent: false,
        reason: `Platform ${platformType} does not support hybrid serving mode`,
      };
    }
  }

  // Determine if structuredContent should be included
  const useStructuredContent =
    platformType === 'openai' ||
    platformType === 'ext-apps' ||
    platformType === 'generic-mcp' ||
    platformType === 'unknown';

  return {
    mode: configuredMode,
    supportsUI: true,
    effectiveMode,
    useStructuredContent,
    reason: `Platform ${platformType} supports UI, mode: ${effectiveMode}`,
  };
}
