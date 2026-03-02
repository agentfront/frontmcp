/**
 * Data Injector
 *
 * Injects tool data (input, output, metadata) into HTML as window globals.
 * Provides template helper functions for safe HTML rendering.
 *
 * @packageDocumentation
 */

import { safeJsonForScript, escapeHtml, escapeScriptClose } from '../utils';

/**
 * Generate a script tag that injects tool data as window globals.
 *
 * Sets `window.__mcpToolName`, `window.__mcpToolInput`,
 * `window.__mcpToolOutput`, and `window.__mcpStructuredContent`.
 */
export function buildDataInjectionScript(options: {
  toolName: string;
  input?: unknown;
  output?: unknown;
  structuredContent?: unknown;
}): string {
  const { toolName, input, output, structuredContent } = options;

  const lines = [
    `window.__mcpToolName = ${safeJsonForScript(toolName)};`,
    `window.__mcpToolInput = ${safeJsonForScript(input ?? null)};`,
    `window.__mcpToolOutput = ${safeJsonForScript(output ?? null)};`,
    `window.__mcpStructuredContent = ${safeJsonForScript(structuredContent ?? null)};`,
  ];

  return `<script>\n${lines.join('\n')}\n</script>`;
}

/**
 * Template helper functions for safe rendering.
 */
export interface TemplateHelpers {
  /** Escape HTML special characters to prevent XSS */
  escapeHtml: (str: unknown) => string;
  /** Format a date for display */
  formatDate: (date: Date | string, format?: string) => string;
  /** Format a number as currency */
  formatCurrency: (amount: number, currency?: string) => string;
  /** Generate a unique ID for DOM elements */
  uniqueId: (prefix?: string) => string;
  /** Safely embed JSON data in HTML */
  jsonEmbed: (data: unknown) => string;
}

let _uniqueIdCounter = 0;

/**
 * Create template helper functions.
 */
export function createTemplateHelpers(): TemplateHelpers {
  return {
    escapeHtml: (str: unknown) => escapeHtml(str),

    formatDate: (date: Date | string, format?: string) => {
      const d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return String(date);

      if (format === 'iso') return d.toISOString();
      if (format === 'date') return d.toLocaleDateString();
      if (format === 'time') return d.toLocaleTimeString();
      return d.toLocaleString();
    },

    formatCurrency: (amount: number, currency = 'USD') => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).format(amount);
    },

    uniqueId: (prefix = 'mcp') => {
      return `${prefix}-${++_uniqueIdCounter}`;
    },

    jsonEmbed: (data: unknown) => {
      return escapeScriptClose(JSON.stringify(data));
    },
  };
}
