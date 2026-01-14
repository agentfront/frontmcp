import 'reflect-metadata';
import { FrontMcpTokens } from '../tokens';
import { FrontMcpMetadata, frontMcpMetadataSchema } from '../metadata';
import { InternalMcpError } from '../../errors/mcp.error';

// Lazy imports to avoid circular dependency with @frontmcp/sdk package entry point.
// Uses direct relative paths instead of require('@frontmcp/sdk') which would create
// a circular dependency since index.ts exports this decorator.

let _FrontMcpInstance: typeof import('../../front-mcp').FrontMcpInstance | null = null;
function getFrontMcpInstance() {
  if (!_FrontMcpInstance) {
    _FrontMcpInstance = require('../../front-mcp').FrontMcpInstance;
  }
  if (!_FrontMcpInstance) {
    throw new InternalMcpError('FrontMcpInstance not found in module', 'MODULE_LOAD_FAILED');
  }
  return _FrontMcpInstance;
}

// Lazy import for serverless handler functions
type ServerlessHandlerFns = {
  setServerlessHandler: (handler: unknown) => void;
  setServerlessHandlerPromise: (promise: Promise<unknown>) => void;
  setServerlessHandlerError: (error: Error) => void;
};
let _serverlessHandlerFns: ServerlessHandlerFns | null = null;

function getServerlessHandlerFns(): ServerlessHandlerFns {
  if (!_serverlessHandlerFns) {
    _serverlessHandlerFns = require('../../front-mcp/serverless-handler');
  }
  if (!_serverlessHandlerFns) {
    throw new InternalMcpError('Serverless handler functions not found', 'MODULE_LOAD_FAILED');
  }
  return _serverlessHandlerFns;
}

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
      // Uses direct relative imports to avoid circular dependency with @frontmcp/sdk
      const ServerlessInstance = getFrontMcpInstance();
      const { setServerlessHandler, setServerlessHandlerPromise, setServerlessHandlerError } =
        getServerlessHandlerFns();

      const handlerPromise = ServerlessInstance.createHandler(metadata);
      setServerlessHandlerPromise(handlerPromise);
      handlerPromise.then(setServerlessHandler).catch((err: unknown) => {
        const e = err instanceof Error ? err : new InternalMcpError(String(err), 'SERVERLESS_INIT_FAILED');
        setServerlessHandlerError(e);
        console.error('[FrontMCP] Serverless initialization failed:', e);
      });
    } else if (metadata.serve) {
      // Normal mode: bootstrap and start server
      // Use lazy require to avoid circular dependency and dual-package hazard
      getFrontMcpInstance().bootstrap(metadata);
    }
  };
}
