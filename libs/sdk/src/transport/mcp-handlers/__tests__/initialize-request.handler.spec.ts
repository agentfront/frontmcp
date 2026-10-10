/**
 * Initialize Request Handler Tests
 *
 * Tests for the MCP initialize request handler, specifically focusing on
 * session payload updates for clientName, clientVersion, supportsElicitation, and platformType.
 */
import type { InitializeRequest } from '@frontmcp/protocol';

import { type SessionIdPayload } from '../../../common';
import { UnsupportedClientVersionError } from '../../../errors';
import { FRONTMCP_SUPPORTED_PROTOCOL_VERSIONS } from '../../mcp-20260728/protocol-20260728.constants';
// Import after mocking
import initializeRequestHandler from '../initialize-request.handler';
import { type McpHandlerOptions } from '../mcp-handlers.types';

// Mock dependencies before importing the handler
const mockUpdateSessionPayload = jest.fn();
jest.mock('../../../auth/session/utils/session-id.utils', () => ({
  updateSessionPayload: (...args: any[]) => mockUpdateSessionPayload(...args),
}));

const mockSupportsElicitation = jest.fn();
const mockDetectPlatformFromCapabilities = jest.fn();
const mockResolvePlatformType = jest.fn();
jest.mock('../../../notification', () => ({
  supportsElicitation: (...args: any[]) => mockSupportsElicitation(...args),
  detectPlatformFromCapabilities: (...args: any[]) => mockDetectPlatformFromCapabilities(...args),
  resolvePlatformType: (...args: any[]) => mockResolvePlatformType(...args),
}));

describe('initializeRequestHandler', () => {
  // Mock logger
  const mockLogger = {
    child: jest.fn(() => mockLogger),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };

  // Mock notification service
  const mockNotifications = {
    setClientCapabilities: jest.fn(),
    setClientInfo: jest.fn(),
  };

  // Mock transport service
  const mockTransportService = {
    updateStoredSessionCapabilities: jest.fn().mockResolvedValue(undefined),
  };

  // Mock scope
  const mockScope = {
    logger: mockLogger,
    notifications: mockNotifications,
    transportService: mockTransportService,
    metadata: {
      info: { name: 'TestServer', version: '1.0.0' },
      transport: { platformDetection: undefined },
    },
  };

  // Mock server options
  const mockServerOptions = {
    capabilities: {
      tools: {},
      resources: {},
    },
    instructions: 'Test instructions',
  };

  // Create handler options
  const handlerOptions: McpHandlerOptions = {
    serverOptions: mockServerOptions as any,
    scope: mockScope as any,
  };

  // Create a valid request template
  const createRequest = (overrides: Partial<InitializeRequest['params']> = {}): InitializeRequest => ({
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      clientInfo: {
        name: 'TestClient',
        version: '1.0.0',
      },
      capabilities: {},
      ...overrides,
    },
  });

  // Create a mock context with authInfo
  const createContext = (sessionIdPayload?: Partial<SessionIdPayload>) => ({
    authInfo: {
      sessionId: 'test-session-id-123',
      sessionIdPayload: sessionIdPayload ?? {
        nodeId: 'test-node',
        authSig: 'test-sig',
        uuid: 'test-uuid',
        iat: 1234567890,
        protocol: 'streamable-http' as const,
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockSupportsElicitation.mockReturnValue(false);
    mockDetectPlatformFromCapabilities.mockReturnValue(undefined);
    mockResolvePlatformType.mockReturnValue(undefined);
    mockUpdateSessionPayload.mockReturnValue(true);
  });

  // ============================================
  // Session Payload Update Tests
  // ============================================

  describe('session payload updates', () => {
    it('should set clientName from clientInfo', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        clientInfo: { name: 'MyClient', version: '2.0.0' },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(ctx.authInfo.sessionIdPayload.clientName).toBe('MyClient');
    });

    it('should set clientVersion from clientInfo', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        clientInfo: { name: 'MyClient', version: '2.0.0' },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(ctx.authInfo.sessionIdPayload.clientVersion).toBe('2.0.0');
    });

    it('should call updateSessionPayload with client info', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        clientInfo: { name: 'MyClient', version: '2.0.0' },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockUpdateSessionPayload).toHaveBeenCalledWith(
        'test-session-id-123',
        expect.objectContaining({
          clientName: 'MyClient',
          clientVersion: '2.0.0',
        }),
      );
    });

    it('should handle missing clientInfo gracefully', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({ clientInfo: undefined });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      // Should still call updateSessionPayload for elicitation support
      expect(mockUpdateSessionPayload).toHaveBeenCalledWith(
        'test-session-id-123',
        expect.objectContaining({
          supportsElicitation: false,
        }),
      );
      // But not with clientName/clientVersion
      const callArgs = mockUpdateSessionPayload.mock.calls[0][1];
      expect(callArgs.clientName).toBeUndefined();
      expect(callArgs.clientVersion).toBeUndefined();
    });
  });

  // ============================================
  // Elicitation Support Tests
  // ============================================

  describe('supportsElicitation detection', () => {
    it('should set supportsElicitation to true when client has elicitation capability', async () => {
      mockSupportsElicitation.mockReturnValue(true);

      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        capabilities: {
          elicitation: {},
        },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(ctx.authInfo.sessionIdPayload.supportsElicitation).toBe(true);
    });

    it('should set supportsElicitation to false when client lacks elicitation capability', async () => {
      mockSupportsElicitation.mockReturnValue(false);

      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        capabilities: {},
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(ctx.authInfo.sessionIdPayload.supportsElicitation).toBe(false);
    });

    it('should call supportsElicitation with elicitation capability', async () => {
      const elicitationCapability = { mode: 'form' };
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        capabilities: {
          elicitation: elicitationCapability,
        },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockSupportsElicitation).toHaveBeenCalledWith(
        expect.objectContaining({
          elicitation: elicitationCapability,
        }),
      );
    });

    it('should call supportsElicitation with undefined when no elicitation capability', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        capabilities: {},
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockSupportsElicitation).toHaveBeenCalledWith(undefined);
    });

    it('should include supportsElicitation in updateSessionPayload call', async () => {
      mockSupportsElicitation.mockReturnValue(true);

      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest();
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockUpdateSessionPayload).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          supportsElicitation: true,
        }),
      );
    });
  });

  // ============================================
  // Platform Detection Tests
  // ============================================

  describe('platformType detection', () => {
    it('should set platformType to the resolved platform', async () => {
      mockResolvePlatformType.mockReturnValue('ext-apps');

      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        capabilities: {
          experimental: { 'io.modelcontextprotocol/ui': {} },
        },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(ctx.authInfo.sessionIdPayload.platformType).toBe('ext-apps');
    });

    it('should not set platformType when no platform is resolved', async () => {
      mockResolvePlatformType.mockReturnValue(undefined);

      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest();
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      // platformType should not be set (remains undefined from initial payload)
      expect(ctx.authInfo.sessionIdPayload.platformType).toBeUndefined();
    });

    it('should resolve the platform from the client info, the declared capabilities and the platformDetection config', async () => {
      const platformConfig = { mappings: [{ pattern: 'CustomClient', platform: 'gemini' }] };
      const scopeWithConfig = {
        ...mockScope,
        metadata: {
          ...mockScope.metadata,
          transport: { platformDetection: platformConfig },
        },
      };

      const handler = initializeRequestHandler({
        ...handlerOptions,
        scope: scopeWithConfig as any,
      });
      const capabilities = { extensions: { 'io.modelcontextprotocol/ui': {} } };
      const request = createRequest({
        clientInfo: { name: 'CustomClient', version: '1.0.0' },
        capabilities: capabilities as InitializeRequest['params']['capabilities'],
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockResolvePlatformType).toHaveBeenCalledWith(
        { name: 'CustomClient', version: '1.0.0' },
        capabilities,
        platformConfig,
      );
    });

    it('should keep the SEP-2133 extensions among the stored client capabilities', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const extensions = { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } };
      const request = createRequest({ capabilities: { extensions } as InitializeRequest['params']['capabilities'] });

      await handler.handler(request, createContext() as any);

      expect(mockNotifications.setClientCapabilities).toHaveBeenCalledWith(
        'test-session-id-123',
        expect.objectContaining({ extensions }),
      );
    });

    it('should include platformType in updateSessionPayload when detected', async () => {
      mockResolvePlatformType.mockReturnValue('openai');

      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest();
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockUpdateSessionPayload).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          platformType: 'openai',
        }),
      );
    });
  });

  // ============================================
  // Notification Service Integration Tests
  // ============================================

  describe('notification service integration', () => {
    it('should store client capabilities in notification service', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        capabilities: {
          roots: { listChanged: true },
          sampling: {},
        },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockNotifications.setClientCapabilities).toHaveBeenCalledWith(
        'test-session-id-123',
        expect.objectContaining({
          roots: { listChanged: true },
          sampling: {},
        }),
      );

      // Should also persist capabilities to session store for recreation
      expect(mockTransportService.updateStoredSessionCapabilities).toHaveBeenCalledWith(
        'test-session-id-123',
        expect.objectContaining({
          roots: { listChanged: true },
          sampling: {},
        }),
      );
    });

    it('should store client info in notification service', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        clientInfo: { name: 'TestApp', version: '3.0.0' },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockNotifications.setClientInfo).toHaveBeenCalledWith('test-session-id-123', {
        name: 'TestApp',
        version: '3.0.0',
      });
    });
  });

  // ============================================
  // Capability Persistence to Session Store
  // ============================================

  describe('capability persistence to session store', () => {
    it('should call updateStoredSessionCapabilities with sessionId and capabilities', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        capabilities: {
          roots: { listChanged: true },
          sampling: {},
        },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockTransportService.updateStoredSessionCapabilities).toHaveBeenCalledWith(
        'test-session-id-123',
        expect.objectContaining({
          roots: { listChanged: true },
          sampling: {},
        }),
      );
    });

    it('should persist elicitation capabilities to session store', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        capabilities: {
          elicitation: { form: {} },
        },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockTransportService.updateStoredSessionCapabilities).toHaveBeenCalledWith(
        'test-session-id-123',
        expect.objectContaining({
          elicitation: { form: {} },
        }),
      );
    });

    it('should not call updateStoredSessionCapabilities when no capabilities provided', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({ capabilities: undefined });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockTransportService.updateStoredSessionCapabilities).not.toHaveBeenCalled();
    });

    it('should not call updateStoredSessionCapabilities when no sessionId', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        capabilities: { roots: { listChanged: true } },
      });
      const ctx = { authInfo: { sessionId: undefined, sessionIdPayload: undefined } };

      await handler.handler(request, ctx as any);

      expect(mockTransportService.updateStoredSessionCapabilities).not.toHaveBeenCalled();
    });

    it('should await updateStoredSessionCapabilities before returning', async () => {
      let release: (() => void) | null = null;
      const persistencePromise = new Promise<void>((resolve) => {
        release = resolve;
      });
      mockTransportService.updateStoredSessionCapabilities.mockReturnValue(persistencePromise);

      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({ capabilities: { roots: {} } });
      const ctx = createContext();

      // Start the handler — it should be blocked awaiting the persistence promise
      const handlerPromise = handler.handler(request, ctx as any);

      // Yield microtask queue so the handler can run up to the await point
      await Promise.resolve();

      let settled = false;
      handlerPromise.finally(() => {
        settled = true;
      });
      // Yield again so .finally can attach
      await Promise.resolve();

      // Handler must NOT have settled yet (it's awaiting the unresolved promise)
      expect(settled).toBe(false);

      // Release the persistence promise
      release?.();

      // Now the handler should resolve
      await expect(handlerPromise).resolves.toBeDefined();
    });
  });

  // ============================================
  // Edge Cases and Error Handling
  // ============================================

  describe('edge cases', () => {
    it('should handle missing sessionId gracefully', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest();
      const ctx = { authInfo: { sessionId: undefined, sessionIdPayload: undefined } };

      // Should not throw
      const result = await handler.handler(request, ctx as any);

      expect(result.serverInfo.name).toBe('TestServer');
      expect(mockUpdateSessionPayload).not.toHaveBeenCalled();
      expect(mockTransportService.updateStoredSessionCapabilities).not.toHaveBeenCalled();
    });

    it('should handle missing sessionIdPayload gracefully', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest();
      const ctx = { authInfo: { sessionId: 'test-session', sessionIdPayload: undefined } };

      // Should not throw
      const result = await handler.handler(request, ctx as any);

      expect(result.serverInfo.name).toBe('TestServer');
      // updateSessionPayload should still be called for caching
      expect(mockNotifications.setClientCapabilities).toHaveBeenCalled();
    });

    it('should reject invalid protocol version format', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        protocolVersion: 'invalid-version',
      } as any);
      const ctx = createContext();

      await expect(handler.handler(request, ctx as any)).rejects.toThrow(UnsupportedClientVersionError);
    });

    it('should accept valid date-formatted protocol versions', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        protocolVersion: '2024-11-05',
      } as any);
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.protocolVersion).toBeDefined();
    });

    it('answers only with a revision server/discover lists as supported', async () => {
      const handler = initializeRequestHandler(handlerOptions);

      const result = await handler.handler(createRequest({ protocolVersion: '2024-10-07' }), createContext() as any);

      expect(FRONTMCP_SUPPORTED_PROTOCOL_VERSIONS).toContain(result.protocolVersion);
      expect(result.protocolVersion).not.toBe('2024-10-07');
    });

    it('does not answer initialize with 2026-07-28, which has no initialize', async () => {
      const handler = initializeRequestHandler(handlerOptions);

      const result = await handler.handler(createRequest({ protocolVersion: '2026-07-28' }), createContext() as any);

      expect(result.protocolVersion).toBe('2025-11-25');
    });
  });

  // ============================================
  // Response Format Tests
  // ============================================

  describe('response format', () => {
    it('should return server info from scope metadata', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest();
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.serverInfo).toEqual({
        name: 'TestServer',
        version: '1.0.0',
        title: 'TestServer',
      });
    });

    it("sends info's title, websiteUrl and icons in serverInfo", async () => {
      const info = {
        name: 'help-desk',
        title: 'Help Desk',
        version: '1.0.0',
        websiteUrl: 'https://desk.example.com',
        icons: [{ src: 'https://desk.example.com/icon.png' }],
      };
      const handler = initializeRequestHandler({
        ...handlerOptions,
        scope: { ...mockScope, metadata: { ...mockScope.metadata, info } } as any,
      });

      const result = await handler.handler(createRequest(), createContext() as any);

      expect(result.serverInfo).toEqual(info);
    });

    it('should return capabilities from server options', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest();
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.capabilities).toEqual({
        tools: {},
        resources: {},
      });
    });

    it('should return instructions from server options', async () => {
      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest();
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.instructions).toBe('Test instructions');
    });

    it('should prefer composeInstructions over static serverOptions.instructions', async () => {
      let counter = 0;
      const optionsWithComposer: McpHandlerOptions = {
        ...handlerOptions,
        composeInstructions: () => `dynamic-instructions-#${++counter}`,
      };
      const handler = initializeRequestHandler(optionsWithComposer);

      const first = await handler.handler(createRequest(), createContext() as any);
      const second = await handler.handler(createRequest(), createContext() as any);

      expect(first.instructions).toBe('dynamic-instructions-#1');
      expect(second.instructions).toBe('dynamic-instructions-#2');
    });

    it('composes the instructions for the calling context and awaits them (#603)', async () => {
      const composeInstructions = jest.fn(async (caller?: { authInfo?: unknown }) => `composed for ${String(caller)}`);
      const handler = initializeRequestHandler({ ...handlerOptions, composeInstructions });
      const ctx = createContext();

      const result = await handler.handler(createRequest(), ctx as any);

      expect(composeInstructions).toHaveBeenCalledWith(ctx);
      expect(result.instructions).toBe(`composed for ${String(ctx)}`);
    });

    it('should fall back to static instructions when composer returns undefined', async () => {
      const optionsWithComposer: McpHandlerOptions = {
        ...handlerOptions,
        composeInstructions: () => undefined,
      };
      const handler = initializeRequestHandler(optionsWithComposer);

      const result = await handler.handler(createRequest(), createContext() as any);

      expect(result.instructions).toBe('Test instructions');
    });

    it('should omit instructions when both composer and static value are empty', async () => {
      const optionsNoInstructions: McpHandlerOptions = {
        ...handlerOptions,
        serverOptions: { ...mockServerOptions, instructions: '' } as any,
        composeInstructions: () => '',
      };
      const handler = initializeRequestHandler(optionsNoInstructions);

      const result = await handler.handler(createRequest(), createContext() as any);

      expect(result.instructions).toBeUndefined();
    });
  });
});
