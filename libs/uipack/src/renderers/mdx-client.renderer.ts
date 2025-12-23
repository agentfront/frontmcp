/**
 * MDX Client Renderer
 *
 * Renders MDX templates client-side using CDN-loaded React and @mdx-js/mdx.
 * This renderer is React-free at build time - all dependencies are loaded from CDN.
 *
 * For server-side MDX rendering with React, use @frontmcp/ui/renderers.
 *
 * @module @frontmcp/uipack/renderers
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
import { transpileCache } from './cache';
import { escapeHtml } from '../utils';

/**
 * Types this renderer can handle - MDX strings.
 */
type MdxTemplate = string;

/**
 * CDN URLs for client-side MDX rendering (esm.sh).
 */
const CDN = {
  mdx: 'https://esm.sh/@mdx-js/mdx@3',
  react: 'https://esm.sh/react@19',
  reactDom: 'https://esm.sh/react-dom@19/client',
  jsxRuntime: 'https://esm.sh/react@19/jsx-runtime',
};

/**
 * Options for client-side MDX rendering.
 */
export interface MdxClientRenderOptions extends RenderOptions {
  /**
   * Container ID for the MDX content.
   * @default 'mdx-content'
   */
  containerId?: string;

  /**
   * Show loading state while MDX is being compiled.
   * @default true
   */
  showLoading?: boolean;

  /**
   * Custom loading message.
   * @default 'Loading...'
   */
  loadingMessage?: string;
}

/**
 * MDX Client Renderer Implementation.
 *
 * Unlike the server-side MdxRenderer, this renderer:
 * - Does NOT bundle React at build time
 * - Returns HTML with script tags that load dependencies from CDN
 * - Compiles and renders MDX in the browser
 *
 * @example Basic usage
 * ```typescript
 * import { mdxClientRenderer } from '@frontmcp/uipack/renderers';
 *
 * const html = await mdxClientRenderer.render(
 *   '# Hello {output.name}',
 *   { input: {}, output: { name: 'World' } }
 * );
 * // Returns HTML with CDN scripts that render the MDX client-side
 * ```
 *
 * @example With custom container
 * ```typescript
 * const html = await mdxClientRenderer.render(mdxTemplate, context, {
 *   containerId: 'my-mdx-root',
 *   showLoading: true,
 * });
 * ```
 */
export class MdxClientRenderer implements UIRenderer<MdxTemplate> {
  readonly type = 'mdx-client' as const;
  readonly priority = 8; // Lower than server-side MDX (10)

  /**
   * Check if this renderer can handle the given template.
   */
  canHandle(template: unknown): template is MdxTemplate {
    if (typeof template !== 'string') {
      return false;
    }
    return containsMdxSyntax(template);
  }

  /**
   * Transpile MDX - for client-side rendering, we just hash the source.
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
   * Render MDX template to HTML with CDN scripts.
   *
   * The returned HTML includes:
   * - A container div for the rendered content
   * - Script tags that load React and MDX from CDN
   * - Inline script that compiles and renders the MDX
   */
  async render<In, Out>(
    template: MdxTemplate,
    context: TemplateContext<In, Out>,
    options?: MdxClientRenderOptions,
  ): Promise<string> {
    const containerId = options?.containerId || 'mdx-content';
    const showLoading = options?.showLoading !== false;
    const loadingMessage = options?.loadingMessage || 'Loading...';

    // Build props for MDX
    const props: ToolUIProps<In, Out> = {
      input: context.input,
      output: context.output,
      structuredContent: context.structuredContent,
      helpers: context.helpers,
    };

    // Spread output for convenience
    const spreadProps = {
      ...props,
      ...(typeof context.output === 'object' && context.output !== null ? context.output : {}),
    };

    // Escape content for embedding in script
    const escapedMdx = JSON.stringify(template);
    const escapedProps = JSON.stringify(spreadProps);

    // Build the loading state
    const loadingHtml = showLoading ? `<div class="mdx-loading">${escapeHtml(loadingMessage)}</div>` : '';

    return `
<div id="${escapeHtml(containerId)}">${loadingHtml}</div>
<script type="module">
(async function() {
  try {
    // Load dependencies from CDN
    const [
      { evaluate },
      runtime,
      React,
      { createRoot }
    ] = await Promise.all([
      import('${CDN.mdx}'),
      import('${CDN.jsxRuntime}'),
      import('${CDN.react}'),
      import('${CDN.reactDom}')
    ]);

    // MDX content and props
    const mdxSource = ${escapedMdx};
    const props = ${escapedProps};

    // Compile and evaluate MDX
    const { default: Content } = await evaluate(mdxSource, {
      ...runtime,
      Fragment: React.Fragment,
      development: false
    });

    // Render to DOM
    const container = document.getElementById('${escapeHtml(containerId)}');
    if (container) {
      const root = createRoot(container);
      root.render(React.createElement(Content, props));
    }
  } catch (error) {
    console.error('[FrontMCP] MDX client rendering failed:', error);
    const container = document.getElementById('${escapeHtml(containerId)}');
    if (container) {
      container.innerHTML = '<div class="mdx-error">Failed to render MDX content</div>';
    }
  }
})();
</script>
`;
  }

  /**
   * Get runtime scripts - not needed for client renderer since scripts are inline.
   */
  getRuntimeScripts(platform: PlatformCapabilities): RuntimeScripts {
    // For blocked-network platforms, client-side rendering won't work
    if (platform.networkMode === 'blocked') {
      return {
        headScripts: '',
        inlineScripts: `console.warn('[FrontMCP] Client-side MDX rendering requires network access. Use @frontmcp/ui for SSR.');`,
        isInline: true,
      };
    }

    // Scripts are included inline in the render output
    return {
      headScripts: '',
      isInline: false,
    };
  }
}

/**
 * Singleton instance of the MDX client renderer.
 */
export const mdxClientRenderer = new MdxClientRenderer();
