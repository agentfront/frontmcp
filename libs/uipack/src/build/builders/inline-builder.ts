/**
 * Inline Builder
 *
 * Builds minimal loader shell (for discovery) + full HTML per request.
 * Best for development/review where each request gets complete widget.
 *
 * Build Phase:
 * - Minimal loader with bridge and loading indicator
 * - Injector script that waits for full HTML in tool response
 *
 * Preview Phase:
 * - OpenAI: Loader at discovery, full HTML replaces document on tool call
 * - Claude: Full HTML returned directly (no loader needed)
 * - Generic: Same as OpenAI with frontmcp namespace
 *
 * @packageDocumentation
 */

import { BaseBuilder } from './base-builder';
import type {
  BuilderOptions,
  BuildToolOptions,
  InlineBuildResult,
  IInlineBuilder,
} from './types';
import type { UITemplateConfig, TemplateBuilderFn } from '../../types';
import { generateCdnScriptTags, generateGlobalsSetupScript } from './esbuild-config';

// ============================================
// Inline Builder
// ============================================

/**
 * Inline builder for development and review scenarios.
 *
 * @example
 * ```typescript
 * const builder = new InlineBuilder({ cdnMode: 'cdn' });
 *
 * // Get loader for tools/list
 * const loader = builder.buildLoader('get_weather');
 *
 * // Build full widget for each tool call
 * const fullHtml = await builder.buildFullWidget(
 *   WeatherWidget,
 *   { location: 'NYC' },
 *   { temperature: 72 }
 * );
 * ```
 */
export class InlineBuilder extends BaseBuilder implements IInlineBuilder {
  readonly mode = 'inline' as const;

  constructor(options: BuilderOptions = {}) {
    super(options);
  }

  /**
   * Build an inline result with loader and full widget generator.
   *
   * @param options - Build options
   * @returns Inline build result
   */
  async build<In = unknown, Out = unknown>(
    options: BuildToolOptions<In, Out>
  ): Promise<InlineBuildResult> {
    const startTime = Date.now();
    const { template, toolName } = options;

    // Build the loader shell
    const loaderShell = this.buildLoader(toolName);

    // Create the full widget builder function
    // Cast input/output to the template types - they're unknown at call time
    // but the template expects the correct types for rendering
    const buildFullWidget = async (input: unknown, output: unknown): Promise<string> => {
      return this.buildFullWidget(template.template, input as In, output as Out);
    };

    // Calculate metrics
    const hash = await this.calculateHash(loaderShell);
    const loaderSize = Buffer.byteLength(loaderShell, 'utf8');

    // Detect renderer type
    const detection = this.detectTemplate(template.template);

    return {
      mode: 'inline',
      loaderShell,
      buildFullWidget,
      hash,
      loaderSize,
      rendererType: detection.renderer,
      buildTime: new Date(startTime).toISOString(),
    };
  }

  /**
   * Build the minimal loader shell.
   *
   * The loader contains:
   * - FrontMCP Bridge runtime
   * - Loading indicator
   * - Injector script that replaces document on tool response
   *
   * @param toolName - Name of the tool
   * @returns Loader HTML
   */
  buildLoader(toolName: string): string {
    const head = this.buildHead({
      title: `${toolName} Widget`,
      includeBridge: true,
      includeCdn: this.cdnMode === 'cdn',
      includeTheme: true,
    });

    const body = `
      <script>
        window.__mcpToolName = ${JSON.stringify(toolName)};
        window.__mcpLeanShell = true;
      </script>

      <div id="frontmcp-widget-root" class="flex items-center justify-center min-h-[200px] p-4">
        <div class="text-center text-gray-500">
          <svg class="animate-spin mx-auto mb-2" style="width: 1.5rem; height: 1.5rem; color: #9ca3af;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p class="text-sm">Loading widget...</p>
        </div>
      </div>

      <!-- Injector script -->
      <script>
        (function() {
          var injected = false;

          function injectWidget(metadata) {
            if (injected) return;

            var html = null;
            if (metadata) {
              html = metadata['ui/html'] || metadata['openai/html'] || metadata.html;
            }

            if (html && typeof html === 'string') {
              injected = true;
              console.log('[FrontMCP] Inline shell: Injecting widget HTML (' + html.length + ' chars)');
              document.open();
              document.write(html);
              document.close();
              return true;
            }
            return false;
          }

          function subscribeAndInject() {
            var bridge = window.FrontMcpBridge;
            if (!bridge) {
              console.warn('[FrontMCP] Inline shell: Bridge not found');
              return;
            }

            // Check if data already available
            if (typeof bridge.getToolResponseMetadata === 'function') {
              var existing = bridge.getToolResponseMetadata();
              if (existing && injectWidget(existing)) {
                return;
              }
            }

            // Subscribe to metadata changes
            if (typeof bridge.onToolResponseMetadata === 'function') {
              console.log('[FrontMCP] Inline shell: Subscribing to tool response metadata');
              bridge.onToolResponseMetadata(function(metadata) {
                console.log('[FrontMCP] Inline shell: Received tool response metadata');
                injectWidget(metadata);
              });
            }
          }

          // Wait for bridge:ready event
          window.addEventListener('bridge:ready', function() {
            console.log('[FrontMCP] Inline shell: Bridge ready, setting up injector');
            subscribeAndInject();
          });

          // Also try immediately in case bridge is already ready
          if (window.FrontMcpBridge && window.FrontMcpBridge.initialized) {
            subscribeAndInject();
          }

          // Fallback: poll for bridge
          var attempts = 0;
          var interval = setInterval(function() {
            attempts++;
            if (window.FrontMcpBridge) {
              clearInterval(interval);
              if (!injected) {
                subscribeAndInject();
              }
            } else if (attempts >= 100) {
              clearInterval(interval);
              console.warn('[FrontMCP] Inline shell: Timeout waiting for bridge');
            }
          }, 100);
        })();
      </script>

      <style>
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
      </style>
    `;

    return this.wrapInHtmlDocument({
      head,
      body,
      bodyClass: 'antialiased',
    });
  }

  /**
   * Build full widget HTML with embedded data.
   *
   * @param template - Component template
   * @param input - Tool input data
   * @param output - Tool output data
   * @returns Complete HTML with all dependencies and data
   */
  async buildFullWidget<In = unknown, Out = unknown>(
    template: UITemplateConfig<In, Out>['template'],
    input: In,
    output: Out
  ): Promise<string> {
    const detection = this.detectTemplate(template);

    // Build head with all dependencies
    const head = this.buildHead({
      title: 'FrontMCP Widget',
      includeBridge: true,
      includeCdn: this.cdnMode === 'cdn',
      includeTheme: true,
    });

    // Build data injection
    const dataScript = this.buildDataInjectionScript({
      toolName: 'widget',
      input,
      output,
      usePlaceholders: false,
    });

    // Build content based on template type
    let content: string;

    if (detection.renderer === 'html') {
      // HTML template - render directly
      const context = this.createContext(input, output);

      if (typeof template === 'function') {
        content = (template as TemplateBuilderFn<In, Out>)(context);
      } else {
        content = template as string;
      }

      content = `
        <div id="frontmcp-widget-root">
          ${content}
        </div>
      `;
    } else {
      // React template - build client-side rendering
      content = this.buildReactContent(template, input, output);
    }

    // Assemble body
    const body = `
      ${dataScript}
      ${detection.renderer === 'react' ? this.buildReactScripts() : ''}
      ${content}
    `;

    const html = this.wrapInHtmlDocument({
      head,
      body,
      bodyClass: 'antialiased',
    });

    return this.minify ? this.minifyHtml(html) : html;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Build React scripts for client-side rendering.
   */
  private buildReactScripts(): string {
    if (this.cdnMode === 'cdn') {
      return generateCdnScriptTags(false) + generateGlobalsSetupScript();
    }

    // For inline mode, we'd bundle React
    return `
      <script>
        console.warn('[FrontMCP] Inline React runtime not yet implemented');
      </script>
    `;
  }

  /**
   * Build React content with client-side rendering.
   */
  private buildReactContent<In = unknown, Out = unknown>(
    _template: UITemplateConfig<In, Out>['template'],
    _input: In,
    _output: Out
  ): string {
    return `
      <div id="frontmcp-widget-root">
        <div id="root" class="min-h-[200px]">
          <div class="flex items-center justify-center p-4">
            <div class="text-center text-gray-500">
              <p class="text-sm">Initializing...</p>
            </div>
          </div>
        </div>
      </div>

      <script type="module">
        // Wait for runtime
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

          const input = window.__mcpToolInput || {};
          const output = window.__mcpToolOutput || {};

          function Widget() {
            return React.createElement('div', {
              className: 'p-4',
            }, React.createElement('pre', {
              className: 'bg-gray-100 p-2 rounded overflow-auto',
            }, JSON.stringify(output, null, 2)));
          }

          const root = ReactDOM.createRoot(document.getElementById('root'));
          root.render(React.createElement(Widget));
        }

        renderWidget().catch(console.error);
      </script>
    `;
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
