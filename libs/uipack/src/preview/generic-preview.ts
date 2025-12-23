/**
 * Generic Preview Handler
 *
 * Generates metadata for generic MCP clients.
 * Uses frontmcp/* namespace with ui/* fallback for compatibility.
 *
 * Behaves like OpenAI but with different metadata namespaces.
 *
 * @packageDocumentation
 */

import type {
  PreviewHandler,
  DiscoveryPreviewOptions,
  ExecutionPreviewOptions,
  DiscoveryMeta,
  ExecutionMeta,
  FrontMCPMetaFields,
  BuilderMockData,
} from './types';
import type { BuilderResult, StaticBuildResult, HybridBuildResult, InlineBuildResult } from '../build/builders/types';

// ============================================
// Generic Preview Handler
// ============================================

/**
 * Preview handler for generic MCP clients.
 *
 * Uses the same patterns as OpenAI but with frontmcp/* namespace
 * and ui/* fallback for maximum compatibility.
 *
 * @example
 * ```typescript
 * const preview = new GenericPreview();
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
export class GenericPreview implements PreviewHandler {
  readonly platform = 'generic' as const;

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
    const resourceUri = `resource://widget/${toolName}`;

    const _meta: FrontMCPMetaFields = {
      // Primary namespace
      'frontmcp/outputTemplate': resourceUri,
      'frontmcp/widgetCSP': {
        connect_domains: ['esm.sh', 'cdn.tailwindcss.com'],
        resource_domains: ['esm.sh', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'],
      },
      // Fallback for compatibility
      'ui/mimeType': 'text/html+mcp',
    };

    return {
      _meta: _meta as Record<string, unknown>,
      resourceUri,
      resourceContent: result.html,
    };
  }

  private forDiscoveryHybrid(result: HybridBuildResult, _toolName: string, _description?: string): DiscoveryMeta {
    const _meta: FrontMCPMetaFields = {
      'frontmcp/outputTemplate': result.shellResourceUri,
      'frontmcp/widgetCSP': {
        connect_domains: ['esm.sh', 'cdn.tailwindcss.com'],
        resource_domains: ['esm.sh', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'],
      },
      'ui/mimeType': 'text/html+mcp',
    };

    return {
      _meta: _meta as Record<string, unknown>,
      resourceUri: result.shellResourceUri,
      resourceContent: result.vendorShell,
    };
  }

  private forDiscoveryInline(result: InlineBuildResult, _toolName: string, _description?: string): DiscoveryMeta {
    const _meta: FrontMCPMetaFields = {
      'frontmcp/html': result.loaderShell,
      'ui/html': result.loaderShell,
      'ui/mimeType': 'text/html+mcp',
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
    if (builderMode) {
      const html = this.injectBuilderMode(result.html, input, output, mockData);
      return {
        _meta: {
          'frontmcp/html': html,
          'ui/html': html,
        },
        html,
        structuredContent: output,
        textContent: JSON.stringify(output, null, 2),
      };
    }

    // Normal mode: Platform handles data injection
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
    const _meta: FrontMCPMetaFields = {
      'frontmcp/component': result.componentChunk,
    };

    if (builderMode) {
      const html = this.combineHybridForBuilder(result, input, output, mockData);
      return {
        _meta: {
          'frontmcp/html': html,
          'ui/html': html,
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
    // Inline mode returns full HTML
    const _meta: FrontMCPMetaFields = {
      'frontmcp/html': '<!-- Full widget will be generated -->',
      'ui/html': '<!-- Full widget will be generated -->',
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

  private injectBuilderMode(html: string, input: unknown, output: unknown, mockData?: BuilderMockData): string {
    const theme = mockData?.theme || 'light';
    const displayMode = mockData?.displayMode || 'inline';
    const toolResponses = mockData?.toolResponses || {};

    // Create mock FrontMCP bridge API
    const mockScript = `
      <script>
        // Mock FrontMCP bridge for builder mode
        window.__frontmcpMock = {
          getTheme: function() { return ${JSON.stringify(theme)}; },
          getDisplayMode: function() { return ${JSON.stringify(displayMode)}; },
          callTool: function(name, args) {
            console.log('[Mock] callTool:', name, args);
            var responses = ${JSON.stringify(toolResponses)};
            return Promise.resolve(responses[name] || { error: 'Tool not mocked' });
          },
          sendMessage: function(text) { console.log('[Mock] sendMessage:', text); return Promise.resolve(); },
          openLink: function(url) { console.log('[Mock] openLink:', url); window.open(url, '_blank'); return Promise.resolve(); },
        };

        // Inject data
        window.__mcpToolInput = ${JSON.stringify(input)};
        window.__mcpToolOutput = ${JSON.stringify(output)};
        window.__mcpStructuredContent = ${JSON.stringify(output)};
        window.__mcpBuilderMode = true;
      </script>
    `;

    return html.replace('<head>', '<head>\n' + mockScript);
  }

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

    // Inject component
    const componentScript = `
      <script type="module">
        ${result.componentChunk}
      </script>
    `;
    html = html.replace('</body>', componentScript + '\n</body>');

    // Add builder mode mock
    return this.injectBuilderMode(html, input, output, mockData);
  }
}
