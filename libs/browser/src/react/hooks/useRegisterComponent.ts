// file: libs/browser/src/react/hooks/useRegisterComponent.ts
/**
 * Hook for registering React components for AI discovery and rendering.
 *
 * @example
 * ```tsx
 * import { useRegisterComponent } from '@frontmcp/browser/react';
 * import { z } from 'zod';
 *
 * const DataTableSchema = z.object({
 *   data: z.array(z.record(z.string(), z.unknown())),
 *   columns: z.array(z.string()),
 *   sortable: z.boolean().optional(),
 * });
 *
 * function DataTable({ data, columns, sortable }: z.infer<typeof DataTableSchema>) {
 *   // Component implementation
 *   return <table>...</table>;
 * }
 *
 * function DataTableRegistration() {
 *   useRegisterComponent({
 *     name: 'DataTable',
 *     description: 'Displays tabular data with optional sorting',
 *     propsSchema: DataTableSchema,
 *     component: DataTable,
 *     category: 'display',
 *     tags: ['table', 'data', 'sortable'],
 *   });
 *
 *   return null;
 * }
 * ```
 */

import { useEffect, useCallback, type ComponentType } from 'react';
import type { z } from 'zod';
import { useFrontMcpContext } from '../context';
import type { ComponentCategory } from '../../registry';

/**
 * React component registration options.
 */
export interface ComponentRegistration<Props = unknown> {
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
   * The React component.
   */
  component: ComponentType<Props>;

  /**
   * Component category for organization.
   */
  category?: ComponentCategory;

  /**
   * Tags for filtering and search.
   */
  tags?: string[];

  /**
   * Default props values.
   */
  defaultProps?: Partial<Props>;

  /**
   * Usage examples.
   */
  examples?: Array<{
    name: string;
    description?: string;
    props: Props;
  }>;
}

/**
 * Return type for useRegisterComponent hook.
 */
export interface UseRegisterComponentResult {
  /**
   * Whether the component is registered.
   */
  isRegistered: boolean;

  /**
   * Unregister the component manually.
   */
  unregister: () => void;
}

/**
 * Hook to register a React component for AI discovery.
 *
 * The component will be registered in the component registry and can be
 * discovered by the AI via `resources/read { uri: 'components://list' }`.
 *
 * @param registration - Component registration options
 * @returns Registration status and utilities
 */
export function useRegisterComponent<Props = unknown>(
  registration: ComponentRegistration<Props>,
): UseRegisterComponentResult {
  const { componentRegistry } = useFrontMcpContext();

  const unregister = useCallback(() => {
    if (componentRegistry) {
      componentRegistry.remove(registration.name);
    }
  }, [componentRegistry, registration.name]);

  useEffect(() => {
    if (!componentRegistry) {
      return;
    }

    // Check if already registered
    if (componentRegistry.has(registration.name)) {
      // Already registered, skip
      return;
    }

    // Register the component
    componentRegistry.register({
      name: registration.name,
      description: registration.description,
      propsSchema: registration.propsSchema,
      category: registration.category,
      tags: registration.tags,
      defaultProps: registration.defaultProps,
      examples: registration.examples,
    });

    return () => {
      // Cleanup on unmount
      componentRegistry.remove(registration.name);
    };
  }, [
    componentRegistry,
    registration.name,
    registration.description,
    registration.propsSchema,
    registration.category,
    registration.tags,
    registration.defaultProps,
    registration.examples,
  ]);

  return {
    isRegistered: componentRegistry?.has(registration.name) ?? false,
    unregister,
  };
}

/**
 * Hook to get all registered components.
 *
 * @returns Array of registered component names and descriptions
 */
export function useRegisteredComponents(): Array<{
  name: string;
  description: string;
  category?: ComponentCategory;
  tags?: string[];
}> {
  const { componentRegistry } = useFrontMcpContext();

  if (!componentRegistry) {
    return [];
  }

  return componentRegistry.getAll().map((def) => ({
    name: def.name,
    description: def.description,
    category: def.category,
    tags: def.tags,
  }));
}

/**
 * Hook to search registered components.
 *
 * @param query - Search query
 * @returns Matching components
 */
export function useComponentSearch(query: string): Array<{
  name: string;
  description: string;
  category?: ComponentCategory;
  tags?: string[];
}> {
  const { componentRegistry } = useFrontMcpContext();

  if (!componentRegistry || !query) {
    return [];
  }

  return componentRegistry.search(query).map((def) => ({
    name: def.name,
    description: def.description,
    category: def.category,
    tags: def.tags,
  }));
}

/**
 * Hook to get components by category.
 *
 * @param category - Component category
 * @returns Components in the category
 */
export function useComponentsByCategory(category: ComponentCategory): Array<{
  name: string;
  description: string;
  tags?: string[];
}> {
  const { componentRegistry } = useFrontMcpContext();

  if (!componentRegistry) {
    return [];
  }

  return componentRegistry.listByCategory(category).map((def) => ({
    name: def.name,
    description: def.description,
    tags: def.tags,
  }));
}

/**
 * Hook to get components by tag.
 *
 * @param tag - Tag to filter by
 * @returns Components with the tag
 */
export function useComponentsByTag(tag: string): Array<{
  name: string;
  description: string;
  category?: ComponentCategory;
}> {
  const { componentRegistry } = useFrontMcpContext();

  if (!componentRegistry) {
    return [];
  }

  return componentRegistry.listByTag(tag).map((def) => ({
    name: def.name,
    description: def.description,
    category: def.category,
  }));
}
