// file: libs/browser/src/registry/renderer.registry.spec.ts
import { z } from 'zod';
import { RendererRegistry } from './renderer.registry';
import type { RendererDefinition } from './types';

describe('RendererRegistry', () => {
  let registry: RendererRegistry;

  const buttonSchema = z.object({
    label: z.string(),
    variant: z.enum(['primary', 'secondary']).optional(),
  });

  type ButtonProps = z.infer<typeof buttonSchema>;

  const htmlButtonRenderer: RendererDefinition<ButtonProps, string> = {
    name: 'html-button',
    description: 'Renders buttons as HTML',
    inputSchema: buttonSchema,
    outputType: 'html',
    render: (props) => `<button class="${props.variant ?? 'primary'}">${props.label}</button>`,
    isDefault: true,
    priority: 10,
  };

  const markdownButtonRenderer: RendererDefinition<ButtonProps, string> = {
    name: 'markdown-button',
    description: 'Renders buttons as Markdown',
    inputSchema: buttonSchema,
    outputType: 'markdown',
    render: (props) => `[${props.label}](action:button:${props.variant ?? 'primary'})`,
    priority: 5,
  };

  const jsonRenderer: RendererDefinition<Record<string, unknown>, string> = {
    name: 'json',
    description: 'Renders as JSON',
    inputSchema: z.record(z.string(), z.unknown()),
    outputType: 'json',
    render: (props) => JSON.stringify(props),
  };

  beforeEach(() => {
    registry = new RendererRegistry();
  });

  describe('register', () => {
    it('should register a renderer', () => {
      registry.register(htmlButtonRenderer);
      expect(registry.has('html-button')).toBe(true);
    });

    it('should throw on duplicate registration', () => {
      registry.register(htmlButtonRenderer);
      expect(() => registry.register(htmlButtonRenderer)).toThrow('Renderer "html-button" is already registered');
    });

    it('should set first renderer as default for output type', () => {
      registry.register(markdownButtonRenderer);
      expect(registry.getDefault('markdown')?.name).toBe('markdown-button');
    });
  });

  describe('get', () => {
    it('should return registered renderer', () => {
      registry.register(htmlButtonRenderer);
      const renderer = registry.get<ButtonProps, string>('html-button');
      expect(renderer?.name).toBe('html-button');
      expect(renderer?.description).toBe('Renders buttons as HTML');
    });

    it('should return undefined for unknown renderer', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('getDefault', () => {
    it('should return default renderer for output type', () => {
      registry.register(htmlButtonRenderer);
      const defaultRenderer = registry.getDefault<ButtonProps, string>('html');
      expect(defaultRenderer?.name).toBe('html-button');
    });

    it('should return undefined when no renderers for output type', () => {
      expect(registry.getDefault('html')).toBeUndefined();
    });

    it('should prefer renderer marked as default', () => {
      // Register non-default first
      registry.register({
        ...markdownButtonRenderer,
        name: 'other-md',
        outputType: 'html',
        isDefault: false,
      });
      registry.register(htmlButtonRenderer);
      expect(registry.getDefault('html')?.name).toBe('html-button');
    });
  });

  describe('has', () => {
    it('should return true for registered renderer', () => {
      registry.register(htmlButtonRenderer);
      expect(registry.has('html-button')).toBe(true);
    });

    it('should return false for unregistered renderer', () => {
      expect(registry.has('unknown')).toBe(false);
    });
  });

  describe('list', () => {
    it('should return empty array when no renderers', () => {
      expect(registry.list()).toEqual([]);
    });

    it('should return all renderer names', () => {
      registry.register(htmlButtonRenderer);
      registry.register(markdownButtonRenderer);
      expect(registry.list()).toEqual(['html-button', 'markdown-button']);
    });
  });

  describe('listByOutputType', () => {
    it('should return renderers by output type', () => {
      registry.register(htmlButtonRenderer);
      registry.register(markdownButtonRenderer);
      registry.register(jsonRenderer);

      const htmlRenderers = registry.listByOutputType('html');
      expect(htmlRenderers).toHaveLength(1);
      expect(htmlRenderers[0].name).toBe('html-button');
    });

    it('should sort by priority', () => {
      const lowPriority: RendererDefinition<ButtonProps, string> = {
        ...htmlButtonRenderer,
        name: 'html-button-low',
        priority: 1,
      };
      const highPriority: RendererDefinition<ButtonProps, string> = {
        ...htmlButtonRenderer,
        name: 'html-button-high',
        priority: 100,
      };

      registry.register(lowPriority);
      registry.register(highPriority);

      const renderers = registry.listByOutputType('html');
      expect(renderers[0].name).toBe('html-button-high');
      expect(renderers[1].name).toBe('html-button-low');
    });

    it('should return empty array for unknown output type', () => {
      expect(registry.listByOutputType('custom')).toEqual([]);
    });
  });

  describe('remove', () => {
    it('should remove a renderer', () => {
      registry.register(htmlButtonRenderer);
      expect(registry.remove('html-button')).toBe(true);
      expect(registry.has('html-button')).toBe(false);
    });

    it('should return false for unknown renderer', () => {
      expect(registry.remove('unknown')).toBe(false);
    });

    it('should update default when default is removed', () => {
      registry.register(htmlButtonRenderer);
      registry.register({
        ...htmlButtonRenderer,
        name: 'html-button-2',
        isDefault: false,
      });

      expect(registry.getDefault('html')?.name).toBe('html-button');
      registry.remove('html-button');
      expect(registry.getDefault('html')?.name).toBe('html-button-2');
    });
  });

  describe('clear', () => {
    it('should remove all renderers', () => {
      registry.register(htmlButtonRenderer);
      registry.register(markdownButtonRenderer);
      registry.clear();
      expect(registry.list()).toEqual([]);
      expect(registry.size).toBe(0);
    });
  });

  describe('render', () => {
    it('should render using renderer', async () => {
      registry.register(htmlButtonRenderer);
      const result = await registry.render<ButtonProps, string>('html-button', { label: 'Click me' });
      expect(result).toBe('<button class="primary">Click me</button>');
    });

    it('should validate props before rendering', async () => {
      registry.register(htmlButtonRenderer);
      await expect(registry.render('html-button', { label: 123 })).rejects.toThrow('Invalid props');
    });

    it('should throw for unknown renderer', async () => {
      await expect(registry.render('unknown', {})).rejects.toThrow('Renderer "unknown" not found');
    });

    it('should pass context to renderer', async () => {
      const contextAwareRenderer: RendererDefinition<ButtonProps, string> = {
        name: 'context-aware',
        description: 'Uses context',
        inputSchema: buttonSchema,
        outputType: 'html',
        render: (props, context) => {
          const theme = (context?.data?.['theme'] as string) ?? 'light';
          return `<button data-theme="${theme}">${props.label}</button>`;
        },
      };

      registry.register(contextAwareRenderer);
      const result = await registry.render<ButtonProps, string>(
        'context-aware',
        { label: 'Click' },
        { outputType: 'html', data: { theme: 'dark' } },
      );
      expect(result).toBe('<button data-theme="dark">Click</button>');
    });
  });

  describe('renderDefault', () => {
    it('should render using default renderer', async () => {
      registry.register(htmlButtonRenderer);
      const result = await registry.renderDefault<ButtonProps, string>('html', { label: 'Click me' });
      expect(result).toBe('<button class="primary">Click me</button>');
    });

    it('should throw when no default renderer', async () => {
      await expect(registry.renderDefault('html', {})).rejects.toThrow('No default renderer for output type "html"');
    });
  });

  describe('setDefault', () => {
    it('should set default renderer', () => {
      registry.register(htmlButtonRenderer);
      registry.register({
        ...htmlButtonRenderer,
        name: 'html-button-2',
        isDefault: false,
      });

      registry.setDefault('html', 'html-button-2');
      expect(registry.getDefault('html')?.name).toBe('html-button-2');
    });

    it('should throw for unknown renderer', () => {
      expect(() => registry.setDefault('html', 'unknown')).toThrow('Renderer "unknown" not found');
    });

    it('should throw for mismatched output type', () => {
      registry.register(htmlButtonRenderer);
      expect(() => registry.setDefault('markdown', 'html-button')).toThrow(
        'has output type "html", expected "markdown"',
      );
    });
  });

  describe('size', () => {
    it('should return 0 for empty registry', () => {
      expect(registry.size).toBe(0);
    });

    it('should return correct count', () => {
      registry.register(htmlButtonRenderer);
      registry.register(markdownButtonRenderer);
      expect(registry.size).toBe(2);
    });
  });

  describe('getAll', () => {
    it('should return all renderer definitions', () => {
      registry.register(htmlButtonRenderer);
      registry.register(markdownButtonRenderer);
      const all = registry.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('getOutputTypes', () => {
    it('should return empty map when no renderers', () => {
      expect(registry.getOutputTypes().size).toBe(0);
    });

    it('should return output type counts', () => {
      registry.register(htmlButtonRenderer);
      registry.register(markdownButtonRenderer);
      registry.register(jsonRenderer);

      const types = registry.getOutputTypes();
      expect(types.get('html')).toBe(1);
      expect(types.get('markdown')).toBe(1);
      expect(types.get('json')).toBe(1);
    });
  });

  describe('toJSON', () => {
    it('should return JSON representation', () => {
      registry.register(htmlButtonRenderer);
      const json = registry.toJSON();
      expect(json).toHaveLength(1);
      expect(json[0]).toEqual({
        name: 'html-button',
        description: 'Renders buttons as HTML',
        outputType: 'html',
        isDefault: true,
        priority: 10,
      });
    });
  });

  describe('async renderers', () => {
    it('should support async render functions', async () => {
      const asyncRenderer: RendererDefinition<ButtonProps, string> = {
        name: 'async-html',
        description: 'Async HTML renderer',
        inputSchema: buttonSchema,
        outputType: 'html',
        render: async (props) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return `<button>${props.label}</button>`;
        },
      };

      registry.register(asyncRenderer);
      const result = await registry.render<ButtonProps, string>('async-html', { label: 'Async Click' });
      expect(result).toBe('<button>Async Click</button>');
    });
  });
});
