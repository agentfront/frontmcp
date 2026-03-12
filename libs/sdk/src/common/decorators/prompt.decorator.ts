import 'reflect-metadata';
import { FrontMcpPromptTokens, extendedPromptMetadata } from '../tokens';
import { PromptMetadata, frontMcpPromptMetadataSchema } from '../metadata';
import { GetPromptResult, GetPromptRequest } from '@frontmcp/protocol';

/**
 * Decorator that marks a class as a McpPrompt module and provides metadata
 */
function FrontMcpPrompt(providedMetadata: PromptMetadata): ClassDecorator {
  return (target: Function) => {
    const metadata = frontMcpPromptMetadataSchema.parse(providedMetadata);

    Reflect.defineMetadata(FrontMcpPromptTokens.type, true, target);

    const extended: Record<string, unknown> = {};
    for (const property in metadata) {
      if (FrontMcpPromptTokens[property]) {
        Reflect.defineMetadata(FrontMcpPromptTokens[property], metadata[property], target);
      } else {
        extended[property] = metadata[property];
      }
    }
    Reflect.defineMetadata(extendedPromptMetadata, extended, target);
  };
}

export type FrontMcpPromptExecuteHandler = (
  args: GetPromptRequest['params']['arguments'],
  ...tokens: unknown[]
) => GetPromptResult | Promise<GetPromptResult>;

/**
 * Function-style prompt builder.
 * Returns a callable with attached metadata for registration.
 */
type FunctionalPromptResult = (() => FrontMcpPromptExecuteHandler) & {
  [key: symbol]: unknown;
};

function frontMcpPrompt<T extends PromptMetadata>(
  providedMetadata: T,
): (handler: FrontMcpPromptExecuteHandler) => FunctionalPromptResult {
  return (execute) => {
    const metadata = frontMcpPromptMetadataSchema.parse(providedMetadata);
    const toolFunction = function () {
      return execute;
    } as FunctionalPromptResult;
    Object.assign(toolFunction, {
      [FrontMcpPromptTokens.type]: 'function-prompt',
      [FrontMcpPromptTokens.metadata]: metadata,
    });
    return toolFunction;
  };
}

export { FrontMcpPrompt, FrontMcpPrompt as Prompt, frontMcpPrompt, frontMcpPrompt as prompt };
