// file: libs/browser/src/registry/component.registry.ts
/**
 * Component registry for browser MCP server.
 *
 * Manages UI component definitions with Zod schema validation.
 */

import type { ComponentDefinition, ComponentCategory, ComponentRegistryInterface } from './types';

/**
 * Component registry for managing UI component definitions.
 *
 * @example
 * ```typescript
 * const registry = new ComponentRegistry();
 *
 * registry.register({
 *   name: 'Button',
 *   description: 'A clickable button',
 *   propsSchema: z.object({
 *     label: z.string(),
 *     variant: z.enum(['primary', 'secondary']).optional(),
 *   }),
 *   category: 'action',
 *   tags: ['interactive', 'form'],
 * });
 *
 * const button = registry.get('Button');
 * console.log(button?.description);
 * ```
 */
export class ComponentRegistry implements ComponentRegistryInterface {
  private components = new Map<string, ComponentDefinition<unknown>>();
  private categoryIndex = new Map<ComponentCategory, Set<string>>();
  private tagIndex = new Map<string, Set<string>>();

  register<Props>(definition: ComponentDefinition<Props>): void {
    if (this.components.has(definition.name)) {
      throw new Error(`Component "${definition.name}" is already registered`);
    }

    this.components.set(definition.name, definition as ComponentDefinition<unknown>);

    // Index by category
    if (definition.category) {
      if (!this.categoryIndex.has(definition.category)) {
        this.categoryIndex.set(definition.category, new Set());
      }
      this.categoryIndex.get(definition.category)!.add(definition.name);
    }

    // Index by tags
    if (definition.tags) {
      for (const tag of definition.tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(definition.name);
      }
    }
  }

  get<Props = unknown>(name: string): ComponentDefinition<Props> | undefined {
    return this.components.get(name) as ComponentDefinition<Props> | undefined;
  }

  has(name: string): boolean {
    return this.components.has(name);
  }

  list(): string[] {
    return Array.from(this.components.keys());
  }

  listByCategory(category: ComponentCategory): ComponentDefinition<unknown>[] {
    const names = this.categoryIndex.get(category);
    if (!names) {
      return [];
    }
    return Array.from(names)
      .map((name) => this.components.get(name))
      .filter((def): def is ComponentDefinition<unknown> => def !== undefined);
  }

  listByTag(tag: string): ComponentDefinition<unknown>[] {
    const names = this.tagIndex.get(tag);
    if (!names) {
      return [];
    }
    return Array.from(names)
      .map((name) => this.components.get(name))
      .filter((def): def is ComponentDefinition<unknown> => def !== undefined);
  }

  remove(name: string): boolean {
    const definition = this.components.get(name);
    if (!definition) {
      return false;
    }

    // Remove from category index
    if (definition.category) {
      const categorySet = this.categoryIndex.get(definition.category);
      if (categorySet) {
        categorySet.delete(name);
        if (categorySet.size === 0) {
          this.categoryIndex.delete(definition.category);
        }
      }
    }

    // Remove from tag index
    if (definition.tags) {
      for (const tag of definition.tags) {
        const tagSet = this.tagIndex.get(tag);
        if (tagSet) {
          tagSet.delete(name);
          if (tagSet.size === 0) {
            this.tagIndex.delete(tag);
          }
        }
      }
    }

    this.components.delete(name);
    return true;
  }

  clear(): void {
    this.components.clear();
    this.categoryIndex.clear();
    this.tagIndex.clear();
  }

  /**
   * Get the number of registered components.
   */
  get size(): number {
    return this.components.size;
  }

  /**
   * Get all component definitions.
   */
  getAll(): ComponentDefinition<unknown>[] {
    return Array.from(this.components.values());
  }

  /**
   * Search components by name, description, or tags.
   *
   * @param query - The search query
   * @returns Matching component definitions
   */
  search(query: string): ComponentDefinition<unknown>[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter((def) => {
      return (
        def.name.toLowerCase().includes(lowerQuery) ||
        def.description.toLowerCase().includes(lowerQuery) ||
        def.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
      );
    });
  }

  /**
   * Get all categories with their component counts.
   */
  getCategories(): Map<ComponentCategory, number> {
    const result = new Map<ComponentCategory, number>();
    for (const [category, names] of this.categoryIndex) {
      result.set(category, names.size);
    }
    return result;
  }

  /**
   * Get all tags with their component counts.
   */
  getTags(): Map<string, number> {
    const result = new Map<string, number>();
    for (const [tag, names] of this.tagIndex) {
      result.set(tag, names.size);
    }
    return result;
  }

  /**
   * Validate props against a component's schema.
   *
   * @param name - The component name
   * @param props - The props to validate
   * @returns Validation result with parsed data or errors
   */
  validateProps<Props>(
    name: string,
    props: unknown,
  ): { success: true; data: Props } | { success: false; errors: string[] } {
    const component = this.components.get(name);
    if (!component) {
      return { success: false, errors: [`Component "${name}" not found`] };
    }

    const result = component.propsSchema.safeParse(props);
    if (result.success) {
      return { success: true, data: result.data as Props };
    }

    // Zod v4 uses `issues`
    const issues = result.error.issues ?? [];
    const errors = issues.map((issue) => `${String(issue.path?.join('.') ?? '')}: ${issue.message}`);
    return { success: false, errors };
  }

  /**
   * Create a JSON representation for AI discovery.
   */
  toJSON(): object[] {
    return this.getAll().map((def) => ({
      name: def.name,
      description: def.description,
      category: def.category,
      tags: def.tags,
      deprecated: def.deprecated,
      deprecationMessage: def.deprecationMessage,
      examples: def.examples?.map((ex) => ({
        name: ex.name,
        description: ex.description,
        props: ex.props,
      })),
    }));
  }
}
