/**
 * Claude Preview Handler
 *
 * Generates metadata for Anthropic Claude platform.
 *
 * Claude is always inline-only (cannot fetch resources).
 * Uses Cloudflare CDN which is trusted by Claude's sandbox.
 *
 * Discovery (tools/list):
 * - No resource registration (Claude can't fetch)
 * - Optional loader HTML in _meta for streaming scenarios
 *
 * Execution (tool/call):
 * - Full HTML with injected input/output
 * - Uses Cloudflare CDN for dependencies
 *
 * @packageDocumentation
 */

import type {
  PreviewHandler,
  DiscoveryPreviewOptions,
  ExecutionPreviewOptions,
  DiscoveryMeta,
  ExecutionMeta,
  ClaudeMetaFields,
} from './types';
import type { BuilderResult, StaticBuildResult, HybridBuildResult, InlineBuildResult } from '../build/builders/types';
import { injectHybridDataFull } from '../build/hybrid-data';
import { CLOUDFLARE_CDN_URLS } from '../build/builders/esbuild-config';

// ============================================
// Claude Preview Handler
// ============================================

/**
 * Preview handler for Anthropic Claude platform.
 *
 * @example
 * ```typescript
 * const preview = new ClaudePreview();
 *
 * // For tool/call (Claude is always inline)
 * const executionMeta = preview.forExecution({
 *   buildResult: staticResult,
 *   input: { location: 'NYC' },
 *   output: { temperature: 72 },
 * });
 * ```
 */
export class ClaudePreview implements PreviewHandler {
  readonly platform = 'claude' as const;

  /**
   * Generate metadata for tool discovery (tools/list).
   *
   * Claude cannot fetch resources, so discovery is minimal.
   * We may include a loader HTML for streaming scenarios.
   */
  forDiscovery(options: DiscoveryPreviewOptions): DiscoveryMeta {
    const { toolName, description } = options;

    // Claude can't fetch resources, so no outputTemplate
    // Just indicate that this tool can produce widgets
    const _meta: ClaudeMetaFields = {
      'claude/widgetDescription': description || `Widget for ${toolName}`,
      'claude/prefersBorder': true,
    };

    return {
      _meta: _meta as Record<string, unknown>,
    };
  }

  /**
   * Generate metadata for tool execution (tool/call).
   *
   * Always returns complete HTML with embedded data.
   */
  forExecution(options: ExecutionPreviewOptions): ExecutionMeta {
    const { buildResult, input, output } = options;

    switch (buildResult.mode) {
      case 'static':
        return this.forExecutionStatic(buildResult, input, output);

      case 'hybrid':
        return this.forExecutionHybrid(buildResult, input, output);

      case 'inline':
        return this.forExecutionInline(buildResult, input, output);

      default:
        throw new Error(`Unknown build mode: ${(buildResult as BuilderResult).mode}`);
    }
  }

  // ============================================
  // Execution Handlers
  // ============================================

  private forExecutionStatic(result: StaticBuildResult, input: unknown, output: unknown): ExecutionMeta {
    // Static mode: Inject data into placeholders
    let html = injectHybridDataFull(result.html, input, output);

    // Replace esm.sh CDN with Cloudflare (Claude-compatible)
    html = this.replaceWithCloudfareCdn(html);

    const _meta: ClaudeMetaFields = {
      'ui/html': html,
      'ui/mimeType': 'text/html+mcp',
    };

    return {
      _meta: _meta as Record<string, unknown>,
      html,
      structuredContent: output,
      textContent: JSON.stringify(output, null, 2),
    };
  }

  private forExecutionHybrid(result: HybridBuildResult, input: unknown, output: unknown): ExecutionMeta {
    // Hybrid mode: Combine shell + component + data
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

    // Replace CDN with Cloudflare
    html = this.replaceWithCloudfareCdn(html);

    const _meta: ClaudeMetaFields = {
      'ui/html': html,
      'ui/mimeType': 'text/html+mcp',
    };

    return {
      _meta: _meta as Record<string, unknown>,
      html,
      structuredContent: output,
      textContent: JSON.stringify(output, null, 2),
    };
  }

  private forExecutionInline(result: InlineBuildResult, input: unknown, output: unknown): ExecutionMeta {
    // Inline mode: Would use buildFullWidget but that's async
    // For Claude, we need to return complete HTML

    // For now, create a simple HTML with the data
    const html = this.buildClaudeInlineHtml(input, output);

    const _meta: ClaudeMetaFields = {
      'ui/html': html,
      'ui/mimeType': 'text/html+mcp',
    };

    return {
      _meta: _meta as Record<string, unknown>,
      html,
      structuredContent: output,
      textContent: JSON.stringify(output, null, 2),
    };
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Replace esm.sh CDN URLs with Cloudflare CDN.
   *
   * Claude's sandbox trusts Cloudflare but not esm.sh.
   */
  private replaceWithCloudfareCdn(html: string): string {
    // Replace React imports
    html = html.replace(/https:\/\/esm\.sh\/react@\d+/g, CLOUDFLARE_CDN_URLS.react);
    html = html.replace(/https:\/\/esm\.sh\/react-dom@\d+/g, CLOUDFLARE_CDN_URLS.reactDom);

    // Replace import map with UMD script tags (Cloudflare uses UMD)
    const importMapRegex = /<script type="importmap">[\s\S]*?<\/script>/g;
    if (importMapRegex.test(html)) {
      const umdScripts = `
        <script src="${CLOUDFLARE_CDN_URLS.react}"></script>
        <script src="${CLOUDFLARE_CDN_URLS.reactDom}"></script>
      `;
      html = html.replace(importMapRegex, umdScripts);
    }

    return html;
  }

  /**
   * Build simple inline HTML for Claude.
   */
  private buildClaudeInlineHtml(input: unknown, output: unknown): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FrontMCP Widget</title>
  <script src="${CLOUDFLARE_CDN_URLS.tailwind}"></script>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body class="antialiased p-4">
  <script>
    window.__mcpToolInput = ${JSON.stringify(input)};
    window.__mcpToolOutput = ${JSON.stringify(output)};
    window.__mcpStructuredContent = ${JSON.stringify(output)};
  </script>

  <div id="root" class="min-h-[100px]">
    <div class="bg-white rounded-lg shadow p-4">
      <h3 class="text-lg font-semibold mb-2">Tool Output</h3>
      <pre class="bg-gray-100 p-3 rounded text-sm overflow-auto">${JSON.stringify(output, null, 2)}</pre>
    </div>
  </div>
</body>
</html>`;
  }
}
