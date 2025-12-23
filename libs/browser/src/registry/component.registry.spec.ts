// file: libs/browser/src/registry/component.registry.spec.ts
import { z } from 'zod';
import { ComponentRegistry } from './component.registry';
import type { ComponentDefinition } from './types';

describe('ComponentRegistry', () => {
  let registry: ComponentRegistry;

  const buttonSchema = z.object({
    label: z.string(),
    variant: z.enum(['primary', 'secondary']).optional(),
  });

  type ButtonProps = z.infer<typeof buttonSchema>;

  const buttonDefinition: ComponentDefinition<ButtonProps> = {
    name: 'Button',
    description: 'A clickable button component',
    propsSchema: buttonSchema,
    defaultProps: { variant: 'primary' },
    category: 'action',
    tags: ['interactive', 'form'],
    examples: [
      {
        name: 'Primary button',
        props: { label: 'Click me', variant: 'primary' },
      },
    ],
  };

  const inputDefinition: ComponentDefinition<{ value: string }> = {
    name: 'Input',
    description: 'A text input component',
    propsSchema: z.object({ value: z.string() }),
    category: 'input',
    tags: ['form', 'text'],
  };

  beforeEach(() => {
    registry = new ComponentRegistry();
  });

  describe('register', () => {
    it('should register a component', () => {
      registry.register(buttonDefinition);
      expect(registry.has('Button')).toBe(true);
    });

    it('should throw on duplicate registration', () => {
      registry.register(buttonDefinition);
      expect(() => registry.register(buttonDefinition)).toThrow('Component "Button" is already registered');
    });
  });

  describe('get', () => {
    it('should return registered component', () => {
      registry.register(buttonDefinition);
      const component = registry.get<ButtonProps>('Button');
      expect(component?.name).toBe('Button');
      expect(component?.description).toBe('A clickable button component');
    });

    it('should return undefined for unknown component', () => {
      expect(registry.get('Unknown')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for registered component', () => {
      registry.register(buttonDefinition);
      expect(registry.has('Button')).toBe(true);
    });

    it('should return false for unregistered component', () => {
      expect(registry.has('Unknown')).toBe(false);
    });
  });

  describe('list', () => {
    it('should return empty array when no components', () => {
      expect(registry.list()).toEqual([]);
    });

    it('should return all component names', () => {
      registry.register(buttonDefinition);
      registry.register(inputDefinition);
      expect(registry.list()).toEqual(['Button', 'Input']);
    });
  });

  describe('listByCategory', () => {
    it('should return components by category', () => {
      registry.register(buttonDefinition);
      registry.register(inputDefinition);

      const actionComponents = registry.listByCategory('action');
      expect(actionComponents).toHaveLength(1);
      expect(actionComponents[0].name).toBe('Button');

      const inputComponents = registry.listByCategory('input');
      expect(inputComponents).toHaveLength(1);
      expect(inputComponents[0].name).toBe('Input');
    });

    it('should return empty array for unknown category', () => {
      expect(registry.listByCategory('layout')).toEqual([]);
    });
  });

  describe('listByTag', () => {
    it('should return components by tag', () => {
      registry.register(buttonDefinition);
      registry.register(inputDefinition);

      const formComponents = registry.listByTag('form');
      expect(formComponents).toHaveLength(2);

      const interactiveComponents = registry.listByTag('interactive');
      expect(interactiveComponents).toHaveLength(1);
      expect(interactiveComponents[0].name).toBe('Button');
    });

    it('should return empty array for unknown tag', () => {
      expect(registry.listByTag('unknown')).toEqual([]);
    });
  });

  describe('remove', () => {
    it('should remove a component', () => {
      registry.register(buttonDefinition);
      expect(registry.remove('Button')).toBe(true);
      expect(registry.has('Button')).toBe(false);
    });

    it('should return false for unknown component', () => {
      expect(registry.remove('Unknown')).toBe(false);
    });

    it('should update category index on removal', () => {
      registry.register(buttonDefinition);
      registry.remove('Button');
      expect(registry.listByCategory('action')).toEqual([]);
    });

    it('should update tag index on removal', () => {
      registry.register(buttonDefinition);
      registry.remove('Button');
      expect(registry.listByTag('interactive')).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should remove all components', () => {
      registry.register(buttonDefinition);
      registry.register(inputDefinition);
      registry.clear();
      expect(registry.list()).toEqual([]);
      expect(registry.size).toBe(0);
    });
  });

  describe('size', () => {
    it('should return 0 for empty registry', () => {
      expect(registry.size).toBe(0);
    });

    it('should return correct count', () => {
      registry.register(buttonDefinition);
      registry.register(inputDefinition);
      expect(registry.size).toBe(2);
    });
  });

  describe('getAll', () => {
    it('should return all component definitions', () => {
      registry.register(buttonDefinition);
      registry.register(inputDefinition);
      const all = registry.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('search', () => {
    it('should search by name', () => {
      registry.register(buttonDefinition);
      registry.register(inputDefinition);
      const results = registry.search('button');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Button');
    });

    it('should search by description', () => {
      registry.register(buttonDefinition);
      registry.register(inputDefinition);
      const results = registry.search('clickable');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Button');
    });

    it('should search by tag', () => {
      registry.register(buttonDefinition);
      registry.register(inputDefinition);
      const results = registry.search('interactive');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Button');
    });

    it('should be case insensitive', () => {
      registry.register(buttonDefinition);
      const results = registry.search('BUTTON');
      expect(results).toHaveLength(1);
    });
  });

  describe('getCategories', () => {
    it('should return empty map when no components', () => {
      expect(registry.getCategories().size).toBe(0);
    });

    it('should return category counts', () => {
      registry.register(buttonDefinition);
      registry.register(inputDefinition);
      const categories = registry.getCategories();
      expect(categories.get('action')).toBe(1);
      expect(categories.get('input')).toBe(1);
    });
  });

  describe('getTags', () => {
    it('should return empty map when no components', () => {
      expect(registry.getTags().size).toBe(0);
    });

    it('should return tag counts', () => {
      registry.register(buttonDefinition);
      registry.register(inputDefinition);
      const tags = registry.getTags();
      expect(tags.get('form')).toBe(2);
      expect(tags.get('interactive')).toBe(1);
    });
  });

  describe('validateProps', () => {
    it('should validate valid props', () => {
      registry.register(buttonDefinition);
      const result = registry.validateProps<ButtonProps>('Button', { label: 'Click me' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.label).toBe('Click me');
      }
    });

    it('should reject invalid props', () => {
      registry.register(buttonDefinition);
      const result = registry.validateProps<ButtonProps>('Button', { label: 123 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('should return error for unknown component', () => {
      const result = registry.validateProps('Unknown', {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toContain('Component "Unknown" not found');
      }
    });
  });

  describe('toJSON', () => {
    it('should return JSON representation', () => {
      registry.register(buttonDefinition);
      const json = registry.toJSON();
      expect(json).toHaveLength(1);
      expect(json[0]).toEqual({
        name: 'Button',
        description: 'A clickable button component',
        category: 'action',
        tags: ['interactive', 'form'],
        deprecated: undefined,
        deprecationMessage: undefined,
        examples: [
          {
            name: 'Primary button',
            description: undefined,
            props: { label: 'Click me', variant: 'primary' },
          },
        ],
      });
    });
  });
});
