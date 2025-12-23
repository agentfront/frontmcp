/**
 * OpenAI Preview Handler
 *
 * Generates metadata for OpenAI ChatGPT platform.
 *
 * Discovery (tools/list):
 * - Static/Hybrid: Return shell via resource:// URI
 * - Inline: Return minimal loader in _meta
 *
 * Execution (tool/call):
 * - Static: Empty _meta, data via window.openai.toolOutput
 * - Hybrid: Component chunk in _meta['ui/component']
 * - Inline: Full HTML in _meta['ui/html']
 *
 * @packageDocumentation
 */

import type {
  PreviewHandler,
  DiscoveryPreviewOptions,
  ExecutionPreviewOptions,
  DiscoveryMeta,
  ExecutionMeta,
  OpenAIMetaFields,
  BuilderMockData,
} from './types';
import type { BuilderResult, StaticBuildResult, HybridBuildResult, InlineBuildResult } from '../build/builders/types';

// ============================================
// OpenAI Preview Handler
// ============================================

/**
 * Preview handler for OpenAI ChatGPT platform.
 *
 * @example
 * ```typescript
 * const preview = new OpenAIPreview();
 *
 * // For tools/list
 * const discoveryMeta = preview.forDiscovery({
 *   buildResult: hybridResult,
 *   toolName: 'get_weather',
 * });
 *
 * // For tool/call
 * const executionMeta = preview.forExecution({
 *   buildResult: hybridResult,
 *   input: { location: 'NYC' },
 *   output: { temperature: 72 },
 * });
 * ```
 */
export class OpenAIPreview implements PreviewHandler {
  readonly platform = 'openai' as const;

  /**
   * Generate metadata for tool discovery (tools/list).
   */
  forDiscovery(options: DiscoveryPreviewOptions): DiscoveryMeta {
    const { buildResult, toolName, description } = options;

    switch (buildResult.mode) {
      case 'static':
        return this.forDiscoveryStatic(buildResult, toolName, description);

      case 'hybrid':
        return this.forDiscoveryHybrid(buildResult, toolName, description);

      case 'inline':
        return this.forDiscoveryInline(buildResult, toolName, description);

      default:
        throw new Error(`Unknown build mode: ${(buildResult as BuilderResult).mode}`);
    }
  }

  /**
   * Generate metadata for tool execution (tool/call).
   */
  forExecution(options: ExecutionPreviewOptions): ExecutionMeta {
    const { buildResult, input, output, builderMode = false, mockData } = options;

    switch (buildResult.mode) {
      case 'static':
        return this.forExecutionStatic(buildResult, input, output, builderMode, mockData);

      case 'hybrid':
        return this.forExecutionHybrid(buildResult, input, output, builderMode, mockData);

      case 'inline':
        return this.forExecutionInline(buildResult, input, output, builderMode, mockData);

      default:
        throw new Error(`Unknown build mode: ${(buildResult as BuilderResult).mode}`);
    }
  }

  // ============================================
  // Discovery Handlers
  // ============================================

  private forDiscoveryStatic(result: StaticBuildResult, toolName: string, _description?: string): DiscoveryMeta {
    // Static mode: Return shell as resource
    const resourceUri = `resource://widget/${toolName}`;

    const _meta: OpenAIMetaFields = {
      'openai/outputTemplate': resourceUri,
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
      'openai/displayMode': 'inline',
      'openai/widgetCSP': {
        connect_domains: ['esm.sh', 'cdn.tailwindcss.com'],
        resource_domains: ['esm.sh', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'],
      },
    };

    return {
      _meta: _meta as Record<string, unknown>,
      resourceUri,
      resourceContent: result.html,
    };
  }

  private forDiscoveryHybrid(result: HybridBuildResult, _toolName: string, _description?: string): DiscoveryMeta {
    // Hybrid mode: Return vendor shell as resource
    const _meta: OpenAIMetaFields = {
      'openai/outputTemplate': result.shellResourceUri,
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
      'openai/displayMode': 'inline',
      'openai/widgetCSP': {
        connect_domains: ['esm.sh', 'cdn.tailwindcss.com'],
        resource_domains: ['esm.sh', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'],
      },
    };

    return {
      _meta: _meta as Record<string, unknown>,
      resourceUri: result.shellResourceUri,
      resourceContent: result.vendorShell,
    };
  }

  private forDiscoveryInline(result: InlineBuildResult, _toolName: string, _description?: string): DiscoveryMeta {
    // Inline mode: Return loader in _meta
    const _meta: OpenAIMetaFields = {
      'openai/html': result.loaderShell,
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
      'openai/displayMode': 'inline',
      'openai/widgetCSP': {
        connect_domains: ['esm.sh', 'cdn.tailwindcss.com'],
        resource_domains: ['esm.sh', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'],
      },
    };

    return {
      _meta: _meta as Record<string, unknown>,
    };
  }

  // ============================================
  // Execution Handlers
  // ============================================

  private forExecutionStatic(
    result: StaticBuildResult,
    input: unknown,
    output: unknown,
    builderMode: boolean,
    mockData?: BuilderMockData,
  ): ExecutionMeta {
    // Static mode: Data via window.openai.toolOutput (platform handles injection)
    // We just return structuredContent

    if (builderMode) {
      // For builder mode, inject full HTML with mock window.openai
      const html = this.injectBuilderMode(result.html, input, output, mockData);
      return {
        _meta: {
          'openai/html': html,
        },
        html,
        structuredContent: output,
        textContent: JSON.stringify(output, null, 2),
      };
    }

    // Normal mode: Platform injects data via toolOutput
    return {
      _meta: {},
      structuredContent: output,
      textContent: JSON.stringify(output, null, 2),
    };
  }

  private forExecutionHybrid(
    result: HybridBuildResult,
    input: unknown,
    output: unknown,
    builderMode: boolean,
    mockData?: BuilderMockData,
  ): ExecutionMeta {
    // Hybrid mode: Return component chunk
    const _meta: OpenAIMetaFields = {
      'openai/component': result.componentChunk,
    };

    if (builderMode) {
      // For builder mode, combine shell + component + mock data
      // This simulates what the platform would do
      const html = this.combineHybridForBuilder(result, input, output, mockData);
      return {
        _meta: {
          'openai/html': html,
        },
        html,
        structuredContent: output,
        textContent: JSON.stringify(output, null, 2),
      };
    }

    return {
      _meta: _meta as Record<string, unknown>,
      structuredContent: output,
      textContent: JSON.stringify(output, null, 2),
    };
  }

  private forExecutionInline(
    result: InlineBuildResult,
    input: unknown,
    output: unknown,
    _builderMode: boolean,
    _mockData?: BuilderMockData,
  ): ExecutionMeta {
    // Inline mode: Build and return full widget HTML
    // Note: buildFullWidget is async, but we need sync here
    // For now, we'll use a placeholder - real implementation would be async
    const _meta: OpenAIMetaFields = {
      'openai/html': '<!-- Full widget will be generated -->',
    };

    return {
      _meta: _meta as Record<string, unknown>,
      structuredContent: output,
      textContent: JSON.stringify(output, null, 2),
    };
  }

  // ============================================
  // Builder Mode Helpers
  // ============================================

  /**
   * Inject builder mode mock APIs into HTML.
   */
  private injectBuilderMode(html: string, input: unknown, output: unknown, mockData?: BuilderMockData): string {
    const theme = mockData?.theme || 'light';
    const displayMode = mockData?.displayMode || 'inline';
    const toolResponses = mockData?.toolResponses || {};

    // Create mock window.openai object
    const mockScript = `
      <script>
        // Mock window.openai for builder mode
        window.openai = {
          canvas: {
            getTheme: function() { return ${JSON.stringify(theme)}; },
            getDisplayMode: function() { return ${JSON.stringify(displayMode)}; },
            setDisplayMode: function(mode) { console.log('[Mock] setDisplayMode:', mode); return Promise.resolve(); },
            sendMessage: function(text) { console.log('[Mock] sendMessage:', text); return Promise.resolve(); },
            openLink: function(url) { console.log('[Mock] openLink:', url); window.open(url, '_blank'); return Promise.resolve(); },
            callServerTool: function(name, args) {
              console.log('[Mock] callServerTool:', name, args);
              var responses = ${JSON.stringify(toolResponses)};
              return Promise.resolve(responses[name] || { error: 'Tool not mocked' });
            },
            onContextChange: function(cb) { return function() {}; },
            onToolResult: function(cb) { return function() {}; },
            close: function() { console.log('[Mock] close'); return Promise.resolve(); },
          },
          toolOutput: ${JSON.stringify(output)},
          toolResponseMetadata: {},
        };

        // Inject data
        window.__mcpToolInput = ${JSON.stringify(input)};
        window.__mcpToolOutput = ${JSON.stringify(output)};
        window.__mcpStructuredContent = ${JSON.stringify(output)};
        window.__mcpBuilderMode = true;
      </script>
    `;

    // Inject after <head>
    return html.replace('<head>', '<head>\n' + mockScript);
  }

  /**
   * Combine hybrid shell + component for builder mode.
   */
  private combineHybridForBuilder(
    result: HybridBuildResult,
    input: unknown,
    output: unknown,
    mockData?: BuilderMockData,
  ): string {
    let html = result.vendorShell;

    // Inject data
    html = html
      .replace('window.__mcpToolInput = {};', `window.__mcpToolInput = ${JSON.stringify(input)};`)
      .replace('window.__mcpToolOutput = {};', `window.__mcpToolOutput = ${JSON.stringify(output)};`)
      .replace('window.__mcpStructuredContent = {};', `window.__mcpStructuredContent = ${JSON.stringify(output)};`);

    // Inject component and builder mode mock
    const componentScript = `
      <script type="module">
        // Component code
        ${result.componentChunk}
      </script>
    `;

    html = html.replace('</body>', componentScript + '\n</body>');

    // Add builder mode mock
    return this.injectBuilderMode(html, input, output, mockData);
  }
}
