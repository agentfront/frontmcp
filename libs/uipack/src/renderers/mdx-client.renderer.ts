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
import { escapeHtml, escapeJsString, escapeScriptClose } from '../utils';

/**
 * Types this renderer can handle - MDX strings.
 */
type MdxTemplate = string;

/**
 * Build React CDN URLs for a specific version.
 * @param version React version (e.g., '18', '19')
 */
export function buildReactCdnUrls(version: '18' | '19' = '19') {
  return {
    react: `https://esm.sh/react@${version}`,
    reactDom: `https://esm.sh/react-dom@${version}/client`,
    jsxRuntime: `https://esm.sh/react@${version}/jsx-runtime`,
  };
}

/**
 * Default CDN URLs for client-side MDX rendering (esm.sh).
 * Uses React 19 by default. Override via the `cdn` option in render().
 * For React 18 compatibility, use: cdn: buildReactCdnUrls('18')
 */
const DEFAULT_CDN = {
  mdx: 'https://esm.sh/@mdx-js/mdx@3',
  ...buildReactCdnUrls('19'),
} as const;

/**
 * CDN configuration for client-side MDX rendering.
 */
export interface MdxClientCdnConfig {
  /** MDX compiler URL @default 'https://esm.sh/@mdx-js/mdx@3' */
  mdx?: string;
  /** React library URL @default 'https://esm.sh/react@19' */
  react?: string;
  /** React DOM client URL @default 'https://esm.sh/react-dom@19/client' */
  reactDom?: string;
  /** JSX runtime URL @default 'https://esm.sh/react@19/jsx-runtime' */
  jsxRuntime?: string;
}

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

  /**
   * Custom CDN URLs for dependencies.
   * Useful for using specific versions or self-hosted mirrors.
   */
  cdn?: MdxClientCdnConfig;
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
   * Prepare MDX template for rendering.
   * Caches the template hash for deduplication. Actual MDX compilation
   * happens client-side via CDN-loaded @mdx-js/mdx in the browser.
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

    // Merge custom CDN config with defaults
    const cdn = {
      ...DEFAULT_CDN,
      ...options?.cdn,
    };

    // Build props for MDX
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

    // Escape content for embedding in script
    // Use escapeScriptClose to prevent </script> from breaking out of the script tag
    const escapedMdx = escapeScriptClose(JSON.stringify(template));
    const escapedProps = escapeScriptClose(JSON.stringify(spreadProps));
    // Escape containerId for use in JS string literals (prevents quote injection)
    const safeContainerId = escapeJsString(containerId);

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
      import('${cdn.mdx}'),
      import('${cdn.jsxRuntime}'),
      import('${cdn.react}'),
      import('${cdn.reactDom}')
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
    const container = document.getElementById('${safeContainerId}');
    if (container) {
      const root = createRoot(container);
      root.render(React.createElement(Content, props));
    }
  } catch (error) {
    console.error('[FrontMCP] MDX client rendering failed:', error);
    const container = document.getElementById('${safeContainerId}');
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
