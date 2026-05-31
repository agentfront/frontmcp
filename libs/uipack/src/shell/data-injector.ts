/**
 * Data Injector
 *
 * Injects tool data (input, output, metadata) into HTML as window globals.
 * Provides template helper functions for safe HTML rendering.
 *
 * @packageDocumentation
 */

import { escapeHtml, escapeScriptClose, safeJsonForScript } from '../utils';
import type { WidgetSizing } from './types';

/**
 * Whether a sizing config carries any value worth injecting/applying.
 *
 * `autoResize` is reported even when it's the only field set so authors can
 * opt OUT (`autoResize: false`) without also setting a height.
 */
export function hasSizing(sizing?: WidgetSizing): sizing is WidgetSizing {
  if (!sizing) return false;
  return (
    sizing.preferredHeight !== undefined ||
    sizing.minHeight !== undefined ||
    sizing.maxHeight !== undefined ||
    sizing.aspectRatio !== undefined ||
    sizing.autoResize !== undefined
  );
}

/**
 * Generate a script tag that injects tool data as window globals.
 *
 * Sets `window.__mcpToolName`, `window.__mcpToolInput`,
 * `window.__mcpToolOutput`, and `window.__mcpStructuredContent`. When `sizing`
 * is provided it also sets `window.__mcpWidgetSizing` so the bridge runtime can
 * apply CSS and drive auto-resize.
 */
export function buildDataInjectionScript(options: {
  toolName: string;
  input?: unknown;
  output?: unknown;
  structuredContent?: unknown;
  sizing?: WidgetSizing;
}): string {
  const { toolName, input, output, structuredContent, sizing } = options;

  const lines = [
    `window.__mcpAppsEnabled = true;`,
    `window.__mcpToolName = ${safeJsonForScript(toolName)};`,
    `window.__mcpToolInput = ${safeJsonForScript(input ?? null)};`,
    `window.__mcpToolOutput = ${safeJsonForScript(output ?? null)};`,
    `window.__mcpStructuredContent = ${safeJsonForScript(structuredContent ?? null)};`,
  ];

  if (hasSizing(sizing)) {
    lines.push(`window.__mcpWidgetSizing = ${safeJsonForScript(sizing)};`);
  }

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
