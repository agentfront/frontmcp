/**
 * React Renderer Adapter
 *
 * Client-side adapter for rendering React components.
 * Handles hydration, client-side rendering, and updates.
 *
 * @packageDocumentation
 */

import type { RendererAdapter, RenderContext, RenderOptions, RenderResult } from '@frontmcp/uipack/runtime';
import type { UIType } from '@frontmcp/uipack/types';

/**
 * React runtime interface.
 * Uses permissive types to support various React versions.
 */

interface ReactRuntime {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createElement: (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component?: any;
}

/**
 * ReactDOM runtime interface.
 * Uses permissive types to support React 17 and 18+.
 */

interface ReactDOMRuntime {
  createRoot?: (container: Element) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: (element: any) => void;
    unmount: () => void;
  };
  hydrateRoot?: (
    container: Element,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    element: any,
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: (element: any) => void;
    unmount: () => void;
  };
  // Legacy APIs (React 17)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render?: (element: any, container: Element) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hydrate?: (element: any, container: Element) => void;
  unmountComponentAtNode?: (container: Element) => boolean;
}

/**
 * Root reference for cleanup.
 */
interface RootRef {
  unmount: () => void;
}

/**
 * Map of mounted roots for cleanup.
 */
const mountedRoots = new WeakMap<HTMLElement, RootRef>();

/**
 * React Renderer Adapter.
 *
 * Renders React components to the DOM with support for:
 * - Server-side rendering (SSR)
 * - Client-side hydration
 * - Dynamic updates when data changes
 */
export class ReactRendererAdapter implements RendererAdapter {
  readonly type: UIType = 'react';

  // Lazy-loaded React runtime
  private react: ReactRuntime | null = null;
  private reactDOM: ReactDOMRuntime | null = null;
  private loadPromise: Promise<void> | null = null;

  /**
   * Check if this adapter can handle the given content.
   */
  canHandle(content: string | unknown): boolean {
    // React adapter handles:
    // - Functions (React components)
    // - Strings that look like JSX
    if (typeof content === 'function') {
      return true;
    }

    if (typeof content === 'string') {
      // Check for JSX patterns
      return (
        content.includes('React.createElement') ||
        content.includes('jsx(') ||
        content.includes('jsxs(') ||
        /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*return\s*[\s\S]*</.test(content)
      );
    }

    return false;
  }

  /**
   * Render React component to a string.
   * This is a client-side fallback - SSR should be done at build time.
   */
  async render(content: string, context: RenderContext, _options?: RenderOptions): Promise<string> {
    // For client-side, we can't SSR React
    // Return a placeholder that will be hydrated
    return `<div data-frontmcp-react data-tool="${context.toolName}">${content}</div>`;
  }

  /**
   * Render React component directly to the DOM.
   */
  async renderToDOM(
    content: string,
    target: HTMLElement,
    context: RenderContext,
    options?: RenderOptions,
  ): Promise<RenderResult> {
    try {
      await this.ensureReactLoaded();

      if (!this.react || !this.reactDOM) {
        throw new Error('React runtime not available');
      }

      // Try to get component from registered components
      const componentName = target.getAttribute('data-component');
      const component = this.getComponent(componentName, content);

      if (!component) {
        // Fall back to HTML rendering
        target.innerHTML = content;
        return { success: true };
      }

      // Create React element with context as props
      const element = this.react.createElement(component, {
        input: context.input,
        output: context.output,
        structuredContent: context.structuredContent,
        toolName: context.toolName,
      });

      // Render or hydrate
      if (options?.hydrate && this.reactDOM.hydrateRoot) {
        const root = this.reactDOM.hydrateRoot(target, element);
        mountedRoots.set(target, root);
      } else if (this.reactDOM.createRoot) {
        const root = this.reactDOM.createRoot(target);
        root.render(element);
        mountedRoots.set(target, root);
      } else if (this.reactDOM.render) {
        // Legacy React 17 API
        this.reactDOM.render(element, target);
        mountedRoots.set(target, {
          unmount: () => this.reactDOM?.unmountComponentAtNode?.(target),
        });
      } else {
        throw new Error('No suitable React render method available');
      }

      // Dispatch event
      target.dispatchEvent(
        new CustomEvent('frontmcp:rendered', {
          bubbles: true,
          detail: { type: 'react', toolName: context.toolName },
        }),
      );

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[FrontMCP] React render failed:', message);
      return { success: false, error: message };
    }
  }

  /**
   * Hydrate existing SSR content with React.
   */
  async hydrate(target: HTMLElement, context: RenderContext, options?: RenderOptions): Promise<RenderResult> {
    return this.renderToDOM('', target, context, { ...options, hydrate: true });
  }

  /**
   * Update rendered React component with new data.
   */
  async update(target: HTMLElement, context: RenderContext): Promise<RenderResult> {
    try {
      await this.ensureReactLoaded();

      if (!this.react) {
        throw new Error('React runtime not available');
      }

      const existingRoot = mountedRoots.get(target);
      const componentName = target.getAttribute('data-component');
      const component = this.getComponent(componentName, '');

      if (!component) {
        return { success: false, error: 'No component found for update' };
      }

      // Create new element with updated props
      const element = this.react.createElement(component, {
        input: context.input,
        output: context.output,
        structuredContent: context.structuredContent,
        toolName: context.toolName,
      });

      if (existingRoot && 'render' in existingRoot) {
        (existingRoot as { render: (el: unknown) => void }).render(element);
        return { success: true };
      }

      // No existing root - do a fresh render
      return this.renderToDOM('', target, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[FrontMCP] React update failed:', message);
      return { success: false, error: message };
    }
  }

  /**
   * Clean up React root.
   */
  destroy(target: HTMLElement): void {
    const root = mountedRoots.get(target);
    if (root) {
      root.unmount();
      mountedRoots.delete(target);
    }
  }

  /**
   * Ensure React is loaded.
   */
  private async ensureReactLoaded(): Promise<void> {
    if (this.react && this.reactDOM) {
      return;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadReact();
    return this.loadPromise;
  }

  /**
   * Load React runtime.
   */
  private async loadReact(): Promise<void> {
    // Check if React is already available globally
    const win = typeof window !== 'undefined' ? window : (globalThis as unknown as Window);

    if ((win as unknown as { React?: ReactRuntime }).React) {
      this.react = (win as unknown as { React: ReactRuntime }).React;
    }

    if ((win as unknown as { ReactDOM?: ReactDOMRuntime }).ReactDOM) {
      this.reactDOM = (win as unknown as { ReactDOM: ReactDOMRuntime }).ReactDOM;
    }

    if (this.react && this.reactDOM) {
      return;
    }

    // Try to dynamically import React
    try {
      if (!this.react) {
        const reactModule = await import(/* webpackIgnore: true */ 'react');
        this.react = reactModule.default || reactModule;
      }

      if (!this.reactDOM) {
        const reactDOMModule = await import(/* webpackIgnore: true */ 'react-dom/client');
        this.reactDOM = reactDOMModule.default || reactDOMModule;
      }
    } catch {
      // React not available via import - rely on global
      if (!this.react || !this.reactDOM) {
        console.warn('[FrontMCP] React runtime not available. ' + 'Ensure React is loaded via CDN or bundled.');
      }
    }
  }

  /**
   * Get a React component by name or from content.
   */
  private getComponent(componentName: string | null, content: string): React.ComponentType<unknown> | null {
    const win = typeof window !== 'undefined' ? window : (globalThis as unknown as Window);

    // Check registered components
    type ComponentRegistry = {
      __frontmcp_components?: Record<string, React.ComponentType<unknown>>;
    };

    if (componentName && (win as ComponentRegistry).__frontmcp_components) {
      const registered = (win as ComponentRegistry).__frontmcp_components?.[componentName];
      if (registered) {
        return registered;
      }
    }

    // Try to evaluate content as a component (unsafe - should be pre-bundled)
    if (content && typeof content === 'function') {
      return content as React.ComponentType<unknown>;
    }

    return null;
  }
}

/**
 * Create a new React renderer adapter.
 */
export function createReactAdapter(): ReactRendererAdapter {
  return new ReactRendererAdapter();
}

/**
 * Adapter loader for lazy loading.
 */
export async function loadReactAdapter(): Promise<RendererAdapter> {
  return createReactAdapter();
}
