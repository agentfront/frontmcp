import 'reflect-metadata';

import { frontMcpAdapterMetadataSchema, type AdapterMetadata } from '../metadata';
import { FrontMcpAdapterTokens } from '../tokens';

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

export { FrontMcpAdapter, FrontMcpAdapter as Adapter };
