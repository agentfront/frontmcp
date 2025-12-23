// file: libs/browser/src/registry/types.ts
/**
 * Component and renderer registry types for browser MCP server.
 *
 * These types define the registries for UI components and output renderers,
 * extending the SDK's RegistryAbstract pattern.
 */

import type { z } from 'zod';

/**
 * Component category for organization.
 */
export type ComponentCategory = 'input' | 'display' | 'layout' | 'action' | 'feedback' | 'navigation' | 'custom';

/**
 * Component example for documentation.
 */
export interface ComponentExample<Props = unknown> {
  /**
   * Name/title of the example.
   */
  name: string;

  /**
   * Description of what the example shows.
   */
  description?: string;

  /**
   * Props for the example.
   */
  props: Props;

  /**
   * Expected output (for testing).
   */
  expectedOutput?: string;
}

/**
 * Component definition with Zod schema validation.
 *
 * @template Props - The props type for the component
 *
 * @example
 * ```typescript
 * const buttonComponent: ComponentDefinition<ButtonProps> = {
 *   name: 'Button',
 *   description: 'A clickable button component',
 *   propsSchema: z.object({
 *     label: z.string(),
 *     variant: z.enum(['primary', 'secondary']).optional(),
 *     onClick: z.string().optional(), // Action name to trigger
 *   }),
 *   defaultProps: { variant: 'primary' },
 *   category: 'action',
 *   tags: ['interactive', 'form'],
 *   examples: [{
 *     name: 'Primary button',
 *     props: { label: 'Click me', variant: 'primary' },
 *   }],
 * };
 * ```
 */
export interface ComponentDefinition<Props = unknown> {
  /**
   * Component name (unique identifier).
   */
  name: string;

  /**
   * Human-readable description.
   */
  description: string;

  /**
   * Zod schema for validating props.
   */
  propsSchema: z.ZodType<Props>;

  /**
   * Default props values.
   */
  defaultProps?: Partial<Props>;

  /**
   * Component category for organization.
   */
  category?: ComponentCategory;

  /**
   * Tags for filtering and search.
   */
  tags?: string[];

  /**
   * Usage examples.
   */
  examples?: ComponentExample<Props>[];

  /**
   * Component icon (for UI display).
   */
  icon?: string;

  /**
   * Whether the component is deprecated.
   */
  deprecated?: boolean;

  /**
   * Deprecation message with migration guidance.
   */
  deprecationMessage?: string;
}

/**
 * Renderer output types.
 */
export type RendererOutputType = 'html' | 'markdown' | 'json' | 'text' | 'react' | 'custom';

/**
 * Renderer function type.
 *
 * @template Props - The input props type
 * @template Result - The output type
 */
export type RenderFunction<Props = unknown, Result = string> = (
  props: Props,
  context?: RenderContext,
) => Result | Promise<Result>;

/**
 * Render context passed to renderers.
 */
export interface RenderContext {
  /**
   * Target output type.
   */
  outputType: RendererOutputType;

  /**
   * Theme configuration.
   */
  theme?: Record<string, unknown>;

  /**
   * Additional context data.
   */
  data?: Record<string, unknown>;

  /**
   * Component registry for nested components.
   */
  components?: ComponentRegistryInterface;
}

/**
 * Renderer definition with schema validation.
 *
 * @template Props - The input props type
 * @template Result - The output type
 *
 * @example
 * ```typescript
 * const htmlRenderer: RendererDefinition<ButtonProps, string> = {
 *   name: 'html',
 *   description: 'Renders components as HTML',
 *   inputSchema: buttonPropsSchema,
 *   outputType: 'html',
 *   render: (props) => {
 *     return `<button class="${props.variant}">${props.label}</button>`;
 *   },
 * };
 * ```
 */
export interface RendererDefinition<Props = unknown, Result = string> {
  /**
   * Renderer name (unique identifier).
   */
  name: string;

  /**
   * Human-readable description.
   */
  description: string;

  /**
   * Zod schema for validating input.
   */
  inputSchema: z.ZodType<Props>;

  /**
   * Output type this renderer produces.
   */
  outputType: RendererOutputType;

  /**
   * The render function.
   */
  render: RenderFunction<Props, Result>;

  /**
   * Whether this renderer is the default for its output type.
   */
  isDefault?: boolean;

  /**
   * Priority for renderer selection (higher = preferred).
   */
  priority?: number;
}

/**
 * Component registry interface.
 *
 * Extends SDK's RegistryAbstract pattern for component management.
 */
export interface ComponentRegistryInterface {
  /**
   * Register a component definition.
   *
   * @param definition - The component definition
   */
  register<Props>(definition: ComponentDefinition<Props>): void;

  /**
   * Get a component by name.
   *
   * @param name - The component name
   * @returns The component definition or undefined
   */
  get<Props = unknown>(name: string): ComponentDefinition<Props> | undefined;

  /**
   * Check if a component exists.
   *
   * @param name - The component name
   * @returns True if component exists
   */
  has(name: string): boolean;

  /**
   * List all registered component names.
   *
   * @returns Array of component names
   */
  list(): string[];

  /**
   * List components by category.
   *
   * @param category - The category to filter by
   * @returns Array of component definitions
   */
  listByCategory(category: ComponentCategory): ComponentDefinition<unknown>[];

  /**
   * List components by tag.
   *
   * @param tag - The tag to filter by
   * @returns Array of component definitions
   */
  listByTag(tag: string): ComponentDefinition<unknown>[];

  /**
   * Remove a component.
   *
   * @param name - The component name
   * @returns True if removed
   */
  remove(name: string): boolean;

  /**
   * Clear all components.
   */
  clear(): void;
}

/**
 * Renderer registry interface.
 *
 * Extends SDK's RegistryAbstract pattern for renderer management.
 */
export interface RendererRegistryInterface {
  /**
   * Register a renderer definition.
   *
   * @param definition - The renderer definition
   */
  register<Props, Result>(definition: RendererDefinition<Props, Result>): void;

  /**
   * Get a renderer by name.
   *
   * @param name - The renderer name
   * @returns The renderer definition or undefined
   */
  get<Props = unknown, Result = string>(name: string): RendererDefinition<Props, Result> | undefined;

  /**
   * Get the default renderer for an output type.
   *
   * @param outputType - The output type
   * @returns The default renderer or undefined
   */
  getDefault<Props = unknown, Result = string>(
    outputType: RendererOutputType,
  ): RendererDefinition<Props, Result> | undefined;

  /**
   * Check if a renderer exists.
   *
   * @param name - The renderer name
   * @returns True if renderer exists
   */
  has(name: string): boolean;

  /**
   * List all registered renderer names.
   *
   * @returns Array of renderer names
   */
  list(): string[];

  /**
   * List renderers by output type.
   *
   * @param outputType - The output type to filter by
   * @returns Array of renderer definitions
   */
  listByOutputType(outputType: RendererOutputType): RendererDefinition<unknown, unknown>[];

  /**
   * Remove a renderer.
   *
   * @param name - The renderer name
   * @returns True if removed
   */
  remove(name: string): boolean;

  /**
   * Clear all renderers.
   */
  clear(): void;

  /**
   * Render using a specific renderer.
   *
   * @param rendererName - The renderer name
   * @param props - The props to render
   * @param context - Optional render context
   * @returns The rendered output
   */
  render<Props = unknown, Result = string>(
    rendererName: string,
    props: Props,
    context?: RenderContext,
  ): Result | Promise<Result>;
}
