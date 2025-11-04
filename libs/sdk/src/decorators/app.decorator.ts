import 'reflect-metadata';
import { FrontMcpLocalAppTokens } from '../tokens';
import { LocalAppMetadata, frontMcpLocalAppMetadataSchema } from '../metadata';

/**
 * Decorator that marks a class as a McpApp module and provides metadata
 */
function FrontMcpApp(providedMetadata: LocalAppMetadata): ClassDecorator {
  return (target: Function) => {

    const { error, data: metadata } = frontMcpLocalAppMetadataSchema.safeParse(providedMetadata);
    if (error) {
      if (error.format().plugins) {
        throw new Error(`Invalid metadata provided to @FrontMcp { plugins: [?] }: \n${JSON.stringify(error.format().plugins, null, 2)}`);
      }
      if (error.format().providers) {
        throw new Error(`Invalid metadata provided to @FrontMcp { providers: [?] }: \n${JSON.stringify(error.format().providers, null, 2)}`);
      }
      if (error.format().authProviders) {
        throw new Error(`Invalid metadata provided to @FrontMcp { authProviders: [?] }: \n${JSON.stringify(error.format().authProviders, null, 2)}`);
      }
      if (error.format().adapters) {
        throw new Error(`Invalid metadata provided to @FrontMcp { adapters: [?] }: \n${JSON.stringify(error.format().adapters, null, 2)}`);
      }
      if (error.format().tools) {
        throw new Error(`Invalid metadata provided to @FrontMcp { tools: [?] }: \n${JSON.stringify(error.format().tools, null, 2)}`);
      }
      if (error.format().resources) {
        throw new Error(`Invalid metadata provided to @FrontMcp { resources: [?] }: \n${JSON.stringify(error.format().resources, null, 2)}`);
      }
      if (error.format().prompts) {
        throw new Error(`Invalid metadata provided to @FrontMcp { prompts: [?] }: \n${JSON.stringify(error.format().prompts, null, 2)}`);
      }
      throw error;
    }

    Reflect.defineMetadata(FrontMcpLocalAppTokens.type, true, target);
    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpLocalAppTokens[property] ?? property, metadata[property], target);
    }
  };
}

export {
  FrontMcpApp,
  FrontMcpApp as App,
};