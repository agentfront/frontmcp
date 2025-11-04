import 'reflect-metadata';
import { FrontMcpToolTokens } from '../tokens';
import { ToolMetadata, frontMcpToolMetadataSchema } from '../metadata';
import z from 'zod';

/**
 * Decorator that marks a class as a McpTool module and provides metadata
 */
function FrontMcpTool(providedMetadata: ToolMetadata): ClassDecorator {

  return (target: any) => {
    const metadata = frontMcpToolMetadataSchema.parse(providedMetadata);

    Reflect.defineMetadata(FrontMcpToolTokens.type, true, target);

    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpToolTokens[property] ?? property, metadata[property], target);
    }
  };
}


export type FrontMcpToolExecuteHandler<In, Out> = (input: In, ...tokens: any[]) => Out | Promise<Out>;

/**
 * Decorator that marks a class as a McpTool module and provides metadata
 */
function frontMcpTool<T extends ToolMetadata,
  In = z.baseObjectInputType<T['inputSchema']>,
  Out = T['outputSchema'] extends z.ZodRawShape ? z.baseObjectInputType<T['outputSchema']> : unknown
>(providedMetadata: T): (handler: FrontMcpToolExecuteHandler<In, Out>) => (() => void) {
  return (execute) => {
    const metadata = frontMcpToolMetadataSchema.parse(providedMetadata);
    const toolFunction = function() {
      return execute;
    };
    Object.assign(toolFunction, {
      [FrontMcpToolTokens.type]: 'function-tool',
      [FrontMcpToolTokens.metadata]: metadata,
    });
    return toolFunction;
  };
}

export {
  FrontMcpTool,
  FrontMcpTool as Tool,
  frontMcpTool,
  frontMcpTool as tool,
};