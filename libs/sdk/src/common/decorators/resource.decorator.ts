import 'reflect-metadata';
import { FrontMcpResourceTokens, FrontMcpResourceTemplateTokens } from '../tokens';
import {
  frontMcpResourceMetadataSchema,
  frontMcpResourceTemplateMetadataSchema,
  ResourceMetadata,
  ResourceTemplateMetadata,
} from '../metadata';

import { ReadResourceRequest, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Decorator that marks a class as a McpResource module and provides metadata
 */
function FrontMcpResource(providedMetadata: ResourceMetadata): ClassDecorator {
  return (target: Function) => {
    const metadata = frontMcpResourceMetadataSchema.parse(providedMetadata);

    Reflect.defineMetadata(FrontMcpResourceTokens.type, true, target);

    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpResourceTokens[property] ?? property, metadata[property], target);
    }
  };
}

/**
 * Decorator that marks a class as a McpResourceTemplate module and provides metadata
 */
function FrontMcpResourceTemplate(providedMetadata: ResourceTemplateMetadata): ClassDecorator {
  return (target: Function) => {
    const metadata = frontMcpResourceTemplateMetadataSchema.parse(providedMetadata);

    Reflect.defineMetadata(FrontMcpResourceTemplateTokens.type, true, target);

    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpResourceTemplateTokens[property] ?? property, metadata[property], target);
    }
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
  return (execute) => {
    const metadata = frontMcpResourceMetadataSchema.parse(providedMetadata);
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
  return (execute) => {
    const metadata = frontMcpResourceTemplateMetadataSchema.parse(providedMetadata);
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

export {
  FrontMcpResource,
  FrontMcpResource as Resource,
  FrontMcpResourceTemplate,
  FrontMcpResourceTemplate as ResourceTemplate,
  frontMcpResource,
  frontMcpResource as resource,
  frontMcpResourceTemplate,
  frontMcpResourceTemplate as resourceTemplate,
};
