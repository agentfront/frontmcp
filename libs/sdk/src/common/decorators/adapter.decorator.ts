import 'reflect-metadata';
import { FrontMcpAdapterTokens } from '../tokens';
import { AdapterMetadata, frontMcpAdapterMetadataSchema } from '../metadata';

/**
 * Decorator that marks a class as a McpAdapter module and provides metadata
 */
function FrontMcpAdapter(providedMetadata: AdapterMetadata): ClassDecorator {
  return (target: Function) => {
    const metadata = frontMcpAdapterMetadataSchema.parse(providedMetadata);

    Reflect.defineMetadata(FrontMcpAdapterTokens.type, true, target);

    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpAdapterTokens[property] ?? property, metadata[property], target);
    }
  };
}

export {
  FrontMcpAdapter,
  FrontMcpAdapter as Adapter,
};