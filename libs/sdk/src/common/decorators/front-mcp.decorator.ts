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

    // Safe check for serverless mode - process.env may not exist in Cloudflare Workers
    const isServerless = typeof process !== 'undefined' && process.env?.['FRONTMCP_SERVERLESS'] === '1';

    if (isServerless) {
      // Serverless mode: bootstrap, prepare (no listen), store handler globally
      const sdk = '@frontmcp/sdk';
      import(sdk)
        .then(({ FrontMcpInstance, setServerlessHandler, setServerlessHandlerPromise, setServerlessHandlerError }) => {
          if (!FrontMcpInstance) {
            throw new Error(
              `${sdk} version mismatch, make sure you have the same version for all @frontmcp/* packages`,
            );
          }

          const handlerPromise = FrontMcpInstance.createHandler(metadata);
          setServerlessHandlerPromise(handlerPromise);
          handlerPromise.then(setServerlessHandler).catch((err: unknown) => {
            const e = err instanceof Error ? err : new Error(String(err));
            setServerlessHandlerError(e);
            console.error('[FrontMCP] Serverless initialization failed:', e);
          });
        })
        .catch((err: unknown) => {
          console.error('[FrontMCP] Failed to import @frontmcp/sdk for serverless init:', err);
        });
    } else if (metadata.serve) {
      // Normal mode: bootstrap and start server
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
