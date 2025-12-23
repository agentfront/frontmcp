// file: libs/browser/src/__tests__/sdk-imports.test.ts
/**
 * Tests to verify SDK/core imports resolve correctly in browser package.
 *
 * These tests ensure that all expected exports from @frontmcp/sdk/core
 * are accessible and have the correct types.
 */

import {
  // Crypto utilities
  generateUUID,
  getRandomBytes,
  getRandomHex,
  sha256,
  sha256Sync,
  simpleHash,
  // Config
  initializeConfig,
  getConfig,
  getConfigValue,
  isConfigInitialized,
  resetConfig,
  isBrowserEnvironment,
  isNodeEnvironment,
  isWebWorkerEnvironment,
  // Registry base
  RegistryAbstract,
  // Entry classes
  ToolEntry,
  ResourceEntry,
  PromptEntry,
  BaseEntry,
  // Transport base
  TransportAdapterBase,
  // Host adapters
  NoOpHostAdapter,
  HostServerAdapter,
  // Errors
  McpError,
  PublicMcpError,
  InternalMcpError,
  ToolNotFoundError,
  ResourceNotFoundError,
  ResourceReadError,
  InvalidResourceUriError,
  InvalidInputError,
  InvalidOutputError,
  InvalidMethodError,
  ToolExecutionError,
  RateLimitError,
  QuotaExceededError,
  UnauthorizedError,
  GenericServerError,
  DependencyNotFoundError,
  InvalidHookFlowError,
  PromptNotFoundError,
  PromptExecutionError,
  isPublicError,
  toMcpError,
  formatMcpErrorResponse,
  MCP_ERROR_CODES,
  // URI utilities
  isValidMcpUri,
  extractUriScheme,
  isValidMcpUriTemplate,
  parseUriTemplate,
  matchUriTemplate,
  expandUriTemplate,
  // Scope
  Scope,
} from '../index';

import type {
  RuntimeConfig,
  RegistryBuildMapResult,
  TransportAdapterBaseOptions,
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
  MessageHandler,
  ConnectionState,
  McpErrorCode,
  ToolMetadata,
  ToolInputType,
  ToolOutputType,
  ToolRecord,
  ResourceMetadata,
  ResourceTemplateMetadata,
  ResourceRecord,
  ResourceTemplateRecord,
  AnyResourceRecord,
  PromptMetadata,
  PromptRecord,
  GetPromptResult,
} from '../index';

describe('SDK/core imports', () => {
  describe('Crypto utilities', () => {
    it('should export generateUUID', () => {
      expect(typeof generateUUID).toBe('function');
      const uuid = generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should export getRandomBytes', () => {
      expect(typeof getRandomBytes).toBe('function');
      const bytes = getRandomBytes(16);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(16);
    });

    it('should export getRandomHex', () => {
      expect(typeof getRandomHex).toBe('function');
      const hex = getRandomHex(8);
      expect(hex).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should export sha256', async () => {
      expect(typeof sha256).toBe('function');
      const hash = await sha256('test');
      expect(typeof hash).toBe('string');
    });

    it('should export sha256Sync', () => {
      expect(typeof sha256Sync).toBe('function');
      // sha256Sync may throw in browser environments that don't support sync hashing
      expect(sha256Sync).toBeDefined();
    });

    it('should export simpleHash', () => {
      expect(typeof simpleHash).toBe('function');
      const hash = simpleHash('test');
      // simpleHash returns a hex string representation
      expect(typeof hash).toBe('string');
    });
  });

  describe('Config utilities', () => {
    beforeEach(() => {
      resetConfig();
    });

    it('should export initializeConfig', () => {
      expect(typeof initializeConfig).toBe('function');
    });

    it('should export getConfig', () => {
      expect(typeof getConfig).toBe('function');
    });

    it('should export getConfigValue', () => {
      expect(typeof getConfigValue).toBe('function');
    });

    it('should export isConfigInitialized', () => {
      expect(typeof isConfigInitialized).toBe('function');
    });

    it('should export resetConfig', () => {
      expect(typeof resetConfig).toBe('function');
    });

    it('should export environment detection functions', () => {
      expect(typeof isBrowserEnvironment).toBe('function');
      expect(typeof isNodeEnvironment).toBe('function');
      expect(typeof isWebWorkerEnvironment).toBe('function');
    });

    it('should correctly initialize and read config', () => {
      initializeConfig({
        debug: true,
        isDevelopment: true,
        machineId: 'test-machine',
      });

      expect(isConfigInitialized()).toBe(true);
      expect(getConfigValue('debug', false)).toBe(true);
      expect(getConfigValue('machineId', '')).toBe('test-machine');
    });
  });

  describe('Registry base', () => {
    it('should export RegistryAbstract', () => {
      expect(RegistryAbstract).toBeDefined();
    });
  });

  describe('Entry classes', () => {
    it('should export ToolEntry', () => {
      expect(ToolEntry).toBeDefined();
    });

    it('should export ResourceEntry', () => {
      expect(ResourceEntry).toBeDefined();
    });

    it('should export PromptEntry', () => {
      expect(PromptEntry).toBeDefined();
    });

    it('should export BaseEntry', () => {
      expect(BaseEntry).toBeDefined();
    });
  });

  describe('Transport base', () => {
    it('should export TransportAdapterBase', () => {
      expect(TransportAdapterBase).toBeDefined();
    });
  });

  describe('Host adapters', () => {
    it('should export NoOpHostAdapter', () => {
      expect(NoOpHostAdapter).toBeDefined();
    });

    it('should export HostServerAdapter', () => {
      expect(HostServerAdapter).toBeDefined();
    });

    it('should allow creating NoOpHostAdapter instance', () => {
      const adapter = new NoOpHostAdapter();
      expect(adapter).toBeInstanceOf(NoOpHostAdapter);
      expect(adapter.isPrepared()).toBe(false);
      adapter.prepare();
      expect(adapter.isPrepared()).toBe(true);
      expect(adapter.getHandler()).toBeNull();
    });
  });

  describe('Error classes', () => {
    it('should export McpError base class', () => {
      expect(McpError).toBeDefined();
    });

    it('should export PublicMcpError', () => {
      expect(PublicMcpError).toBeDefined();
      const error = new PublicMcpError('Test error');
      expect(error.isPublic).toBe(true);
    });

    it('should export InternalMcpError', () => {
      expect(InternalMcpError).toBeDefined();
      const error = new InternalMcpError('Test error');
      expect(error.isPublic).toBe(false);
    });

    it('should export specific error classes', () => {
      expect(ToolNotFoundError).toBeDefined();
      expect(ResourceNotFoundError).toBeDefined();
      expect(ResourceReadError).toBeDefined();
      expect(InvalidResourceUriError).toBeDefined();
      expect(InvalidInputError).toBeDefined();
      expect(InvalidOutputError).toBeDefined();
      expect(InvalidMethodError).toBeDefined();
      expect(ToolExecutionError).toBeDefined();
      expect(RateLimitError).toBeDefined();
      expect(QuotaExceededError).toBeDefined();
      expect(UnauthorizedError).toBeDefined();
      expect(GenericServerError).toBeDefined();
      expect(DependencyNotFoundError).toBeDefined();
      expect(InvalidHookFlowError).toBeDefined();
      expect(PromptNotFoundError).toBeDefined();
      expect(PromptExecutionError).toBeDefined();
    });

    it('should export error utility functions', () => {
      expect(typeof isPublicError).toBe('function');
      expect(typeof toMcpError).toBe('function');
      expect(typeof formatMcpErrorResponse).toBe('function');
    });

    it('should export MCP_ERROR_CODES', () => {
      expect(MCP_ERROR_CODES).toBeDefined();
      expect(MCP_ERROR_CODES.RESOURCE_NOT_FOUND).toBe(-32002);
      expect(MCP_ERROR_CODES.INVALID_REQUEST).toBe(-32600);
      expect(MCP_ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
      expect(MCP_ERROR_CODES.INVALID_PARAMS).toBe(-32602);
      expect(MCP_ERROR_CODES.INTERNAL_ERROR).toBe(-32603);
      expect(MCP_ERROR_CODES.PARSE_ERROR).toBe(-32700);
    });
  });

  describe('URI utilities', () => {
    it('should export URI validation functions', () => {
      expect(typeof isValidMcpUri).toBe('function');
      expect(typeof extractUriScheme).toBe('function');
      expect(typeof isValidMcpUriTemplate).toBe('function');
    });

    it('should export URI template functions', () => {
      expect(typeof parseUriTemplate).toBe('function');
      expect(typeof matchUriTemplate).toBe('function');
      expect(typeof expandUriTemplate).toBe('function');
    });

    it('should correctly validate URIs', () => {
      expect(isValidMcpUri('file:///path/to/file')).toBe(true);
      expect(isValidMcpUri('https://example.com')).toBe(true);
      expect(isValidMcpUri('invalid')).toBe(false);
    });
  });

  describe('Scope', () => {
    it('should export Scope class', () => {
      expect(Scope).toBeDefined();
    });
  });

  describe('Type exports', () => {
    it('should have correct type definitions (compile-time check)', () => {
      // These type assertions are compile-time checks
      // If they compile, the types are correctly exported

      const _runtimeConfig: RuntimeConfig = {
        debug: true,
        isDevelopment: true,
        machineId: 'test',
      };

      const _connectionState: ConnectionState = 'disconnected';

      const _errorCode: McpErrorCode = MCP_ERROR_CODES.INTERNAL_ERROR;

      // Type checks pass if this compiles
      expect(true).toBe(true);
    });
  });
});
