import 'reflect-metadata';
import {
  FrontMcpResourceTokens,
  FrontMcpResourceTemplateTokens,
} from '../tokens';
import {
  frontMcpResourceMetadataSchema,
  frontMcpResourceTemplateMetadataSchema,
  ResourceMetadata,
  ResourceTemplateMetadata,
} from '../metadata';

import {
  ReadResourceRequest,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';

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

/**
 * Decorator that marks a class as a McpResource module and provides metadata
 */
function frontMcpResource<T extends ResourceMetadata>(providedMetadata: T): (handler: FrontMcpResourceExecuteHandler) => (() => void) {
  return (execute) => {
    const metadata = frontMcpResourceMetadataSchema.parse(providedMetadata);
    const toolFunction = function () {
      return execute;
    };
    Object.assign(toolFunction, {
      [FrontMcpResourceTokens.type]: 'function-resource',
      [FrontMcpResourceTokens.metadata]: metadata,
    });
    return toolFunction;
  };
}

//
// /**
//  * Decorator that marks a class as a McpResource module and provides metadata
//  */
// function frontMcpResourceTemplate<T extends ResourceMetadata>(providedMetadata: T): (handler: FrontMcpResourceExecuteHandler) => (() => void) {
//   return (execute) => {
//     const metadata = frontMcpResourceMetadataSchema.parse(providedMetadata);
//     const toolFunction = function() {
//       return execute;
//     };
//     Object.assign(toolFunction, {
//       [FrontMcpResourceTokens.type]: 'function-resource',
//       [FrontMcpResourceTokens.metadata]: metadata,
//     });
//     return toolFunction;
//   };
// }


export {
  FrontMcpResource,
  FrontMcpResource as Resource,
  FrontMcpResourceTemplate,
  FrontMcpResourceTemplate as ResourceTemplate,
  frontMcpResource,
  frontMcpResource as resource,
};