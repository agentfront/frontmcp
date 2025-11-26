/// <reference types="jest" />
/**
 * Test fixtures for resources
 */

import { ResourceMetadata, ResourceTemplateMetadata } from '../../common/metadata';

/**
 * Simple test resource metadata
 */
export function createResourceMetadata(overrides: Partial<ResourceMetadata> = {}): ResourceMetadata {
  return {
    name: 'test-resource',
    uri: 'test://resource',
    ...overrides,
  };
}

/**
 * Simple test resource template metadata
 */
export function createResourceTemplateMetadata(
  overrides: Partial<ResourceTemplateMetadata> = {},
): ResourceTemplateMetadata {
  return {
    name: 'test-template',
    uriTemplate: 'test://resource/{id}',
    ...overrides,
  };
}

/**
 * Creates a docs resource metadata
 */
export function createDocsResourceMetadata(): ResourceMetadata {
  return {
    name: 'docs',
    title: 'Documentation',
    uri: 'docs://home',
    description: 'Application documentation',
    mimeType: 'text/markdown',
  };
}

/**
 * Creates a config resource metadata
 */
export function createConfigResourceMetadata(): ResourceMetadata {
  return {
    name: 'config',
    title: 'Configuration',
    uri: 'config://app',
    description: 'Application configuration',
    mimeType: 'application/json',
  };
}

/**
 * Creates a user profile template metadata
 */
export function createUserProfileTemplateMetadata(): ResourceTemplateMetadata {
  return {
    name: 'user-profile',
    title: 'User Profile',
    uriTemplate: 'users://{userId}/profile',
    description: 'User profile information',
    mimeType: 'application/json',
  };
}

/**
 * Creates a file template metadata
 */
export function createFileTemplateMetadata(): ResourceTemplateMetadata {
  return {
    name: 'file',
    title: 'File Content',
    uriTemplate: 'file://{path}',
    description: 'File contents',
  };
}

/**
 * Mock resource class for testing
 */
export class MockResourceClass {
  async execute(uri: string): Promise<{ text: string }> {
    return { text: `Content for ${uri}` };
  }
}

/**
 * Mock resource template class for testing
 */
export class MockResourceTemplateClass {
  async execute(uri: string, params: Record<string, string>): Promise<{ text: string }> {
    return { text: `Content for ${uri} with params: ${JSON.stringify(params)}` };
  }
}

/**
 * Mock resource instance for testing
 */
export function createMockResourceInstance(metadata?: Partial<ResourceMetadata>) {
  return {
    metadata: createResourceMetadata(metadata),
    execute: jest.fn(async (uri: string) => ({ text: `Content for ${uri}` })),
    isTemplate: false,
  };
}

/**
 * Mock resource template instance for testing
 */
export function createMockResourceTemplateInstance(metadata?: Partial<ResourceTemplateMetadata>) {
  return {
    metadata: createResourceTemplateMetadata(metadata),
    execute: jest.fn(async (uri: string, params: Record<string, string>) => ({
      text: `Content for ${uri} with params: ${JSON.stringify(params)}`,
    })),
    isTemplate: true,
  };
}
