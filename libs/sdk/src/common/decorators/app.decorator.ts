import 'reflect-metadata';
import { FrontMcpLocalAppTokens } from '../tokens';
import { LocalAppMetadata, frontMcpLocalAppMetadataSchema } from '../metadata';
import { InvalidDecoratorMetadataError } from '../../errors';

/**
 * Decorator that marks a class as a McpApp module and provides metadata
 */
function FrontMcpApp(providedMetadata: LocalAppMetadata): ClassDecorator {
  return (target: Function) => {
    const { error, data: metadata } = frontMcpLocalAppMetadataSchema.safeParse(providedMetadata);
    if (error) {
      const formatted = error.format();
      if (formatted.plugins) {
        throw new InvalidDecoratorMetadataError('App', 'plugins', JSON.stringify(formatted.plugins, null, 2));
      }
      if (formatted.providers) {
        throw new InvalidDecoratorMetadataError('App', 'providers', JSON.stringify(formatted.providers, null, 2));
      }
      if (formatted.authProviders) {
        throw new InvalidDecoratorMetadataError(
          'App',
          'authProviders',
          JSON.stringify(formatted.authProviders, null, 2),
        );
      }
      if (formatted.adapters) {
        throw new InvalidDecoratorMetadataError('App', 'adapters', JSON.stringify(formatted.adapters, null, 2));
      }
      if (formatted.tools) {
        throw new InvalidDecoratorMetadataError('App', 'tools', JSON.stringify(formatted.tools, null, 2));
      }
      if (formatted.resources) {
        throw new InvalidDecoratorMetadataError('App', 'resources', JSON.stringify(formatted.resources, null, 2));
      }
      if (formatted.prompts) {
        throw new InvalidDecoratorMetadataError('App', 'prompts', JSON.stringify(formatted.prompts, null, 2));
      }
      throw error;
    }

    Reflect.defineMetadata(FrontMcpLocalAppTokens.type, true, target);
    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpLocalAppTokens[property] ?? property, metadata[property], target);
    }
  };
}

export { FrontMcpApp, FrontMcpApp as App };
