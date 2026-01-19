/**
 * Initialize Request Handler Tests
 *
 * Tests for the MCP initialize request handler, specifically focusing on
 * session payload updates for clientName, clientVersion, supportsElicitation, and platformType.
 */
import { InitializeRequest, InitializeResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandlerOptions } from '../mcp-handlers.types';
import { SessionIdPayload } from '../../../common';

// Mock dependencies before importing the handler
const mockUpdateSessionPayload = jest.fn();
jest.mock('../../../auth/session/utils/session-id.utils', () => ({
  updateSessionPayload: (...args: any[]) => mockUpdateSessionPayload(...args),
}));

const mockSupportsElicitation = jest.fn();
const mockDetectPlatformFromCapabilities = jest.fn();
const mockDetectAIPlatform = jest.fn();
jest.mock('../../../notification', () => ({
  supportsElicitation: (...args: any[]) => mockSupportsElicitation(...args),
  detectPlatformFromCapabilities: (...args: any[]) => mockDetectPlatformFromCapabilities(...args),
  detectAIPlatform: (...args: any[]) => mockDetectAIPlatform(...args),
}));

// Import after mocking
import initializeRequestHandler from '../initialize-request.handler';

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

  // Mock scope
  const mockScope = {
    logger: mockLogger,
    notifications: mockNotifications,
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
    mockDetectAIPlatform.mockReturnValue(undefined);
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
    it('should set platformType from capability-based detection', async () => {
      mockDetectPlatformFromCapabilities.mockReturnValue('ext-apps');

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

    it('should set platformType from client info when capabilities detection returns undefined', async () => {
      mockDetectPlatformFromCapabilities.mockReturnValue(undefined);
      mockDetectAIPlatform.mockReturnValue('claude');

      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest({
        clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(ctx.authInfo.sessionIdPayload.platformType).toBe('claude');
    });

    it('should prefer capability-based detection over client info detection', async () => {
      mockDetectPlatformFromCapabilities.mockReturnValue('ext-apps');
      mockDetectAIPlatform.mockReturnValue('claude');

      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest();
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      // Should use ext-apps from capability detection, not claude from client info
      expect(ctx.authInfo.sessionIdPayload.platformType).toBe('ext-apps');
    });

    it('should not set platformType when both detections return undefined', async () => {
      mockDetectPlatformFromCapabilities.mockReturnValue(undefined);
      mockDetectAIPlatform.mockReturnValue(undefined);

      const handler = initializeRequestHandler(handlerOptions);
      const request = createRequest();
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      // platformType should not be set (remains undefined from initial payload)
      expect(ctx.authInfo.sessionIdPayload.platformType).toBeUndefined();
    });

    it('should call detectAIPlatform with platformDetection config', async () => {
      const platformConfig = { customPatterns: [] };
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
      const request = createRequest({
        clientInfo: { name: 'CustomClient', version: '1.0.0' },
      });
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockDetectAIPlatform).toHaveBeenCalledWith({ name: 'CustomClient', version: '1.0.0' }, platformConfig);
    });

    it('should include platformType in updateSessionPayload when detected', async () => {
      mockDetectAIPlatform.mockReturnValue('openai');

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

      await expect(handler.handler(request, ctx as any)).rejects.toThrow();
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
  });
});
