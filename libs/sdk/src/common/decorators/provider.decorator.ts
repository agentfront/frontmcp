import 'reflect-metadata';
import { FrontMcpProviderTokens } from '../tokens';
import { frontMcpProviderMetadataSchema, ProviderMetadata } from '../metadata';

/**
 * Decorator that marks a class as a McpProvider module and provides metadata
 */
function FrontMcpProvider(providedMetadata: ProviderMetadata): ClassDecorator {
  return (target: Function) => {
    const metadata = frontMcpProviderMetadataSchema.parse(providedMetadata);

    Reflect.defineMetadata(FrontMcpProviderTokens.type, true, target);

    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpProviderTokens[property] ?? property, metadata[property], target);
    }
  };
}

export { FrontMcpProvider, FrontMcpProvider as Provider };
