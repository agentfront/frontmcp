import 'reflect-metadata';
import { FrontMcpPluginTokens } from '../tokens';
import { PluginMetadata, frontMcpPluginMetadataSchema } from '../metadata';

/**
 * Decorator that marks a class as a McpPlugin and provides metadata
 */
function FrontMcpPlugin(providedMetadata: PluginMetadata): ClassDecorator {
  return (target: Function) => {
    const { error, data: metadata } = frontMcpPluginMetadataSchema.safeParse(providedMetadata);
    if (error) {
      const formatted = error.format();
      if (formatted.providers) {
        throw new Error(
          `Invalid metadata provided to @FrontMcpProvider or @Provider: \n${JSON.stringify(
            formatted.providers,
            null,
            2,
          )}`,
        );
      }
      if (formatted.adapters) {
        throw new Error(
          `Invalid metadata provided to @FrontMcpAdapter or @Adapter: \n${JSON.stringify(formatted.adapters, null, 2)}`,
        );
      }
      if (formatted.tools) {
        throw new Error(
          `Invalid metadata provided to @FrontMcpTool or @Tool: \n${JSON.stringify(formatted.tools, null, 2)}`,
        );
      }
      if (formatted.resources) {
        throw new Error(
          `Invalid metadata provided to @FrontMcpResource or @Resource: \n${JSON.stringify(
            formatted.resources,
            null,
            2,
          )}`,
        );
      }
      if (formatted.prompts) {
        throw new Error(
          `Invalid metadata provided to @FrontMcpPrompt or @Prompt: \n${JSON.stringify(formatted.prompts, null, 2)}`,
        );
      }
      throw error;
    }

    Reflect.defineMetadata(FrontMcpPluginTokens.type, true, target);
    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpPluginTokens[property] ?? property, metadata[property], target);
    }
  };
}

export { FrontMcpPlugin, FrontMcpPlugin as Plugin };
