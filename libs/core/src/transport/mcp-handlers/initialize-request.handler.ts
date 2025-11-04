import {
  isInitializeRequest,
  InitializeRequestSchema,
  InitializeRequest,
  InitializeResultSchema,
  InitializeResult,
} from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_NEGOTIATED_PROTOCOL_VERSION, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import { UnsupportedClientVersionException } from '../../exceptions/mcp-exceptions/unsupported-client-version.exception';

function guardClientVersion(clientVersion: string) {
  try {
    return new Date(clientVersion) > new Date(DEFAULT_NEGOTIATED_PROTOCOL_VERSION);
  } catch {
    throw UnsupportedClientVersionException.fromVersion(clientVersion);
  }
}
export default function initializeRequestHandler({
  serverOptions,
}: McpHandlerOptions): McpHandler<InitializeRequest, InitializeResult> {
  return {
    when: isInitializeRequest,
    requestSchema: InitializeRequestSchema,
    responseSchema: InitializeResultSchema,
    handler: async (request, ctx): Promise<InitializeResult> => {
      guardClientVersion(request.params.protocolVersion);

      return {
        capabilities: serverOptions.capabilities!,
        instructions: serverOptions.instructions,
        serverInfo: {
          name: 'FrontMcpServer',
          version: '0.0.1',
          title: 'FrontMcpServer',

        },
        protocolVersion: LATEST_PROTOCOL_VERSION,
      };
    },
  };
}
