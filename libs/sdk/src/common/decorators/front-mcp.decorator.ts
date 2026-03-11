import 'reflect-metadata';
import { FrontMcpTokens } from '../tokens';
import { FrontMcpMetadata, frontMcpMetadataSchema } from '../metadata';
import { getEnvFlag } from '@frontmcp/utils';
import { InternalMcpError } from '../../errors/mcp.error';
import { InvalidDecoratorMetadataError } from '../../errors/decorator.errors';

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
      const formatted = error.format();
      if (formatted.apps) {
        throw new InvalidDecoratorMetadataError('FrontMcp', 'apps', JSON.stringify(formatted.apps, null, 2));
      }
      if (formatted.providers) {
        throw new InvalidDecoratorMetadataError('FrontMcp', 'providers', JSON.stringify(formatted.providers, null, 2));
      }
      const loggingFormat = formatted['logging'] as Record<string, unknown> | undefined;
      if (loggingFormat?.['transports']) {
        throw new InvalidDecoratorMetadataError(
          'FrontMcp',
          'logging.transports',
          JSON.stringify(loggingFormat['transports'], null, 2),
        );
      }
      throw error;
    }

    Reflect.defineMetadata(FrontMcpTokens.type, true, target);
    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpTokens[property] ?? property, metadata[property], target);
    }

    // Store full parsed config for build-time extraction (e.g., schema-extractor via connect())
    Reflect.defineMetadata('__frontmcp:config', metadata, target);

    const isServerless = getEnvFlag('FRONTMCP_SERVERLESS');
    const isSchemaExtract = getEnvFlag('FRONTMCP_SCHEMA_EXTRACT');

    if (isSchemaExtract) {
      // Schema extraction mode — metadata already stored above, skip bootstrap
    } else if (isServerless) {
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
