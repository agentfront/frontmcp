import { InitializeRequestSchema, InitializeRequest, InitializeResult } from '@modelcontextprotocol/sdk/types.js';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import { UnsupportedClientVersionException } from '../../exceptions/mcp-exceptions/unsupported-client-version.exception';
import type { ClientCapabilities } from '../../notification';
import { detectPlatformFromCapabilities, detectAIPlatform } from '../../notification';
import { updateSessionPayload } from '../../auth/session/utils/session-id.utils';

/**
 * Validates that the client's protocol version is a valid date string format.
 * Per MCP spec, older versions should be accepted if supported - version negotiation
 * determines which version to use, not this guard.
 */
function guardClientVersion(clientVersion: string): void {
  const parsed = new Date(clientVersion);
  if (isNaN(parsed.getTime())) {
    throw UnsupportedClientVersionException.fromVersion(clientVersion);
  }
  // Don't reject older versions - let version negotiation handle it
}
export default function initializeRequestHandler({
  serverOptions,
  scope,
}: McpHandlerOptions): McpHandler<InitializeRequest, InitializeResult> {
  const logger = scope.logger.child('initialize-handler');

  return {
    requestSchema: InitializeRequestSchema,
    handler: async (request, ctx): Promise<InitializeResult> => {
      logger.info('initialize: received request', {
        clientName: request.params.clientInfo?.name,
        clientVersion: request.params.clientInfo?.version,
        protocolVersion: request.params.protocolVersion,
        hasCapabilities: !!request.params.capabilities,
        sessionId: ctx.authInfo?.sessionId?.slice(0, 20),
      });

      guardClientVersion(request.params.protocolVersion);

      // Store client capabilities and client info from the initialize request
      // The session ID is available in the auth info from the transport
      const sessionId = ctx.authInfo?.sessionId;
      let detectedPlatform: ReturnType<typeof detectPlatformFromCapabilities> = undefined;

      if (sessionId) {
        // Store client capabilities if provided
        if (request.params.capabilities) {
          // Map MCP client capabilities to our ClientCapabilities interface
          const clientCapabilities: ClientCapabilities = {
            roots: request.params.capabilities.roots as ClientCapabilities['roots'],
            sampling: request.params.capabilities.sampling as ClientCapabilities['sampling'],
            // Include experimental capabilities for MCP Apps extension detection
            experimental: request.params.capabilities.experimental as ClientCapabilities['experimental'],
          };
          scope.notifications.setClientCapabilities(sessionId, clientCapabilities);

          // Try to detect platform from capabilities first (e.g., MCP Apps extension)
          detectedPlatform = detectPlatformFromCapabilities(clientCapabilities);
        }

        // Store client info (name/version) for platform detection
        // and update the session payload with the detected platform type
        if (request.params.clientInfo) {
          // Try to store in notification service (may fail for HTTP transports without registered server)
          scope.notifications.setClientInfo(sessionId, {
            name: request.params.clientInfo.name,
            version: request.params.clientInfo.version,
          });

          // Detect platform directly from client info (don't rely on setClientInfo return)
          // Use platform detection config from scope if available
          const platformDetectionConfig = scope.metadata.transport?.platformDetection;
          const clientInfoPlatform = detectAIPlatform(request.params.clientInfo, platformDetectionConfig);

          // Prefer capability-based detection (ext-apps) over client info detection
          const finalPlatform = detectedPlatform ?? clientInfoPlatform;

          // Update the session payload with the detected platform type
          // This makes platformType available via ctx.authInfo.sessionIdPayload.platformType
          if (finalPlatform && ctx.authInfo?.sessionIdPayload) {
            ctx.authInfo.sessionIdPayload.platformType = finalPlatform;

            // Persist the platformType to the session cache so subsequent requests can access it
            // This is critical for HTTP transports where sessions are parsed from encrypted headers
            updateSessionPayload(sessionId, { platformType: finalPlatform });
          }
        } else if (detectedPlatform && ctx.authInfo?.sessionIdPayload) {
          // Update platform even without client info if detected from capabilities
          ctx.authInfo.sessionIdPayload.platformType = detectedPlatform;

          // Persist to session cache
          updateSessionPayload(sessionId, { platformType: detectedPlatform });
        }
      }

      // MCP Protocol Version Negotiation (per spec):
      // "If the server supports the requested protocol version, it MUST respond with the same version.
      //  Otherwise, the server MUST respond with another protocol version it supports."
      const requestedVersion = request.params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
        ? requestedVersion
        : LATEST_PROTOCOL_VERSION;

      const result: InitializeResult = {
        capabilities: serverOptions.capabilities!,
        instructions: serverOptions.instructions,
        serverInfo: {
          name: 'FrontMcpServer',
          version: '0.0.1',
          title: 'FrontMcpServer',
        },
        protocolVersion,
      };

      logger.info('initialize: sending response', {
        capabilities: JSON.stringify(result.capabilities),
        protocolVersion: result.protocolVersion,
        serverName: result.serverInfo.name,
        sessionId: ctx.authInfo?.sessionId?.slice(0, 20),
      });

      return result;
    },
  };
}
