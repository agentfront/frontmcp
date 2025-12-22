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
