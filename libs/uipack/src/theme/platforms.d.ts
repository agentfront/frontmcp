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
/**
 * Known LLM platform identifiers
 */
export type PlatformId = 'openai' | 'claude' | 'gemini' | 'ngrok' | 'custom';
/**
 * Network access mode for the platform
 */
export type NetworkMode = 'full' | 'blocked' | 'limited';
/**
 * Script loading strategy
 */
export type ScriptStrategy = 'cdn' | 'inline' | 'cached';
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
/**
 * OpenAI Platform Configuration
 * Full support via Canvas/Apps SDK
 */
export declare const OPENAI_PLATFORM: PlatformCapabilities;
/**
 * Claude Platform Configuration
 * Artifacts mode - no network access, must inline scripts
 */
export declare const CLAUDE_PLATFORM: PlatformCapabilities;
/**
 * Gemini Platform Configuration
 * No interactive widget support
 */
export declare const GEMINI_PLATFORM: PlatformCapabilities;
/**
 * Ngrok Platform Configuration
 * Bridge/tunnel - essential for HTMX
 */
export declare const NGROK_PLATFORM: PlatformCapabilities;
/**
 * Default custom MCP client configuration
 */
export declare const CUSTOM_PLATFORM: PlatformCapabilities;
/**
 * All platform presets
 */
export declare const PLATFORM_PRESETS: Record<PlatformId, PlatformCapabilities>;
/**
 * Get platform capabilities by ID
 */
export declare function getPlatform(id: PlatformId): PlatformCapabilities;
/**
 * Create custom platform configuration
 */
export declare function createPlatform(
  base: Partial<PlatformCapabilities> & {
    id: PlatformId;
    name: string;
  },
): PlatformCapabilities;
/**
 * Check if platform can use CDN resources
 */
export declare function canUseCdn(platform: PlatformCapabilities): boolean;
/**
 * Check if platform needs inlined scripts
 */
export declare function needsInlineScripts(platform: PlatformCapabilities): boolean;
/**
 * Check if platform supports full interactivity
 */
export declare function supportsFullInteractivity(platform: PlatformCapabilities): boolean;
/**
 * Get fallback rendering mode for unsupported platforms
 */
export declare function getFallbackMode(platform: PlatformCapabilities): 'html' | 'markdown' | 'text';
//# sourceMappingURL=platforms.d.ts.map
