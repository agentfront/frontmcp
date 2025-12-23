/**
 * MDX Server Renderer
 *
 * Handles MDX templates - Markdown with embedded JSX components.
 * Uses @mdx-js/mdx for compilation and react-dom/server for SSR.
 *
 * This renderer requires React as a peer dependency.
 * For React-free client-side MDX rendering, use MdxClientRenderer from @frontmcp/uipack.
 *
 * MDX allows mixing Markdown with React components:
 * - Markdown headings, lists, code blocks
 * - JSX component tags: `<Card />`
 * - JS expressions: `{output.items.map(...)}`
 * - Frontmatter for metadata
 *
 * @module @frontmcp/ui/renderers
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
import { containsMdxSyntax, hashString, transpileCache, componentCache } from '@frontmcp/uipack/renderers';

/**
 * Types this renderer can handle - MDX strings.
 */
type MdxTemplate = string;

/**
 * Build React CDN URLs for a specific version.
 * @param version React version (e.g., '18', '19')
 */
function buildReactCdnUrls(version: '18' | '19' = '19') {
  return {
    react: `https://esm.sh/react@${version}`,
    reactDom: `https://esm.sh/react-dom@${version}/client`,
  };
}

/**
 * Runtime CDN URLs for client-side hydration.
 * Uses React 19 by default. For React 18 compatibility, modify getRuntimeScripts().
 * Note: This is used for hydration scripts only. SSR uses the installed React version.
 */
const REACT_CDN = buildReactCdnUrls('19');

/**
 * Placeholder for blocked-network platforms.
 */
const INLINE_MDX_PLACEHOLDER = `
// MDX runtime not available inline yet.
// For blocked-network platforms, use pre-rendered HTML templates.
console.warn('[FrontMCP] MDX hydration not available on this platform.');
`;

/**
 * MDX Server Renderer Implementation.
 *
 * Compiles MDX (Markdown + JSX) to React components using @mdx-js/mdx,
 * then renders to HTML using react-dom/server.
 *
 * @example Basic MDX template
 * ```typescript
 * @Tool({
 *   ui: {
 *     template: `
 * # User Profile
 *
 * <UserCard name={output.name} email={output.email} />
 *
 * ## Recent Activity
 * {output.items.map(item => <ActivityItem key={item.id} {...item} />)}
 *     `,
 *     mdxComponents: { UserCard, ActivityItem }
 *   }
 * })
 * ```
 */
export class MdxRenderer implements UIRenderer<MdxTemplate> {
  readonly type = 'mdx' as const;
  readonly priority = 10; // Between HTML (0) and React (20)

  /**
   * Lazy-loaded modules.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private React: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ReactDOMServer: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private jsxRuntime: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mdxEvaluate: ((source: string, options: object) => Promise<{ default: any }>) | null = null;

  /**
   * Check if this renderer can handle the given template.
   *
   * Accepts strings containing MDX syntax (Markdown + JSX).
   */
  canHandle(template: unknown): template is MdxTemplate {
    if (typeof template !== 'string') {
      return false;
    }

    return containsMdxSyntax(template);
  }

  /**
   * Prepare MDX template for rendering.
   * Caches the template hash for deduplication. Actual MDX compilation
   * happens during render() via @mdx-js/mdx evaluate().
   */
  async transpile(template: MdxTemplate, _options?: TranspileOptions): Promise<TranspileResult> {
    const hash = hashString(template);

    const cached = transpileCache.getByKey(hash);
    if (cached) {
      return { ...cached, cached: true };
    }

    const transpileResult: TranspileResult = {
      code: template,
      hash,
      cached: false,
    };

    transpileCache.setByKey(hash, transpileResult);

    return transpileResult;
  }

  /**
   * Render MDX template to HTML string.
   *
   * Uses @mdx-js/mdx's evaluate() for clean compilation + execution,
   * then renders the resulting React component to HTML via SSR.
   */
  async render<In, Out>(
    template: MdxTemplate,
    context: TemplateContext<In, Out>,
    options?: RenderOptions,
  ): Promise<string> {
    // Ensure dependencies are loaded
    await this.loadReact();
    await this.loadMdx();

    if (!this.mdxEvaluate) {
      throw new Error('MDX compilation requires @mdx-js/mdx. Install it: npm install @mdx-js/mdx');
    }

    // Create a cache key based on the template hash
    const templateHash = hashString(template);
    const cacheKey = `mdx-component:${templateHash}`;

    // Check component cache
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Content: any = componentCache.get(cacheKey);

    if (!Content) {
      // Evaluate MDX source to get the component
      const result = await this.mdxEvaluate(template, {
        ...this.jsxRuntime,
        Fragment: this.React.Fragment,
        development: false,
      });

      Content = result.default;

      // Cache the compiled component
      componentCache.set(cacheKey, Content);
    }

    // Build component map with custom MDX components
    const mdxComponents = {
      ...options?.mdxComponents,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wrapper: ({ children }: { children: any }) => {
        return this.React.createElement('div', { className: 'mdx-content' }, children);
      },
    };

    // Create props that MDX can access
    const props: ToolUIProps<In, Out> = {
      input: context.input,
      output: context.output,
      structuredContent: context.structuredContent,
      helpers: context.helpers,
    };

    // Reserved prop names that should not be overwritten by output properties
    const reservedProps = new Set(['input', 'output', 'structuredContent', 'helpers', 'components']);

    // Spread output properties at top level for convenience, but preserve reserved props
    // Output properties are spread first, then reserved props override them
    const outputProps =
      typeof context.output === 'object' && context.output !== null
        ? Object.fromEntries(Object.entries(context.output).filter(([key]) => !reservedProps.has(key)))
        : {};

    const spreadProps = {
      ...outputProps,
      ...props,
    };

    // Create the element with components and props
    const element = this.React.createElement(Content, {
      components: mdxComponents,
      ...spreadProps,
    });

    // Render to HTML
    const html = this.ReactDOMServer.renderToString(element);

    // If hydration is enabled, wrap with markers
    if (options?.hydrate) {
      const escapedProps = JSON.stringify(props)
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<div data-mdx-hydrate="true" data-props='${escapedProps}'>${html}</div>`;
    }

    return html;
  }

  /**
   * Get runtime scripts for client-side functionality.
   */
  getRuntimeScripts(platform: PlatformCapabilities): RuntimeScripts {
    if (platform.networkMode === 'blocked') {
      return {
        headScripts: '',
        inlineScripts: INLINE_MDX_PLACEHOLDER,
        isInline: true,
      };
    }

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
    if (this.React && this.ReactDOMServer && this.jsxRuntime) {
      return;
    }

    try {
      const [react, reactDomServer, jsxRuntime] = await Promise.all([
        import('react'),
        import('react-dom/server'),
        import('react/jsx-runtime'),
      ]);

      this.React = react;
      this.ReactDOMServer = reactDomServer;
      this.jsxRuntime = jsxRuntime;
    } catch {
      throw new Error('React is required for MdxRenderer. Install react and react-dom: npm install react react-dom');
    }
  }

  /**
   * Load @mdx-js/mdx evaluate function.
   */
  private async loadMdx(): Promise<void> {
    if (this.mdxEvaluate) {
      return;
    }

    try {
      const mdx = await import('@mdx-js/mdx');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.mdxEvaluate = mdx.evaluate as any;
    } catch {
      console.warn(
        '[@frontmcp/ui] @mdx-js/mdx not available. MDX rendering disabled. ' +
          'Install @mdx-js/mdx to enable: npm install @mdx-js/mdx',
      );
    }
  }
}

/**
 * Singleton instance of the MDX renderer.
 */
export const mdxRenderer = new MdxRenderer();

/**
 * Build MDX hydration script for client-side interactivity.
 */
export function buildMdxHydrationScript(): string {
  return `
<script>
(function() {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
    console.warn('[FrontMCP] React not available for MDX hydration');
    return;
  }

  document.querySelectorAll('[data-mdx-hydrate]').forEach(function(root) {
    var propsJson = root.getAttribute('data-props');
    var props = propsJson ? JSON.parse(propsJson) : {};

    if (window.__frontmcp_mdx_content) {
      try {
        ReactDOM.hydrateRoot(root, React.createElement(
          window.__frontmcp_mdx_content,
          props
        ));
      } catch (e) {
        console.error('[FrontMCP] MDX hydration failed', e);
      }
    }
  });
})();
</script>
`;
}
