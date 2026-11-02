import 'reflect-metadata';

import { type ReadResourceRequest, type ReadResourceResult } from '@frontmcp/protocol';

import { parsePackageSpecifier } from '../../esm-loader/package-specifier';
import {
  registerWorkerResourceClass,
  registerWorkerResourceHandler,
  type WorkerResourceClass,
} from '../../offload/worker-resources';
import { type ResourceContext } from '../interfaces';
// ═══════════════════════════════════════════════════════════════════
// STATIC METHODS: Resource.esm() and Resource.remote()
// ═══════════════════════════════════════════════════════════════════
import {
  frontMcpResourceMetadataSchema,
  frontMcpResourceTemplateMetadataSchema,
  type EsmOptions,
  type RemoteOptions,
  type ResourceMetadata,
  type ResourceTemplateMetadata,
} from '../metadata';
import { ResourceKind, type ResourceEsmTargetRecord, type ResourceRemoteRecord } from '../records/resource.record';
import {
  extendedResourceMetadata,
  extendedResourceTemplateMetadata,
  FrontMcpResourceTemplateTokens,
  FrontMcpResourceTokens,
} from '../tokens';
import { captureCallerFile } from '../utils/caller-dir.utils';
import { validateRemoteUrl } from '../utils/validate-remote-url';

/** Basenames of THIS decorator file, skipped so the captured frame is the module that declares the resource. */
const RESOURCE_DECORATOR_BASENAMES = [
  'resource.decorator.ts',
  'resource.decorator.js',
  'resource.decorator.mjs',
  'resource.decorator.cjs',
];

/** The module a `worker: true` resource is declared in, which its worker imports to read it. */
function workerModuleOf(metadata: { worker?: unknown }): string | undefined {
  return metadata.worker ? captureCallerFile(RESOURCE_DECORATOR_BASENAMES) : undefined;
}

/**
 * Decorator that marks a class as a McpResource module and provides metadata
 */
function FrontMcpResource(providedMetadata: ResourceMetadata): ClassDecorator {
  const workerModule = workerModuleOf(providedMetadata);
  return (target: Function) => {
    const metadata = frontMcpResourceMetadataSchema.parse(providedMetadata);
    if (metadata.worker) registerWorkerResourceClass(target as WorkerResourceClass, metadata, workerModule);

    Reflect.defineMetadata(FrontMcpResourceTokens.type, true, target);

    const extended: Record<string, unknown> = {};
    for (const property in metadata) {
      if (FrontMcpResourceTokens[property]) {
        Reflect.defineMetadata(FrontMcpResourceTokens[property], metadata[property], target);
      } else {
        extended[property] = metadata[property];
      }
    }
    Reflect.defineMetadata(extendedResourceMetadata, extended, target);
  };
}

/**
 * Decorator that marks a class as a McpResourceTemplate module and provides metadata
 */
function FrontMcpResourceTemplate(providedMetadata: ResourceTemplateMetadata): ClassDecorator {
  const workerModule = workerModuleOf(providedMetadata);
  return (target: Function) => {
    const metadata = frontMcpResourceTemplateMetadataSchema.parse(providedMetadata);
    if (metadata.worker) registerWorkerResourceClass(target as WorkerResourceClass, metadata, workerModule);

    Reflect.defineMetadata(FrontMcpResourceTemplateTokens.type, true, target);

    const extended: Record<string, unknown> = Object.create(null);
    for (const property in metadata) {
      if (Object.prototype.hasOwnProperty.call(FrontMcpResourceTemplateTokens, property)) {
        Reflect.defineMetadata(FrontMcpResourceTemplateTokens[property], metadata[property], target);
      } else {
        extended[property] = metadata[property];
      }
    }
    Reflect.defineMetadata(extendedResourceTemplateMetadata, extended, target);
  };
}

export type FrontMcpResourceExecuteHandler = (
  uri: ReadResourceRequest['params']['uri'],
  ...tokens: any[]
) => ReadResourceResult | Promise<ReadResourceResult>;

export type FrontMcpResourceTemplateExecuteHandler = (
  uri: ReadResourceRequest['params']['uri'],
  params: Record<string, string>,
  ...tokens: any[]
) => ReadResourceResult | Promise<ReadResourceResult>;

/**
 * Function builder that creates a function-style static resource.
 * Use for simple resources that don't need class-based context.
 *
 * @example
 * ```ts
 * const AppConfig = resource({
 *   name: 'app-config',
 *   uri: 'config://app',
 *   mimeType: 'application/json',
 * })((uri) => ({
 *   contents: [{ uri, text: JSON.stringify({ version: '1.0.0' }) }]
 * }));
 * ```
 */
function frontMcpResource<T extends ResourceMetadata>(
  providedMetadata: T,
): (handler: FrontMcpResourceExecuteHandler) => () => FrontMcpResourceExecuteHandler {
  const workerModule = workerModuleOf(providedMetadata);
  return (execute) => {
    const metadata = frontMcpResourceMetadataSchema.parse(providedMetadata);
    if (metadata.worker) registerWorkerResourceHandler(execute, metadata, workerModule);
    const resourceFunction = function () {
      return execute;
    };
    Object.assign(resourceFunction, {
      [FrontMcpResourceTokens.type]: 'function-resource',
      [FrontMcpResourceTokens.metadata]: metadata,
    });
    return resourceFunction;
  };
}

/**
 * Function builder that creates a function-style resource template.
 * Use for simple templated resources that don't need class-based context.
 *
 * @example
 * ```ts
 * const UserProfile = resourceTemplate({
 *   name: 'user-profile',
 *   uriTemplate: 'users://{userId}/profile',
 *   mimeType: 'application/json',
 * })((uri, params) => ({
 *   contents: [{ uri, text: JSON.stringify({ id: params.userId }) }]
 * }));
 * ```
 */
function frontMcpResourceTemplate<T extends ResourceTemplateMetadata>(
  providedMetadata: T,
): (handler: FrontMcpResourceTemplateExecuteHandler) => () => FrontMcpResourceTemplateExecuteHandler {
  const workerModule = workerModuleOf(providedMetadata);
  return (execute) => {
    const metadata = frontMcpResourceTemplateMetadataSchema.parse(providedMetadata);
    if (metadata.worker) registerWorkerResourceHandler(execute, metadata, workerModule);
    const resourceFunction = function () {
      return execute;
    };
    Object.assign(resourceFunction, {
      [FrontMcpResourceTemplateTokens.type]: 'function-resource-template',
      [FrontMcpResourceTemplateTokens.metadata]: metadata,
    });
    return resourceFunction;
  };
}

function resourceEsm(
  specifier: string,
  targetName: string,
  options?: EsmOptions<ResourceMetadata>,
): ResourceEsmTargetRecord {
  const parsed = parsePackageSpecifier(specifier);
  return {
    kind: ResourceKind.ESM,
    provide: Symbol(`esm-resource:${parsed.fullName}:${targetName}`),
    specifier: parsed,
    targetName,
    options,
    metadata: {
      name: targetName,
      description: `Resource "${targetName}" from ${parsed.fullName}`,
      uri: `esm://${targetName}`,
      ...options?.metadata,
    },
  };
}

function resourceRemote(
  url: string,
  targetName: string,
  options?: RemoteOptions<ResourceMetadata>,
): ResourceRemoteRecord {
  validateRemoteUrl(url);
  return {
    kind: ResourceKind.REMOTE,
    provide: Symbol(`remote-resource:${url}:${targetName}`),
    url,
    targetName,
    transportOptions: options?.transportOptions,
    remoteAuth: options?.remoteAuth,
    options,
    metadata: {
      name: targetName,
      description: `Remote resource "${targetName}" from ${url}`,
      uri: `remote://${targetName}`,
      ...options?.metadata,
    },
  };
}

Object.assign(FrontMcpResource, {
  esm: resourceEsm,
  remote: resourceRemote,
});

// ============================================================================
// Type Checking Helpers
// ============================================================================

// ---------- ctor & reflection ----------
type __Ctor = (new (...a: any[]) => any) | (abstract new (...a: any[]) => any);
type __R<C extends __Ctor> = C extends new (...a: any[]) => infer R
  ? R
  : C extends abstract new (...a: any[]) => infer R
    ? R
    : never;

// ---------- friendly branded errors ----------
type __MustExtendResourceCtx<C extends __Ctor> =
  __R<C> extends ResourceContext ? unknown : { 'Resource class error': 'Class must extend ResourceContext' };

type ResourceDecorator = {
  (metadata: ResourceMetadata): <C extends __Ctor>(cls: C & __MustExtendResourceCtx<C>) => C;
  esm: typeof resourceEsm;
  remote: typeof resourceRemote;
};

type ResourceTemplateDecorator = {
  (metadata: ResourceTemplateMetadata): <C extends __Ctor>(cls: C & __MustExtendResourceCtx<C>) => C;
};

const Resource = FrontMcpResource as unknown as ResourceDecorator;
const _ResourceTemplate = FrontMcpResourceTemplate as unknown as ResourceTemplateDecorator;

export {
  FrontMcpResource,
  Resource,
  FrontMcpResourceTemplate,
  _ResourceTemplate as ResourceTemplate,
  frontMcpResource,
  frontMcpResource as resource,
  frontMcpResourceTemplate,
  frontMcpResourceTemplate as resourceTemplate,
};
