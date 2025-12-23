/**
 * LLM Platform Configurations
 *
 * Different LLM platforms have different capabilities for rendering UI:
 * - OpenAI: Full support (Canvas/Apps SDK) - Tailwind + HTMX with network
 * - Claude: Artifacts mode - Tailwind but NO network (scripts must be inlined)
 * - Gemini: No interactive widget support
 * - Custom MCP: Configurable based on client capabilities
 *
 * This module provides platform presets and utilities for building
 * compatible UI across different environments.
 */

// ============================================
// Platform Types
// ============================================

/**
 * Known LLM platform identifiers
 */
export type PlatformId = 'openai' | 'claude' | 'gemini' | 'custom';

/**
 * Network access mode for the platform
 */
export type NetworkMode =
  | 'full' // Full network access (CDN, API calls)
  | 'blocked' // No network access (must inline everything)
  | 'limited'; // Limited network (specific domains only)

/**
 * Script loading strategy
 */
export type ScriptStrategy =
  | 'cdn' // Load from CDN URLs
  | 'inline' // Inline script content directly
  | 'cached'; // Load once and cache for reuse

/**
 * Platform capabilities configuration
 */
export interface PlatformCapabilities {
  /** Platform identifier */
  id: PlatformId;

  /** Human-readable name */
  name: string;

  /** Whether platform supports interactive widgets */
  supportsWidgets: boolean;

  /** Whether platform supports Tailwind CSS */
  supportsTailwind: boolean;

  /** Whether platform supports HTMX/dynamic content */
  supportsHtmx: boolean;

  /** Network access mode */
  networkMode: NetworkMode;

  /** How to load scripts */
  scriptStrategy: ScriptStrategy;

  /** Allowed domains for network requests (if limited) */
  allowedDomains?: string[];

  /** Content Security Policy restrictions */
  cspRestrictions?: string[];

  /** Maximum inline script size (bytes) */
  maxInlineSize?: number;

  /** Additional platform-specific options */
  options?: Record<string, unknown>;
}

// ============================================
// Platform Presets
// ============================================

/**
 * OpenAI Platform Configuration
 * Full support via Canvas/Apps SDK
 */
export const OPENAI_PLATFORM: PlatformCapabilities = {
  id: 'openai',
  name: 'OpenAI',
  supportsWidgets: true,
  supportsTailwind: true,
  supportsHtmx: true,
  networkMode: 'full',
  scriptStrategy: 'cdn',
  options: {
    sdk: 'apps-sdk',
    version: '1.0',
  },
};

/**
 * Claude Platform Configuration
 * Artifacts mode - no network access, must inline scripts
 */
export const CLAUDE_PLATFORM: PlatformCapabilities = {
  id: 'claude',
  name: 'Claude (Artifacts)',
  supportsWidgets: true,
  supportsTailwind: true,
  supportsHtmx: false, // Network blocked, HTMX won't work for API calls
  networkMode: 'limited',
  scriptStrategy: 'cdn',
  maxInlineSize: 100 * 1024, // 100KB limit for artifacts
  cspRestrictions: ["script-src 'unsafe-inline'", "connect-src 'none'"],
  options: {
    mode: 'artifacts',
    framework: 'react', // Claude artifacts prefer React
  },
};

/**
 * Gemini Platform Configuration
 * No interactive widget support
 */
export const GEMINI_PLATFORM: PlatformCapabilities = {
  id: 'gemini',
  name: 'Gemini',
  supportsWidgets: false,
  supportsTailwind: false,
  supportsHtmx: false,
  networkMode: 'limited',
  scriptStrategy: 'inline',
  options: {
    fallback: 'markdown', // Fall back to markdown rendering
  },
};

/**
 * Default custom MCP client configuration
 */
export const CUSTOM_PLATFORM: PlatformCapabilities = {
  id: 'custom',
  name: 'Custom MCP Client',
  supportsWidgets: true,
  supportsTailwind: true,
  supportsHtmx: true,
  networkMode: 'full',
  scriptStrategy: 'cdn',
};

/**
 * All platform presets
 */
export const PLATFORM_PRESETS: Record<PlatformId, PlatformCapabilities> = {
  openai: OPENAI_PLATFORM,
  claude: CLAUDE_PLATFORM,
  gemini: GEMINI_PLATFORM,
  custom: CUSTOM_PLATFORM,
};

// ============================================
// Platform Detection & Utilities
// ============================================

/**
 * Get platform capabilities by ID
 */
export function getPlatform(id: PlatformId): PlatformCapabilities {
  return PLATFORM_PRESETS[id] ?? CUSTOM_PLATFORM;
}

/**
 * Create custom platform configuration
 */
export function createPlatform(
  base: Partial<PlatformCapabilities> & { id: PlatformId; name: string },
): PlatformCapabilities {
  const preset = PLATFORM_PRESETS[base.id] ?? CUSTOM_PLATFORM;
  return { ...preset, ...base };
}

/**
 * Check if platform can use CDN resources
 */
export function canUseCdn(platform: PlatformCapabilities): boolean {
  return platform.networkMode === 'full' && platform.scriptStrategy === 'cdn';
}

/**
 * Check if platform needs inlined scripts
 */
export function needsInlineScripts(platform: PlatformCapabilities): boolean {
  return platform.scriptStrategy === 'inline' || platform.networkMode === 'blocked';
}

/**
 * Check if platform supports full interactivity
 */
export function supportsFullInteractivity(platform: PlatformCapabilities): boolean {
  return platform.supportsWidgets && platform.supportsHtmx && platform.networkMode === 'full';
}

/**
 * Get fallback rendering mode for unsupported platforms
 */
export function getFallbackMode(platform: PlatformCapabilities): 'html' | 'markdown' | 'text' {
  if (platform.supportsWidgets && platform.supportsTailwind) {
    return 'html';
  }
  if (platform.options?.['fallback'] === 'markdown') {
    return 'markdown';
  }
  return 'text';
}
