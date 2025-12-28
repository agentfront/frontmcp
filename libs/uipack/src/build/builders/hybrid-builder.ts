/**
 * Hybrid Builder
 *
 * Builds vendor shell (cached, shared) + component chunks (per-tool).
 * Optimal for OpenAI where shell is fetched once via resource URI and cached.
 *
 * Build Phase:
 * - Vendor shell: React, Bridge, UI components from CDN
 * - Component chunks: Transpiled with externalized dependencies
 *
 * Preview Phase:
 * - OpenAI: Shell via resource://, component in tool response
 * - Claude: Combine shell + component (inline delivery)
 * - Generic: Same as OpenAI with frontmcp namespace
 *
 * @packageDocumentation
 */

import { BaseBuilder } from './base-builder';
import type {
  BuilderOptions,
  BuildToolOptions,
  HybridBuildResult,
  IHybridBuilder,
} from './types';
import type { UITemplateConfig, TemplateBuilderFn } from '../../types';
import {
  generateCdnScriptTags,
  generateGlobalsSetupScript,
  DEFAULT_EXTERNALS,
} from './esbuild-config';

// ============================================
// Hybrid Builder
// ============================================

/**
 * Hybrid builder for creating vendor shells and component chunks.
 *
 * @example
 * ```typescript
 * const builder = new HybridBuilder({ cdnMode: 'cdn' });
 *
 * // Build vendor shell (cached, shared across all tools)
 * const vendorShell = await builder.buildVendorShell();
 *
 * // Build component chunk per tool
 * const componentChunk = await builder.buildComponentChunk(WeatherWidget);
 *
 * // For Claude, combine into inline HTML
 * const html = builder.combineForInline(vendorShell, componentChunk, input, output);
 * ```
 */
export class HybridBuilder extends BaseBuilder implements IHybridBuilder {
  readonly mode = 'hybrid' as const;

  /**
   * Cached vendor shell.
   */
  private vendorShellCache: string | null = null;

  constructor(options: BuilderOptions = {}) {
    super(options);
  }

  /**
   * Build a hybrid result with vendor shell and component chunk.
   *
   * @param options - Build options
   * @returns Hybrid build result
   */
  async build<In = unknown, Out = unknown>(
    options: BuildToolOptions<In, Out>
  ): Promise<HybridBuildResult> {
    const startTime = Date.now();
    const { template, toolName } = options;

    // Build or retrieve cached vendor shell
    const vendorShell = await this.buildVendorShell();

    // Build component chunk for this specific tool
    const componentChunk = await this.buildComponentChunk(template.template);

    // Generate resource URI for the shell
    const shellResourceUri = `resource://widget/${toolName}/shell`;

    // Calculate metrics
    const combinedHash = await this.calculateHash(vendorShell + componentChunk);
    const shellSize = Buffer.byteLength(vendorShell, 'utf8');
    const componentSize = Buffer.byteLength(componentChunk, 'utf8');

    // Detect renderer type
    const detection = this.detectTemplate(template.template);

    return {
      mode: 'hybrid',
      vendorShell,
      componentChunk,
      shellResourceUri,
      hash: combinedHash,
      shellSize,
      componentSize,
      rendererType: detection.renderer,
      buildTime: new Date(startTime).toISOString(),
    };
  }

  /**
   * Build the vendor shell (shared across all tools).
   *
   * The vendor shell contains:
   * - React/ReactDOM from CDN
   * - FrontMCP Bridge runtime
   * - Theme CSS and fonts
   * - Component injection point
   *
   * @returns Vendor shell HTML
   */
  async buildVendorShell(): Promise<string> {
    // Return cached shell if available
    if (this.vendorShellCache) {
      return this.vendorShellCache;
    }

    // Build head with all dependencies
    const head = this.buildHead({
      title: 'FrontMCP Widget',
      includeBridge: true,
      includeCdn: this.cdnMode === 'cdn',
      includeTheme: true,
    });

    // CDN scripts for React
    const cdnScripts = this.cdnMode === 'cdn'
      ? generateCdnScriptTags(false) + generateGlobalsSetupScript()
      : '';

    // Component injection point
    const body = `
      <script>
        window.__mcpToolName = '';
        window.__mcpToolInput = {};
        window.__mcpToolOutput = {};
        window.__mcpStructuredContent = {};
      </script>
      ${cdnScripts}
      <div id="frontmcp-widget-root">
        <div id="root" class="min-h-[200px]">
          <!-- Component will be injected here -->
          <div class="flex items-center justify-center p-4">
            <div class="text-center text-gray-500">
              <svg class="animate-spin mx-auto mb-2" style="width: 1.5rem; height: 1.5rem; color: #9ca3af;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p class="text-sm">Loading component...</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Component injection script -->
      <script type="module">
        // Wait for component code to be injected
        window.__frontmcpInjectComponent = async function(componentCode) {
          try {
            // Wait for runtime
            if (!window.__frontmcpRuntimeReady) {
              await new Promise((resolve) => {
                window.addEventListener('frontmcp:runtime-ready', resolve, { once: true });
              });
            }

            // Execute component code
            const blob = new Blob([componentCode], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const module = await import(url);
            URL.revokeObjectURL(url);

            // Render component
            const React = window.React;
            const ReactDOM = window.ReactDOM;
            const Component = module.default || module.Widget || module.Component;

            if (Component) {
              const root = ReactDOM.createRoot(document.getElementById('root'));
              root.render(React.createElement(Component, {
                input: window.__mcpToolInput,
                output: window.__mcpToolOutput,
              }));
            }
          } catch (error) {
            console.error('[FrontMCP] Component injection failed:', error);
            document.getElementById('root').innerHTML =
              '<div class="p-4 text-red-500">Component failed to load</div>';
          }
        };

        // Listen for component via bridge
        if (window.FrontMcpBridge) {
          const checkForComponent = () => {
            const meta = window.FrontMcpBridge.getToolResponseMetadata?.() || {};
            const componentCode = meta['ui/component'] || meta['openai/component'];
            if (componentCode) {
              window.__frontmcpInjectComponent(componentCode);
            }
          };

          if (window.FrontMcpBridge.onToolResponseMetadata) {
            window.FrontMcpBridge.onToolResponseMetadata((meta) => {
              const componentCode = meta['ui/component'] || meta['openai/component'];
              if (componentCode) {
                window.__frontmcpInjectComponent(componentCode);
              }
            });
          }

          // Check immediately in case data is already available
          checkForComponent();
        }
      </script>
    `;

    const html = this.wrapInHtmlDocument({
      head,
      body,
      bodyClass: 'antialiased',
    });

    // Cache the shell
    this.vendorShellCache = html;

    return html;
  }

  /**
   * Build a component chunk for a specific template.
   *
   * The component chunk is transpiled with externalized dependencies
   * (React, etc.) that are provided by the vendor shell.
   *
   * @param template - Component template
   * @returns Transpiled component code
   */
  async buildComponentChunk<In = unknown, Out = unknown>(
    template: UITemplateConfig<In, Out>['template']
  ): Promise<string> {
    const detection = this.detectTemplate(template);

    if (detection.renderer === 'html') {
      // For HTML templates, create a simple wrapper component
      return this.wrapHtmlAsComponent(template as string | TemplateBuilderFn<In, Out>);
    }

    // For React templates, we need to serialize and transpile
    // This is a simplified approach - full implementation would use bundling
    if (typeof template === 'function') {
      return this.transpileReactComponent(template);
    }

    // Fallback for React elements
    return `
      // Externalized React component
      const React = window.React;

      export default function Widget({ input, output }) {
        return React.createElement('div', {
          className: 'p-4',
        }, React.createElement('pre', null, JSON.stringify(output, null, 2)));
      }
    `;
  }

  /**
   * Combine shell and component for Claude/inline delivery.
   *
   * @param shell - Vendor shell HTML
   * @param component - Component chunk code
   * @param input - Tool input data
   * @param output - Tool output data
   * @returns Complete HTML with embedded component and data
   */
  combineForInline(
    shell: string,
    component: string,
    input: unknown,
    output: unknown
  ): string {
    // Inject data
    let result = shell
      .replace('window.__mcpToolInput = {};', `window.__mcpToolInput = ${JSON.stringify(input)};`)
      .replace('window.__mcpToolOutput = {};', `window.__mcpToolOutput = ${JSON.stringify(output)};`)
      .replace('window.__mcpStructuredContent = {};', `window.__mcpStructuredContent = ${JSON.stringify(output)};`);

    // Inject component code directly
    const componentInjection = `
      <script type="module">
        (async function() {
          // Wait for runtime
          if (!window.__frontmcpRuntimeReady) {
            await new Promise((resolve) => {
              window.addEventListener('frontmcp:runtime-ready', resolve, { once: true });
            });
          }

          // Execute component
          ${component}

          // Render
          const React = window.React;
          const ReactDOM = window.ReactDOM;
          const Component = typeof Widget !== 'undefined' ? Widget : (typeof exports !== 'undefined' ? exports.default : null);

          if (Component) {
            const root = ReactDOM.createRoot(document.getElementById('root'));
            root.render(React.createElement(Component, {
              input: window.__mcpToolInput,
              output: window.__mcpToolOutput,
            }));
          }
        })();
      </script>
    `;

    // Insert before </body>
    result = result.replace('</body>', componentInjection + '\n</body>');

    return result;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Wrap HTML template as a React component.
   */
  private wrapHtmlAsComponent<In = unknown, Out = unknown>(
    template: string | TemplateBuilderFn<In, Out>
  ): string {
    if (typeof template === 'string') {
      return `
        // HTML template wrapped as component
        const React = window.React;

        export default function Widget({ input, output }) {
          return React.createElement('div', {
            dangerouslySetInnerHTML: { __html: ${JSON.stringify(template)} }
          });
        }
      `;
    }

    // For function templates, we need to execute them
    return `
      // HTML function template wrapped as component
      const React = window.React;

      export default function Widget({ input, output }) {
        const html = (${template.toString()})({ input, output, helpers: {} });
        return React.createElement('div', {
          dangerouslySetInnerHTML: { __html: html }
        });
      }
    `;
  }

  /**
   * Transpile a React component function.
   */
  private async transpileReactComponent(component: Function): Promise<string> {
    // Serialize the function
    const funcString = component.toString();
    const componentName = component.name || 'Widget';

    // Create a module that exports the component
    const source = `
      // Externalized React component
      const React = window.React;

      const ${componentName} = ${funcString};

      export default ${componentName};
      export { ${componentName} as Widget, ${componentName} as Component };
    `;

    // Transpile with esbuild
    try {
      const result = await this.transpile(source, {
        externals: DEFAULT_EXTERNALS,
        format: 'esm',
        minify: this.minify,
      });
      return result.code;
    } catch (error) {
      // Fallback if transpilation fails
      console.warn('[HybridBuilder] Transpilation failed, using source directly:', error);
      return source;
    }
  }
}
