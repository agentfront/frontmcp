// file: libs/browser/src/registry/index.ts
/**
 * Component and renderer registries for browser MCP server.
 *
 * Provides UI component and output rendering capabilities.
 */

export type {
  ComponentCategory,
  ComponentExample,
  ComponentDefinition,
  RendererOutputType,
  RenderFunction,
  RenderContext,
  RendererDefinition,
  ComponentRegistryInterface,
  RendererRegistryInterface,
} from './types';

// Registry implementations
export { ComponentRegistry } from './component.registry';
export { RendererRegistry } from './renderer.registry';

// Instance registry
export {
  ComponentInstanceRegistry,
  createInstanceRegistry,
  type ComponentInstance,
  type CreateInstanceOptions,
  type InstanceQueryOptions,
  type InstanceRegistryOptions,
} from './instance.registry';
