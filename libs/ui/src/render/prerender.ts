/**
 * @file prerender.ts
 * @description React 19 static rendering utilities.
 *
 * Provides both async (prerender) and sync (renderToStaticMarkup) methods
 * for converting React elements to HTML strings.
 *
 * @example Async rendering (recommended)
 * ```typescript
 * import { renderToString } from '@frontmcp/ui/render';
 * import { Card } from '@frontmcp/ui/components';
 *
 * const html = await renderToString(<Card title="Hello">Content</Card>);
 * ```
 *
 * @example Sync rendering (backwards compatible)
 * ```typescript
 * import { renderToStringSync } from '@frontmcp/ui/render';
 *
 * const html = renderToStringSync(<Card title="Hello">Content</Card>);
 * ```
 *
 * @module @frontmcp/ui/render
 */

/// <reference path="./react-dom-static.d.ts" />
import type { ReactElement } from 'react';

/**
 * Render a React element to static HTML string using React 19's prerender API.
 *
 * This is the recommended async method that:
 * - Waits for all Suspense boundaries to resolve
 * - Uses React 19's streaming prerender API
 * - Returns clean static HTML without hydration markers
 *
 * @param element - The React element to render
 * @returns Promise resolving to HTML string
 */
export async function renderToString(element: ReactElement): Promise<string> {
  // Dynamically import to avoid issues when react-dom is not installed
  const { prerender } = await import('react-dom/static');

  const { prelude } = await prerender(element);

  // Convert ReadableStream to string
  const reader = prelude.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  // Concatenate all chunks and decode
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(combined);
}

/**
 * Render a React element to static HTML string synchronously.
 *
 * This is the sync method for backwards compatibility that:
 * - Does NOT wait for Suspense boundaries
 * - Uses React's renderToStaticMarkup
 * - Returns clean static HTML without hydration markers
 *
 * @param element - The React element to render
 * @returns HTML string
 */
export function renderToStringSync(element: ReactElement): string {
  // Use dynamic require to handle optional react-dom dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactDOMServer = require('react-dom/server');
  return ReactDOMServer.renderToStaticMarkup(element);
}

/**
 * Check if React and react-dom are available.
 * Useful for conditional rendering in environments where React may not be installed.
 *
 * @returns true if React and react-dom are available
 */
export function isReactAvailable(): boolean {
  try {
    require('react');
    require('react-dom/server');
    return true;
  } catch {
    return false;
  }
}
