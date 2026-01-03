/**
 * @file tool-configs.ts
 * @description Shared tool configurations for platform E2E testing.
 *
 * These configurations provide consistent test fixtures for validating
 * platform-specific meta key behavior across E2E test projects.
 *
 * @example Usage in E2E tool implementation
 * ```typescript
 * import { Tool, ToolContext } from '@frontmcp/sdk';
 * import { BASIC_UI_TOOL_CONFIG, FULL_UI_TOOL_CONFIG } from '@frontmcp/testing';
 *
 * @Tool({
 *   name: BASIC_UI_TOOL_CONFIG.name,
 *   description: BASIC_UI_TOOL_CONFIG.description,
 *   ui: BASIC_UI_TOOL_CONFIG.ui,
 * })
 * export class BasicUITool extends ToolContext<typeof inputSchema, typeof outputSchema> {
 *   async execute(input) {
 *     return { message: `Hello, ${input.name}!`, timestamp: Date.now() };
 *   }
 * }
 * ```
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════
// BASIC UI TOOL CONFIG
// ═══════════════════════════════════════════════════════════════════

/**
 * Input schema for the basic UI tool.
 */
export const basicUIToolInputSchema = z.object({
  name: z.string().optional().default('World'),
});

/**
 * Output schema for the basic UI tool.
 */
export const basicUIToolOutputSchema = z.object({
  message: z.string(),
  timestamp: z.number(),
});

/**
 * Basic UI tool configuration with minimal UI config.
 * Use this for testing that platform-specific meta keys are correctly applied.
 */
export const BASIC_UI_TOOL_CONFIG = {
  name: 'platform-test-basic',
  description: 'Basic UI tool for platform testing',
  inputSchema: basicUIToolInputSchema,
  outputSchema: basicUIToolOutputSchema,
  ui: {
    /**
     * Simple template that displays the output.
     * Works with all platforms.
     */
    template: `
<div class="platform-test-basic">
  <h1>Platform Test - Basic</h1>
  <p>Message: {output.message}</p>
  <p>Timestamp: {output.timestamp}</p>
</div>
    `.trim(),
  },
} as const;

// ═══════════════════════════════════════════════════════════════════
// FULL UI TOOL CONFIG
// ═══════════════════════════════════════════════════════════════════

/**
 * Input schema for the full UI tool.
 */
export const fullUIToolInputSchema = z.object({
  name: z.string().optional().default('World'),
  count: z.number().optional().default(1),
});

/**
 * Output schema for the full UI tool.
 */
export const fullUIToolOutputSchema = z.object({
  message: z.string(),
  count: z.number(),
  items: z.array(z.string()),
  timestamp: z.number(),
});

/**
 * Full UI tool configuration with all UI options.
 * Use this for testing comprehensive platform-specific meta key behavior.
 */
export const FULL_UI_TOOL_CONFIG = {
  name: 'platform-test-full',
  description: 'Full UI tool with all options for comprehensive platform testing',
  inputSchema: fullUIToolInputSchema,
  outputSchema: fullUIToolOutputSchema,
  ui: {
    /**
     * Template with more complex UI elements.
     */
    template: `
<div class="platform-test-full">
  <h1>Platform Test - Full</h1>
  <div class="message-box">
    <strong>Message:</strong> {output.message}
  </div>
  <div class="count-box">
    <strong>Count:</strong> {output.count}
  </div>
  <div class="items-list">
    <strong>Items:</strong>
    <ul>
      {output.items.map(item => <li key={item}>{item}</li>)}
    </ul>
  </div>
  <footer>
    <small>Generated at: {new Date(output.timestamp).toISOString()}</small>
  </footer>
</div>
    `.trim(),
    /**
     * Widget is accessible for callback invocations.
     */
    widgetAccessible: true,
    /**
     * Invocation status messages for OpenAI.
     */
    invocationStatus: {
      invoking: 'Processing request...',
      invoked: 'Request completed',
    },
    /**
     * Content Security Policy configuration.
     */
    csp: {
      connectDomains: ['https://api.example.com'],
      resourceDomains: ['https://cdn.example.com'],
    },
    /**
     * Display mode for the widget.
     */
    displayMode: 'inline' as const,
    /**
     * Prefers border around the widget.
     */
    prefersBorder: true,
    /**
     * Custom sandbox domain.
     */
    sandboxDomain: 'sandbox.example.com',
  },
} as const;

// ═══════════════════════════════════════════════════════════════════
// TOOL EXECUTION HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate output for the basic UI tool.
 */
export function generateBasicUIToolOutput(input: z.infer<typeof basicUIToolInputSchema>) {
  return {
    message: `Hello, ${input.name}!`,
    timestamp: Date.now(),
  };
}

/**
 * Generate output for the full UI tool.
 */
export function generateFullUIToolOutput(input: z.infer<typeof fullUIToolInputSchema>) {
  const items: string[] = [];
  for (let i = 1; i <= input.count; i++) {
    items.push(`Item ${i}`);
  }
  return {
    message: `Hello, ${input.name}! You requested ${input.count} item(s).`,
    count: input.count,
    items,
    timestamp: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// EXPECTED META KEYS
// ═══════════════════════════════════════════════════════════════════

/**
 * Expected meta keys for OpenAI platform in tools/list response.
 */
export const EXPECTED_OPENAI_TOOLS_LIST_META_KEYS = [
  'openai/outputTemplate',
  'openai/resultCanProduceWidget',
  'openai/widgetAccessible',
] as const;

/**
 * Expected meta keys for OpenAI platform in tools/call response.
 */
export const EXPECTED_OPENAI_TOOL_CALL_META_KEYS = ['openai/html', 'openai/mimeType', 'openai/type'] as const;

/**
 * Expected meta keys for ext-apps platform in tools/list response (SEP-1865).
 */
export const EXPECTED_EXTAPPS_TOOLS_LIST_META_KEYS = ['ui/resourceUri', 'ui/mimeType', 'ui/cdn', 'ui/type'] as const;

/**
 * Expected meta keys for ext-apps platform in tools/call response (SEP-1865).
 */
export const EXPECTED_EXTAPPS_TOOL_CALL_META_KEYS = ['ui/html', 'ui/mimeType', 'ui/type'] as const;

/**
 * Expected meta keys for generic MCP platforms in tools/list response (Claude, Cursor, etc.).
 * Uses ui/* namespace only.
 */
export const EXPECTED_GENERIC_TOOLS_LIST_META_KEYS = ['ui/resourceUri', 'ui/mimeType', 'ui/cdn', 'ui/type'] as const;

/**
 * Expected meta keys for generic MCP platforms in tools/call response (Claude, Cursor, etc.).
 * Uses ui/* namespace only.
 */
export const EXPECTED_GENERIC_TOOL_CALL_META_KEYS = ['ui/html', 'ui/mimeType'] as const;

/**
 * @deprecated Use EXPECTED_GENERIC_TOOLS_LIST_META_KEYS instead
 */
export const EXPECTED_FRONTMCP_TOOLS_LIST_META_KEYS = EXPECTED_GENERIC_TOOLS_LIST_META_KEYS;

/**
 * @deprecated Use EXPECTED_GENERIC_TOOL_CALL_META_KEYS instead
 */
export const EXPECTED_FRONTMCP_TOOL_CALL_META_KEYS = EXPECTED_GENERIC_TOOL_CALL_META_KEYS;
