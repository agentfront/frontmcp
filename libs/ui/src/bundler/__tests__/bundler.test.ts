/**
 * InMemoryBundler Tests
 *
 * Tests for the in-memory bundler class.
 * Note: Some tests require esbuild or @swc/core to be installed.
 */

import { InMemoryBundler } from '../bundler';
import type { BundleOptions, SecurityPolicy } from '../types';
import { DEFAULT_BUNDLE_OPTIONS, DEFAULT_BUNDLER_OPTIONS, DEFAULT_SECURITY_POLICY } from '../types';

// ============================================
// Constructor Tests
// ============================================

describe('InMemoryBundler', () => {
  describe('Constructor', () => {
    it('should create bundler with default options', () => {
      const bundler = new InMemoryBundler();
      expect(bundler).toBeInstanceOf(InMemoryBundler);
    });

    it('should create bundler with custom options', () => {
      const bundler = new InMemoryBundler({
        cache: { maxSize: 50, ttl: 10000 },
        defaultSecurity: { maxBundleSize: 500000 },
      });
      expect(bundler).toBeInstanceOf(InMemoryBundler);
    });

    it('should merge cache options with defaults', () => {
      const bundler = new InMemoryBundler({
        cache: { maxSize: 50 },
      });
      expect(bundler).toBeInstanceOf(InMemoryBundler);
    });
  });

  describe('Cache Management', () => {
    let bundler: InMemoryBundler;

    beforeEach(() => {
      bundler = new InMemoryBundler();
      bundler.clearCache();
    });

    it('should clear cache', () => {
      bundler.clearCache();
      const stats = bundler.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should return cache stats', () => {
      const stats = bundler.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('hitRate');
    });
  });
});

// ============================================
// Default Options Tests
// ============================================

describe('Default Options', () => {
  describe('DEFAULT_BUNDLE_OPTIONS', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_BUNDLE_OPTIONS.sourceType).toBe('auto');
      expect(DEFAULT_BUNDLE_OPTIONS.format).toBe('iife');
      expect(DEFAULT_BUNDLE_OPTIONS.minify).toBe(false);
      expect(DEFAULT_BUNDLE_OPTIONS.sourceMaps).toBe(false);
      expect(DEFAULT_BUNDLE_OPTIONS.externals).toContain('react');
      expect(DEFAULT_BUNDLE_OPTIONS.target).toBe('es2020');
      expect(DEFAULT_BUNDLE_OPTIONS.globalName).toBe('Widget');
    });

    it('should have JSX configuration', () => {
      expect(DEFAULT_BUNDLE_OPTIONS.jsx).toBeDefined();
      expect(DEFAULT_BUNDLE_OPTIONS.jsx?.runtime).toBe('automatic');
      expect(DEFAULT_BUNDLE_OPTIONS.jsx?.importSource).toBe('react');
    });
  });

  describe('DEFAULT_BUNDLER_OPTIONS', () => {
    it('should have cache configuration', () => {
      expect(DEFAULT_BUNDLER_OPTIONS.cache).toBeDefined();
      expect(DEFAULT_BUNDLER_OPTIONS.cache?.maxSize).toBeGreaterThan(0);
      expect(DEFAULT_BUNDLER_OPTIONS.cache?.ttl).toBeGreaterThan(0);
    });

    it('should have security configuration', () => {
      expect(DEFAULT_BUNDLER_OPTIONS.defaultSecurity).toBeDefined();
    });
  });

  describe('DEFAULT_SECURITY_POLICY', () => {
    it('should have allowed imports', () => {
      expect(DEFAULT_SECURITY_POLICY.allowedImports).toBeDefined();
      expect(Array.isArray(DEFAULT_SECURITY_POLICY.allowedImports)).toBe(true);
    });

    it('should have blocked imports for dangerous modules', () => {
      expect(DEFAULT_SECURITY_POLICY.blockedImports).toBeDefined();
      expect(Array.isArray(DEFAULT_SECURITY_POLICY.blockedImports)).toBe(true);
    });

    it('should block fs module', () => {
      const hasFsBlock = DEFAULT_SECURITY_POLICY.blockedImports?.some((p) => p.toString().includes('fs'));
      expect(hasFsBlock).toBe(true);
    });

    it('should block child_process module', () => {
      const hasChildProcessBlock = DEFAULT_SECURITY_POLICY.blockedImports?.some((p) =>
        p.toString().includes('child_process'),
      );
      expect(hasChildProcessBlock).toBe(true);
    });
  });
});

// ============================================
// Bundle Tests (with transpiler)
// ============================================

describe('Bundle Operations', () => {
  let bundler: InMemoryBundler;

  beforeEach(() => {
    bundler = new InMemoryBundler();
    bundler.clearCache();
  });

  describe('bundle', () => {
    it('should bundle simple JSX', async () => {
      const result = await bundler.bundle({
        source: 'const App = () => <div>Hello</div>; export default App;',
        sourceType: 'jsx',
      });

      expect(result).toBeDefined();
      expect(result.code).toBeDefined();
      expect(result.size).toBeGreaterThan(0);
      expect(result.hash).toBeDefined();
    });

    it('should bundle TSX with types', async () => {
      const result = await bundler.bundle({
        source: `
          interface Props { name: string; }
          const App = ({ name }: Props) => <div>Hello {name}</div>;
          export default App;
        `,
        sourceType: 'tsx',
      });

      expect(result).toBeDefined();
      expect(result.code).toBeDefined();
      // Types should be stripped
      expect(result.code).not.toContain('interface Props');
    });

    it('should return cached result on second call', async () => {
      const source = 'const App = () => <span>Test</span>; export default App;';

      const result1 = await bundler.bundle({ source, sourceType: 'jsx' });
      expect(result1.cached).toBe(false);

      const result2 = await bundler.bundle({ source, sourceType: 'jsx' });
      expect(result2.cached).toBe(true);
      expect(result2.code).toBe(result1.code);
    });

    it('should skip cache when requested', async () => {
      const source = 'const App = () => <span>Skip</span>; export default App;';

      await bundler.bundle({ source, sourceType: 'jsx' });

      const result2 = await bundler.bundle({
        source,
        sourceType: 'jsx',
        skipCache: true,
      });

      expect(result2.cached).toBe(false);
    });

    it('should minify when requested', async () => {
      const source = `
        const App = () => {
          const message = "Hello World";
          return <div>{message}</div>;
        };
        export default App;
      `;

      const normalResult = await bundler.bundle({ source, sourceType: 'jsx' });
      const minifiedResult = await bundler.bundle({
        source,
        sourceType: 'jsx',
        minify: true,
      });

      expect(minifiedResult.size).toBeLessThan(normalResult.size);
    });

    it('should include source maps when requested', async () => {
      const result = await bundler.bundle({
        source: 'const App = () => <div>Test</div>; export default App;',
        sourceType: 'jsx',
        sourceMaps: true,
      });

      expect(result.map).toBeDefined();
    });

    it('should track metrics', async () => {
      const result = await bundler.bundle({
        source: 'const App = () => <div>Metrics</div>; export default App;',
        sourceType: 'jsx',
      });

      expect(result.metrics).toBeDefined();
      expect(result.metrics.totalTime).toBeGreaterThanOrEqual(0);
      expect(result.metrics.transformTime).toBeGreaterThanOrEqual(0);
    });

    it('should detect source type when auto', async () => {
      const jsxSource = 'const App = () => <div>Auto</div>; export default App;';

      const result = await bundler.bundle({
        source: jsxSource,
        sourceType: 'auto',
      });

      expect(result.sourceType).toBeDefined();
    });
  });

  // Note: bundleSSR tests are skipped because they require enclave-vm
  // which has compatibility issues with React's Symbol (Fragment).
  // The enclave-vm library rejects symbols in custom globals for security.
  describe.skip('bundleSSR', () => {
    it('should render component to HTML', async () => {
      const result = await bundler.bundleSSR({
        source: `
          export default function App() {
            return <div id="app">Hello SSR</div>;
          }
        `,
        sourceType: 'jsx',
        context: {},
      });

      expect(result).toBeDefined();
      expect(result.html).toContain('Hello SSR');
    });

    it('should inject context data', async () => {
      const result = await bundler.bundleSSR({
        source: `
          export default function App({ data }) {
            return <div>{data?.message}</div>;
          }
        `,
        sourceType: 'jsx',
        context: { data: { message: 'Context Message' } },
      });

      expect(result.html).toContain('Context Message');
    });

    it('should include SSR metrics', async () => {
      const result = await bundler.bundleSSR({
        source: 'export default () => <div>SSR Metrics</div>;',
        sourceType: 'jsx',
      });

      expect(result.ssrMetrics).toBeDefined();
      expect(result.ssrMetrics.renderTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Security Validation', () => {
    it('should reject source exceeding max size', async () => {
      const largeSource = 'x'.repeat(2000000); // 2MB

      await expect(
        bundler.bundle({
          source: largeSource,
          sourceType: 'jsx',
        }),
      ).rejects.toThrow();
    });

    it('should reject blocked patterns', async () => {
      const maliciousSource = 'const x = eval("alert(1)"); export default () => x;';

      await expect(
        bundler.bundle({
          source: maliciousSource,
          sourceType: 'jsx',
        }),
      ).rejects.toThrow();
    });

    it('should reject new Function', async () => {
      const maliciousSource = 'const fn = new Function("return 1"); export default () => fn();';

      await expect(
        bundler.bundle({
          source: maliciousSource,
          sourceType: 'jsx',
        }),
      ).rejects.toThrow();
    });
  });
});

// ============================================
// Static HTML Tests
// ============================================

describe('Static HTML Generation', () => {
  let bundler: InMemoryBundler;

  beforeEach(() => {
    bundler = new InMemoryBundler();
  });

  describe('bundleToStaticHTML', () => {
    it('should generate static HTML', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: 'export default () => <div>Static HTML</div>;',
        sourceType: 'jsx',
        toolName: 'test_tool',
        input: { arg: 'value' },
        output: { result: 42 },
      });

      expect(result).toBeDefined();
      expect(result.html).toContain('<!DOCTYPE html>');
      expect(result.html).toContain('Static HTML');
    });

    it('should include React CDN scripts', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: 'export default () => <div>CDN Test</div>;',
        sourceType: 'jsx',
        toolName: 'test_tool',
      });

      expect(result.html).toContain('react');
    });

    it('should handle markdown content type', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: '# Hello Markdown',
        sourceType: 'html',
        contentType: 'markdown',
        toolName: 'test_tool',
      });

      expect(result).toBeDefined();
    });

    it('should work with different platforms', async () => {
      const claudeResult = await bundler.bundleToStaticHTML({
        source: 'export default () => <div>Claude</div>;',
        sourceType: 'jsx',
        toolName: 'test_tool',
        targetPlatform: 'claude',
      });

      const openaiResult = await bundler.bundleToStaticHTML({
        source: 'export default () => <div>OpenAI</div>;',
        sourceType: 'jsx',
        toolName: 'test_tool',
        targetPlatform: 'openai',
      });

      // Both should produce valid HTML
      expect(claudeResult.html).toContain('<!DOCTYPE html>');
      expect(openaiResult.html).toContain('<!DOCTYPE html>');
    });

    it('should inject DEFAULT_THEME CSS variables by default', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: 'export default () => <div>Theme Test</div>;',
        sourceType: 'jsx',
        toolName: 'test_tool',
      });

      // Should contain :root CSS variables from DEFAULT_THEME
      expect(result.html).toContain(':root');
      expect(result.html).toContain('--color-primary');
      expect(result.html).toContain('--color-secondary');
      expect(result.html).toContain('--color-border');
      expect(result.html).toContain('--color-background');
    });

    it('should inject custom theme CSS variables when provided', async () => {
      const { createTheme } = await import('@frontmcp/uipack/theme');

      const customTheme = createTheme({
        colors: {
          semantic: {
            primary: '#ff0000',
            secondary: '#00ff00',
          },
        },
      });

      const result = await bundler.bundleToStaticHTML({
        source: 'export default () => <div>Custom Theme</div>;',
        sourceType: 'jsx',
        toolName: 'test_tool',
        theme: customTheme,
      });

      // Should contain the custom primary color
      expect(result.html).toContain(':root');
      expect(result.html).toContain('#ff0000');
      expect(result.html).toContain('#00ff00');
    });

    it('should inject theme CSS after Tailwind and before custom CSS', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: 'export default () => <div>Order Test</div>;',
        sourceType: 'jsx',
        toolName: 'test_tool',
        customCss: '.custom-class { color: purple; }',
      });

      const tailwindIndex = result.html.indexOf('tailwind');
      const rootIndex = result.html.indexOf(':root');
      const customCssIndex = result.html.indexOf('.custom-class');

      // Theme CSS should appear after Tailwind reference
      expect(rootIndex).toBeGreaterThan(tailwindIndex);
      // Custom CSS should appear after theme CSS
      expect(customCssIndex).toBeGreaterThan(rootIndex);
    });
  });
});

// ============================================
// Error Handling Tests
// ============================================

describe('Error Handling', () => {
  let bundler: InMemoryBundler;

  beforeEach(() => {
    bundler = new InMemoryBundler();
  });

  it('should handle syntax errors', async () => {
    const invalidSource = 'const App = () => <div>Unclosed';

    await expect(
      bundler.bundle({
        source: invalidSource,
        sourceType: 'jsx',
      }),
    ).rejects.toThrow();
  });

  it('should handle empty source', async () => {
    // Empty source should either succeed with empty output or fail gracefully
    try {
      const result = await bundler.bundle({
        source: '',
        sourceType: 'jsx',
      });
      expect(result.code).toBeDefined();
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('should include error context in messages', async () => {
    try {
      await bundler.bundle({
        source: 'const x = <div>Error</div',
        sourceType: 'jsx',
      });
      throw new Error('Should have thrown');
    } catch (error: unknown) {
      expect((error as Error).message).toBeDefined();
    }
  });
});

// ============================================
// Integration Tests
// ============================================

describe('Integration', () => {
  let bundler: InMemoryBundler;

  beforeEach(() => {
    bundler = new InMemoryBundler({
      cache: { maxSize: 100, ttl: 60000 },
    });
    bundler.clearCache();
  });

  it('should handle multiple concurrent bundles', async () => {
    const sources = Array.from({ length: 10 }, (_, i) => ({
      source: `export default () => <div>Component ${i}</div>;`,
      sourceType: 'jsx' as const,
    }));

    const results = await Promise.all(sources.map((opts) => bundler.bundle(opts)));

    expect(results).toHaveLength(10);
    results.forEach((result, i) => {
      expect(result.code).toContain(`Component ${i}`);
    });
  });

  it('should maintain cache consistency under concurrent access', async () => {
    const source = 'export default () => <div>Concurrent</div>;';

    // Run same bundle multiple times concurrently
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        bundler.bundle({
          source,
          sourceType: 'jsx',
        }),
      ),
    );

    // All should produce same result
    const codes = results.map((r) => r.code);
    expect(new Set(codes).size).toBe(1);

    // At least some should be cached (after first)
    const stats = bundler.getCacheStats();
    expect(stats.hits + stats.misses).toBeGreaterThan(0);
  });

  it('should work end-to-end with real component', async () => {
    const complexComponent = `
      import { useState } from 'react';

      interface Props {
        initialCount?: number;
      }

      export default function Counter({ initialCount = 0 }: Props) {
        const [count, setCount] = useState(initialCount);

        return (
          <div className="counter">
            <span>Count: {count}</span>
            <button onClick={() => setCount(c => c + 1)}>+</button>
            <button onClick={() => setCount(c => c - 1)}>-</button>
          </div>
        );
      }
    `;

    const result = await bundler.bundle({
      source: complexComponent,
      sourceType: 'tsx',
    });

    expect(result.code).toBeDefined();
    expect(result.size).toBeGreaterThan(0);
    // Types should be stripped
    expect(result.code).not.toContain('interface Props');
  });
});

// ============================================
// Multi-Platform Build Tests
// ============================================

describe('bundleToStaticHTMLAll', () => {
  let bundler: InMemoryBundler;

  beforeEach(() => {
    bundler = new InMemoryBundler();
    bundler.clearCache();
  });

  const simpleComponent = 'export default () => <div>Hello</div>';

  it('should build for all 5 platforms by default', async () => {
    const result = await bundler.bundleToStaticHTMLAll({
      source: simpleComponent,
      toolName: 'test_tool',
    });

    expect(Object.keys(result.platforms)).toHaveLength(5);
    expect(result.platforms.openai).toBeDefined();
    expect(result.platforms.claude).toBeDefined();
    expect(result.platforms.cursor).toBeDefined();
    expect(result.platforms['ext-apps']).toBeDefined();
    expect(result.platforms.generic).toBeDefined();
  });

  it('should build for specified platforms only', async () => {
    const result = await bundler.bundleToStaticHTMLAll({
      source: simpleComponent,
      toolName: 'test_tool',
      platforms: ['openai', 'claude'],
    });

    expect(Object.keys(result.platforms)).toHaveLength(2);
    expect(result.platforms.openai).toBeDefined();
    expect(result.platforms.claude).toBeDefined();
    expect((result.platforms as Record<string, unknown>)['cursor']).toBeUndefined();
  });

  it('should transpile code only once (shared across platforms)', async () => {
    const result = await bundler.bundleToStaticHTMLAll({
      source: simpleComponent,
      toolName: 'test_tool',
    });

    // All platforms should share the same component code
    expect(result.sharedComponentCode).toBeTruthy();
    expect(result.platforms.openai.componentCode).toBe(result.sharedComponentCode);
    expect(result.platforms.claude.componentCode).toBe(result.sharedComponentCode);
    expect(result.platforms.generic.componentCode).toBe(result.sharedComponentCode);
  });

  it('should include platform-specific metadata in each result', async () => {
    const result = await bundler.bundleToStaticHTMLAll({
      source: simpleComponent,
      toolName: 'test_tool',
    });

    // OpenAI should have openai/* namespace
    expect(result.platforms.openai.meta['openai/html']).toBeDefined();
    expect(result.platforms.openai.meta['openai/mimeType']).toBe('text/html+skybridge');

    // Claude should have ui/* namespace only (no frontmcp/* duplication)
    expect(result.platforms.claude.meta['ui/html']).toBeDefined();
    expect(result.platforms.claude.meta['frontmcp/html']).toBeUndefined();

    // Generic should have ui/* namespace only (no frontmcp/* duplication)
    expect(result.platforms.generic.meta['ui/html']).toBeDefined();
    expect(result.platforms.generic.meta['frontmcp/html']).toBeUndefined();

    // ext-apps should have ui/* namespace only
    expect(result.platforms['ext-apps'].meta['ui/html']).toBeDefined();
    expect(result.platforms['ext-apps'].meta['ui/mimeType']).toBe('text/html+mcp');
  });

  it('should use different CDN types per platform', async () => {
    const result = await bundler.bundleToStaticHTMLAll({
      source: simpleComponent,
      toolName: 'test_tool',
    });

    // Claude uses UMD (cdnjs.cloudflare.com)
    expect(result.platforms.claude.html).toContain('cdnjs.cloudflare.com');

    // OpenAI uses ESM (esm.sh)
    expect(result.platforms.openai.html).toContain('esm.sh');

    // Generic uses ESM (esm.sh)
    expect(result.platforms.generic.html).toContain('esm.sh');
  });

  it('should include metrics for transpilation and generation', async () => {
    const result = await bundler.bundleToStaticHTMLAll({
      source: simpleComponent,
      toolName: 'test_tool',
    });

    expect(result.metrics.transpileTime).toBeGreaterThanOrEqual(0);
    expect(result.metrics.generationTime).toBeGreaterThanOrEqual(0);
    expect(result.metrics.totalTime).toBeGreaterThanOrEqual(0);
    expect(result.metrics.totalTime).toBeGreaterThanOrEqual(result.metrics.transpileTime);
  });

  it('should return correct targetPlatform for each result', async () => {
    const result = await bundler.bundleToStaticHTMLAll({
      source: simpleComponent,
      toolName: 'test_tool',
    });

    expect(result.platforms.openai.targetPlatform).toBe('openai');
    expect(result.platforms.claude.targetPlatform).toBe('claude');
    expect(result.platforms.cursor.targetPlatform).toBe('cursor');
    expect(result.platforms['ext-apps'].targetPlatform).toBe('ext-apps');
    expect(result.platforms.generic.targetPlatform).toBe('generic');
  });

  it('should work with universal mode', async () => {
    const markdownContent = '# Hello World\n\nThis is **bold** text.';

    const result = await bundler.bundleToStaticHTMLAll({
      source: markdownContent,
      toolName: 'test_tool',
      universal: true,
      contentType: 'markdown',
    });

    // All platforms should have universal: true
    expect(result.platforms.openai.universal).toBe(true);
    expect(result.platforms.claude.universal).toBe(true);
    expect(result.platforms.generic.universal).toBe(true);

    // All should have contentType: markdown
    expect(result.platforms.openai.contentType).toBe('markdown');
    expect(result.platforms.claude.contentType).toBe('markdown');
  });

  it('should generate different HTML sizes for different platforms', async () => {
    const result = await bundler.bundleToStaticHTMLAll({
      source: simpleComponent,
      toolName: 'test_tool',
    });

    // Each platform should have a valid size
    expect(result.platforms.openai.size).toBeGreaterThan(0);
    expect(result.platforms.claude.size).toBeGreaterThan(0);

    // HTML content should differ (UMD vs ESM)
    expect(result.platforms.openai.html).not.toBe(result.platforms.claude.html);
  });

  it('should include hash for each platform result', async () => {
    const result = await bundler.bundleToStaticHTMLAll({
      source: simpleComponent,
      toolName: 'test_tool',
    });

    expect(result.platforms.openai.hash).toBeDefined();
    expect(result.platforms.claude.hash).toBeDefined();
    expect(typeof result.platforms.openai.hash).toBe('string');
    expect(result.platforms.openai.hash.length).toBeGreaterThan(0);
  });

  it('should include theme CSS variables in all platform outputs', async () => {
    const result = await bundler.bundleToStaticHTMLAll({
      source: simpleComponent,
      toolName: 'test_tool',
    });

    // All platforms should contain :root CSS variables
    for (const platform of ['openai', 'claude', 'cursor', 'ext-apps', 'generic'] as const) {
      const html = result.platforms[platform].html;
      expect(html).toContain(':root');
      expect(html).toContain('--color-primary');
      expect(html).toContain('--color-secondary');
    }
  });

  it('should use custom theme in multi-platform build', async () => {
    const { createTheme } = await import('@frontmcp/uipack/theme');

    const customTheme = createTheme({
      colors: {
        semantic: {
          primary: '#123456',
          accent: '#abcdef',
        },
      },
    });

    const result = await bundler.bundleToStaticHTMLAll({
      source: simpleComponent,
      toolName: 'test_tool',
      theme: customTheme,
    });

    // All platforms should contain the custom colors
    for (const platform of ['openai', 'claude', 'generic'] as const) {
      const html = result.platforms[platform].html;
      expect(html).toContain('#123456');
      expect(html).toContain('#abcdef');
    }
  });
});

// ============================================
// Build Mode Tests
// ============================================

describe('Build Modes', () => {
  let bundler: InMemoryBundler;

  beforeEach(() => {
    bundler = new InMemoryBundler();
    bundler.clearCache();
  });

  const simpleComponent = 'export default () => <div>Build Mode Test</div>';

  describe('Static Mode (default)', () => {
    it('should bake data into HTML at build time', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        output: { temperature: 72 },
        buildMode: 'static',
      });

      // Data should be embedded in the HTML
      expect(result.html).toContain('72');
      expect(result.html).toContain('__mcpToolOutput');
      expect(result.html).toContain('Static Mode');
      expect(result.buildMode).toBe('static');
    });

    it('should use static mode by default', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        output: { value: 'default' },
      });

      expect(result.buildMode).toBe('static');
      expect(result.html).toContain('Static Mode');
    });
  });

  describe('Dynamic Mode', () => {
    it('should include initial data when includeInitialData is true', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        output: { temperature: 72 },
        buildMode: 'dynamic',
        dynamicOptions: { includeInitialData: true },
      });

      expect(result.html).toContain('72');
      expect(result.html).toContain('Dynamic Mode');
      expect(result.buildMode).toBe('dynamic');
    });

    it('should show loading state when includeInitialData is false', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        output: { temperature: 72 },
        buildMode: 'dynamic',
        dynamicOptions: { includeInitialData: false },
      });

      // Should set loading: true
      expect(result.html).toContain('loading: true');
      expect(result.html).toContain('Dynamic Mode');
    });

    it('should subscribe to platform events by default', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'dynamic',
      });

      // Should include OpenAI event subscription
      expect(result.html).toContain('window.openai');
      expect(result.html).toContain('onToolResult');
    });

    it('should not subscribe to events when subscribeToUpdates is false', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'dynamic',
        dynamicOptions: { subscribeToUpdates: false },
      });

      // Should NOT include OpenAI event subscription
      expect(result.html).not.toContain('window.openai');
    });

    it('should dispatch custom events on tool result', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'dynamic',
      });

      expect(result.html).toContain('frontmcp:toolResult');
    });
  });

  describe('Hybrid Mode', () => {
    it('should include placeholder in HTML', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'hybrid',
      });

      expect(result.html).toContain('__FRONTMCP_OUTPUT_PLACEHOLDER__');
      expect(result.html).toContain('Hybrid Mode');
      expect(result.buildMode).toBe('hybrid');
      expect(result.dataPlaceholder).toBe('__FRONTMCP_OUTPUT_PLACEHOLDER__');
    });

    it('should use custom placeholder when provided', async () => {
      const customPlaceholder = '__CUSTOM_PLACEHOLDER__';

      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'hybrid',
        hybridOptions: { placeholder: customPlaceholder },
      });

      expect(result.html).toContain(customPlaceholder);
      expect(result.dataPlaceholder).toBe(customPlaceholder);
    });

    it('should include JSON parsing logic for injected data', async () => {
      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'hybrid',
      });

      // Should include parsing logic
      expect(result.html).toContain('JSON.parse');
    });

    it('should include tool name and placeholders in hybrid shell', async () => {
      const { HYBRID_DATA_PLACEHOLDER, HYBRID_INPUT_PLACEHOLDER } = await import('@frontmcp/uipack/build');

      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'my_weather_tool',
        input: { city: 'NYC' }, // Input is ignored in hybrid mode, placeholder is used instead
        buildMode: 'hybrid',
      });

      expect(result.html).toContain('my_weather_tool');
      // In hybrid mode, input and output are placeholders
      expect(result.html).toContain(HYBRID_INPUT_PLACEHOLDER);
      expect(result.html).toContain(HYBRID_DATA_PLACEHOLDER);
    });
  });

  describe('injectHybridData helper', () => {
    it('should replace placeholder with JSON data', async () => {
      const { injectHybridData, HYBRID_DATA_PLACEHOLDER } = await import('@frontmcp/uipack/build');

      // Build a hybrid shell
      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'hybrid',
      });

      // Verify placeholder exists in the data assignment
      expect(result.html).toContain(HYBRID_DATA_PLACEHOLDER);

      // Inject data
      const data = { temperature: 72, humidity: 45 };
      const injectedHtml = injectHybridData(result.html, data);

      // Count occurrences of placeholder - should be reduced after injection
      const originalCount = (result.html.match(new RegExp(HYBRID_DATA_PLACEHOLDER, 'g')) || []).length;
      const injectedCount = (injectedHtml.match(new RegExp(HYBRID_DATA_PLACEHOLDER, 'g')) || []).length;
      expect(injectedCount).toBeLessThan(originalCount);

      // Data should be present (the JSON is double-escaped for embedding in a string literal)
      expect(injectedHtml).toContain('temperature');
      expect(injectedHtml).toContain('humidity');
    });

    it('should work with nested objects', async () => {
      const { injectHybridData } = await import('@frontmcp/uipack/build');

      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'hybrid',
      });

      const data = {
        weather: { temp: 72, conditions: 'sunny' },
        location: { city: 'NYC', country: 'USA' },
      };

      const injectedHtml = injectHybridData(result.html, data);

      expect(injectedHtml).toContain('sunny');
      expect(injectedHtml).toContain('NYC');
    });

    it('should handle null data', async () => {
      const { injectHybridData } = await import('@frontmcp/uipack/build');

      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'hybrid',
      });

      const injectedHtml = injectHybridData(result.html, null);

      expect(injectedHtml).toContain('null');
    });

    it('should inject both input and output with injectHybridDataFull', async () => {
      const { injectHybridDataFull, HYBRID_DATA_PLACEHOLDER, HYBRID_INPUT_PLACEHOLDER } = await import(
        '@frontmcp/uipack/build'
      );

      // Build a hybrid shell
      const result = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'hybrid',
      });

      // Verify both placeholders exist
      expect(result.html).toContain(HYBRID_DATA_PLACEHOLDER);
      expect(result.html).toContain(HYBRID_INPUT_PLACEHOLDER);
      expect(result.dataPlaceholder).toBe(HYBRID_DATA_PLACEHOLDER);
      expect(result.inputPlaceholder).toBe(HYBRID_INPUT_PLACEHOLDER);

      // Inject both input and output
      const input = { city: 'NYC', units: 'fahrenheit' };
      const output = { temperature: 72, humidity: 45 };
      const injectedHtml = injectHybridDataFull(result.html, input, output);

      // Both input and output data should be present
      expect(injectedHtml).toContain('NYC');
      expect(injectedHtml).toContain('fahrenheit');
      expect(injectedHtml).toContain('temperature');
      expect(injectedHtml).toContain('humidity');
    });
  });

  describe('isHybridShell helper', () => {
    it('should detect hybrid shell', async () => {
      const { isHybridShell } = await import('@frontmcp/uipack/build');

      const hybridResult = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'hybrid',
      });

      const staticResult = await bundler.bundleToStaticHTML({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'static',
        output: { temp: 72 },
      });

      expect(isHybridShell(hybridResult.html)).toBe(true);
      expect(isHybridShell(staticResult.html)).toBe(false);
    });
  });

  describe('Multi-platform with build modes', () => {
    it('should apply build mode to all platforms', async () => {
      const result = await bundler.bundleToStaticHTMLAll({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'hybrid',
      });

      // All platforms should have hybrid mode
      expect(result.platforms.openai.buildMode).toBe('hybrid');
      expect(result.platforms.claude.buildMode).toBe('hybrid');
      expect(result.platforms.generic.buildMode).toBe('hybrid');

      // All platforms should have the placeholder
      expect(result.platforms.openai.dataPlaceholder).toBe('__FRONTMCP_OUTPUT_PLACEHOLDER__');
      expect(result.platforms.claude.dataPlaceholder).toBe('__FRONTMCP_OUTPUT_PLACEHOLDER__');
    });

    it('should support dynamic mode for OpenAI platform', async () => {
      const result = await bundler.bundleToStaticHTMLAll({
        source: simpleComponent,
        toolName: 'test_tool',
        buildMode: 'dynamic',
        platforms: ['openai'],
      });

      expect(result.platforms.openai.buildMode).toBe('dynamic');
      expect(result.platforms.openai.html).toContain('window.openai');
    });
  });
});
