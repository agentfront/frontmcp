/**
 * @file utils.ts
 * @description Utility functions for React wrapper components.
 *
 * Provides helpers for converting React children to HTML strings
 * for SSR compatibility with FrontMCP web components.
 *
 * @module @frontmcp/ui/react/utils
 */

import type { ReactNode } from 'react';
import { escapeHtml } from '@frontmcp/uipack/layouts';

// Lazy-load ReactDOMServer to avoid import errors in non-React environments
let cachedReactDOMServer: typeof import('react-dom/server') | null = null;

/**
 * Get ReactDOMServer lazily (only when needed)
 */
function getReactDOMServer(): typeof import('react-dom/server') | null {
  if (!cachedReactDOMServer) {
    try {
      cachedReactDOMServer = require('react-dom/server');
    } catch {
      return null;
    }
  }
  return cachedReactDOMServer;
}

/**
 * Convert React children to an HTML string for SSR.
 *
 * - Strings are escaped via escapeHtml()
 * - Numbers are converted to strings
 * - ReactNode is rendered via ReactDOMServer.renderToStaticMarkup()
 * - null/undefined return empty string
 *
 * @param children - React children to convert
 * @returns HTML string representation
 *
 * @example
 * ```tsx
 * // String children
 * renderChildrenToString('Hello') // 'Hello' (escaped)
 *
 * // React element children
 * renderChildrenToString(<div>Test</div>) // '<div>Test</div>'
 *
 * // Mixed children
 * renderChildrenToString(['Hello', <span>World</span>])
 * ```
 */
export function renderChildrenToString(children: ReactNode): string {
  // Handle null/undefined
  if (children == null) {
    return '';
  }

  // Handle string - escape HTML
  if (typeof children === 'string') {
    return escapeHtml(children);
  }

  // Handle number - convert to string
  if (typeof children === 'number') {
    return String(children);
  }

  // Handle boolean - React doesn't render true/false
  if (typeof children === 'boolean') {
    return '';
  }

  // Handle React elements and arrays - use ReactDOMServer
  try {
    const server = getReactDOMServer();
    if (server) {
      return server.renderToStaticMarkup(children as React.ReactElement);
    }
    // Fallback for non-React environments
    return String(children);
  } catch {
    // Fallback for non-React environments
    return String(children);
  }
}

/**
 * Check if we're running in a browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Check if we're running in a Node.js environment
 */
export function isServer(): boolean {
  return typeof window === 'undefined';
}
