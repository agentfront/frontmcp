// file: libs/browser/src/registry/renderer.registry.ts
/**
 * Renderer registry for browser MCP server.
 *
 * Manages output renderers with Zod schema validation.
 */

import type { RendererDefinition, RendererOutputType, RendererRegistryInterface, RenderContext } from './types';

/**
 * Renderer registry for managing output renderers.
 *
 * @example
 * ```typescript
 * const registry = new RendererRegistry();
 *
 * registry.register({
 *   name: 'html-button',
 *   description: 'Renders buttons as HTML',
 *   inputSchema: z.object({
 *     label: z.string(),
 *     variant: z.enum(['primary', 'secondary']).optional(),
 *   }),
 *   outputType: 'html',
 *   render: (props) => {
 *     return `<button class="${props.variant ?? 'primary'}">${props.label}</button>`;
 *   },
 *   isDefault: true,
 * });
 *
 * const html = await registry.render('html-button', { label: 'Click me' });
 * ```
 */
export class RendererRegistry implements RendererRegistryInterface {
  private renderers = new Map<string, RendererDefinition<unknown, unknown>>();
  private outputTypeIndex = new Map<RendererOutputType, Set<string>>();
  private defaultRenderers = new Map<RendererOutputType, string>();

  register<Props, Result>(definition: RendererDefinition<Props, Result>): void {
    if (this.renderers.has(definition.name)) {
      throw new Error(`Renderer "${definition.name}" is already registered`);
    }

    this.renderers.set(definition.name, definition as RendererDefinition<unknown, unknown>);

    // Index by output type
    if (!this.outputTypeIndex.has(definition.outputType)) {
      this.outputTypeIndex.set(definition.outputType, new Set());
    }
    this.outputTypeIndex.get(definition.outputType)!.add(definition.name);

    // Set as default if specified or if it's the first for this output type
    if (definition.isDefault || !this.defaultRenderers.has(definition.outputType)) {
      this.defaultRenderers.set(definition.outputType, definition.name);
    }
  }

  get<Props = unknown, Result = string>(name: string): RendererDefinition<Props, Result> | undefined {
    return this.renderers.get(name) as RendererDefinition<Props, Result> | undefined;
  }

  getDefault<Props = unknown, Result = string>(
    outputType: RendererOutputType,
  ): RendererDefinition<Props, Result> | undefined {
    const defaultName = this.defaultRenderers.get(outputType);
    if (!defaultName) {
      return undefined;
    }
    return this.get<Props, Result>(defaultName);
  }

  has(name: string): boolean {
    return this.renderers.has(name);
  }

  list(): string[] {
    return Array.from(this.renderers.keys());
  }

  listByOutputType(outputType: RendererOutputType): RendererDefinition<unknown, unknown>[] {
    const names = this.outputTypeIndex.get(outputType);
    if (!names) {
      return [];
    }
    return Array.from(names)
      .map((name) => this.renderers.get(name))
      .filter((def): def is RendererDefinition<unknown, unknown> => def !== undefined)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  remove(name: string): boolean {
    const definition = this.renderers.get(name);
    if (!definition) {
      return false;
    }

    // Remove from output type index
    const outputTypeSet = this.outputTypeIndex.get(definition.outputType);
    if (outputTypeSet) {
      outputTypeSet.delete(name);
      if (outputTypeSet.size === 0) {
        this.outputTypeIndex.delete(definition.outputType);
      }
    }

    // Update default if this was the default
    if (this.defaultRenderers.get(definition.outputType) === name) {
      this.defaultRenderers.delete(definition.outputType);

      // Set a new default if there are other renderers for this output type
      const remaining = this.listByOutputType(definition.outputType);
      if (remaining.length > 0) {
        // Prefer one marked as default, or the first one
        const newDefault = remaining.find((r) => r.isDefault) ?? remaining[0];
        if (newDefault) {
          this.defaultRenderers.set(definition.outputType, newDefault.name);
        }
      }
    }

    this.renderers.delete(name);
    return true;
  }

  clear(): void {
    this.renderers.clear();
    this.outputTypeIndex.clear();
    this.defaultRenderers.clear();
  }

  async render<Props = unknown, Result = string>(
    rendererName: string,
    props: Props,
    context?: RenderContext,
  ): Promise<Result> {
    const renderer = this.get<Props, Result>(rendererName);
    if (!renderer) {
      throw new Error(`Renderer "${rendererName}" not found`);
    }

    // Validate input against schema
    const validation = renderer.inputSchema.safeParse(props);
    if (!validation.success) {
      // Zod v4 uses `issues`
      const issues = validation.error.issues ?? [];
      const errors = issues.map((issue) => `${String(issue.path?.join('.') ?? '')}: ${issue.message}`);
      throw new Error(`Invalid props for renderer "${rendererName}": ${errors.join(', ')}`);
    }

    // Call the render function
    const renderContext: RenderContext = context ?? { outputType: renderer.outputType };
    return renderer.render(validation.data as Props, renderContext);
  }

  /**
   * Get the number of registered renderers.
   */
  get size(): number {
    return this.renderers.size;
  }

  /**
   * Get all renderer definitions.
   */
  getAll(): RendererDefinition<unknown, unknown>[] {
    return Array.from(this.renderers.values());
  }

  /**
   * Get all output types with their renderer counts.
   */
  getOutputTypes(): Map<RendererOutputType, number> {
    const result = new Map<RendererOutputType, number>();
    for (const [outputType, names] of this.outputTypeIndex) {
      result.set(outputType, names.size);
    }
    return result;
  }

  /**
   * Set the default renderer for an output type.
   *
   * @param outputType - The output type
   * @param rendererName - The renderer name to set as default
   */
  setDefault(outputType: RendererOutputType, rendererName: string): void {
    const renderer = this.get(rendererName);
    if (!renderer) {
      throw new Error(`Renderer "${rendererName}" not found`);
    }
    if (renderer.outputType !== outputType) {
      throw new Error(`Renderer "${rendererName}" has output type "${renderer.outputType}", expected "${outputType}"`);
    }
    this.defaultRenderers.set(outputType, rendererName);
  }

  /**
   * Render using the default renderer for an output type.
   *
   * @param outputType - The output type
   * @param props - The props to render
   * @param context - Optional render context
   * @returns The rendered output
   */
  async renderDefault<Props = unknown, Result = string>(
    outputType: RendererOutputType,
    props: Props,
    context?: RenderContext,
  ): Promise<Result> {
    const defaultName = this.defaultRenderers.get(outputType);
    if (!defaultName) {
      throw new Error(`No default renderer for output type "${outputType}"`);
    }
    return this.render<Props, Result>(defaultName, props, context);
  }

  /**
   * Create a JSON representation for AI discovery.
   */
  toJSON(): object[] {
    return this.getAll().map((def) => ({
      name: def.name,
      description: def.description,
      outputType: def.outputType,
      isDefault: def.isDefault,
      priority: def.priority,
    }));
  }
}
