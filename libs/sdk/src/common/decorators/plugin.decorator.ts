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
      if (error.format().providers) {
        throw new Error(`Invalid metadata provided to @FrontMcpProvider or @Provider: \n${JSON.stringify(error.formErrors.fieldErrors['providers'], null, 2)}`);
      }
      if (error.format().adapters) {
        throw new Error(`Invalid metadata provided to @FrontMcpAdapter or @Adapter: \n${JSON.stringify(error.format().adapters, null, 2)}`);
      }
      if (error.format().tools) {
        throw new Error(`Invalid metadata provided to @FrontMcpTool or @Tool: \n${JSON.stringify(error.format().tools, null, 2)}`);
      }
      if (error.format().resources) {
        throw new Error(`Invalid metadata provided to @FrontMcpResource or @Resource: \n${JSON.stringify(error.format().resources, null, 2)}`);
      }
      if (error.format().prompts) {
        throw new Error(`Invalid metadata provided to @FrontMcpPrompt or @Prompt: \n${JSON.stringify(error.format().prompts, null, 2)}`);
      }
      throw error;
    }

    Reflect.defineMetadata(FrontMcpPluginTokens.type, true, target);
    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpPluginTokens[property] ?? property, metadata[property], target);
    }
  };
}

export {
  FrontMcpPlugin,
  FrontMcpPlugin as Plugin,
};