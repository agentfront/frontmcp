import 'reflect-metadata';
import { FrontMcpTokens } from '../tokens';
import { FrontMcpMetadata, frontMcpMetadataSchema } from '../metadata';
import { FrontMcpInstance } from '../../front-mcp';

/**
 * Decorator that marks a class as a FrontMcp Server and provides metadata
 */
export function FrontMcp(providedMetadata: FrontMcpMetadata): ClassDecorator {
  return (target: Function) => {
    const { error, data: metadata } = frontMcpMetadataSchema.safeParse(providedMetadata);
    if (error) {
      if (error.format().apps) {
        throw new Error(
          `Invalid metadata provided to @FrontMcp { apps: [?] }: \n${JSON.stringify(error.format().apps, null, 2)}`,
        );
      }
      if (error.format().providers) {
        throw new Error(
          `Invalid metadata provided to @FrontMcp { providers: [?] }: \n${JSON.stringify(
            error.format().providers,
            null,
            2,
          )}`,
        );
      }
      const loggingFormat = error.format()['logging'] as Record<string, unknown> | undefined;
      if (loggingFormat?.['transports']) {
        throw new Error(
          `Invalid metadata provided to @FrontMcp { logging: { transports: [?] } }: \n${JSON.stringify(
            loggingFormat['transports'],
            null,
            2,
          )}`,
        );
      }
      throw error;
    }

    Reflect.defineMetadata(FrontMcpTokens.type, true, target);
    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpTokens[property] ?? property, metadata[property], target);
    }

    if (metadata.serve) {
      const sdk = '@frontmcp/sdk';
      import(sdk).then(({ FrontMcpInstance }) => {
        if (!FrontMcpInstance) {
          throw new Error(`${sdk} version mismatch, make sure you have the same version for all @frontmcp/* packages`);
        }

        FrontMcpInstance.bootstrap(metadata);
      });
    }
  };
}
