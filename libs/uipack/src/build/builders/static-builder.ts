/**
 * Static Builder
 *
 * Builds complete HTML documents with placeholders for data injection.
 * The shell is cached and reused; only data changes per request.
 *
 * Build Phase:
 * - Full HTML with theme, CDN scripts, bridge runtime
 * - Component code (transpiled if React/MDX)
 * - Placeholders for input/output data
 *
 * Preview Phase:
 * - Replace placeholders with actual data
 * - Platform-specific handling (OpenAI, Claude, Generic)
 *
 * @packageDocumentation
 */

import { BaseBuilder } from './base-builder';
import type {
  BuilderOptions,
  BuildToolOptions,
  StaticBuildResult,
  IStaticBuilder,
} from './types';
import type { UITemplateConfig, TemplateBuilderFn } from '../../types';
import { injectHybridDataFull, HYBRID_DATA_PLACEHOLDER, HYBRID_INPUT_PLACEHOLDER } from '../hybrid-data';
import { generateCdnScriptTags, generateGlobalsSetupScript } from './esbuild-config';

// ============================================
// Static Builder
// ============================================

/**
 * Static builder for creating cached HTML shells with placeholders.
 *
 * @example
 * ```typescript
 * const builder = new StaticBuilder({ cdnMode: 'cdn' });
 *
 * // Build once (cached)
 * const result = await builder.build({
 *   template: WeatherWidget,
 *   toolName: 'get_weather',
 * });
 *
 * // Inject data per request (fast)
 * const html = builder.injectData(result.html, input, output);
 * ```
 */
export class StaticBuilder extends BaseBuilder implements IStaticBuilder {
  readonly mode = 'static' as const;

  constructor(options: BuilderOptions = {}) {
    super(options);
  }

  /**
   * Build a static HTML shell with placeholders.
   *
   * @param options - Build options
   * @returns Static build result
   */
  async build<In = unknown, Out = unknown>(
    options: BuildToolOptions<In, Out>
  ): Promise<StaticBuildResult> {
    const startTime = Date.now();
    const { template, toolName, title = `${toolName} Widget` } = options;

    // Detect template type
    const detection = this.detectTemplate(template.template);

    // Render or transpile based on type
    let bodyContent: string;

    if (detection.renderer === 'html') {
      // HTML templates - render directly with placeholder context
      const context = this.createContext<In, Out>(
        options.sampleInput ?? ({} as In),
        options.sampleOutput ?? ({} as Out)
      );

      if (typeof template.template === 'function') {
        bodyContent = (template.template as TemplateBuilderFn<In, Out>)(context);
      } else {
        bodyContent = template.template as string;
      }

      // Wrap in a container for client-side updates
      bodyContent = `
        <div id="frontmcp-widget-root">
          ${bodyContent}
        </div>
      `;
    } else {
      // React/MDX templates - build client-side rendering shell
      bodyContent = this.buildReactShell(template, toolName);
    }

    // Build head with all dependencies
    const head = this.buildHead({
      title,
      includeBridge: true,
      includeCdn: this.cdnMode === 'cdn',
      includeTheme: true,
    });

    // Build data injection with placeholders
    const dataScript = this.buildDataInjectionScript({
      toolName,
      usePlaceholders: true,
    });

    // Additional scripts for React
    let additionalScripts = '';
    if (detection.renderer === 'react') {
      additionalScripts = this.cdnMode === 'cdn'
        ? generateCdnScriptTags(false) + generateGlobalsSetupScript()
        : this.buildInlineReactRuntime();
    }

    // Assemble body
    const body = `
      ${dataScript}
      ${additionalScripts}
      ${bodyContent}
    `;

    // Create complete HTML document
    const html = this.wrapInHtmlDocument({
      head,
      body,
      bodyClass: 'antialiased',
    });

    // Optionally minify
    const finalHtml = this.minify ? this.minifyHtml(html) : html;

    // Calculate metrics
    const hash = await this.calculateHash(finalHtml);
    const size = Buffer.byteLength(finalHtml, 'utf8');
    const gzipSize = this.estimateGzipSize(finalHtml);

    return {
      mode: 'static',
      html: finalHtml,
      hash,
      size,
      gzipSize,
      placeholders: {
        hasOutput: finalHtml.includes(HYBRID_DATA_PLACEHOLDER),
        hasInput: finalHtml.includes(HYBRID_INPUT_PLACEHOLDER),
      },
      rendererType: detection.renderer,
      buildTime: new Date(startTime).toISOString(),
    };
  }

  /**
   * Inject data into a pre-built shell.
   *
   * @param shell - HTML shell with placeholders
   * @param input - Tool input data
   * @param output - Tool output data
   * @returns HTML with data injected
   */
  injectData(shell: string, input: unknown, output: unknown): string {
    return injectHybridDataFull(shell, input, output);
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Build React rendering shell.
   *
   * Creates a client-side React rendering setup that:
   * 1. Waits for runtime to be ready
   * 2. Loads component code
   * 3. Renders into #root with data from window.__mcpToolOutput
   */
  private buildReactShell<In = unknown, Out = unknown>(
    template: UITemplateConfig<In, Out>,
    _toolName: string
  ): string {
    // For React components, we need to serialize them for client-side execution
    // This is a simplified approach - full implementation would use bundling
    const _componentName = this.getComponentName(template.template);

    return `
      <div id="frontmcp-widget-root">
        <div id="root" class="min-h-[200px]">
          <div class="flex items-center justify-center p-4">
            <div class="text-center text-gray-500">
              <svg class="animate-spin mx-auto mb-2" style="width: 1.5rem; height: 1.5rem; color: #9ca3af;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p class="text-sm">Loading...</p>
            </div>
          </div>
        </div>
      </div>

      <script type="module">
        // Wait for React runtime to be ready
        function waitForRuntime() {
          return new Promise((resolve) => {
            if (window.__frontmcpRuntimeReady) {
              resolve();
            } else {
              window.addEventListener('frontmcp:runtime-ready', resolve, { once: true });
            }
          });
        }

        async function renderWidget() {
          await waitForRuntime();

          const React = window.React;
          const ReactDOM = window.ReactDOM;

          // Get data from injected globals
          const input = window.__mcpToolInput || {};
          const output = window.__mcpToolOutput || {};

          // Create simple widget component
          function Widget() {
            const [data, setData] = React.useState({ input, output });

            React.useEffect(() => {
              // Subscribe to data updates via bridge
              const handleUpdate = (event) => {
                if (event.detail) {
                  setData((prev) => ({ ...prev, output: event.detail }));
                }
              };
              window.addEventListener('frontmcp:toolResult', handleUpdate);
              return () => window.removeEventListener('frontmcp:toolResult', handleUpdate);
            }, []);

            return React.createElement('div', {
              className: 'p-4',
              dangerouslySetInnerHTML: {
                __html: '<pre>' + JSON.stringify(data.output, null, 2) + '</pre>'
              }
            });
          }

          // Render
          const root = ReactDOM.createRoot(document.getElementById('root'));
          root.render(React.createElement(Widget));
        }

        renderWidget().catch(console.error);
      </script>
    `;
  }

  /**
   * Build inline React runtime (for offline mode).
   */
  private buildInlineReactRuntime(): string {
    // For inline mode, we'd bundle React directly
    // This is a placeholder - full implementation would include minified React
    return `
      <script>
        // Inline React runtime would be bundled here
        console.warn('[FrontMCP] Inline React runtime not yet implemented');
      </script>
    `;
  }

  /**
   * Get component name from template.
   */
  private getComponentName(template: unknown): string {
    if (typeof template === 'function') {
      return template.name || 'Widget';
    }
    return 'Widget';
  }

  /**
   * Simple HTML minification.
   */
  private minifyHtml(html: string): string {
    return html
      .replace(/>\s+</g, '><')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
}
