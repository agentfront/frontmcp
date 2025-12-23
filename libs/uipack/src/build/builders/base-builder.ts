/**
 * Base Builder
 *
 * Abstract base class for Static, Hybrid, and Inline builders.
 * Provides common functionality for template detection, transpilation,
 * and HTML generation.
 *
 * @packageDocumentation
 */

import { transform } from 'esbuild';
import type {
  BuilderOptions,
  CdnMode,
  TemplateDetection,
  TranspileOptions,
  TranspileResult,
} from './types';
import type { UITemplateConfig, TemplateContext, TemplateBuilderFn } from '../../types';
import type { ThemeConfig } from '../../theme';
import { DEFAULT_THEME, mergeThemes, buildThemeCss, buildFontPreconnect, buildFontStylesheets } from '../../theme';
import { createTransformConfig, createExternalizedConfig, DEFAULT_EXTERNALS } from './esbuild-config';
import { BRIDGE_SCRIPT_TAGS } from '../../bridge-runtime';
import { HYBRID_DATA_PLACEHOLDER, HYBRID_INPUT_PLACEHOLDER } from '../hybrid-data';
import { escapeHtml } from '../../utils';

// ============================================
// Base Builder Class
// ============================================

/**
 * Abstract base builder class.
 *
 * Provides common functionality:
 * - Template type detection
 * - Component transpilation via esbuild
 * - Theme CSS generation
 * - HTML document scaffolding
 */
export abstract class BaseBuilder {
  /**
   * CDN loading mode.
   */
  protected readonly cdnMode: CdnMode;

  /**
   * Whether to minify output.
   */
  protected readonly minify: boolean;

  /**
   * Theme configuration.
   */
  protected readonly theme: ThemeConfig;

  /**
   * Whether to include source maps.
   */
  protected readonly sourceMaps: boolean;

  constructor(options: BuilderOptions = {}) {
    this.cdnMode = options.cdnMode ?? 'cdn';
    this.minify = options.minify ?? false;
    this.theme = options.theme ? mergeThemes(DEFAULT_THEME, options.theme) : DEFAULT_THEME;
    this.sourceMaps = options.sourceMaps ?? false;
  }

  // ============================================
  // Template Detection
  // ============================================

  /**
   * Detect the type of a template.
   *
   * @param template - Template to detect
   * @returns Detection result with type and renderer info
   */
  protected detectTemplate<In = unknown, Out = unknown>(
    template: UITemplateConfig<In, Out>['template']
  ): TemplateDetection {
    // String template
    if (typeof template === 'string') {
      return {
        type: 'html-string',
        renderer: 'html',
        needsTranspilation: false,
      };
    }

    // Function template
    if (typeof template === 'function') {
      // Check if it's a React component (has $$typeof or returns JSX)
      const funcStr = template.toString();
      if (
        funcStr.includes('jsx') ||
        funcStr.includes('createElement') ||
        funcStr.includes('React') ||
        (template as unknown as { $$typeof?: symbol }).$$typeof
      ) {
        return {
          type: 'react-component',
          renderer: 'react',
          needsTranspilation: true,
        };
      }

      // HTML builder function
      return {
        type: 'html-function',
        renderer: 'html',
        needsTranspilation: false,
      };
    }

    // React element
    if (
      template &&
      typeof template === 'object' &&
      (template as unknown as { $$typeof?: symbol }).$$typeof
    ) {
      return {
        type: 'react-element',
        renderer: 'react',
        needsTranspilation: true,
      };
    }

    // Default to HTML
    return {
      type: 'html-string',
      renderer: 'html',
      needsTranspilation: false,
    };
  }

  // ============================================
  // Transpilation
  // ============================================

  /**
   * Transpile a component using esbuild.
   *
   * @param source - Source code to transpile
   * @param options - Transpile options
   * @returns Transpile result
   */
  protected async transpile(
    source: string,
    options: TranspileOptions = {}
  ): Promise<TranspileResult> {
    const externals = options.externals || DEFAULT_EXTERNALS;
    const config = options.externals
      ? createExternalizedConfig(options)
      : createTransformConfig(options);

    const result = await transform(source, config);

    return {
      code: result.code,
      map: result.map,
      size: Buffer.byteLength(result.code, 'utf8'),
      externalizedImports: externals,
    };
  }

  /**
   * Render an HTML template.
   *
   * @param template - HTML template (string or function)
   * @param context - Template context with input/output
   * @returns Rendered HTML string
   */
  protected renderHtmlTemplate<In = unknown, Out = unknown>(
    template: string | TemplateBuilderFn<In, Out>,
    context: TemplateContext<In, Out>
  ): string {
    if (typeof template === 'string') {
      return template;
    }

    return template(context);
  }

  // ============================================
  // HTML Generation
  // ============================================

  /**
   * Build the <head> section of the HTML document.
   *
   * @param options - Head options
   * @returns HTML head content
   */
  protected buildHead(options: {
    title: string;
    includeBridge?: boolean;
    includeCdn?: boolean;
    includeTheme?: boolean;
    customStyles?: string;
  }): string {
    const {
      title,
      includeBridge = true,
      includeCdn = this.cdnMode === 'cdn',
      includeTheme = true,
      customStyles = '',
    } = options;

    const parts: string[] = [
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `<title>${escapeHtml(title)}</title>`,
    ];

    // Font preconnect and stylesheets
    parts.push(buildFontPreconnect());
    parts.push(buildFontStylesheets({ inter: true }));

    // Theme CSS
    if (includeTheme) {
      const themeCss = buildThemeCss(this.theme);
      const customCss = this.theme.customCss || '';
      parts.push(`
        <style type="text/tailwindcss">
          @theme {
            ${themeCss}
          }
          ${customCss}
        </style>
      `);
    }

    // Custom styles
    if (customStyles) {
      parts.push(`<style>${customStyles}</style>`);
    }

    // CDN scripts (Tailwind, etc.)
    if (includeCdn) {
      parts.push('<script src="https://cdn.tailwindcss.com"></script>');
    }

    // Bridge runtime
    if (includeBridge) {
      parts.push(BRIDGE_SCRIPT_TAGS.universal);
    }

    parts.push('</head>');

    return parts.join('\n');
  }

  /**
   * Build data injection script.
   *
   * @param options - Injection options
   * @returns Script tag with data injection
   */
  protected buildDataInjectionScript(options: {
    toolName: string;
    input?: unknown;
    output?: unknown;
    usePlaceholders?: boolean;
  }): string {
    const { toolName, input, output, usePlaceholders = false } = options;

    if (usePlaceholders) {
      return `
        <script>
          window.__mcpToolName = ${JSON.stringify(toolName)};
          window.__mcpToolInput = JSON.parse("${HYBRID_INPUT_PLACEHOLDER}");
          window.__mcpToolOutput = JSON.parse("${HYBRID_DATA_PLACEHOLDER}");
          window.__mcpStructuredContent = window.__mcpToolOutput;
        </script>
      `;
    }

    return `
      <script>
        window.__mcpToolName = ${JSON.stringify(toolName)};
        window.__mcpToolInput = ${JSON.stringify(input ?? {})};
        window.__mcpToolOutput = ${JSON.stringify(output ?? {})};
        window.__mcpStructuredContent = window.__mcpToolOutput;
      </script>
    `;
  }

  /**
   * Wrap content in a complete HTML document.
   *
   * @param options - Wrap options
   * @returns Complete HTML document
   */
  protected wrapInHtmlDocument(options: {
    head: string;
    body: string;
    bodyClass?: string;
  }): string {
    const { head, body, bodyClass = '' } = options;

    return `<!DOCTYPE html>
<html lang="en">
${head}
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${body}
</body>
</html>`;
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Calculate content hash.
   *
   * @param content - Content to hash
   * @returns Hash string
   */
  protected async calculateHash(content: string): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(content);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    }

    // Simple fallback hash
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Estimate gzipped size.
   *
   * @param content - Content to estimate
   * @returns Estimated gzipped size in bytes
   */
  protected estimateGzipSize(content: string): number {
    // Rough estimate: gzip typically achieves 70-90% compression on HTML
    return Math.round(Buffer.byteLength(content, 'utf8') * 0.25);
  }

  /**
   * Create template context.
   *
   * @param input - Tool input
   * @param output - Tool output
   * @returns Template context
   */
  protected createContext<In = unknown, Out = unknown>(
    input: In,
    output: Out
  ): TemplateContext<In, Out> {
    return {
      input,
      output,
      helpers: {
        escapeHtml,
        formatDate: (date: Date | string, format?: string): string => {
          const d = typeof date === 'string' ? new Date(date) : date;
          if (isNaN(d.getTime())) return String(date);
          if (format === 'iso') return d.toISOString();
          if (format === 'time') return d.toLocaleTimeString();
          if (format === 'datetime') return d.toLocaleString();
          return d.toLocaleDateString();
        },
        formatCurrency: (amount: number, currency = 'USD'): string => {
          return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
        },
        uniqueId: (prefix = 'mcp'): string => {
          return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        },
        jsonEmbed: (data: unknown): string => {
          const json = JSON.stringify(data);
          if (json === undefined) return 'undefined';
          return json
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026')
            .replace(/'/g, '\\u0027');
        },
      },
    };
  }
}
