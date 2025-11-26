/// <reference types="jest" />
/**
 * Mock factory for ResourceRegistry
 */

import { ResourceMetadata, ResourceTemplateMetadata } from '../../common/metadata';

/**
 * Creates a mock ResourceRegistry for testing
 */
export function createMockResourceRegistry(overrides: Partial<any> = {}) {
  const resources = new Map<string, any>();
  const templates = new Map<string, any>();

  return {
    resources,
    templates,
    ready: Promise.resolve(),

    getResources: jest.fn((includeHidden?: boolean) => {
      return Array.from(resources.values());
    }),

    getResourceTemplates: jest.fn(() => {
      return Array.from(templates.values());
    }),

    findByUri: jest.fn((uri: string) => {
      return resources.get(uri);
    }),

    matchTemplateByUri: jest.fn((uri: string) => {
      // Simple mock implementation - returns undefined by default
      return undefined;
    }),

    findResourceForUri: jest.fn((uri: string) => {
      const resource = resources.get(uri);
      if (resource) {
        return { instance: resource, params: {} };
      }
      return undefined;
    }),

    listAllIndexed: jest.fn(() => {
      const all: any[] = [];
      resources.forEach((r) => all.push(r));
      templates.forEach((t) => all.push(t));
      return all;
    }),

    exportResolvedNames: jest.fn((opts?: any) => {
      const result: Array<{ name: string; instance: any }> = [];
      resources.forEach((instance, name) => {
        result.push({ name, instance });
      });
      templates.forEach((instance, name) => {
        result.push({ name, instance });
      });
      return result;
    }),

    ...overrides,
  };
}

/**
 * Creates a mock resource entry
 */
export function createMockResourceEntry(
  name: string,
  uri: string,
  metadata?: Partial<ResourceMetadata>,
  execute?: (uri: string) => Promise<any>,
) {
  return {
    name,
    uri,
    isTemplate: false,
    metadata: {
      name,
      uri,
      description: `Mock resource: ${name}`,
      ...metadata,
    },
    execute: jest.fn(execute || (async (u: string) => ({ text: `Content from ${name}` }))),
    matchUri: jest.fn((u: string) => ({ matches: u === uri, params: {} })),
  };
}

/**
 * Creates a mock resource template entry
 */
export function createMockResourceTemplateEntry(
  name: string,
  uriTemplate: string,
  metadata?: Partial<ResourceTemplateMetadata>,
  execute?: (uri: string, params: Record<string, string>) => Promise<any>,
) {
  return {
    name,
    uriTemplate,
    isTemplate: true,
    metadata: {
      name,
      uriTemplate,
      description: `Mock template: ${name}`,
      ...metadata,
    },
    execute: jest.fn(
      execute || (async (u: string, params: Record<string, string>) => ({ text: `Content from ${name}` })),
    ),
    matchUri: jest.fn((u: string) => {
      // Simple mock - doesn't actually parse template
      return { matches: false, params: {} };
    }),
  };
}

/**
 * Adds a resource to a mock registry
 */
export function addResourceToMock(
  registry: ReturnType<typeof createMockResourceRegistry>,
  uri: string,
  resourceEntry: any,
) {
  registry.resources.set(uri, resourceEntry);
  registry.findByUri.mockImplementation((u: string) => {
    return registry.resources.get(u);
  });
  registry.findResourceForUri.mockImplementation((u: string) => {
    const resource = registry.resources.get(u);
    if (resource) {
      return { instance: resource, params: {} };
    }
    return undefined;
  });
}

/**
 * Adds a resource template to a mock registry
 */
export function addTemplateToMock(
  registry: ReturnType<typeof createMockResourceRegistry>,
  name: string,
  templateEntry: any,
) {
  registry.templates.set(name, templateEntry);
}
