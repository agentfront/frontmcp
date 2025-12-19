/**
 * Universal App Component
 *
 * Main entry point for the universal renderer.
 * Handles loading states, error boundaries, and auto-detection.
 */

import React from 'react';
import type { UniversalAppProps, UniversalContent, RenderContext, FrontMCPState } from './types';
import { useFrontMCPStore } from './store';
import { useComponents, FrontMCPProvider, ComponentsProvider } from './context';
import { renderContent, detectRenderer } from './renderers';
import { escapeHtml } from '../utils/escape-html';

// ============================================
// Loading Component
// ============================================

/**
 * Default loading spinner component.
 */
function LoadingSpinner(): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'frontmcp-loading flex items-center justify-center min-h-[200px]' },
    React.createElement('div', {
      className: 'frontmcp-spinner w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin',
    }),
  );
}

// ============================================
// Error Component
// ============================================

/**
 * Default error display component.
 */
function ErrorDisplay({ error }: { error: string }): React.ReactElement {
  return React.createElement(
    'div',
    {
      className: 'frontmcp-error bg-red-50 border border-red-200 rounded-lg p-4 text-red-800',
    },
    [
      React.createElement('div', { key: 'title', className: 'font-medium' }, 'Error'),
      React.createElement('div', { key: 'message', className: 'text-sm mt-1' }, escapeHtml(error)),
    ],
  );
}

// ============================================
// Empty State Component
// ============================================

/**
 * Default empty state component.
 */
function EmptyState(): React.ReactElement {
  return React.createElement(
    'div',
    {
      className: 'frontmcp-empty text-gray-500 text-center py-8',
    },
    'No content to display',
  );
}

// ============================================
// Universal Renderer
// ============================================

/**
 * Core renderer component that handles content rendering.
 */
function UniversalRenderer({
  content,
  state,
}: {
  content: UniversalContent;
  state: FrontMCPState;
}): React.ReactElement {
  const components = useComponents();

  // Build render context
  const context: RenderContext = {
    output: state.output,
    input: state.input,
    components: {
      ...components,
      ...content.components,
    },
    state,
  };

  // Detect and use appropriate renderer
  const rendered = renderContent(content, context);

  return React.createElement('div', { className: 'frontmcp-content' }, rendered);
}

// ============================================
// Universal App
// ============================================

/**
 * Universal App component.
 *
 * Main entry point for the universal renderer. Handles:
 * - Loading states
 * - Error display
 * - Content auto-detection
 * - Custom component injection
 *
 * @example Basic usage
 * ```tsx
 * function App() {
 *   return (
 *     <FrontMCPProvider>
 *       <UniversalApp />
 *     </FrontMCPProvider>
 *   );
 * }
 * ```
 *
 * @example With custom content
 * ```tsx
 * const content: UniversalContent = {
 *   type: 'markdown',
 *   source: '# Hello World',
 * };
 *
 * function App() {
 *   return (
 *     <FrontMCPProvider>
 *       <UniversalApp content={content} />
 *     </FrontMCPProvider>
 *   );
 * }
 * ```
 *
 * @example With custom components
 * ```tsx
 * const components = {
 *   WeatherCard: ({ temp }) => <div>{temp}°F</div>,
 * };
 *
 * function App() {
 *   return (
 *     <FrontMCPProvider>
 *       <UniversalApp components={components} />
 *     </FrontMCPProvider>
 *   );
 * }
 * ```
 */
export function UniversalApp({
  content: contentOverride,
  components,
  fallback,
  errorFallback: ErrorFallback = ErrorDisplay,
}: UniversalAppProps): React.ReactElement {
  const state = useFrontMCPStore();

  // Handle loading state
  if (state.loading) {
    return fallback ? React.createElement(React.Fragment, null, fallback) : React.createElement(LoadingSpinner, null);
  }

  // Handle error state
  if (state.error) {
    return React.createElement(ErrorFallback, { error: state.error });
  }

  // Determine content to render
  const content = contentOverride ?? state.content;

  // Handle empty state
  if (!content) {
    return React.createElement(EmptyState, null);
  }

  // Render with components context
  if (components) {
    return React.createElement(
      ComponentsProvider,
      { components },
      React.createElement(UniversalRenderer, { content, state }),
    );
  }

  return React.createElement(UniversalRenderer, { content, state });
}

// ============================================
// Standalone Universal App
// ============================================

/**
 * Props for the standalone UniversalAppWithProvider.
 */
interface StandaloneAppProps extends UniversalAppProps {
  /** Initial store state */
  initialState?: Partial<FrontMCPState>;
}

/**
 * Standalone Universal App with built-in provider.
 *
 * Use this when you need a self-contained universal renderer
 * without manually setting up the provider.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <UniversalAppWithProvider
 *       initialState={{
 *         toolName: 'get_weather',
 *         output: { temperature: 72 },
 *       }}
 *       content={{
 *         type: 'markdown',
 *         source: '# Weather: {output.temperature}°F',
 *       }}
 *     />
 *   );
 * }
 * ```
 */
export function UniversalAppWithProvider({
  initialState,
  components,
  ...appProps
}: StandaloneAppProps): React.ReactElement {
  return React.createElement(
    FrontMCPProvider,
    { initialState },
    components
      ? React.createElement(ComponentsProvider, { components }, React.createElement(UniversalApp, appProps))
      : React.createElement(UniversalApp, appProps),
  );
}

// ============================================
// Re-exports for convenience
// ============================================

export { LoadingSpinner, ErrorDisplay, EmptyState };
