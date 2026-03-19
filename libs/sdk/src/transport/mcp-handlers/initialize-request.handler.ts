import { InitializeRequestSchema, type InitializeRequest, type InitializeResult } from '@frontmcp/protocol';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@frontmcp/protocol';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import { UnsupportedClientVersionError } from '../../errors';
import type { ClientCapabilities } from '../../notification';
import { detectPlatformFromCapabilities, detectAIPlatform, supportsElicitation } from '../../notification';
import { updateSessionPayload } from '../../auth/session/utils/session-id.utils';
import type { SessionIdPayload } from '@frontmcp/auth';
import type { SdkAuthInfo } from '../../server/server.types';

/**
 * Persist initialization data to the session cache and transport adapter.
 *
 * The returned new session ID from updateSessionPayload is intentionally not
 * propagated to the client. The transport session ID is fixed at creation —
 * changing it mid-session would break MCP protocol (the client references the
 * original ID). The re-encrypted payload is cached under both old and new IDs
 * for future lookups on any node.
 */
function persistInitPayload(
  sessionId: string,
  initPayload: Partial<SessionIdPayload>,
  ctx: { authInfo?: unknown },
): void {
  updateSessionPayload(sessionId, initPayload);

  const transport = (ctx.authInfo as SdkAuthInfo)?.transport;
  transport?.setInitSessionPayload(initPayload);
}

/**
 * Validates that the client's protocol version is a valid date string format.
 * Per MCP spec, older versions should be accepted if supported - version negotiation
 * determines which version to use, not this guard.
 */
function guardClientVersion(clientVersion: string): void {
  const parsed = new Date(clientVersion);
  if (isNaN(parsed.getTime())) {
    throw UnsupportedClientVersionError.fromVersion(clientVersion);
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

      // Determine if client supports elicitation from capabilities
      const clientSupportsElicitation = supportsElicitation(
        request.params.capabilities?.elicitation
          ? ({ elicitation: request.params.capabilities.elicitation } as ClientCapabilities)
          : undefined,
      );

      if (sessionId) {
        // Store client capabilities if provided
        if (request.params.capabilities) {
          // Map MCP client capabilities to our ClientCapabilities interface
          const clientCapabilities: ClientCapabilities = {
            roots: request.params.capabilities.roots as ClientCapabilities['roots'],
            sampling: request.params.capabilities.sampling as ClientCapabilities['sampling'],
            // Include experimental capabilities for MCP Apps extension detection
            experimental: request.params.capabilities.experimental as ClientCapabilities['experimental'],
            // Include elicitation capability for interactive user input support
            elicitation: request.params.capabilities.elicitation as ClientCapabilities['elicitation'],
          };
          scope.notifications.setClientCapabilities(sessionId!, clientCapabilities);

          // Persist capabilities to session store for recreation after transport eviction/restart
          await scope.transportService.updateStoredSessionCapabilities(
            sessionId,
            clientCapabilities as unknown as Record<string, unknown>,
          );

          // Try to detect platform from capabilities first (e.g., MCP Apps extension)
          detectedPlatform = detectPlatformFromCapabilities(clientCapabilities);
        }

        // Store client info (name/version) for platform detection
        // and update the session payload with the detected platform type
        if (request.params.clientInfo) {
          const { name: clientName, version: clientVersion } = request.params.clientInfo;

          // Try to store in notification service (may fail for HTTP transports without registered server)
          scope.notifications.setClientInfo(sessionId!, {
            name: clientName,
            version: clientVersion,
          });

          // Detect platform directly from client info (don't rely on setClientInfo return)
          // Use platform detection config from scope if available
          const platformDetectionConfig = scope.metadata.transport?.platformDetection;
          const clientInfoPlatform = detectAIPlatform(request.params.clientInfo, platformDetectionConfig);

          // Prefer capability-based detection (ext-apps) over client info detection
          const finalPlatform = detectedPlatform ?? clientInfoPlatform;

          // Update the session payload with client name, version, detected platform type, and elicitation support
          // This makes them available via ctx.authInfo.sessionIdPayload for logging, stateless access, and persistence
          if (ctx.authInfo?.sessionIdPayload) {
            ctx.authInfo.sessionIdPayload.clientName = clientName;
            ctx.authInfo.sessionIdPayload.clientVersion = clientVersion;
            ctx.authInfo.sessionIdPayload.supportsElicitation = clientSupportsElicitation;
            if (finalPlatform) {
              ctx.authInfo.sessionIdPayload.platformType = finalPlatform;
            }

            persistInitPayload(
              sessionId,
              {
                clientName,
                clientVersion,
                supportsElicitation: clientSupportsElicitation,
                ...(finalPlatform && { platformType: finalPlatform }),
              },
              ctx,
            );
          }
        } else if (ctx.authInfo?.sessionIdPayload) {
          // Update platform and elicitation support even without client info
          ctx.authInfo.sessionIdPayload.supportsElicitation = clientSupportsElicitation;
          if (detectedPlatform) {
            ctx.authInfo.sessionIdPayload.platformType = detectedPlatform;
          }

          persistInitPayload(
            sessionId,
            {
              supportsElicitation: clientSupportsElicitation,
              ...(detectedPlatform && { platformType: detectedPlatform }),
            },
            ctx,
          );
        }
      }

      // MCP Protocol Version Negotiation (per spec):
      // "If the server supports the requested protocol version, it MUST respond with the same version.
      //  Otherwise, the server MUST respond with another protocol version it supports."
      const requestedVersion = request.params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
        ? requestedVersion
        : LATEST_PROTOCOL_VERSION;

      // Get server info from scope metadata (configured in @FrontMcp decorator)
      // Fall back to defaults if not configured
      const configuredInfo = scope.metadata?.info ?? { name: 'FrontMcpServer', version: '0.0.1' };

      const result: InitializeResult = {
        capabilities: serverOptions.capabilities ?? {},
        instructions: serverOptions.instructions,
        serverInfo: {
          name: configuredInfo.name,
          version: configuredInfo.version,
          title: configuredInfo.name,
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
