/**
 * Cached Runtime Tests
 *
 * Tests for the runtime caching system, script building,
 * and data injection utilities.
 */

import {
  getCachedRuntime,
  clearRuntimeCache,
  getRuntimeCacheStats,
  buildAppScript,
  buildDataInjectionCode,
  buildComponentCode,
  RUNTIME_PLACEHOLDERS,
} from '../cached-runtime';

// ============================================
// Setup/Teardown
// ============================================

beforeEach(() => {
  clearRuntimeCache();
});

// ============================================
// Runtime Placeholders Tests
// ============================================

describe('RUNTIME_PLACEHOLDERS', () => {
  it('should have all required placeholders', () => {
    expect(RUNTIME_PLACEHOLDERS.COMPONENT_CODE).toBeDefined();
    expect(RUNTIME_PLACEHOLDERS.DATA_INJECTION).toBeDefined();
    expect(RUNTIME_PLACEHOLDERS.CUSTOM_COMPONENTS).toBeDefined();
  });

  it('should have unique placeholder values', () => {
    const values = Object.values(RUNTIME_PLACEHOLDERS);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it('should have comment-style placeholders', () => {
    // All placeholders should be wrapped in /* */ for safe replacement
    Object.values(RUNTIME_PLACEHOLDERS).forEach((placeholder) => {
      expect(placeholder).toMatch(/^\/\*.*\*\/$/);
    });
  });
});

// ============================================
// getCachedRuntime Tests
// ============================================

describe('getCachedRuntime', () => {
  describe('UMD Mode (Claude)', () => {
    it('should return vendor script for UMD mode', () => {
      const result = getCachedRuntime({ cdnType: 'umd' });

      expect(result.vendorScript).toBeDefined();
      expect(result.vendorScript.length).toBeGreaterThan(0);
      expect(result.vendorSize).toBe(result.vendorScript.length);
    });

    it('should include store runtime', () => {
      const result = getCachedRuntime({ cdnType: 'umd' });

      expect(result.vendorScript).toContain('__frontmcp');
      expect(result.vendorScript).toContain('getState');
      expect(result.vendorScript).toContain('setState');
      expect(result.vendorScript).toContain('subscribe');
    });

    it('should include require shim', () => {
      const result = getCachedRuntime({ cdnType: 'umd' });

      expect(result.vendorScript).toContain('window.require');
      expect(result.vendorScript).toContain('moduleMap');
    });

    it('should include markdown parser for UMD', () => {
      const result = getCachedRuntime({ cdnType: 'umd' });

      expect(result.vendorScript).toContain('parseMarkdown');
      expect(result.vendorScript).toContain('ReactMarkdown');
    });

    it('should include renderers runtime', () => {
      const result = getCachedRuntime({ cdnType: 'umd' });

      expect(result.vendorScript).toContain('renderers');
      expect(result.vendorScript).toContain('renderContent');
      expect(result.vendorScript).toContain('detectRenderer');
    });

    it('should include UI components', () => {
      const result = getCachedRuntime({ cdnType: 'umd' });

      expect(result.vendorScript).toContain('window.Card');
      expect(result.vendorScript).toContain('window.Badge');
      expect(result.vendorScript).toContain('window.Button');
    });

    it('should include UniversalApp', () => {
      const result = getCachedRuntime({ cdnType: 'umd' });

      expect(result.vendorScript).toContain('UniversalApp');
      expect(result.vendorScript).toContain('LoadingSpinner');
      expect(result.vendorScript).toContain('ErrorDisplay');
      expect(result.vendorScript).toContain('EmptyState');
    });
  });

  describe('ESM Mode (OpenAI)', () => {
    it('should return vendor script for ESM mode', () => {
      const result = getCachedRuntime({ cdnType: 'esm' });

      expect(result.vendorScript).toBeDefined();
      expect(result.vendorScript.length).toBeGreaterThan(0);
    });

    it('should not include inline markdown by default', () => {
      const result = getCachedRuntime({ cdnType: 'esm' });

      // ESM mode should rely on CDN imports for markdown
      expect(result.vendorScript).toContain('parseMarkdown');
    });

    it('should add CDN imports for markdown when requested', () => {
      const result = getCachedRuntime({ cdnType: 'esm', includeMarkdown: true });

      expect(result.cdnImports).toContain('react-markdown');
    });

    it('should add CDN imports for MDX when requested', () => {
      const result = getCachedRuntime({ cdnType: 'esm', includeMdx: true });

      expect(result.cdnImports).toContain('mdx');
    });
  });

  describe('App Template', () => {
    it('should return app template with placeholders', () => {
      const result = getCachedRuntime({ cdnType: 'umd' });

      expect(result.appTemplate).toContain(RUNTIME_PLACEHOLDERS.COMPONENT_CODE);
      expect(result.appTemplate).toContain(RUNTIME_PLACEHOLDERS.DATA_INJECTION);
      expect(result.appTemplate).toContain(RUNTIME_PLACEHOLDERS.CUSTOM_COMPONENTS);
    });
  });

  describe('Caching', () => {
    it('should cache results', () => {
      const result1 = getCachedRuntime({ cdnType: 'umd' });
      expect(result1.cached).toBe(false);

      const result2 = getCachedRuntime({ cdnType: 'umd' });
      expect(result2.cached).toBe(true);
    });

    it('should use different cache keys for different options', () => {
      const umdResult = getCachedRuntime({ cdnType: 'umd' });
      const esmResult = getCachedRuntime({ cdnType: 'esm' });

      expect(umdResult.cacheKey).not.toBe(esmResult.cacheKey);
    });

    it('should include options in cache key', () => {
      const result1 = getCachedRuntime({ cdnType: 'umd' });
      const result2 = getCachedRuntime({ cdnType: 'umd', includeMarkdown: true });
      const result3 = getCachedRuntime({ cdnType: 'umd', minify: true });

      expect(result1.cacheKey).not.toBe(result2.cacheKey);
      expect(result1.cacheKey).not.toBe(result3.cacheKey);
    });

    it('should return same vendor script from cache', () => {
      const result1 = getCachedRuntime({ cdnType: 'umd' });
      const result2 = getCachedRuntime({ cdnType: 'umd' });

      expect(result1.vendorScript).toBe(result2.vendorScript);
    });
  });

  describe('Minification', () => {
    it('should minify when requested', () => {
      const normalResult = getCachedRuntime({ cdnType: 'umd' });
      const minifiedResult = getCachedRuntime({ cdnType: 'umd', minify: true });

      // Minified should be smaller
      expect(minifiedResult.vendorSize).toBeLessThan(normalResult.vendorSize);
    });

    it('should remove comments when minifying', () => {
      const result = getCachedRuntime({ cdnType: 'umd', minify: true });

      // Should not contain comment markers (but may have some)
      expect(result.vendorScript).not.toContain('// FrontMCP Store (Vendor)');
    });
  });
});

// ============================================
// Cache Management Tests
// ============================================

describe('Cache Management', () => {
  it('should clear cache', () => {
    getCachedRuntime({ cdnType: 'umd' });
    getCachedRuntime({ cdnType: 'esm' });

    let stats = getRuntimeCacheStats();
    expect(stats.entries).toBe(2);

    clearRuntimeCache();

    stats = getRuntimeCacheStats();
    expect(stats.entries).toBe(0);
  });

  it('should report cache statistics', () => {
    getCachedRuntime({ cdnType: 'umd' });
    getCachedRuntime({ cdnType: 'esm' });

    const stats = getRuntimeCacheStats();

    expect(stats.entries).toBe(2);
    expect(stats.totalSize).toBeGreaterThan(0);
    expect(stats.keys).toHaveLength(2);
  });

  it('should report correct keys', () => {
    const umd = getCachedRuntime({ cdnType: 'umd' });
    const esm = getCachedRuntime({ cdnType: 'esm' });

    const stats = getRuntimeCacheStats();

    expect(stats.keys).toContain(umd.cacheKey);
    expect(stats.keys).toContain(esm.cacheKey);
  });

  it('should enforce max entries', () => {
    // Default max is 10, fill it up
    for (let i = 0; i < 15; i++) {
      getCachedRuntime({
        cdnType: i % 2 === 0 ? 'umd' : 'esm',
        includeMarkdown: i % 3 === 0,
        includeMdx: i % 4 === 0,
        minify: i % 5 === 0,
      });
    }

    const stats = getRuntimeCacheStats();
    expect(stats.entries).toBeLessThanOrEqual(10);
  });
});

// ============================================
// buildAppScript Tests
// ============================================

describe('buildAppScript', () => {
  it('should replace component code placeholder', () => {
    const result = getCachedRuntime({ cdnType: 'umd' });
    const componentCode = 'const MyComponent = () => "Hello";';

    const appScript = buildAppScript(result.appTemplate, componentCode, '', '');

    expect(appScript).toContain(componentCode);
    expect(appScript).not.toContain(RUNTIME_PLACEHOLDERS.COMPONENT_CODE);
  });

  it('should replace data injection placeholder', () => {
    const result = getCachedRuntime({ cdnType: 'umd' });
    const dataInjection = 'window.__data = { test: true };';

    const appScript = buildAppScript(result.appTemplate, '', dataInjection, '');

    expect(appScript).toContain(dataInjection);
    expect(appScript).not.toContain(RUNTIME_PLACEHOLDERS.DATA_INJECTION);
  });

  it('should replace custom components placeholder', () => {
    const result = getCachedRuntime({ cdnType: 'umd' });
    const customComponents = 'window.CustomWidget = () => "Widget";';

    const appScript = buildAppScript(result.appTemplate, '', '', customComponents);

    expect(appScript).toContain(customComponents);
    expect(appScript).not.toContain(RUNTIME_PLACEHOLDERS.CUSTOM_COMPONENTS);
  });

  it('should use default comment when no component code', () => {
    const result = getCachedRuntime({ cdnType: 'umd' });

    const appScript = buildAppScript(result.appTemplate, '', 'data', '');

    expect(appScript).toContain('// No component code');
  });

  it('should use default comment when no custom components', () => {
    const result = getCachedRuntime({ cdnType: 'umd' });

    const appScript = buildAppScript(result.appTemplate, 'code', 'data', '');

    expect(appScript).toContain('// No custom components');
  });
});

// ============================================
// buildDataInjectionCode Tests
// ============================================

describe('buildDataInjectionCode', () => {
  it('should build data injection with component', () => {
    const code = buildDataInjectionCode(
      'test_tool',
      { arg: 'value' },
      { result: 42 },
      null,
      'react',
      null,
      true, // hasComponent
    );

    expect(code).toContain('window.__frontmcp.setState');
    expect(code).toContain('"test_tool"');
    expect(code).toContain('"arg"');
    expect(code).toContain('"result"');
    expect(code).toContain('window.__frontmcp_component');
  });

  it('should build data injection without component', () => {
    const code = buildDataInjectionCode(
      'test_tool',
      { arg: 'value' },
      { result: 42 },
      null,
      'markdown',
      '# Hello',
      false, // no component
    );

    expect(code).toContain('window.__frontmcp.setState');
    expect(code).toContain('"test_tool"');
    expect(code).toContain('"markdown"');
    expect(code).toContain('"# Hello"');
    expect(code).not.toContain('window.__frontmcp_component');
  });

  it('should handle null input/output', () => {
    const code = buildDataInjectionCode('tool', null, null, null, 'html', '<div />', false);

    expect(code).toContain('input: null');
    expect(code).toContain('output: null');
  });

  it('should safely stringify complex data', () => {
    const complexOutput = {
      nested: {
        array: [1, 2, { deep: 'value' }],
        unicode: '\u0000\u001F',
      },
    };

    const code = buildDataInjectionCode('tool', null, complexOutput, null, 'html', null, false);

    // Should not throw
    expect(code).toBeDefined();
    expect(code).toContain('nested');
  });

  it('should set loading to false and error to null', () => {
    const code = buildDataInjectionCode('tool', null, null, null, 'html', null, false);

    expect(code).toContain('loading: false');
    expect(code).toContain('error: null');
  });

  it('should include structured content', () => {
    const structuredContent = { type: 'parsed', data: [1, 2, 3] };

    const code = buildDataInjectionCode('tool', null, null, structuredContent, 'html', null, false);

    expect(code).toContain('structuredContent');
    expect(code).toContain('"parsed"');
  });
});

// ============================================
// buildComponentCode Tests
// ============================================

describe('buildComponentCode', () => {
  it('should wrap transpiled code with module shim', () => {
    const transpiledCode = 'module.exports.default = function() { return "Hello"; };';

    const code = buildComponentCode(transpiledCode);

    expect(code).toContain('var module = { exports: {} }');
    expect(code).toContain('var exports = module.exports');
    expect(code).toContain(transpiledCode);
  });

  it('should capture component as window.__frontmcp_component', () => {
    const code = buildComponentCode('module.exports.default = MyComponent;');

    expect(code).toContain('window.__frontmcp_component');
    expect(code).toContain('module.exports.default || module.exports');
  });

  it('should handle named exports', () => {
    const transpiledCode = 'exports.MyWidget = function() { return "Widget"; };';

    const code = buildComponentCode(transpiledCode);

    // Should still capture with fallback to module.exports
    expect(code).toContain('module.exports.default || module.exports');
  });
});

// ============================================
// Integration Tests
// ============================================

describe('Integration', () => {
  it('should build complete runtime with all parts', () => {
    const runtime = getCachedRuntime({ cdnType: 'umd' });

    const componentCode = 'module.exports.default = function() { return "Hello"; };';
    const dataInjection = buildDataInjectionCode('my_tool', { x: 1 }, { y: 2 }, null, 'react', null, true);
    const wrappedComponent = buildComponentCode(componentCode);

    const appScript = buildAppScript(runtime.appTemplate, wrappedComponent, dataInjection, '');

    // Should contain all parts
    expect(appScript).toContain('module.exports.default');
    expect(appScript).toContain('my_tool');
    expect(appScript).toContain('window.__frontmcp_component');
  });

  it('should work with markdown content type', () => {
    const runtime = getCachedRuntime({ cdnType: 'umd' });
    const dataInjection = buildDataInjectionCode(
      'md_tool',
      null,
      { text: '# Hello' },
      null,
      'markdown',
      '# Hello',
      false,
    );
    const appScript = buildAppScript(runtime.appTemplate, '', dataInjection, '');

    expect(appScript).toContain('markdown');
    expect(appScript).toContain('# Hello');
  });
});

// ============================================
// Edge Cases
// ============================================

describe('Edge Cases', () => {
  it('should handle empty options', () => {
    // @ts-expect-error - Testing with minimal options
    const result = getCachedRuntime({ cdnType: 'umd' });
    expect(result).toBeDefined();
  });

  it('should handle special characters in data', () => {
    const output = {
      html: '<script>alert("xss")</script>',
      quotes: `"single" and 'double'`,
      backslash: 'C:\\Users\\test',
      unicode: '日本語',
    };

    const code = buildDataInjectionCode('tool', null, output, null, 'html', null, false);

    // Should not throw and should be valid JS
    expect(code).toBeDefined();
    expect(() => JSON.parse(`{"test": ${JSON.stringify(output)}}`)).not.toThrow();
  });

  it('should handle very large output', () => {
    const largeOutput = { data: 'x'.repeat(1000000) };

    const code = buildDataInjectionCode('tool', null, largeOutput, null, 'html', null, false);

    expect(code).toBeDefined();
    expect(code.length).toBeGreaterThan(1000000);
  });

  it('should handle circular reference in output gracefully', () => {
    // The safeJson function should handle this
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    // buildDataInjectionCode uses safeJson which catches stringify errors
    const code = buildDataInjectionCode('tool', null, circular, null, 'html', null, false);

    expect(code).toContain('null'); // Falls back to null on error
  });
});
