import 'reflect-metadata';
import {
  FrontMcpPromptTokens,
} from '../tokens';
import {
  PromptMetadata,
  frontMcpPromptMetadataSchema,
} from '../metadata';
import { GetPromptResult, GetPromptRequest } from '@modelcontextprotocol/sdk/types.js';


/**
 * Decorator that marks a class as a McpPrompt module and provides metadata
 */
function FrontMcpPrompt(providedMetadata: PromptMetadata): ClassDecorator {
  return (target: Function) => {
    const metadata = frontMcpPromptMetadataSchema.parse(providedMetadata);

    Reflect.defineMetadata(FrontMcpPromptTokens.type, true, target);

    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpPromptTokens[property] ?? property, metadata[property], target);
    }
  };
}


export type FrontMcpPromptExecuteHandler = (
  args: GetPromptRequest['params']['arguments'],
  ...tokens: any[]
) => GetPromptResult | Promise<GetPromptResult>;

/**
 * Decorator that marks a class as a McpTool module and provides metadata
 */
function frontMcpPrompt<T extends PromptMetadata>(providedMetadata: T): (handler: FrontMcpPromptExecuteHandler) => (() => void) {
  return (execute) => {
    const metadata = frontMcpPromptMetadataSchema.parse(providedMetadata);
    const toolFunction = function() {
      return execute;
    };
    Object.assign(toolFunction, {
      [FrontMcpPromptTokens.type]: 'function-prompt',
      [FrontMcpPromptTokens.metadata]: metadata,
    });
    return toolFunction;
  };
}

export {
  FrontMcpPrompt,
  FrontMcpPrompt as Prompt,

  frontMcpPrompt,
  frontMcpPrompt as prompt,
};