import 'reflect-metadata';

import { frontMcpLogTransportMetadataSchema, type LogTransportMetadata } from '../metadata';
import { FrontMcpLogTransportTokens } from '../tokens';

/**
 * Decorator that marks a class as a FrontMcpLogger module and provides metadata
 */
function FrontMcpLogTransport(providedMetadata: LogTransportMetadata): ClassDecorator {
  return (target: Function) => {
    const { error, data: metadata } = frontMcpLogTransportMetadataSchema.safeParse(providedMetadata);

    Reflect.defineMetadata(FrontMcpLogTransportTokens.type, true, target);
    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpLogTransportTokens[property] ?? property, metadata[property], target);
    }
  };
}

export { FrontMcpLogTransport, FrontMcpLogTransport as LogTransport };
