/**
 * Renderer Registry Tests
 */

import { RendererRegistry, rendererRegistry } from './registry';
import { HtmlRenderer, htmlRenderer } from './html.renderer';
import type { UIRenderer, TranspileResult, RuntimeScripts } from './types';
import type { TemplateContext } from '../runtime/types';
import type { PlatformCapabilities } from '../theme';

describe('RendererRegistry', () => {
  let registry: RendererRegistry;

  beforeEach(() => {
    registry = new RendererRegistry();
  });

  describe('constructor', () => {
    it('should create empty registry', () => {
      const empty = new RendererRegistry();
      expect(empty).toBeInstanceOf(RendererRegistry);
    });

    it('should register HTML renderer by default', () => {
      // The registry includes HTML renderer by default
      const result = registry.detect('<div>hello</div>');
      expect(result.renderer.type).toBe('html');
    });
  });

  describe('register', () => {
    it('should register a new renderer', () => {
      const mockRenderer: UIRenderer = {
        type: 'html',
        priority: 50,
        canHandle: () => true,
        transpile: async () => ({ code: '', hash: '', cached: false }),
        render: async () => '<div>mock</div>',
        getRuntimeScripts: () => ({ headScripts: '', isInline: false }),
      };

      registry.register(mockRenderer);

      // The mock should now have higher priority
      const result = registry.detect('anything');
      expect(result.renderer.priority).toBe(50);
    });

    it('should allow multiple renderers', () => {
      const renderer1: UIRenderer = {
        type: 'html',
        priority: 10,
        canHandle: (t) => t === 'type1',
        transpile: async () => ({ code: '', hash: '', cached: false }),
        render: async () => 'type1',
        getRuntimeScripts: () => ({ headScripts: '', isInline: false }),
      };

      const renderer2: UIRenderer = {
        type: 'react',
        priority: 20,
        canHandle: (t) => t === 'type2',
        transpile: async () => ({ code: '', hash: '', cached: false }),
        render: async () => 'type2',
        getRuntimeScripts: () => ({ headScripts: '', isInline: false }),
      };

      registry.register(renderer1);
      registry.register(renderer2);

      expect(registry.detect('type1').renderer.type).toBe('html');
      expect(registry.detect('type2').renderer.type).toBe('react');
    });
  });

  describe('get', () => {
    it('should return renderer by type', () => {
      const renderer = registry.get('html');
      expect(renderer).toBeDefined();
      expect(renderer?.type).toBe('html');
    });

    it('should return undefined for non-existent type', () => {
      const renderer = registry.get('nonexistent' as any);
      expect(renderer).toBeUndefined();
    });
  });

  describe('unregister', () => {
    it('should unregister a renderer', () => {
      const customRegistry = new RendererRegistry();
      expect(customRegistry.has('html')).toBe(true);
      const removed = customRegistry.unregister('html');
      expect(removed).toBe(true);
      expect(customRegistry.has('html')).toBe(false);
    });

    it('should return false for non-existent renderer', () => {
      const customRegistry = new RendererRegistry();
      const removed = customRegistry.unregister('nonexistent' as any);
      expect(removed).toBe(false);
    });
  });

  describe('has', () => {
    it('should return true for registered renderer', () => {
      expect(registry.has('html')).toBe(true);
    });

    it('should return false for unregistered renderer', () => {
      expect(registry.has('nonexistent' as any)).toBe(false);
    });
  });

  describe('getTypes', () => {
    it('should return all registered types', () => {
      const types = registry.getTypes();
      expect(types).toContain('html');
    });
  });

  describe('setDefault', () => {
    it('should set default renderer', () => {
      const customRegistry = new RendererRegistry();
      // HTML is already registered
      customRegistry.setDefault('html');
      const stats = customRegistry.getStats();
      expect(stats.defaultRenderer).toBe('html');
    });

    it('should throw for unregistered default', () => {
      const customRegistry = new RendererRegistry();
      expect(() => customRegistry.setDefault('nonexistent' as any)).toThrow();
    });
  });

  describe('getStats', () => {
    it('should return registry statistics', () => {
      const stats = registry.getStats();
      expect(stats.registeredRenderers).toContain('html');
      expect(stats.defaultRenderer).toBe('html');
      expect(Array.isArray(stats.priorityOrder)).toBe(true);
    });
  });

  describe('detect', () => {
    it('should detect HTML strings', () => {
      const result = registry.detect('<div>hello</div>');
      expect(result.renderer.type).toBe('html');
      // HTML renderer has priority 0, so confidence is 0/100 = 0
      expect(result.confidence).toBe(0);
    });

    it('should detect template builder functions', () => {
      const template = (ctx: any) => `<div>${ctx.output.name}</div>`;
      const result = registry.detect(template);
      expect(result.renderer.type).toBe('html');
    });

    it('should return detection reason', () => {
      const result = registry.detect('<div>hello</div>');
      expect(result.reason).toBeTruthy();
      expect(typeof result.reason).toBe('string');
    });

    it('should prioritize higher priority renderers', () => {
      const lowPriority: UIRenderer = {
        type: 'html',
        priority: 0,
        canHandle: () => true,
        transpile: async () => ({ code: '', hash: '', cached: false }),
        render: async () => 'low',
        getRuntimeScripts: () => ({ headScripts: '', isInline: false }),
      };

      const highPriority: UIRenderer = {
        type: 'react',
        priority: 100,
        canHandle: () => true,
        transpile: async () => ({ code: '', hash: '', cached: false }),
        render: async () => 'high',
        getRuntimeScripts: () => ({ headScripts: '', isInline: false }),
      };

      const customRegistry = new RendererRegistry();
      customRegistry.register(lowPriority);
      customRegistry.register(highPriority);

      const result = customRegistry.detect('any');
      expect(result.renderer.priority).toBe(100);
    });

    it('should use fallback renderer when no renderer matches', () => {
      // Create registry with a noop renderer that handles nothing
      const customRegistry = new RendererRegistry();
      const noopRenderer: UIRenderer = {
        type: 'html',
        priority: 0,
        canHandle: () => false,
        transpile: async () => ({ code: '', hash: '', cached: false }),
        render: async () => 'fallback',
        getRuntimeScripts: () => ({ headScripts: '', isInline: false }),
      };

      // Replace the default HTML renderer with noop
      (customRegistry as any).renderers = new Map([['html', noopRenderer]]);
      (customRegistry as any).sortedRenderers = [noopRenderer];

      // Should use fallback with confidence 0.5
      const detection = customRegistry.detect('test');
      expect(detection.confidence).toBe(0.5);
      expect(detection.reason).toContain('Fallback');
    });
  });

  describe('render', () => {
    const createContext = <In = object, Out = object>(input: In, output: Out): TemplateContext<In, Out> => ({
      input,
      output,
      helpers: {
        escapeHtml: (s) => s,
        formatDate: () => '',
        formatCurrency: () => '',
        uniqueId: () => 'id',
        jsonEmbed: (d) => JSON.stringify(d),
      },
    });

    it('should render HTML templates', async () => {
      const template = '<div>hello world</div>';
      const result = await registry.render(template, createContext({}, {}));
      expect(result.html).toBe('<div>hello world</div>');
      expect(result.rendererType).toBe('html');
    });

    it('should render template builder functions', async () => {
      const template = (ctx: TemplateContext<{}, { name: string }>) => `<div>${ctx.output.name}</div>`;
      const result = await registry.render(template, createContext({}, { name: 'Test' }));
      expect(result.html).toBe('<div>Test</div>');
    });

    it('should include transpile cache status', async () => {
      const template = '<div>test</div>';
      const result = await registry.render(template, createContext({}, {}));
      expect(typeof result.transpileCached).toBe('boolean');
    });

    it('should include runtime scripts', async () => {
      const template = '<div>test</div>';
      const result = await registry.render(template, createContext({}, {}));
      expect(result.runtimeScripts).toBeDefined();
      expect(typeof result.runtimeScripts.headScripts).toBe('string');
    });
  });

  describe('renderWith', () => {
    const createContext = <In = object, Out = object>(input: In, output: Out): TemplateContext<In, Out> => ({
      input,
      output,
      helpers: {
        escapeHtml: (s) => s,
        formatDate: () => '',
        formatCurrency: () => '',
        uniqueId: () => 'id',
        jsonEmbed: (d) => JSON.stringify(d),
      },
    });

    it('should render with specific renderer type', async () => {
      const template = '<div>hello</div>';
      const result = await registry.renderWith('html', template, createContext({}, {}));
      expect(result.html).toBe('<div>hello</div>');
      expect(result.rendererType).toBe('html');
    });

    it('should throw for non-existent renderer type', async () => {
      await expect(registry.renderWith('nonexistent' as any, 'test', createContext({}, {}))).rejects.toThrow(
        "Renderer 'nonexistent' not registered",
      );
    });
  });

  describe('debug mode', () => {
    it('should log when debug is enabled', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const debugRegistry = new RendererRegistry({ debug: true });

      // Register triggers debug log
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[RendererRegistry]'));

      // Detection triggers debug log
      debugRegistry.detect('<div>test</div>');
      expect(consoleSpy.mock.calls.length).toBeGreaterThan(1);

      consoleSpy.mockRestore();
    });

    it('should log during render in debug mode', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const debugRegistry = new RendererRegistry({ debug: true });

      await debugRegistry.render('<div>test</div>', {
        input: {},
        output: {},
        helpers: {
          escapeHtml: (s) => s,
          formatDate: () => '',
          formatCurrency: () => '',
          uniqueId: () => 'id',
          jsonEmbed: (d) => JSON.stringify(d),
        },
      });

      // Should have logged rendering
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Rendering with'));

      consoleSpy.mockRestore();
    });
  });
});

describe('Global Registry Instance', () => {
  it('should export rendererRegistry singleton', () => {
    expect(rendererRegistry).toBeInstanceOf(RendererRegistry);
  });

  it('should have HTML renderer registered', () => {
    const renderer = rendererRegistry.get('html');
    expect(renderer).toBeDefined();
    expect(renderer?.type).toBe('html');
  });
});
