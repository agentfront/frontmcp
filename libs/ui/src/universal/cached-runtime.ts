/**
 * Cached Runtime Builder
 *
 * Optimizes bundling by pre-building and caching the static runtime code.
 * Separates "vendor" (static runtime) from "app" (user component) chunks.
 *
 * Benefits:
 * - Runtime is built once and cached globally
 * - Only user components need transpilation per request
 * - Significantly reduces build time for repeated builds
 */

import type { CDNType, ContentSecurityOptions } from './types';
import { UNIVERSAL_CDN } from './types';

// ============================================
// Cache Types
// ============================================

/**
 * Cached runtime entry with metadata.
 */
interface CachedRuntime {
  /** Pre-built runtime script */
  script: string;
  /** CDN imports for head */
  cdnImports: string;
  /** Size in bytes */
  size: number;
  /** Cache key for this configuration */
  cacheKey: string;
  /** Timestamp when cached */
  cachedAt: number;
}

/**
 * Runtime cache configuration.
 */
interface RuntimeCacheConfig {
  /** Maximum cache entries */
  maxEntries?: number;
  /** TTL in milliseconds (0 = forever) */
  ttl?: number;
}

// ============================================
// Placeholders
// ============================================

/**
 * Placeholders for dynamic content injection.
 * These are replaced at build time with actual content.
 */
export const RUNTIME_PLACEHOLDERS = {
  /** Placeholder for transpiled component code */
  COMPONENT_CODE: '/*__FRONTMCP_COMPONENT_CODE__*/',
  /** Placeholder for data injection */
  DATA_INJECTION: '/*__FRONTMCP_DATA_INJECTION__*/',
  /** Placeholder for custom components */
  CUSTOM_COMPONENTS: '/*__FRONTMCP_CUSTOM_COMPONENTS__*/',
} as const;

// ============================================
// Global Cache
// ============================================

/** Global runtime cache */
const runtimeCache = new Map<string, CachedRuntime>();

/** Default cache configuration */
const DEFAULT_CACHE_CONFIG: Required<RuntimeCacheConfig> = {
  maxEntries: 10,
  ttl: 0, // Forever by default
};

// ============================================
// Cache Key Generation
// ============================================

/**
 * Generate cache key for runtime configuration.
 */
function generateCacheKey(options: CachedRuntimeOptions): string {
  // Content security affects generated code, so must be part of cache key
  const securityKey = options.contentSecurity
    ? [
        options.contentSecurity.allowUnsafeLinks ? 'unsafeLinks' : '',
        options.contentSecurity.allowInlineScripts ? 'unsafeScripts' : '',
        options.contentSecurity.bypassSanitization ? 'bypass' : '',
      ]
        .filter(Boolean)
        .join('+') || 'secure'
    : 'secure';

  return [
    options.cdnType,
    options.includeMarkdown ? 'md' : '',
    options.includeMdx ? 'mdx' : '',
    options.minify ? 'min' : '',
    securityKey,
  ]
    .filter(Boolean)
    .join(':');
}

// ============================================
// Runtime Building (Static Parts)
// ============================================

/**
 * Options for cached runtime.
 */
export interface CachedRuntimeOptions {
  /** CDN type (esm or umd) */
  cdnType: CDNType;
  /** Include markdown renderer */
  includeMarkdown?: boolean;
  /** Include MDX renderer */
  includeMdx?: boolean;
  /** Minify output */
  minify?: boolean;
  /** Content security / XSS protection options */
  contentSecurity?: ContentSecurityOptions;
}

/**
 * Build the store runtime (static).
 */
function buildStoreRuntime(): string {
  return `
// FrontMCP Store (Vendor)
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
    context: state,
    setContext: function(ctx) {
      this.setState(ctx);
    }
  };

  // React hooks
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

/**
 * Build the require shim (static).
 */
function buildRequireShim(): string {
  return `
// Module Require Shim (Vendor)
(function() {
  window.__moduleCache = {};
  window.require = function(moduleName) {
    if (window.__moduleCache[moduleName]) {
      return window.__moduleCache[moduleName];
    }

    var moduleMap = {
      'react': function() { return window.React; },
      'react-dom': function() { return window.ReactDOM; },
      'react-dom/client': function() { return window.ReactDOM; },
      'react/jsx-runtime': function() { return window.jsx_runtime_namespaceObject; },
      'react/jsx-dev-runtime': function() { return window.jsx_runtime_namespaceObject; },
      '@frontmcp/ui': function() { return window.frontmcp_ui_namespaceObject; },
      '@frontmcp/ui/react': function() { return window.frontmcp_ui_namespaceObject; }
    };

    var resolver = moduleMap[moduleName];
    if (resolver) {
      var mod = resolver();
      window.__moduleCache[moduleName] = mod;
      return mod;
    }

    console.warn('[FrontMCP] Unknown module:', moduleName);
    return {};
  };
})();
`;
}

/**
 * Build inline markdown parser (static).
 * @param options Runtime options for content security configuration
 */
function buildInlineMarkdownParser(options?: CachedRuntimeOptions): string {
  // Determine if unsafe links should be allowed (for customers who need to inject scripts/styles)
  const allowUnsafeLinks = options?.contentSecurity?.bypassSanitization || options?.contentSecurity?.allowUnsafeLinks;

  return `
// Inline Markdown Parser (Vendor)
(function() {
  // XSS protection settings (configured at build time)
  // Set to true if contentSecurity.allowUnsafeLinks or bypassSanitization is enabled
  var __allowUnsafeLinks = ${allowUnsafeLinks ? 'true' : 'false'};

  // URL scheme validation to prevent XSS via javascript: URLs
  function isSafeUrl(url) {
    // If unsafe links are explicitly allowed, skip validation
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
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/^######\\s+(.*)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\\s+(.*)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\\s+(.*)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\\s+(.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\\s+(.*)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\\s+(.*)$/gm, '<h1>$1</h1>');
    html = html.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
    html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    // Links - validate URL scheme to prevent XSS (unless bypassed)
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(match, text, url) {
      return isSafeUrl(url) ? '<a href="' + url + '">' + text + '</a>' : text;
    });
    html = html.replace(/^[-*]\\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/\\n\\n+/g, '</p><p>');
    html = '<p>' + html + '</p>';
    return html;
  }

  window.__frontmcp.parseMarkdown = parseMarkdown;

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

/**
 * Build renderers runtime (static).
 * @param options Runtime options for content security configuration
 */
function buildRenderersRuntime(options?: CachedRuntimeOptions): string {
  // Determine if inline scripts should be allowed (for customers who need to inject scripts/styles)
  const bypassSanitization = options?.contentSecurity?.bypassSanitization;
  const allowInlineScripts = bypassSanitization || options?.contentSecurity?.allowInlineScripts;

  return `
// Universal Renderers (Vendor)
(function() {
  var renderers = {};

  // XSS protection settings (configured at build time)
  // Set to true if contentSecurity.allowInlineScripts or bypassSanitization is enabled
  var __allowInlineScripts = ${allowInlineScripts ? 'true' : 'false'};

  renderers.html = {
    type: 'html',
    priority: 0,
    canHandle: function(c) { return c.type === 'html'; },
    render: function(c, ctx) {
      var html = c.source;
      // Apply XSS protection unless bypassed
      if (!__allowInlineScripts) {
        // Remove script tags and event handlers to prevent XSS
        html = html.replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi, '');
        html = html.replace(/\\s+on\\w+\\s*=/gi, ' data-removed-handler=');
      }
      return React.createElement('div', {
        className: 'frontmcp-html-content',
        dangerouslySetInnerHTML: { __html: html }
      });
    }
  };

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
      var html = window.__frontmcp.parseMarkdown ? window.__frontmcp.parseMarkdown(c.source) : c.source;
      return React.createElement('div', {
        className: 'frontmcp-markdown prose',
        dangerouslySetInnerHTML: { __html: html }
      });
    }
  };

  renderers.react = {
    type: 'react',
    priority: 30,
    canHandle: function(c) { return c.type === 'react' || typeof c.source === 'function'; },
    render: function(c, ctx) {
      var Component = c.source;
      var props = Object.assign({
        output: ctx.output,
        input: ctx.input,
        state: ctx.state,
        data: ctx.output // Alias for convenience
      }, c.props);
      return React.createElement(Component, props);
    }
  };

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
      if (typeof c.compiledContent === 'function') {
        var MDXContent = c.compiledContent;
        return React.createElement(MDXContent, {
          output: ctx.output,
          input: ctx.input,
          components: Object.assign({}, ctx.components, c.components)
        });
      }
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

  var sortedRenderers = [renderers.react, renderers.mdx, renderers.markdown, renderers.html];

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

  window.__frontmcp.renderContent = function(content, context) {
    var renderer = window.__frontmcp.detectRenderer(content);
    return renderer.render(content, context);
  };

  window.__frontmcp.renderers = renderers;
})();
`;
}

/**
 * Build UI components runtime (static).
 */
function buildUIComponentsRuntime(): string {
  return `
// UI Components (Vendor)
(function() {
  window.Card = function(props) {
    var children = props.children;
    var title = props.title;
    var className = props.className || '';
    return React.createElement('div', {
      className: 'bg-white rounded-lg shadow border border-gray-200 overflow-hidden ' + className
    }, [
      title && React.createElement('div', {
        key: 'header',
        className: 'px-4 py-3 border-b border-gray-200 bg-gray-50'
      }, React.createElement('h3', { className: 'text-sm font-medium text-gray-900' }, title)),
      React.createElement('div', { key: 'body', className: 'p-4' }, children)
    ]);
  };

  window.Badge = function(props) {
    var children = props.children;
    var variant = props.variant || 'default';
    var variantClasses = {
      default: 'bg-gray-100 text-gray-800',
      success: 'bg-green-100 text-green-800',
      warning: 'bg-yellow-100 text-yellow-800',
      error: 'bg-red-100 text-red-800',
      info: 'bg-blue-100 text-blue-800'
    };
    return React.createElement('span', {
      className: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + (variantClasses[variant] || variantClasses.default)
    }, children);
  };

  window.Button = function(props) {
    var children = props.children;
    var variant = props.variant || 'primary';
    var onClick = props.onClick;
    var disabled = props.disabled;
    var variantClasses = {
      primary: 'bg-blue-600 text-white hover:bg-blue-700',
      secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
      outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
      danger: 'bg-red-600 text-white hover:bg-red-700'
    };
    return React.createElement('button', {
      className: 'px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ' +
        (disabled ? 'opacity-50 cursor-not-allowed ' : '') +
        (variantClasses[variant] || variantClasses.primary),
      onClick: onClick,
      disabled: disabled
    }, children);
  };

  // Export to namespace
  window.frontmcp_ui_namespaceObject = Object.assign({}, window.React || {}, {
    useToolOutput: window.useToolOutput,
    useToolInput: window.useToolInput,
    useMcpBridgeContext: function() { return window.__frontmcp.context; },
    useCallTool: function() { return function() { return Promise.resolve(null); }; },
    Card: window.Card,
    Badge: window.Badge,
    Button: window.Button
  });
})();
`;
}

/**
 * Build UniversalApp component (static).
 */
function buildUniversalAppRuntime(): string {
  return `
// Universal App (Vendor)
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

/**
 * Build component execution wrapper (static template with placeholder).
 */
function buildComponentWrapper(): string {
  return `
// Component Execution (App Chunk)
(function() {
  ${RUNTIME_PLACEHOLDERS.COMPONENT_CODE}
})();
`;
}

/**
 * Build data injection (static template with placeholder).
 */
function buildDataInjectionWrapper(): string {
  return `
// Data Injection (App Chunk)
(function() {
  ${RUNTIME_PLACEHOLDERS.DATA_INJECTION}
})();
`;
}

/**
 * Build custom components wrapper (static template with placeholder).
 */
function buildCustomComponentsWrapper(): string {
  return `
// Custom Components (App Chunk)
(function() {
  ${RUNTIME_PLACEHOLDERS.CUSTOM_COMPONENTS}
})();
`;
}

// ============================================
// CDN Imports
// ============================================

/**
 * Build CDN import statements.
 */
function buildCdnImports(options: CachedRuntimeOptions): string {
  const parts: string[] = [];

  if (options.cdnType === 'esm') {
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

  return parts.join('\n');
}

// ============================================
// Main Cache API
// ============================================

/**
 * Result from getting cached runtime.
 */
export interface CachedRuntimeResult {
  /** Pre-built vendor script (static runtime) */
  vendorScript: string;
  /** Template for app script (with placeholders) */
  appTemplate: string;
  /** CDN imports for head */
  cdnImports: string;
  /** Total size of vendor script */
  vendorSize: number;
  /** Whether this was from cache */
  cached: boolean;
  /** Cache key used */
  cacheKey: string;
}

/**
 * Get or build cached runtime.
 *
 * @param options - Runtime options
 * @param config - Cache configuration
 * @returns Cached runtime result
 *
 * @example
 * ```typescript
 * const runtime = getCachedRuntime({ cdnType: 'umd', includeMarkdown: true });
 *
 * // Replace placeholders with actual content
 * const appScript = runtime.appTemplate
 *   .replace(RUNTIME_PLACEHOLDERS.COMPONENT_CODE, transpiledCode)
 *   .replace(RUNTIME_PLACEHOLDERS.DATA_INJECTION, dataScript);
 * ```
 */
export function getCachedRuntime(options: CachedRuntimeOptions, config: RuntimeCacheConfig = {}): CachedRuntimeResult {
  const cacheKey = generateCacheKey(options);
  const cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...config };

  // Check cache
  const cached = runtimeCache.get(cacheKey);
  if (cached) {
    // Check TTL
    if (cacheConfig.ttl === 0 || Date.now() - cached.cachedAt < cacheConfig.ttl) {
      return {
        vendorScript: cached.script,
        appTemplate: buildAppTemplate(),
        cdnImports: cached.cdnImports,
        vendorSize: cached.size,
        cached: true,
        cacheKey,
      };
    }
    // Expired, remove from cache
    runtimeCache.delete(cacheKey);
  }

  // Build vendor script
  const vendorParts: string[] = [buildStoreRuntime(), buildRequireShim()];

  // Add markdown parser for UMD (Claude) or when explicitly requested
  // Pass options for content security configuration
  if (options.cdnType === 'umd' || options.includeMarkdown) {
    vendorParts.push(buildInlineMarkdownParser(options));
  }

  // Pass options for content security configuration (inline scripts protection)
  vendorParts.push(buildRenderersRuntime(options));
  vendorParts.push(buildUIComponentsRuntime());
  vendorParts.push(buildUniversalAppRuntime());

  let vendorScript = vendorParts.join('\n');

  // Minify if requested
  if (options.minify) {
    vendorScript = minifyScript(vendorScript);
  }

  const cdnImports = buildCdnImports(options);

  // Cache the result
  const entry: CachedRuntime = {
    script: vendorScript,
    cdnImports,
    size: vendorScript.length,
    cacheKey,
    cachedAt: Date.now(),
  };

  // Enforce max entries
  if (runtimeCache.size >= cacheConfig.maxEntries) {
    // Remove oldest entry
    const oldestKey = runtimeCache.keys().next().value;
    if (oldestKey) {
      runtimeCache.delete(oldestKey);
    }
  }

  runtimeCache.set(cacheKey, entry);

  return {
    vendorScript,
    appTemplate: buildAppTemplate(),
    cdnImports,
    vendorSize: vendorScript.length,
    cached: false,
    cacheKey,
  };
}

/**
 * Build the app template with placeholders.
 */
function buildAppTemplate(): string {
  return [buildCustomComponentsWrapper(), buildComponentWrapper(), buildDataInjectionWrapper()].join('\n');
}

/**
 * Safe script minification that preserves strings.
 *
 * Uses a conservative approach to avoid corrupting string literals:
 * - Only removes full-line comments (lines starting with //)
 * - Removes block comments (/* ... *\/)
 * - Removes empty lines and leading whitespace
 * - Does NOT remove inline // comments (they might be in strings like 'http://')
 */
function minifyScript(script: string): string {
  return (
    script
      // Remove block comments (safe - /* can't appear in strings without escaping)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove full-line comments (lines that are ONLY a comment after whitespace)
      // This is safe because we require the line to start with optional whitespace then //
      .replace(/^\s*\/\/[^\n]*$/gm, '')
      // Collapse multiple newlines into single newline
      .replace(/\n\s*\n/g, '\n')
      // Remove leading whitespace from each line
      .replace(/^\s+/gm, '')
      .trim()
  );
}

/**
 * Clear the runtime cache.
 */
export function clearRuntimeCache(): void {
  runtimeCache.clear();
}

/**
 * Get cache statistics.
 */
export function getRuntimeCacheStats(): {
  entries: number;
  totalSize: number;
  keys: string[];
} {
  let totalSize = 0;
  const keys: string[] = [];

  for (const [key, entry] of runtimeCache) {
    keys.push(key);
    totalSize += entry.size;
  }

  return {
    entries: runtimeCache.size,
    totalSize,
    keys,
  };
}

// ============================================
// Helper Functions for Bundler Integration
// ============================================

/**
 * Build the complete app script by replacing placeholders.
 *
 * @param appTemplate - Template with placeholders
 * @param componentCode - Transpiled component code (or empty string)
 * @param dataInjection - Data injection script
 * @param customComponents - Custom components script (or empty string)
 * @returns Complete app script
 */
export function buildAppScript(
  appTemplate: string,
  componentCode: string,
  dataInjection: string,
  customComponents = '',
): string {
  return appTemplate
    .replace(RUNTIME_PLACEHOLDERS.CUSTOM_COMPONENTS, customComponents || '// No custom components')
    .replace(RUNTIME_PLACEHOLDERS.COMPONENT_CODE, componentCode || '// No component code')
    .replace(RUNTIME_PLACEHOLDERS.DATA_INJECTION, dataInjection);
}

/**
 * Build data injection code for the app script.
 */
export function buildDataInjectionCode(
  toolName: string,
  input: unknown,
  output: unknown,
  structuredContent: unknown,
  contentType: string,
  source: string | null,
  hasComponent: boolean,
): string {
  const safeJson = (value: unknown): string => {
    try {
      return JSON.stringify(value);
    } catch {
      return 'null';
    }
  };

  if (hasComponent) {
    return `
  window.__frontmcp.setState({
    toolName: ${safeJson(toolName)},
    input: ${safeJson(input ?? null)},
    output: ${safeJson(output ?? null)},
    structuredContent: ${safeJson(structuredContent ?? null)},
    content: {
      type: 'react',
      source: window.__frontmcp_component
    },
    loading: false,
    error: null
  });`;
  }

  return `
  window.__frontmcp.setState({
    toolName: ${safeJson(toolName)},
    input: ${safeJson(input ?? null)},
    output: ${safeJson(output ?? null)},
    structuredContent: ${safeJson(structuredContent ?? null)},
    content: {
      type: ${safeJson(contentType)},
      source: ${safeJson(source)}
    },
    loading: false,
    error: null
  });`;
}

/**
 * Build component wrapper code.
 */
export function buildComponentCode(transpiledCode: string): string {
  return `
  // CommonJS module shim
  var module = { exports: {} };
  var exports = module.exports;

  // Execute transpiled component
  ${transpiledCode}

  // Capture component
  window.__frontmcp_component = module.exports.default || module.exports;`;
}
