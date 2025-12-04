/**
 * React Renderer
 *
 * Handles React component templates:
 * - Imported React components (already transpiled)
 * - JSX string templates (transpiled at runtime with SWC)
 *
 * Uses react-dom/server for SSR to HTML.
 */

import type { TemplateContext } from '../runtime/types';
import type { PlatformCapabilities } from '../theme';
import type {
  UIRenderer,
  TranspileResult,
  TranspileOptions,
  RenderOptions,
  RuntimeScripts,
  ToolUIProps,
} from './types';
import { isReactComponent, containsJsx } from './utils/detect';
import { hashString } from './utils/hash';
import { transpileJsx, executeTranspiledCode } from './utils/transpiler';
import { transpileCache } from './cache';

/**
 * Types this renderer can handle.
 */
type ReactTemplate<In = unknown, Out = unknown> =
  | ((props: ToolUIProps<In, Out>) => unknown) // React component function
  | string; // JSX string to transpile

/**
 * React runtime CDN URLs.
 */
const REACT_CDN = {
  react: 'https://unpkg.com/react@18/umd/react.production.min.js',
  reactDom: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
};

/**
 * Minimal inline React runtime for blocked-network platforms (Claude).
 * This is a placeholder - in production, we'd bundle a minified React.
 */
const INLINE_REACT_PLACEHOLDER = `
// React runtime not available inline yet.
// For blocked-network platforms, use pre-rendered HTML templates.
console.warn('[FrontMCP] React hydration not available on this platform.');
`;

/**
 * React Renderer Implementation.
 *
 * Handles:
 * - Imported React components (FC or class)
 * - JSX string templates (transpiled with SWC at runtime)
 *
 * Renders to HTML using react-dom/server's renderToString.
 *
 * @example Imported component
 * ```typescript
 * import { MyWidget } from './my-widget.tsx';
 *
 * @Tool({
 *   ui: { template: MyWidget }
 * })
 * ```
 *
 * @example JSX string (runtime transpilation)
 * ```typescript
 * @Tool({
 *   ui: {
 *     template: `
 *       function Widget({ output }) {
 *         return <div>{output.name}</div>;
 *       }
 *     `
 *   }
 * })
 * ```
 */
export class ReactRenderer implements UIRenderer<ReactTemplate> {
  readonly type = 'react' as const;
  readonly priority = 20; // Higher priority than HTML

  /**
   * Lazy-loaded React modules.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private React: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ReactDOMServer: any = null;

  /**
   * Check if this renderer can handle the given template.
   *
   * Accepts:
   * - React component functions (imported, already transpiled)
   * - Strings containing JSX syntax
   */
  canHandle(template: unknown): template is ReactTemplate {
    // React component function
    if (typeof template === 'function' && isReactComponent(template)) {
      return true;
    }

    // JSX string
    if (typeof template === 'string' && containsJsx(template)) {
      return true;
    }

    return false;
  }

  /**
   * Transpile the template if needed.
   *
   * For imported React components, no transpilation is needed.
   * For JSX strings, SWC transpilation is performed.
   */
  async transpile(template: ReactTemplate, options?: TranspileOptions): Promise<TranspileResult> {
    // Imported component - no transpilation needed
    if (typeof template === 'function') {
      const hash = hashString(template.toString());

      return {
        code: '', // No transpiled code for already-compiled components
        hash,
        cached: true,
      };
    }

    // JSX string - transpile with SWC
    if (typeof template === 'string') {
      return transpileJsx(template, {
        development: options?.sourceMaps ?? false,
      });
    }

    throw new Error('Invalid template type for ReactRenderer');
  }

  /**
   * Render the template to HTML string using react-dom/server.
   */
  async render<In, Out>(
    template: ReactTemplate<In, Out>,
    context: TemplateContext<In, Out>,
    options?: RenderOptions,
  ): Promise<string> {
    // Ensure React is loaded
    await this.loadReact();

    // Get the component function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Component: (props: ToolUIProps<In, Out>) => any;

    if (typeof template === 'function') {
      // Already a component function
      Component = template;
    } else if (typeof template === 'string') {
      // Transpile and execute the JSX string
      const transpiled = await this.transpile(template);

      // Check cache for the executed component
      const cached = transpileCache.getByKey(`exec:${transpiled.hash}`);
      if (cached) {
        Component = cached.code as unknown as typeof Component;
      } else {
        // Execute the transpiled code to get the component
        Component = await executeTranspiledCode(transpiled.code, {
          // Provide any additional MDX components if specified
          ...options?.mdxComponents,
        });

        // Cache the component function
        transpileCache.setByKey(`exec:${transpiled.hash}`, {
          code: Component as unknown as string,
          hash: transpiled.hash,
          cached: false,
        });
      }
    } else {
      throw new Error('Invalid template type for ReactRenderer');
    }

    // Build props from context
    const props: ToolUIProps<In, Out> = {
      input: context.input,
      output: context.output,
      structuredContent: context.structuredContent,
      helpers: context.helpers,
    };

    // Create React element
    const element = this.React.createElement(Component, props);

    // Render to HTML string
    const html = this.ReactDOMServer.renderToString(element);

    // If hydration is enabled, wrap with hydration markers
    if (options?.hydrate) {
      const componentName = (Component as { name?: string }).name || 'Component';
      // Full HTML attribute escaping to prevent XSS
      const escapedProps = JSON.stringify(props)
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<div data-hydrate="${componentName}" data-props='${escapedProps}'>${html}</div>`;
    }

    return html;
  }

  /**
   * Get runtime scripts for client-side functionality.
   */
  getRuntimeScripts(platform: PlatformCapabilities): RuntimeScripts {
    // For blocked-network platforms (Claude), scripts must be inline
    if (platform.networkMode === 'blocked') {
      return {
        headScripts: '',
        inlineScripts: INLINE_REACT_PLACEHOLDER,
        isInline: true,
      };
    }

    // For platforms with network access, use CDN
    return {
      headScripts: `
        <script crossorigin src="${REACT_CDN.react}"></script>
        <script crossorigin src="${REACT_CDN.reactDom}"></script>
      `,
      isInline: false,
    };
  }

  /**
   * Load React and ReactDOMServer modules.
   */
  private async loadReact(): Promise<void> {
    if (this.React && this.ReactDOMServer) {
      return;
    }

    try {
      this.React = await import('react');
      this.ReactDOMServer = await import('react-dom/server');
    } catch {
      throw new Error('React is required for ReactRenderer. Install react and react-dom: npm install react react-dom');
    }
  }
}

/**
 * Singleton instance of the React renderer.
 */
export const reactRenderer = new ReactRenderer();

/**
 * Build React hydration script for client-side interactivity.
 *
 * This script finds elements with data-hydrate attributes and
 * hydrates them with the corresponding React component.
 */
export function buildHydrationScript(): string {
  return `
<script>
(function() {
  // Wait for React to be available
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
    console.warn('[FrontMCP] React not available for hydration');
    return;
  }

  // Find all elements marked for hydration
  document.querySelectorAll('[data-hydrate]').forEach(function(root) {
    var componentName = root.getAttribute('data-hydrate');
    var propsJson = root.getAttribute('data-props');
    var props = propsJson ? JSON.parse(propsJson) : {};

    // Look for the component in the global scope
    if (window.__frontmcp_components && window.__frontmcp_components[componentName]) {
      try {
        ReactDOM.hydrateRoot(root, React.createElement(
          window.__frontmcp_components[componentName],
          props
        ));
      } catch (e) {
        console.error('[FrontMCP] Hydration failed for', componentName, e);
      }
    }
  });
})();
</script>
`;
}
