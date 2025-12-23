/**
 * Universal Runtime Builder
 *
 * Generates inline JavaScript for the universal renderer.
 * Used by bundleToStaticHTML to create self-contained HTML documents.
 */

import type { UniversalRuntimeOptions, UniversalRuntimeResult, CDNType } from './types';
import { UNIVERSAL_CDN } from './types';

// ============================================
// Store Runtime
// ============================================

/**
 * Build the inline store implementation.
 */
function buildStoreRuntime(): string {
  return `
// FrontMCP Store
(function() {
  var state = {
    toolName: null,
    input: null,
    output: null,
    content: null,
    structuredContent: null,
    loading: false,
    error: null
  };

  var listeners = new Set();

  window.__frontmcp = {
    // Store methods
    getState: function() { return state; },
    setState: function(partial) {
      state = Object.assign({}, state, partial);
      listeners.forEach(function(fn) { fn(); });
    },
    subscribe: function(fn) {
      listeners.add(fn);
      return function() { listeners.delete(fn); };
    },
    reset: function() {
      state = {
        toolName: null,
        input: null,
        output: null,
        content: null,
        structuredContent: null,
        loading: false,
        error: null
      };
    },

    // Context (legacy support)
    context: state,
    setContext: function(ctx) {
      this.setState(ctx);
    }
  };

  // Hooks for React components
  window.useFrontMCPStore = function() {
    var store = window.__frontmcp;
    return React.useSyncExternalStore(
      store.subscribe,
      store.getState,
      store.getState
    );
  };

  window.useToolOutput = function() {
    return window.useFrontMCPStore().output;
  };

  window.useToolInput = function() {
    return window.useFrontMCPStore().input;
  };

  window.useContent = function() {
    return window.useFrontMCPStore().content;
  };
})();
`;
}

// ============================================
// Markdown Runtime
// ============================================

/**
 * Build inline markdown parser for platforms without react-markdown CDN.
 * @param options Content security options for XSS protection
 */
function buildInlineMarkdownParser(options?: UniversalRuntimeOptions): string {
  const allowUnsafeLinks = options?.contentSecurity?.bypassSanitization || options?.contentSecurity?.allowUnsafeLinks;

  return `
// Inline Markdown Parser
(function() {
  // XSS protection settings (configured at build time)
  var __allowUnsafeLinks = ${allowUnsafeLinks ? 'true' : 'false'};

  // URL scheme validation to prevent XSS via javascript: URLs
  function isSafeUrl(url) {
    // If unsafe links are allowed, all URLs are considered safe
    if (__allowUnsafeLinks) return true;
    if (!url) return false;
    var lower = url.toLowerCase().trim();
    return lower.startsWith('http://') ||
           lower.startsWith('https://') ||
           lower.startsWith('/') ||
           lower.startsWith('#') ||
           lower.startsWith('mailto:');
  }

  function parseMarkdown(md) {
    var html = md;
    // Escape HTML
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Headers
    html = html.replace(/^######\\s+(.*)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\\s+(.*)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\\s+(.*)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\\s+(.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\\s+(.*)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\\s+(.*)$/gm, '<h1>$1</h1>');
    // Bold and italic
    html = html.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
    // Inline code
    html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    // Links - validate URL scheme to prevent XSS (unless bypassed)
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(match, text, url) {
      return isSafeUrl(url) ? '<a href="' + url + '">' + text + '</a>' : text;
    });
    // Lists
    html = html.replace(/^[-*]\\s+(.*)$/gm, '<li>$1</li>');
    // Paragraphs
    html = html.replace(/\\n\\n+/g, '</p><p>');
    html = '<p>' + html + '</p>';
    return html;
  }

  window.__frontmcp.parseMarkdown = parseMarkdown;

  // Simple ReactMarkdown replacement
  window.ReactMarkdown = function(props) {
    var html = parseMarkdown(props.children || '');
    return React.createElement('div', {
      className: 'frontmcp-markdown prose',
      dangerouslySetInnerHTML: { __html: html }
    });
  };
})();
`;
}

// ============================================
// Renderers Runtime
// ============================================

/**
 * Build the inline renderers implementation.
 */
function buildRenderersRuntime(options: UniversalRuntimeOptions): string {
  const bypassSanitization = options?.contentSecurity?.bypassSanitization;
  const allowInlineScripts = bypassSanitization || options?.contentSecurity?.allowInlineScripts;

  return `
// Universal Renderers
(function() {
  var renderers = {};

  // XSS protection settings (configured at build time)
  var __allowInlineScripts = ${allowInlineScripts ? 'true' : 'false'};

  // HTML Renderer
  renderers.html = {
    type: 'html',
    priority: 0,
    canHandle: function(c) { return c.type === 'html'; },
    render: function(c, ctx) {
      var html = c.source;
      // Apply XSS protection unless bypassed
      if (!__allowInlineScripts) {
        // Remove script tags and event handlers
        html = html.replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi, '');
        html = html.replace(/\\s+on\\w+\\s*=/gi, ' data-removed-handler=');
      }
      return React.createElement('div', {
        className: 'frontmcp-html-content',
        dangerouslySetInnerHTML: { __html: html }
      });
    }
  };

  // Markdown Renderer
  renderers.markdown = {
    type: 'markdown',
    priority: 10,
    canHandle: function(c) {
      if (c.type === 'markdown') return true;
      if (typeof c.source !== 'string') return false;
      var s = c.source;
      return /^#{1,6}\\s/m.test(s) || /^[-*]\\s/m.test(s) || /\\*\\*[^*]+\\*\\*/.test(s);
    },
    render: function(c, ctx) {
      if (window.ReactMarkdown) {
        return React.createElement(window.ReactMarkdown, {
          children: c.source,
          components: Object.assign({}, ctx.components, c.components)
        });
      }
      // Fallback to inline parser
      var html = window.__frontmcp.parseMarkdown ? window.__frontmcp.parseMarkdown(c.source) : c.source;
      return React.createElement('div', {
        className: 'frontmcp-markdown prose',
        dangerouslySetInnerHTML: { __html: html }
      });
    }
  };

  // React Renderer
  renderers.react = {
    type: 'react',
    priority: 30,
    canHandle: function(c) { return c.type === 'react' || typeof c.source === 'function'; },
    render: function(c, ctx) {
      var Component = c.source;
      var props = Object.assign({
        output: ctx.output,
        input: ctx.input,
        state: ctx.state
      }, c.props);
      return React.createElement(Component, props);
    }
  };

  // MDX Renderer
  renderers.mdx = {
    type: 'mdx',
    priority: 20,
    canHandle: function(c) {
      if (c.type === 'mdx') return true;
      if (typeof c.source !== 'string') return false;
      var s = c.source;
      return /<[A-Z][a-zA-Z]*/.test(s) && /^#{1,6}\\s/m.test(s);
    },
    render: function(c, ctx) {
      // MDX requires pre-compilation, fallback to showing source
      if (typeof c.compiledContent === 'function') {
        var MDXContent = c.compiledContent;
        return React.createElement(MDXContent, {
          output: ctx.output,
          input: ctx.input,
          components: Object.assign({}, ctx.components, c.components)
        });
      }
      // Show warning
      return React.createElement('div', { className: 'frontmcp-mdx-fallback' }, [
        React.createElement('div', {
          key: 'warn',
          className: 'bg-yellow-50 border border-yellow-200 rounded p-2 mb-2 text-sm text-yellow-800'
        }, 'MDX requires pre-compilation. Showing raw content.'),
        React.createElement('pre', {
          key: 'pre',
          className: 'bg-gray-100 p-4 rounded text-sm overflow-auto'
        }, c.source)
      ]);
    }
  };

  // Sorted by priority
  var sortedRenderers = [renderers.react, renderers.mdx, renderers.markdown, renderers.html];

  // Detect renderer
  window.__frontmcp.detectRenderer = function(content) {
    if (content.type && renderers[content.type]) {
      return renderers[content.type];
    }
    for (var i = 0; i < sortedRenderers.length; i++) {
      if (sortedRenderers[i].canHandle(content)) {
        return sortedRenderers[i];
      }
    }
    return renderers.html;
  };

  // Render content
  window.__frontmcp.renderContent = function(content, context) {
    var renderer = window.__frontmcp.detectRenderer(content);
    return renderer.render(content, context);
  };

  window.__frontmcp.renderers = renderers;
})();
`;
}

// ============================================
// Universal App Runtime
// ============================================

/**
 * Build the inline UniversalApp component.
 */
function buildUniversalAppRuntime(): string {
  return `
// Universal App Component
(function() {
  var LoadingSpinner = function() {
    return React.createElement('div', {
      className: 'frontmcp-loading flex items-center justify-center min-h-[200px]'
    }, React.createElement('div', {
      className: 'frontmcp-spinner w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin'
    }));
  };

  var ErrorDisplay = function(props) {
    return React.createElement('div', {
      className: 'frontmcp-error bg-red-50 border border-red-200 rounded-lg p-4 text-red-800'
    }, [
      React.createElement('div', { key: 'title', className: 'font-medium' }, 'Error'),
      React.createElement('div', { key: 'msg', className: 'text-sm mt-1' }, props.error)
    ]);
  };

  var EmptyState = function() {
    return React.createElement('div', {
      className: 'frontmcp-empty text-gray-500 text-center py-8'
    }, 'No content to display');
  };

  window.__frontmcp.UniversalApp = function(props) {
    var state = window.useFrontMCPStore();

    if (state.loading) {
      return props.fallback || React.createElement(LoadingSpinner);
    }

    if (state.error) {
      var ErrorComp = props.errorFallback || ErrorDisplay;
      return React.createElement(ErrorComp, { error: state.error });
    }

    var content = props.content || state.content;

    if (!content) {
      return React.createElement(EmptyState);
    }

    var context = {
      output: state.output,
      input: state.input,
      state: state,
      components: props.components || {}
    };

    var rendered = window.__frontmcp.renderContent(content, context);
    return React.createElement('div', { className: 'frontmcp-content' }, rendered);
  };

  window.__frontmcp.LoadingSpinner = LoadingSpinner;
  window.__frontmcp.ErrorDisplay = ErrorDisplay;
  window.__frontmcp.EmptyState = EmptyState;
})();
`;
}

// ============================================
// CDN Imports Builder
// ============================================

/**
 * Build CDN import statements.
 */
function buildCdnImports(options: UniversalRuntimeOptions): string {
  const parts: string[] = [];

  if (options.cdnType === 'esm') {
    // ES modules - load via import
    if (options.includeMarkdown) {
      parts.push(`
    <script type="module">
      import ReactMarkdown from '${UNIVERSAL_CDN.esm.reactMarkdown}';
      window.ReactMarkdown = ReactMarkdown;
    </script>`);
    }

    if (options.includeMdx) {
      parts.push(`
    <script type="module">
      import { MDXProvider } from '${UNIVERSAL_CDN.esm.mdxReact}';
      window.MDXProvider = MDXProvider;
    </script>`);
    }
  }
  // UMD (Claude) - no CDN available, use inline implementations

  return parts.join('\n');
}

// ============================================
// Main Builder Function
// ============================================

/**
 * Build the complete universal runtime script.
 *
 * @param options - Build options
 * @returns Runtime result with script and CDN imports
 *
 * @example
 * ```typescript
 * const result = buildUniversalRuntime({
 *   cdnType: 'esm',
 *   includeMarkdown: true,
 * });
 *
 * // result.script = complete inline runtime
 * // result.cdnImports = CDN script tags to include in head
 * ```
 */
export function buildUniversalRuntime(options: UniversalRuntimeOptions): UniversalRuntimeResult {
  const parts: string[] = [];

  // 1. Store runtime
  parts.push(buildStoreRuntime());

  // 2. Inline markdown parser (for UMD/Claude or when no CDN available)
  if (options.cdnType === 'umd' || options.includeMarkdown) {
    parts.push(buildInlineMarkdownParser(options));
  }

  // 3. Renderers
  parts.push(buildRenderersRuntime(options));

  // 4. Universal App
  parts.push(buildUniversalAppRuntime());

  // 5. Custom components (if provided)
  if (options.customComponents) {
    parts.push(`
// Custom Components
(function() {
  ${options.customComponents}
})();
`);
  }

  let script = parts.join('\n');

  // Minify if requested (safe minification that preserves strings)
  if (options.minify) {
    script = script
      // Remove block comments (safe - /* can't appear in strings without escaping)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove full-line comments only (to preserve // in strings like 'http://')
      .replace(/^\s*\/\/[^\n]*$/gm, '')
      // Collapse multiple newlines
      .replace(/\n\s*\n/g, '\n')
      // Remove leading whitespace
      .replace(/^\s+/gm, '')
      .trim();
  }

  return {
    script,
    cdnImports: buildCdnImports(options),
    size: script.length,
  };
}

/**
 * Build a minimal runtime (store + basic rendering only).
 *
 * @param options - Build options
 * @returns Minimal runtime script
 */
export function buildMinimalRuntime(options: Pick<UniversalRuntimeOptions, 'minify'>): string {
  let script = buildStoreRuntime();

  if (options.minify) {
    script = script
      // Remove block comments (safe)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove full-line comments only (preserves // in strings)
      .replace(/^\s*\/\/[^\n]*$/gm, '')
      .replace(/\n\s*\n/g, '\n')
      .replace(/^\s+/gm, '')
      .trim();
  }

  return script;
}
