/**
 * React Renderer
 *
 * Renders React components directly.
 * Used for pre-compiled or imported React components.
 */

import React from 'react';
import type { ClientRenderer, UniversalContent, RenderContext } from '../types';

/**
 * React renderer implementation.
 *
 * Renders React components by creating elements with the provided props.
 * This is the highest priority renderer when a function is provided.
 *
 * @example
 * ```tsx
 * const WeatherCard = ({ output }) => (
 *   <div className="card">{output.temperature}°F</div>
 * );
 *
 * const content: UniversalContent = {
 *   type: 'react',
 *   source: WeatherCard,
 *   props: { output: { temperature: 72 } },
 * };
 *
 * // Renders: <div class="card">72°F</div>
 * ```
 */
export const reactRenderer: ClientRenderer = {
  type: 'react',
  priority: 30, // Highest priority for function components

  canHandle(content: UniversalContent): boolean {
    return content.type === 'react' || typeof content.source === 'function';
  },

  render(content: UniversalContent, context: RenderContext): React.ReactNode {
    const Component = content.source;

    // Must be a function for React rendering
    if (typeof Component !== 'function') {
      return React.createElement('div', {
        className: 'frontmcp-error',
        children: 'React renderer requires a component function',
      });
    }

    // Build props from content and context
    const props = {
      // Default props from context
      output: context.output,
      input: context.input,
      state: context.state,
      // Override with content-specific props
      ...content.props,
    };

    // Render the component
    return React.createElement(Component, props);
  },
};

/**
 * Check if a value is a React component.
 *
 * @param value - Value to check
 * @returns True if the value is a React component
 */
export function isReactComponent(value: unknown): boolean {
  if (typeof value !== 'function') {
    return false;
  }

  // Check for React.memo, forwardRef, etc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = value as any;
  const typeofSymbol = fn.$$typeof;

  if (typeofSymbol) {
    const symbolString = typeofSymbol.toString();
    return (
      symbolString.includes('react.memo') ||
      symbolString.includes('react.forward_ref') ||
      symbolString.includes('react.lazy')
    );
  }

  // Check for class components
  if (fn.prototype?.isReactComponent) {
    return true;
  }

  // Function components (heuristic: PascalCase name)
  if (fn.name && /^[A-Z]/.test(fn.name)) {
    return true;
  }

  return false;
}

/**
 * Wrap a component with error boundary behavior.
 *
 * @param Component - Component to wrap
 * @param fallback - Fallback to render on error
 * @returns Wrapped component
 */
export function withErrorBoundary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: React.ComponentType<any>,
  fallback?: React.ReactNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): React.ComponentType<any> {
  // Note: This is a simple wrapper. For true error boundaries,
  // use React's ErrorBoundary class component.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function WrappedComponent(props: any) {
    try {
      return React.createElement(Component, props);
    } catch (error) {
      console.error('[FrontMCP] Component render error:', error);
      return (
        fallback ??
        React.createElement('div', {
          className: 'frontmcp-error',
          children: 'Component failed to render',
        })
      );
    }
  };
}
