// file: libs/sdk/src/resource/resource.utils.ts

import { depsOfClass, depsOfFunc, getMetadata, isClass, type Token, type Type } from '@frontmcp/di';

import {
  extendedResourceMetadata,
  extendedResourceTemplateMetadata,
  FrontMcpResourceTemplateTokens,
  FrontMcpResourceTokens,
  ResourceKind,
  ResourceTemplateKind,
  type ResourceEntry,
  type ResourceMetadata,
  type ResourceRecord,
  type ResourceTemplateMetadata,
  type ResourceTemplateRecord,
  type ResourceType,
} from '../common';
import { InvalidEntityError } from '../errors';
import { type ResourceTemplateType } from './resource.types';

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
  // Pre-built record objects: ESM, REMOTE, FUNCTION, or CLASS_TOKEN.
  // FrontMCP internals (e.g. SEP-2640 per-skill registration) build
  // FUNCTION records directly to attach SEP-conformant metadata. We
  // validate the kind-specific shape here so malformed records fail at
  // registration time rather than at first read.
  if (
    item &&
    typeof item === 'object' &&
    (item.kind === ResourceKind.ESM ||
      item.kind === ResourceKind.REMOTE ||
      item.kind === ResourceKind.FUNCTION ||
      item.kind === ResourceKind.CLASS_TOKEN)
  ) {
    if (item.provide == null || typeof item.metadata !== 'object' || item.metadata === null) {
      throw new InvalidEntityError(
        'resource',
        String(item.metadata?.name ?? item.metadata?.uri ?? 'unknown'),
        `a pre-built ResourceRecord with both 'provide' and 'metadata' set (kind: ${item.kind})`,
      );
    }
    if (item.kind === ResourceKind.FUNCTION && typeof item.provide !== 'function') {
      throw new InvalidEntityError(
        'resource',
        String(item.metadata?.name ?? item.metadata?.uri ?? 'unknown'),
        "a FUNCTION ResourceRecord whose 'provide' is a function",
      );
    }
    if (
      (item.kind === ResourceKind.ESM || item.kind === ResourceKind.REMOTE) &&
      (typeof item.provide !== 'string' || item.provide.length === 0) &&
      typeof item.provide !== 'symbol'
    ) {
      throw new InvalidEntityError(
        'resource',
        String(item.metadata?.name ?? item.metadata?.uri ?? 'unknown'),
        `a ${item.kind} ResourceRecord whose 'provide' is a non-empty string or symbol token`,
      );
    }
    if (item.kind === ResourceKind.CLASS_TOKEN && typeof item.provide !== 'function') {
      throw new InvalidEntityError(
        'resource',
        String(item.metadata?.name ?? item.metadata?.uri ?? 'unknown'),
        "a CLASS_TOKEN ResourceRecord whose 'provide' is a class constructor",
      );
    }
    return item as ResourceRecord;
  }

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
  // Pre-built template records (kind: TemplateKind.FUNCTION/CLASS_TOKEN)
  // — same shape validation as `normalizeResource` for static records.
  if (
    item &&
    typeof item === 'object' &&
    (item.kind === ResourceTemplateKind.FUNCTION || item.kind === ResourceTemplateKind.CLASS_TOKEN)
  ) {
    if (item.provide == null || typeof item.metadata !== 'object' || item.metadata === null) {
      throw new InvalidEntityError(
        'resource template',
        String(item.metadata?.name ?? item.metadata?.uriTemplate ?? 'unknown'),
        `a pre-built ResourceTemplateRecord with both 'provide' and 'metadata' set (kind: ${item.kind})`,
      );
    }
    if (item.kind === ResourceTemplateKind.FUNCTION && typeof item.provide !== 'function') {
      throw new InvalidEntityError(
        'resource template',
        String(item.metadata?.name ?? item.metadata?.uriTemplate ?? 'unknown'),
        "a FUNCTION ResourceTemplateRecord whose 'provide' is a function",
      );
    }
    if (item.kind === ResourceTemplateKind.CLASS_TOKEN && typeof item.provide !== 'function') {
      throw new InvalidEntityError(
        'resource template',
        String(item.metadata?.name ?? item.metadata?.uriTemplate ?? 'unknown'),
        "a CLASS_TOKEN ResourceTemplateRecord whose 'provide' is a class constructor",
      );
    }
    return item as ResourceTemplateRecord;
  }

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
    case ResourceKind.ESM:
    case ResourceKind.REMOTE:
      // External packages/services have no local DI dependencies at discovery time
      return [];
  }
}
