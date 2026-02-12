// file: libs/sdk/src/resource/resource.utils.ts

import { Token, Type, depsOfClass, depsOfFunc, isClass, getMetadata } from '@frontmcp/di';
import {
  ResourceMetadata,
  ResourceTemplateMetadata,
  FrontMcpResourceTokens,
  FrontMcpResourceTemplateTokens,
  extendedResourceMetadata,
  extendedResourceTemplateMetadata,
  ResourceType,
  ResourceRecord,
  ResourceKind,
  ResourceTemplateRecord,
  ResourceTemplateKind,
  ResourceEntry,
} from '../common';
import { ResourceTemplateType } from './resource.types';
import { InvalidEntityError } from '../errors';

/**
 * Collect metadata from a class decorated with @FrontMcpResource
 */
export function collectResourceMetadata(cls: ResourceType): ResourceMetadata {
  const extended = getMetadata(extendedResourceMetadata, cls);
  const seed = (extended ? { ...extended } : {}) as ResourceMetadata;
  return Object.entries(FrontMcpResourceTokens).reduce((metadata, [key, token]) => {
    const value = getMetadata(token, cls);
    if (value !== undefined) {
      return Object.assign(metadata, {
        [key]: value,
      });
    }
    return metadata;
  }, seed);
}

/**
 * Collect metadata from a class decorated with @FrontMcpResourceTemplate
 */
export function collectResourceTemplateMetadata(cls: ResourceTemplateType): ResourceTemplateMetadata {
  const extended = getMetadata(extendedResourceTemplateMetadata, cls);
  const seed = (extended ? { ...extended } : {}) as ResourceTemplateMetadata;
  return Object.entries(FrontMcpResourceTemplateTokens).reduce((metadata, [key, token]) => {
    const value = getMetadata(token, cls);
    if (value !== undefined) {
      return Object.assign(metadata, {
        [key]: value,
      });
    }
    return metadata;
  }, seed);
}

/**
 * Normalize any resource input (class or function) to a ResourceRecord
 */
export function normalizeResource(item: any): ResourceRecord {
  // Function-style decorator: resource({ uri: '...' })(handler)
  if (
    item &&
    typeof item === 'function' &&
    item[FrontMcpResourceTokens.type] === 'function-resource' &&
    item[FrontMcpResourceTokens.metadata]
  ) {
    return {
      kind: ResourceKind.FUNCTION,
      provide: item(),
      metadata: item[FrontMcpResourceTokens.metadata] as ResourceMetadata,
    };
  }

  // Class-style decorator: @FrontMcpResource({ uri: '...' })
  if (isClass(item)) {
    const metadata = collectResourceMetadata(item as ResourceType);
    return { kind: ResourceKind.CLASS_TOKEN, provide: item as Type<ResourceEntry>, metadata };
  }

  const name = (item as any)?.name ?? String(item);
  throw new InvalidEntityError('resource', name, 'a class or a resource function');
}

/**
 * Normalize any resource template input (class or function) to a ResourceTemplateRecord
 */
export function normalizeResourceTemplate(item: any): ResourceTemplateRecord {
  // Function-style decorator: resourceTemplate({ uriTemplate: '...' })(handler)
  if (
    item &&
    typeof item === 'function' &&
    item[FrontMcpResourceTemplateTokens.type] === 'function-resource-template' &&
    item[FrontMcpResourceTemplateTokens.metadata]
  ) {
    return {
      kind: ResourceTemplateKind.FUNCTION,
      provide: item(),
      metadata: item[FrontMcpResourceTemplateTokens.metadata] as ResourceTemplateMetadata,
    };
  }

  // Class-style decorator: @FrontMcpResourceTemplate({ uriTemplate: '...' })
  if (isClass(item)) {
    const metadata = collectResourceTemplateMetadata(item as ResourceTemplateType);
    return { kind: ResourceTemplateKind.CLASS_TOKEN, provide: item as Type<ResourceEntry>, metadata };
  }

  const name = (item as any)?.name ?? String(item);
  throw new InvalidEntityError('resource template', name, 'a class or a resource template function');
}

/**
 * Determine if an item is a resource template (vs static resource)
 */
export function isResourceTemplate(item: any): boolean {
  // Function-style template
  if (
    item &&
    typeof item === 'function' &&
    item[FrontMcpResourceTemplateTokens.type] === 'function-resource-template'
  ) {
    return true;
  }

  // Class-style: check if it has uriTemplate metadata
  if (isClass(item)) {
    const uriTemplate = getMetadata(FrontMcpResourceTemplateTokens.uriTemplate, item);
    return uriTemplate !== undefined;
  }

  return false;
}

/**
 * Get dependency tokens for graph/cycle detection
 */
export function resourceDiscoveryDeps(rec: ResourceRecord | ResourceTemplateRecord): Token[] {
  switch (rec.kind) {
    case ResourceKind.FUNCTION:
    case ResourceTemplateKind.FUNCTION:
      return depsOfFunc(rec.provide, 'discovery');
    case ResourceKind.CLASS_TOKEN:
    case ResourceTemplateKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');
  }
}
