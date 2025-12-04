/**
 * Template Helpers
 *
 * Utility functions available in template rendering context.
 * These helpers provide safe HTML generation, formatting, and
 * other common operations needed by tool UI templates.
 */

import type { TemplateHelpers } from '../../common/metadata/tool-ui.metadata';

let idCounter = 0;

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(str: string): string {
  if (typeof str !== 'string') {
    return String(str ?? '');
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format a date for display.
 * @param date - Date object or ISO string
 * @param format - Optional format: 'iso', 'time', 'datetime', or default (localized date)
 */
export function formatDate(date: Date | string, format?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return String(date);
  }

  switch (format) {
    case 'iso':
      return d.toISOString();
    case 'time':
      return d.toLocaleTimeString();
    case 'datetime':
      return d.toLocaleString();
    default:
      return d.toLocaleDateString();
  }
}

/**
 * Format a number as currency.
 * @param amount - The numeric amount
 * @param currency - ISO 4217 currency code (default: 'USD')
 */
export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Generate a unique ID for DOM elements.
 * @param prefix - Optional prefix for the ID
 */
export function uniqueId(prefix = 'mcp'): string {
  return `${prefix}-${++idCounter}-${Date.now().toString(36)}`;
}

/**
 * Safely embed JSON data in HTML.
 * Escapes characters that could break out of script tags or HTML.
 */
export function jsonEmbed(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027');
}

/**
 * Create a TemplateHelpers object with all helper functions.
 */
export function createTemplateHelpers(): TemplateHelpers {
  return {
    escapeHtml,
    formatDate,
    formatCurrency,
    uniqueId,
    jsonEmbed,
  };
}

/**
 * Reset the ID counter (useful for testing).
 * @internal
 */
export function resetIdCounter(): void {
  idCounter = 0;
}
