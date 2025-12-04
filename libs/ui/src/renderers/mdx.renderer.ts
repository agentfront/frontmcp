/**
 * MDX Renderer
 *
 * Handles MDX templates - Markdown with embedded JSX components.
 * Uses @mdx-js/mdx for compilation and react-dom/server for SSR.
 *
 * MDX allows mixing Markdown with React components:
 * - Markdown headings, lists, code blocks
 * - JSX component tags: `<Card />`
 * - JS expressions: `{output.items.map(...)}`
 * - Frontmatter for metadata
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
import { containsMdxSyntax } from './utils/detect';
import { hashString } from './utils/hash';
import { transpileCache, componentCache } from './cache';

/**
 * Types this renderer can handle - MDX strings.
 */
type MdxTemplate = string;

/**
 * Runtime CDN URLs (same as React since MDX compiles to React).
 */
const REACT_CDN = {
  react: 'https://unpkg.com/react@18/umd/react.production.min.js',
  reactDom: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
};

/**
 * Placeholder for blocked-network platforms.
 */
const INLINE_MDX_PLACEHOLDER = `
// MDX runtime not available inline yet.
// For blocked-network platforms, use pre-rendered HTML templates.
console.warn('[FrontMCP] MDX hydration not available on this platform.');
`;

/**
 * MDX Renderer Implementation.
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
 *
 * @example MDX with frontmatter
 * ```typescript
 * @Tool({
 *   ui: {
 *     template: `
 * ---
 * title: Dashboard
 * ---
 *
 * # {frontmatter.title}
 *
 * <Dashboard data={output} />
 *     `
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
   * Transpile MDX to executable JavaScript.
   *
   * Uses @mdx-js/mdx to compile MDX source to a module.
   * Note: For MDX, we use evaluate() which combines compile + run,
   * so this method just returns the source hash for caching purposes.
   */
  async transpile(template: MdxTemplate, _options?: TranspileOptions): Promise<TranspileResult> {
    const hash = hashString(template);

    // Check cache - for MDX, the "code" is just the original source
    // since we use evaluate() which handles compilation internally
    const cached = transpileCache.getByKey(hash);
    if (cached) {
      return { ...cached, cached: true };
    }

    const transpileResult: TranspileResult = {
      code: template, // Store original MDX for evaluate()
      hash,
      cached: false,
    };

    // Cache the result
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
      // evaluate() combines compile + run in one step
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
      // User-provided components from tool config
      ...options?.mdxComponents,
      // Wrapper that provides context to the content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wrapper: ({ children }: { children: any }) => {
        return this.React.createElement('div', { className: 'mdx-content' }, children);
      },
    };

    // Create props that MDX can access
    // These become available in MDX as {props.input}, {props.output}, etc.
    const props: ToolUIProps<In, Out> = {
      input: context.input,
      output: context.output,
      structuredContent: context.structuredContent,
      helpers: context.helpers,
    };

    // Also spread output properties at top level for convenience
    // This allows accessing {output.name} or just {name} in MDX
    const spreadProps = {
      ...props,
      ...(typeof context.output === 'object' && context.output !== null ? context.output : {}),
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
      return `<div data-mdx-hydrate="true" data-props='${JSON.stringify(props).replace(/'/g, '&#39;')}'>${html}</div>`;
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
        inlineScripts: INLINE_MDX_PLACEHOLDER,
        isInline: true,
      };
    }

    // For platforms with network access, use CDN (React required for MDX)
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
   *
   * evaluate() is the cleanest way to run MDX - it combines
   * compile and run in a single step, handling all the runtime
   * injection automatically.
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
 *
 * Note: MDX hydration is more complex than React hydration
 * because it needs the MDX runtime and component definitions.
 */
export function buildMdxHydrationScript(): string {
  return `
<script>
(function() {
  // MDX hydration requires React and component definitions
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
    console.warn('[FrontMCP] React not available for MDX hydration');
    return;
  }

  // Find all elements marked for MDX hydration
  document.querySelectorAll('[data-mdx-hydrate]').forEach(function(root) {
    var propsJson = root.getAttribute('data-props');
    var props = propsJson ? JSON.parse(propsJson) : {};

    // MDX content is pre-rendered, hydration mainly attaches event handlers
    // For full interactivity, components need to be available client-side
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
