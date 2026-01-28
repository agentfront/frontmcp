/**
 * @file ext-apps.types.test.ts
 * @description Tests for MCP Apps (ext-apps) type definitions and constants.
 */

import { EXT_APPS_ERROR_CODES } from '../ext-apps.types';
import type {
  ExtAppsCallServerToolParams,
  ExtAppsUpdateModelContextParams,
  ExtAppsOpenLinkParams,
  ExtAppsDisplayMode,
  ExtAppsSetDisplayModeParams,
  ExtAppsCloseParams,
  ExtAppsLogLevel,
  ExtAppsLogParams,
  ExtAppsRegisterToolParams,
  ExtAppsUnregisterToolParams,
  ExtAppsHostCapabilities,
  ExtAppsWidgetCapabilities,
  ExtAppsInitializeParams,
  ExtAppsInitializeResult,
  ExtAppsJsonRpcRequest,
  ExtAppsJsonRpcResponse,
  ExtAppsJsonRpcNotification,
} from '../ext-apps.types';

describe('ext-apps types', () => {
  describe('EXT_APPS_ERROR_CODES', () => {
    it('should define standard JSON-RPC error codes', () => {
      expect(EXT_APPS_ERROR_CODES.PARSE_ERROR).toBe(-32700);
      expect(EXT_APPS_ERROR_CODES.INVALID_REQUEST).toBe(-32600);
      expect(EXT_APPS_ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
      expect(EXT_APPS_ERROR_CODES.INVALID_PARAMS).toBe(-32602);
      expect(EXT_APPS_ERROR_CODES.INTERNAL_ERROR).toBe(-32603);
    });

    it('should define ext-apps specific error codes', () => {
      expect(EXT_APPS_ERROR_CODES.TOOL_NOT_FOUND).toBe(-32001);
      expect(EXT_APPS_ERROR_CODES.TOOL_EXECUTION_FAILED).toBe(-32002);
      expect(EXT_APPS_ERROR_CODES.NOT_SUPPORTED).toBe(-32003);
      expect(EXT_APPS_ERROR_CODES.CANCELLED).toBe(-32004);
    });
  });

  describe('type definitions compile correctly', () => {
    it('should accept valid ExtAppsCallServerToolParams', () => {
      const params: ExtAppsCallServerToolParams = {
        name: 'get_weather',
        arguments: { location: 'NYC' },
      };
      expect(params.name).toBe('get_weather');
      expect(params.arguments).toEqual({ location: 'NYC' });
    });

    it('should accept ExtAppsCallServerToolParams without arguments', () => {
      const params: ExtAppsCallServerToolParams = {
        name: 'list_items',
      };
      expect(params.name).toBe('list_items');
      expect(params.arguments).toBeUndefined();
    });

    it('should accept valid ExtAppsUpdateModelContextParams', () => {
      const params: ExtAppsUpdateModelContextParams = {
        context: { key: 'value' },
        merge: true,
      };
      expect(params.context).toEqual({ key: 'value' });
      expect(params.merge).toBe(true);
    });

    it('should accept ExtAppsUpdateModelContextParams without merge', () => {
      const params: ExtAppsUpdateModelContextParams = {
        context: { data: 123 },
      };
      expect(params.context).toEqual({ data: 123 });
      expect(params.merge).toBeUndefined();
    });

    it('should accept valid ExtAppsOpenLinkParams', () => {
      const params: ExtAppsOpenLinkParams = {
        url: 'https://example.com',
      };
      expect(params.url).toBe('https://example.com');
    });

    it('should accept valid ExtAppsDisplayMode values', () => {
      const modes: ExtAppsDisplayMode[] = ['inline', 'fullscreen', 'pip'];
      expect(modes).toHaveLength(3);
    });

    it('should accept valid ExtAppsSetDisplayModeParams', () => {
      const params: ExtAppsSetDisplayModeParams = {
        mode: 'fullscreen',
      };
      expect(params.mode).toBe('fullscreen');
    });

    it('should accept valid ExtAppsCloseParams', () => {
      const params: ExtAppsCloseParams = {
        reason: 'user requested',
      };
      expect(params.reason).toBe('user requested');
    });

    it('should accept ExtAppsCloseParams without reason', () => {
      const params: ExtAppsCloseParams = {};
      expect(params.reason).toBeUndefined();
    });

    it('should accept valid ExtAppsLogLevel values', () => {
      const levels: ExtAppsLogLevel[] = ['debug', 'info', 'warn', 'error'];
      expect(levels).toHaveLength(4);
    });

    it('should accept valid ExtAppsLogParams', () => {
      const params: ExtAppsLogParams = {
        level: 'info',
        message: 'Test message',
        data: { extra: 'info' },
      };
      expect(params.level).toBe('info');
      expect(params.message).toBe('Test message');
      expect(params.data).toEqual({ extra: 'info' });
    });

    it('should accept valid ExtAppsRegisterToolParams', () => {
      const params: ExtAppsRegisterToolParams = {
        name: 'my_tool',
        description: 'A custom tool',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string' },
          },
        },
      };
      expect(params.name).toBe('my_tool');
      expect(params.description).toBe('A custom tool');
      expect(params.inputSchema).toHaveProperty('type', 'object');
    });

    it('should accept valid ExtAppsUnregisterToolParams', () => {
      const params: ExtAppsUnregisterToolParams = {
        name: 'my_tool',
      };
      expect(params.name).toBe('my_tool');
    });

    it('should accept valid ExtAppsHostCapabilities', () => {
      const capabilities: ExtAppsHostCapabilities = {
        serverToolProxy: true,
        openLink: true,
        modelContextUpdate: true,
        widgetTools: true,
        displayModes: ['inline', 'fullscreen'],
        logging: true,
      };
      expect(capabilities.serverToolProxy).toBe(true);
      expect(capabilities.displayModes).toEqual(['inline', 'fullscreen']);
    });

    it('should accept partial ExtAppsHostCapabilities', () => {
      const capabilities: ExtAppsHostCapabilities = {
        serverToolProxy: true,
      };
      expect(capabilities.serverToolProxy).toBe(true);
      expect(capabilities.openLink).toBeUndefined();
    });

    it('should accept valid ExtAppsWidgetCapabilities', () => {
      const capabilities: ExtAppsWidgetCapabilities = {
        tools: {
          listChanged: true,
        },
        supportsPartialInput: true,
      };
      expect(capabilities.tools?.listChanged).toBe(true);
      expect(capabilities.supportsPartialInput).toBe(true);
    });

    it('should accept valid ExtAppsInitializeParams', () => {
      const params: ExtAppsInitializeParams = {
        appInfo: {
          name: 'My Widget',
          version: '1.0.0',
        },
        appCapabilities: {
          tools: {
            listChanged: false,
          },
        },
        protocolVersion: '2024-11-05',
      };
      expect(params.appInfo.name).toBe('My Widget');
      expect(params.protocolVersion).toBe('2024-11-05');
    });

    it('should accept valid ExtAppsInitializeResult', () => {
      const result: ExtAppsInitializeResult = {
        hostCapabilities: {
          serverToolProxy: true,
          openLink: true,
        },
        hostContext: {
          theme: 'dark',
          displayMode: 'inline',
        },
        protocolVersion: '2024-11-05',
      };
      expect(result.hostCapabilities.serverToolProxy).toBe(true);
      expect(result.hostContext?.theme).toBe('dark');
    });

    it('should accept valid ExtAppsJsonRpcRequest', () => {
      const request: ExtAppsJsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'ui/callServerTool',
        params: { name: 'test' },
      };
      expect(request.jsonrpc).toBe('2.0');
      expect(request.method).toBe('ui/callServerTool');
    });

    it('should accept ExtAppsJsonRpcRequest with string id', () => {
      const request: ExtAppsJsonRpcRequest = {
        jsonrpc: '2.0',
        id: 'request-123',
        method: 'ui/close',
      };
      expect(request.id).toBe('request-123');
    });

    it('should accept valid ExtAppsJsonRpcResponse with result', () => {
      const response: ExtAppsJsonRpcResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { data: 'success' },
      };
      expect(response.result).toEqual({ data: 'success' });
      expect(response.error).toBeUndefined();
    });

    it('should accept valid ExtAppsJsonRpcResponse with error', () => {
      const response: ExtAppsJsonRpcResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32601,
          message: 'Method not found',
          data: { method: 'unknown' },
        },
      };
      expect(response.error?.code).toBe(-32601);
      expect(response.result).toBeUndefined();
    });

    it('should accept valid ExtAppsJsonRpcNotification', () => {
      const notification: ExtAppsJsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-input',
        params: { arguments: { location: 'NYC' } },
      };
      expect(notification.method).toBe('ui/notifications/tool-input');
      // Notifications don't have id
      expect((notification as any).id).toBeUndefined();
    });
  });
});
