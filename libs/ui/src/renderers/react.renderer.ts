/**
 * React Renderer
 *
 * Handles React component templates:
 * - Imported React components (already transpiled)
 * - JSX string templates (transpiled at runtime with SWC)
 *
 * Generates HTML for CLIENT-SIDE rendering (no SSR).
 * React components are rendered in the browser, not on the server.
 *
 * @example
 * ```typescript
 * // The generated HTML includes React CDN scripts and a render script
 * // The component is rendered client-side when the page loads
 * const html = await reactRenderer.render(MyWidget, context);
 * ```
 */

import type { TemplateContext } from '@frontmcp/uipack/runtime';
import type { PlatformCapabilities } from '@frontmcp/uipack/theme';
import type {
  UIRenderer,
  TranspileResult,
  TranspileOptions,
  RenderOptions,
  RuntimeScripts,
  ToolUIProps,
} from '@frontmcp/uipack/renderers';
import { isReactComponent, containsJsx, hashString, transpileJsx } from '@frontmcp/uipack/renderers';

// ============================================
// Component Name Validation
// ============================================

/**
 * Valid JavaScript identifier pattern.
 * Matches only alphanumeric characters, underscores, and dollar signs,
 * and must not start with a digit.
 */
const VALID_JS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Validate that a component name is a safe JavaScript identifier.
 *
 * Prevents code injection attacks where a malicious function name
 * could break out of the identifier context.
 *
 * @param name - Component name to validate
 * @returns True if the name is a valid JavaScript identifier
 */
function isValidComponentName(name: string): boolean {
  return VALID_JS_IDENTIFIER.test(name);
}

/**
 * Sanitize a component name for safe use in generated JavaScript code.
 *
 * If the name is not a valid identifier, returns a safe fallback.
 *
 * @param name - Component name to sanitize
 * @returns Safe component name
 */
function sanitizeComponentName(name: string): string {
  if (isValidComponentName(name)) {
    return name;
  }
  // Replace invalid characters with underscores, ensure it starts correctly
  const sanitized = name.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^[0-9]/, '_$&');
  return sanitized || 'Component';
}

/**
 * Types this renderer can handle.
 */
type ReactTemplate<In = unknown, Out = unknown> =
  | ((props: ToolUIProps<In, Out>) => unknown) // React component function
  | string; // JSX string to transpile

/**
 * React runtime CDN URLs.
 * Using esm.sh for React 19 (ES modules).
 */
const REACT_CDN = {
  react: 'https://esm.sh/react@19',
  reactDom: 'https://esm.sh/react-dom@19/client',
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
 * Generates HTML for CLIENT-SIDE rendering. The component is rendered
 * in the browser using React from CDN, not server-side rendered.
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
   * Render the template to HTML for client-side rendering.
   *
   * Unlike SSR, this method generates HTML that will be rendered
   * client-side by React in the browser. No server-side React required.
   *
   * The generated HTML includes:
   * - A container div for the React root
   * - The component code (transpiled if needed)
   * - Props embedded as a data attribute
   * - A render script that initializes the component
   */
  async render<In, Out>(
    template: ReactTemplate<In, Out>,
    context: TemplateContext<In, Out>,
    _options?: RenderOptions,
  ): Promise<string> {
    // Build props from context
    const props: ToolUIProps<In, Out> = {
      input: context.input,
      output: context.output,
      structuredContent: context.structuredContent,
      helpers: context.helpers,
    };

    // Escape props for HTML embedding
    const escapedProps = JSON.stringify(props)
      .replace(/&/g, '&amp;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Generate unique ID for this render
    const rootId = `frontmcp-react-${hashString(Date.now().toString()).slice(0, 8)}`;

    // Get the component code
    let componentCode: string;
    let componentName: string;

    if (typeof template === 'function') {
      // For imported components, we need the component to be registered
      // Sanitize the component name to prevent code injection attacks
      const rawName = (template as { name?: string }).name || 'Component';
      componentName = sanitizeComponentName(rawName);

      // Cache the component function for client-side access
      componentCode = `
        // Component should be registered via window.__frontmcp_components['${componentName}']
        (function() {
          if (!window.__frontmcp_components || !window.__frontmcp_components['${componentName}']) {
            console.error('[FrontMCP] Component "${componentName}" not registered. Use buildHydrationScript() to register components.');
          }
        })();
      `;
    } else if (typeof template === 'string') {
      // Transpile JSX string to JavaScript
      const transpiled = await this.transpile(template);

      // Extract component name from transpiled code
      // The regex only matches valid identifiers, so this is already safe
      const match = transpiled.code.match(/function\s+(\w+)/);
      const rawName = match?.[1] || 'Widget';
      componentName = sanitizeComponentName(rawName);

      componentCode = transpiled.code;
    } else {
      throw new Error('Invalid template type for ReactRenderer');
    }

    // Generate HTML with client-side rendering script
    const html = `
<div id="${rootId}" data-frontmcp-react data-component="${componentName}" data-props='${escapedProps}'>
  <div class="flex items-center justify-center p-4 text-gray-500">
    <svg class="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Loading...
  </div>
</div>
<script type="module">
(function() {
  ${componentCode}

  // Wait for React to be available
  function waitForReact(callback, maxAttempts) {
    var attempts = 0;
    var check = function() {
      if (typeof React !== 'undefined' && typeof ReactDOM !== 'undefined') {
        callback();
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(check, 50);
      } else {
        console.error('[FrontMCP] React not loaded after ' + maxAttempts + ' attempts');
      }
    };
    check();
  }

  waitForReact(function() {
    try {
      var root = document.getElementById('${rootId}');
      if (!root) return;

      var propsJson = root.getAttribute('data-props');
      var props = propsJson ? JSON.parse(propsJson.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')) : {};

      // Get the component
      var Component = ${componentName};

      // Check if it's registered globally
      if (typeof Component === 'undefined' && window.__frontmcp_components) {
        Component = window.__frontmcp_components['${componentName}'];
      }

      if (typeof Component === 'function') {
        var element = React.createElement(Component, props);
        var reactRoot = ReactDOM.createRoot(root);
        reactRoot.render(element);
      } else {
        console.error('[FrontMCP] Component "${componentName}" not found');
      }
    } catch (err) {
      console.error('[FrontMCP] React render error:', err);
    }
  }, 100);
})();
</script>
`;

    return html.trim();
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
