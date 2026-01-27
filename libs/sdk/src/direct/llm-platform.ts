/**
 * LLM Platform Detection and Formatting
 *
 * Detects LLM platform from clientInfo and formats tools/results accordingly.
 */

import type { Tool as McpTool, CallToolResult, TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';
import type { LLMPlatform, ClientInfo } from './client.types';

/**
 * Client info presets for each LLM platform.
 * Used by LLM-specific connect helpers.
 */
export const PLATFORM_CLIENT_INFO: Record<LLMPlatform, ClientInfo> = {
  openai: { name: 'openai', version: '1.0.0' },
  claude: { name: 'claude', version: '1.0.0' },
  langchain: { name: 'langchain', version: '1.0.0' },
  'vercel-ai': { name: 'vercel-ai', version: '1.0.0' },
  raw: { name: 'mcp-client', version: '1.0.0' },
};

/**
 * Detect LLM platform from clientInfo.
 *
 * @param clientInfo - MCP client info from handshake
 * @returns Detected LLM platform
 *
 * @example
 * ```typescript
 * detectPlatform({ name: 'openai-agent', version: '1.0.0' }); // 'openai'
 * detectPlatform({ name: 'claude', version: '1.0.0' }); // 'claude'
 * detectPlatform({ name: 'my-agent', version: '1.0.0' }); // 'raw'
 * ```
 */
export function detectPlatform(clientInfo: ClientInfo): LLMPlatform {
  const name = clientInfo.name.toLowerCase();

  if (name.includes('openai') || name.includes('gpt')) {
    return 'openai';
  }
  if (name.includes('claude') || name.includes('anthropic')) {
    return 'claude';
  }
  if (name.includes('langchain')) {
    return 'langchain';
  }
  if (name.includes('vercel') || name.includes('ai-sdk')) {
    return 'vercel-ai';
  }

  return 'raw';
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Types
// ─────────────────────────────────────────────────────────────────────────────

/** OpenAI function calling tool format */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Types
// ─────────────────────────────────────────────────────────────────────────────

/** Anthropic Claude tool format */
export interface ClaudeTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// LangChain Types
// ─────────────────────────────────────────────────────────────────────────────

/** LangChain tool schema format */
export interface LangChainTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vercel AI Types
// ─────────────────────────────────────────────────────────────────────────────

/** Vercel AI SDK tool format */
export interface VercelAITool {
  description: string;
  parameters: Record<string, unknown>;
}

/** Vercel AI tools map */
export type VercelAITools = Record<string, VercelAITool>;

// ─────────────────────────────────────────────────────────────────────────────
// Platform-Agnostic Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Union of all platform-specific tool formats.
 * Returned by formatToolsForPlatform based on detected platform.
 */
export type FormattedTools = OpenAITool[] | ClaudeTool[] | LangChainTool[] | VercelAITools | McpTool[];

/**
 * Union of all platform-specific tool result formats.
 * Returned by formatResultForPlatform based on detected platform.
 */
export type FormattedToolResult =
  | string
  | unknown
  | Array<{ type: string; text: string }>
  | CallToolResult
  | {
      text?: string[];
      images?: Array<{ data: string; mimeType: string }>;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Tool Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize JSON schema for OpenAI strict mode.
 * OpenAI requires 'additionalProperties: false' for strict mode.
 *
 * Handles:
 * - Object types: adds additionalProperties: false
 * - Nested properties: recursively sanitizes
 * - Array items: recursively sanitizes
 * - Composition keywords (allOf, oneOf, anyOf): recursively sanitizes each variant
 */
function sanitizeSchemaForOpenAI(schema: Record<string, unknown>): Record<string, unknown> {
  // Clone to avoid mutating original
  const result = { ...schema };

  // Enforce additionalProperties: false for OpenAI strict mode compliance
  if (result['type'] === 'object') {
    result['additionalProperties'] = false;
  }

  // Recursively handle nested objects in properties
  if (result['properties'] && typeof result['properties'] === 'object') {
    const properties = result['properties'] as Record<string, Record<string, unknown>>;
    const sanitizedProperties: Record<string, Record<string, unknown>> = {};

    for (const [key, value] of Object.entries(properties)) {
      if (value && typeof value === 'object') {
        sanitizedProperties[key] = sanitizeSchemaForOpenAI(value);
      } else {
        sanitizedProperties[key] = value;
      }
    }

    result['properties'] = sanitizedProperties;
  }

  // Recursively handle array items
  if (result['items'] && typeof result['items'] === 'object') {
    result['items'] = sanitizeSchemaForOpenAI(result['items'] as Record<string, unknown>);
  }

  // Recursively handle composition keywords (allOf, oneOf, anyOf)
  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    if (Array.isArray(result[keyword])) {
      result[keyword] = (result[keyword] as Record<string, unknown>[]).map((variant) =>
        variant && typeof variant === 'object' ? sanitizeSchemaForOpenAI(variant) : variant,
      );
    }
  }

  return result;
}

/**
 * Format MCP tools for the specified LLM platform.
 *
 * @param tools - MCP tools from listTools()
 * @param platform - Target LLM platform
 * @returns Tools formatted for the platform
 */
export function formatToolsForPlatform(tools: McpTool[], platform: LLMPlatform): FormattedTools {
  switch (platform) {
    case 'openai':
      return tools.map(
        (tool): OpenAITool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: sanitizeSchemaForOpenAI(tool.inputSchema as Record<string, unknown>),
            strict: true,
          },
        }),
      );

    case 'claude':
      return tools.map(
        (tool): ClaudeTool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Record<string, unknown>,
        }),
      );

    case 'langchain':
      return tools.map(
        (tool): LangChainTool => ({
          name: tool.name,
          description: tool.description ?? `Execute ${tool.name}`,
          schema: tool.inputSchema as Record<string, unknown>,
        }),
      );

    case 'vercel-ai': {
      const result: VercelAITools = {};
      for (const tool of tools) {
        result[tool.name] = {
          description: tool.description ?? `Execute ${tool.name}`,
          parameters: tool.inputSchema as Record<string, unknown>,
        };
      }
      return result;
    }

    default:
      return tools;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Result Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract text content from MCP CallToolResult.
 * Used for platforms that expect simple string/JSON results.
 * Returns string for plain text, or parsed JSON (unknown) for structured data.
 */
function extractTextContent(result: CallToolResult): unknown {
  if (!result.content || result.content.length === 0) {
    return '';
  }

  // Combine all text content
  const textParts: string[] = [];
  for (const content of result.content) {
    if (content.type === 'text') {
      textParts.push((content as TextContent).text);
    }
  }

  if (textParts.length === 0) {
    return '';
  }

  const combined = textParts.join('\n');

  // Try to parse as JSON for structured results
  try {
    return JSON.parse(combined);
  } catch {
    return combined;
  }
}

/**
 * Extract structured result from MCP CallToolResult.
 * Used for Vercel AI SDK which expects structured data.
 */
function extractStructuredResult(result: CallToolResult): unknown {
  if (!result.content || result.content.length === 0) {
    return null;
  }

  // If single text content, try to parse as JSON
  if (result.content.length === 1 && result.content[0].type === 'text') {
    const text = (result.content[0] as TextContent).text;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // For multiple content items, return structured object
  const structured: {
    text?: string[];
    images?: Array<{ data: string; mimeType: string }>;
  } = {};

  for (const content of result.content) {
    if (content.type === 'text') {
      if (!structured.text) structured.text = [];
      structured.text.push((content as TextContent).text);
    } else if (content.type === 'image') {
      if (!structured.images) structured.images = [];
      const img = content as ImageContent;
      structured.images.push({ data: img.data, mimeType: img.mimeType });
    }
  }

  return structured;
}

/**
 * Format MCP CallToolResult for the specified LLM platform.
 *
 * Handles both content-based responses (standard CallToolResult) and
 * toolResult-based responses (newer MCP SDK versions).
 *
 * @param result - MCP tool result from callTool()
 * @param platform - Target LLM platform
 * @returns Result formatted for the platform
 */
export function formatResultForPlatform(result: CallToolResult, platform: LLMPlatform): FormattedToolResult {
  // Handle toolResult-based response (newer MCP SDK versions)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flexResult = result as any;
  if ('toolResult' in flexResult && flexResult.toolResult !== undefined) {
    // For toolResult responses, return as-is for most platforms
    switch (platform) {
      case 'openai':
      case 'langchain':
        return typeof flexResult.toolResult === 'string'
          ? flexResult.toolResult
          : JSON.stringify(flexResult.toolResult);
      case 'claude':
        return [{ type: 'text', text: JSON.stringify(flexResult.toolResult) }];
      case 'vercel-ai':
      default:
        return flexResult.toolResult;
    }
  }

  // Handle content-based response (standard CallToolResult)
  switch (platform) {
    case 'openai':
    case 'langchain':
      // OpenAI and LangChain expect simple string/JSON content
      return extractTextContent(result);

    case 'claude':
      // Claude can handle the content array directly
      return result.content;

    case 'vercel-ai':
      // Vercel AI SDK expects structured data
      return extractStructuredResult(result);

    default:
      // Raw - return full MCP result
      return result;
  }
}
