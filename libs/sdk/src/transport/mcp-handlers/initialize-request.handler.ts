import { InitializeRequestSchema, InitializeRequest, InitializeResult } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_NEGOTIATED_PROTOCOL_VERSION, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import { UnsupportedClientVersionException } from '../../exceptions/mcp-exceptions/unsupported-client-version.exception';
import type { ClientCapabilities } from '../../notification';

function guardClientVersion(clientVersion: string) {
  try {
    return new Date(clientVersion) > new Date(DEFAULT_NEGOTIATED_PROTOCOL_VERSION);
  } catch {
    throw UnsupportedClientVersionException.fromVersion(clientVersion);
  }
}
export default function initializeRequestHandler({
  serverOptions,
  scope,
}: McpHandlerOptions): McpHandler<InitializeRequest, InitializeResult> {
  return {
    requestSchema: InitializeRequestSchema,
    handler: async (request, ctx): Promise<InitializeResult> => {
      guardClientVersion(request.params.protocolVersion);

      // Store client capabilities and client info from the initialize request
      // The session ID is available in the auth info from the transport
      const sessionId = ctx.authInfo?.sessionId;
      if (sessionId) {
        // Store client capabilities if provided
        if (request.params.capabilities) {
          // Map MCP client capabilities to our ClientCapabilities interface
          const clientCapabilities: ClientCapabilities = {
            roots: request.params.capabilities.roots as ClientCapabilities['roots'],
            sampling: request.params.capabilities.sampling as ClientCapabilities['sampling'],
          };
          scope.notifications.setClientCapabilities(sessionId, clientCapabilities);
        }

        // Store client info (name/version) for platform detection
        // and update the session payload with the detected platform type
        if (request.params.clientInfo) {
          const detectedPlatform = scope.notifications.setClientInfo(sessionId, {
            name: request.params.clientInfo.name,
            version: request.params.clientInfo.version,
          });

          // Update the session payload with the detected platform type
          // This makes platformType available via ctx.authInfo.sessionIdPayload.platformType
          if (detectedPlatform && ctx.authInfo?.sessionIdPayload) {
            ctx.authInfo.sessionIdPayload.platformType = detectedPlatform;
          }
        }
      }

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
