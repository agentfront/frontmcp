/**
 * Preview Types
 *
 * Type definitions for platform-specific preview handlers.
 *
 * @packageDocumentation
 */

import type { BuilderResult } from '../build/builders/types';

// Re-export AIPlatformType from the canonical source for convenience
export type { AIPlatformType } from '../adapters/platform-meta';

// ============================================
// Platform Types
// ============================================

/**
 * Supported MCP platforms for preview handlers.
 *
 * This is a strict subset used for preview handler routing.
 * - 'openai': OpenAI ChatGPT platform
 * - 'claude': Anthropic Claude platform
 * - 'generic': All other MCP clients
 *
 * For broader platform detection (including IDEs), see AIPlatformType
 * from the adapters module, which is the canonical source for that type.
 */
export type Platform = 'openai' | 'claude' | 'generic';

// ============================================
// Preview Options
// ============================================

/**
 * Options for generating discovery metadata (tools/list).
 */
export interface DiscoveryPreviewOptions {
  /**
   * Build result from a builder.
   */
  buildResult: BuilderResult;

  /**
   * Name of the tool.
   */
  toolName: string;

  /**
   * Optional description for the widget.
   */
  description?: string;
}

/**
 * Options for generating execution metadata (tool/call).
 */
export interface ExecutionPreviewOptions {
  /**
   * Build result from a builder.
   */
  buildResult: BuilderResult;

  /**
   * Tool input arguments.
   */
  input: unknown;

  /**
   * Tool output/result data.
   */
  output: unknown;

  /**
   * Whether to enable builder mode (inject mock platform APIs).
   * @default false
   */
  builderMode?: boolean;

  /**
   * Mock data for builder mode.
   */
  mockData?: BuilderMockData;
}

/**
 * Mock data for builder mode preview.
 */
export interface BuilderMockData {
  /**
   * Theme to use ('light' | 'dark').
   */
  theme?: 'light' | 'dark';

  /**
   * Display mode.
   */
  displayMode?: 'inline' | 'immersive';

  /**
   * Mock tool call responses.
   */
  toolResponses?: Record<string, unknown>;
}

// ============================================
// Preview Results
// ============================================

/**
 * Result from discovery preview (tools/list).
 */
export interface DiscoveryMeta {
  /**
   * Metadata fields for the tool response.
   */
  _meta: Record<string, unknown>;

  /**
   * Resource URI (if static/hybrid mode with resource delivery).
   */
  resourceUri?: string;

  /**
   * Resource content (if resource needs to be registered).
   */
  resourceContent?: string;
}

/**
 * Result from execution preview (tool/call).
 */
export interface ExecutionMeta {
  /**
   * Metadata fields for the tool response.
   */
  _meta: Record<string, unknown>;

  /**
   * Complete HTML (for inline delivery).
   */
  html?: string;

  /**
   * Structured content for the response.
   */
  structuredContent?: unknown;

  /**
   * Text content for fallback display.
   */
  textContent?: string;
}

// ============================================
// Preview Handler Interface
// ============================================

/**
 * Interface for platform-specific preview handlers.
 */
export interface PreviewHandler {
  /**
   * Platform this handler is for.
   */
  readonly platform: Platform;

  /**
   * Generate metadata for tool discovery (tools/list).
   *
   * @param options - Discovery options
   * @returns Discovery metadata
   */
  forDiscovery(options: DiscoveryPreviewOptions): DiscoveryMeta;

  /**
   * Generate metadata for tool execution (tool/call).
   *
   * @param options - Execution options
   * @returns Execution metadata
   */
  forExecution(options: ExecutionPreviewOptions): ExecutionMeta;
}

// ============================================
// Meta Field Types
// ============================================

/**
 * OpenAI-specific metadata fields.
 */
export interface OpenAIMetaFields {
  'openai/outputTemplate'?: string;
  'openai/html'?: string;
  'openai/component'?: string;
  'openai/widgetCSP'?: {
    connect_domains?: string[];
    resource_domains?: string[];
  };
  'openai/widgetAccessible'?: boolean;
  'openai/displayMode'?: 'inline' | 'immersive';
  'openai/resultCanProduceWidget'?: boolean;
}

/**
 * Claude-specific metadata fields.
 */
export interface ClaudeMetaFields {
  'ui/html'?: string;
  'ui/mimeType'?: string;
  'claude/widgetDescription'?: string;
  'claude/prefersBorder'?: boolean;
}

/**
 * FrontMCP/Generic metadata fields.
 */
export interface FrontMCPMetaFields {
  'frontmcp/html'?: string;
  'frontmcp/outputTemplate'?: string;
  'frontmcp/component'?: string;
  'frontmcp/widgetCSP'?: {
    connect_domains?: string[];
    resource_domains?: string[];
  };
  'ui/html'?: string;
  'ui/mimeType'?: string;
}

/**
 * Combined metadata fields for all platforms.
 */
export type UIMetaFields = OpenAIMetaFields & ClaudeMetaFields & FrontMCPMetaFields;
