import { DefaultMockRegistry, mockResponse } from '../mock-registry';
import type { JsonRpcRequest } from '../../transport/transport.interface';
import type { MockDefinition } from '../interceptor.types';

function makeRequest(method: string, params?: Record<string, unknown>, id?: string | number): JsonRpcRequest {
  return { jsonrpc: '2.0', id: id ?? 1, method, ...(params !== undefined && { params }) };
}

describe('DefaultMockRegistry', () => {
  let registry: DefaultMockRegistry;

  beforeEach(() => {
    registry = new DefaultMockRegistry();
  });

  describe('add', () => {
    it('should add a mock and return a handle', () => {
      const mock: MockDefinition = {
        method: 'tools/list',
        response: mockResponse.success({ tools: [] }),
      };
      const handle = registry.add(mock);
      expect(handle).toBeDefined();
      expect(typeof handle.remove).toBe('function');
      expect(typeof handle.callCount).toBe('function');
      expect(typeof handle.calls).toBe('function');
    });

    it('should start with callCount of 0 and empty calls', () => {
      const handle = registry.add({
        method: 'tools/list',
        response: mockResponse.success({ tools: [] }),
      });
      expect(handle.callCount()).toBe(0);
      expect(handle.calls()).toEqual([]);
    });
  });

  describe('getAll', () => {
    it('should return all registered mock definitions', () => {
      const mock1: MockDefinition = { method: 'tools/list', response: mockResponse.success({}) };
      const mock2: MockDefinition = { method: 'tools/call', response: mockResponse.success({}) };
      registry.add(mock1);
      registry.add(mock2);
      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all[0]).toBe(mock1);
      expect(all[1]).toBe(mock2);
    });
  });

  describe('clear', () => {
    it('should remove all mocks', () => {
      registry.add({ method: 'tools/list', response: mockResponse.success({}) });
      registry.add({ method: 'tools/call', response: mockResponse.success({}) });
      registry.clear();
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe('handle.remove', () => {
    it('should remove only the specific mock', () => {
      const handle1 = registry.add({ method: 'tools/list', response: mockResponse.success({}) });
      registry.add({ method: 'tools/call', response: mockResponse.success({}) });
      handle1.remove();
      expect(registry.getAll()).toHaveLength(1);
      expect(registry.getAll()[0].method).toBe('tools/call');
    });

    it('should be safe to call remove twice', () => {
      const handle = registry.add({ method: 'tools/list', response: mockResponse.success({}) });
      handle.remove();
      handle.remove(); // should not throw
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe('match', () => {
    it('should match by method name', () => {
      const response = mockResponse.success({ tools: [] });
      registry.add({ method: 'tools/list', response });
      const result = registry.match(makeRequest('tools/list'));
      expect(result).toBeDefined();
      if (!result) return;
      expect(result.method).toBe('tools/list');
    });

    it('should return undefined when no mock matches', () => {
      registry.add({ method: 'tools/list', response: mockResponse.success({}) });
      const result = registry.match(makeRequest('resources/list'));
      expect(result).toBeUndefined();
    });

    it('should increment callCount and record calls on match', () => {
      const handle = registry.add({ method: 'tools/list', response: mockResponse.success({}) });
      const req = makeRequest('tools/list');
      registry.match(req);
      expect(handle.callCount()).toBe(1);
      expect(handle.calls()).toHaveLength(1);
      expect(handle.calls()[0]).toBe(req);
    });

    it('should return a copy of calls array', () => {
      const handle = registry.add({ method: 'tools/list', response: mockResponse.success({}) });
      registry.match(makeRequest('tools/list'));
      const calls1 = handle.calls();
      const calls2 = handle.calls();
      expect(calls1).toEqual(calls2);
      expect(calls1).not.toBe(calls2);
    });

    it('should respect the times limit', () => {
      registry.add({
        method: 'tools/list',
        response: mockResponse.success({ tools: [] }),
        times: 2,
      });

      expect(registry.match(makeRequest('tools/list'))).toBeDefined();
      expect(registry.match(makeRequest('tools/list'))).toBeDefined();
      expect(registry.match(makeRequest('tools/list'))).toBeUndefined();
    });

    it('should match with undefined times (Infinity uses)', () => {
      registry.add({
        method: 'tools/list',
        response: mockResponse.success({}),
      });

      for (let i = 0; i < 100; i++) {
        expect(registry.match(makeRequest('tools/list'))).toBeDefined();
      }
    });

    describe('params matching - object equality', () => {
      it('should match when params are equal', () => {
        registry.add({
          method: 'tools/call',
          params: { name: 'my-tool' },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { name: 'my-tool' }));
        expect(result).toBeDefined();
      });

      it('should not match when params differ', () => {
        registry.add({
          method: 'tools/call',
          params: { name: 'my-tool' },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { name: 'other-tool' }));
        expect(result).toBeUndefined();
      });

      it('should match when actual params have extra keys (subset match)', () => {
        registry.add({
          method: 'tools/call',
          params: { name: 'my-tool' },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { name: 'my-tool', extra: 'value' }));
        expect(result).toBeDefined();
      });

      it('should not match when expected key is missing in actual params', () => {
        registry.add({
          method: 'tools/call',
          params: { name: 'my-tool', required: true },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { name: 'my-tool' }));
        expect(result).toBeUndefined();
      });

      it('should match with empty params when request has no params', () => {
        registry.add({
          method: 'tools/list',
          params: {},
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/list'));
        expect(result).toBeDefined();
      });
    });

    describe('params matching - nested objects', () => {
      it('should match nested objects', () => {
        registry.add({
          method: 'tools/call',
          params: { arguments: { key: 'value' } },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { arguments: { key: 'value' } }));
        expect(result).toBeDefined();
      });

      it('should not match when nested value differs', () => {
        registry.add({
          method: 'tools/call',
          params: { arguments: { key: 'expected' } },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { arguments: { key: 'actual' } }));
        expect(result).toBeUndefined();
      });

      it('should not match when expected nested object but actual is not object', () => {
        registry.add({
          method: 'tools/call',
          params: { arguments: { key: 'value' } },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { arguments: 'not-an-object' }));
        expect(result).toBeUndefined();
      });

      it('should not match when expected nested object but actual is null', () => {
        registry.add({
          method: 'tools/call',
          params: { arguments: { key: 'value' } },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { arguments: null }));
        expect(result).toBeUndefined();
      });
    });

    describe('params matching - arrays', () => {
      it('should match identical arrays', () => {
        registry.add({
          method: 'tools/call',
          params: { tags: ['a', 'b'] },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { tags: ['a', 'b'] }));
        expect(result).toBeDefined();
      });

      it('should not match arrays with different lengths', () => {
        registry.add({
          method: 'tools/call',
          params: { tags: ['a', 'b'] },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { tags: ['a'] }));
        expect(result).toBeUndefined();
      });

      it('should not match arrays with different values', () => {
        registry.add({
          method: 'tools/call',
          params: { tags: ['a', 'b'] },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { tags: ['a', 'c'] }));
        expect(result).toBeUndefined();
      });

      it('should not match when expected is array but actual is not', () => {
        registry.add({
          method: 'tools/call',
          params: { tags: ['a'] },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { tags: 'a' }));
        expect(result).toBeUndefined();
      });

      it('should match arrays containing objects', () => {
        registry.add({
          method: 'tools/call',
          params: { items: [{ id: 1 }, { id: 2 }] },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { items: [{ id: 1 }, { id: 2 }] }));
        expect(result).toBeDefined();
      });

      it('should not match arrays where an object element differs', () => {
        registry.add({
          method: 'tools/call',
          params: { items: [{ id: 1 }] },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { items: [{ id: 999 }] }));
        expect(result).toBeUndefined();
      });

      it('should not match when expected array element is object but actual is not', () => {
        registry.add({
          method: 'tools/call',
          params: { items: [{ id: 1 }] },
          response: mockResponse.success({}),
        });
        const result = registry.match(makeRequest('tools/call', { items: ['not-an-object'] }));
        expect(result).toBeUndefined();
      });
    });

    describe('params matching - custom function', () => {
      it('should use function matcher when params is a function', () => {
        registry.add({
          method: 'tools/call',
          params: (p) => p['name'] === 'my-tool',
          response: mockResponse.success({}),
        });
        expect(registry.match(makeRequest('tools/call', { name: 'my-tool' }))).toBeDefined();
        expect(registry.match(makeRequest('tools/call', { name: 'other' }))).toBeUndefined();
      });

      it('should default missing request params to empty object for function matcher', () => {
        registry.add({
          method: 'tools/call',
          params: (p) => Object.keys(p).length === 0,
          response: mockResponse.success({}),
        });
        expect(registry.match(makeRequest('tools/call'))).toBeDefined();
      });
    });

    it('should match first registered mock when multiple match', () => {
      const resp1 = mockResponse.success({ first: true });
      const resp2 = mockResponse.success({ second: true });
      registry.add({ method: 'tools/list', response: resp1 });
      registry.add({ method: 'tools/list', response: resp2 });

      const result = registry.match(makeRequest('tools/list'));
      expect(result).toBeDefined();
      if (!result) return;
      expect(result.response).toBe(resp1);
    });

    it('should fall through to next mock when first is exhausted', () => {
      const resp1 = mockResponse.success({ first: true });
      const resp2 = mockResponse.success({ second: true });
      registry.add({ method: 'tools/list', response: resp1, times: 1 });
      registry.add({ method: 'tools/list', response: resp2 });

      const r1 = registry.match(makeRequest('tools/list'));
      expect(r1).toBeDefined();
      if (!r1) return;
      expect(r1.response).toBe(resp1);

      const r2 = registry.match(makeRequest('tools/list'));
      expect(r2).toBeDefined();
      if (!r2) return;
      expect(r2.response).toBe(resp2);
    });
  });
});

describe('mockResponse', () => {
  describe('success', () => {
    it('should create a valid JSON-RPC success response', () => {
      const resp = mockResponse.success({ data: 123 });
      expect(resp).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { data: 123 },
      });
    });

    it('should allow custom id', () => {
      const resp = mockResponse.success('ok', 42);
      expect(resp.id).toBe(42);
      expect(resp.result).toBe('ok');
    });

    it('should allow string id', () => {
      const resp = mockResponse.success(null, 'req-1');
      expect(resp.id).toBe('req-1');
    });
  });

  describe('error', () => {
    it('should create a valid JSON-RPC error response', () => {
      const resp = mockResponse.error(-32600, 'Invalid Request');
      expect(resp).toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request', data: undefined },
      });
    });

    it('should include data when provided', () => {
      const resp = mockResponse.error(-32602, 'Invalid params', { field: 'name' });
      expect(resp.error).toBeDefined();
      if (!resp.error) return;
      expect(resp.error.data).toEqual({ field: 'name' });
    });

    it('should allow null id', () => {
      const resp = mockResponse.error(-32603, 'Internal', undefined, null);
      expect(resp.id).toBeNull();
    });

    it('should allow custom id', () => {
      const resp = mockResponse.error(-32603, 'Internal', undefined, 99);
      expect(resp.id).toBe(99);
    });
  });

  describe('toolResult', () => {
    it('should create a tool result response with text content', () => {
      const resp = mockResponse.toolResult([{ type: 'text', text: 'hello' }]);
      expect(resp).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'hello' }] },
      });
    });

    it('should create a tool result response with image content', () => {
      const resp = mockResponse.toolResult([{ type: 'image', data: 'base64data', mimeType: 'image/png' }]);
      expect(resp.result).toEqual({
        content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
      });
    });

    it('should allow custom id', () => {
      const resp = mockResponse.toolResult([{ type: 'text', text: 'x' }], 'custom-id');
      expect(resp.id).toBe('custom-id');
    });
  });

  describe('toolsList', () => {
    it('should create a tools/list response', () => {
      const tools = [{ name: 'tool-a', description: 'A tool' }];
      const resp = mockResponse.toolsList(tools);
      expect(resp).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { tools },
      });
    });

    it('should handle tools with inputSchema', () => {
      const tools = [{ name: 'tool-b', inputSchema: { type: 'object' } }];
      const resp = mockResponse.toolsList(tools, 5);
      expect(resp.id).toBe(5);
      expect(resp.result).toEqual({ tools });
    });
  });

  describe('resourcesList', () => {
    it('should create a resources/list response', () => {
      const resources = [{ uri: 'file://a.txt', name: 'A' }];
      const resp = mockResponse.resourcesList(resources);
      expect(resp).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { resources },
      });
    });

    it('should allow custom id', () => {
      const resp = mockResponse.resourcesList([], 10);
      expect(resp.id).toBe(10);
    });
  });

  describe('resourceRead', () => {
    it('should create a resources/read response', () => {
      const contents = [{ uri: 'file://a.txt', text: 'content' }];
      const resp = mockResponse.resourceRead(contents);
      expect(resp).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { contents },
      });
    });

    it('should handle blob content', () => {
      const contents = [{ uri: 'file://img.png', blob: 'base64blob', mimeType: 'image/png' }];
      const resp = mockResponse.resourceRead(contents, 7);
      expect(resp.id).toBe(7);
      expect(resp.result).toEqual({ contents });
    });
  });

  describe('errors', () => {
    it('methodNotFound should create error with code -32601', () => {
      const resp = mockResponse.errors.methodNotFound('tools/call');
      expect(resp.error).toBeDefined();
      if (!resp.error) return;
      expect(resp.error.code).toBe(-32601);
      expect(resp.error.message).toBe('Method not found: tools/call');
    });

    it('invalidParams should create error with code -32602', () => {
      const resp = mockResponse.errors.invalidParams('missing field');
      expect(resp.error).toBeDefined();
      if (!resp.error) return;
      expect(resp.error.code).toBe(-32602);
      expect(resp.error.message).toBe('missing field');
    });

    it('internalError should create error with code -32603', () => {
      const resp = mockResponse.errors.internalError('something broke');
      expect(resp.error).toBeDefined();
      if (!resp.error) return;
      expect(resp.error.code).toBe(-32603);
    });

    it('resourceNotFound should create error with code -32002 and data', () => {
      const resp = mockResponse.errors.resourceNotFound('file://missing');
      expect(resp.error).toBeDefined();
      if (!resp.error) return;
      expect(resp.error.code).toBe(-32002);
      expect(resp.error.message).toBe('Resource not found: file://missing');
      expect(resp.error.data).toEqual({ uri: 'file://missing' });
    });

    it('toolNotFound should create error with code -32601 and data', () => {
      const resp = mockResponse.errors.toolNotFound('my-tool');
      expect(resp.error).toBeDefined();
      if (!resp.error) return;
      expect(resp.error.code).toBe(-32601);
      expect(resp.error.message).toBe('Tool not found: my-tool');
      expect(resp.error.data).toEqual({ name: 'my-tool' });
    });

    it('unauthorized should create error with code -32001', () => {
      const resp = mockResponse.errors.unauthorized();
      expect(resp.error).toBeDefined();
      if (!resp.error) return;
      expect(resp.error.code).toBe(-32001);
      expect(resp.error.message).toBe('Unauthorized');
    });

    it('forbidden should create error with code -32003', () => {
      const resp = mockResponse.errors.forbidden();
      expect(resp.error).toBeDefined();
      if (!resp.error) return;
      expect(resp.error.code).toBe(-32003);
      expect(resp.error.message).toBe('Forbidden');
    });

    it('all error helpers should accept a custom id', () => {
      expect(mockResponse.errors.methodNotFound('m', 99).id).toBe(99);
      expect(mockResponse.errors.invalidParams('p', 99).id).toBe(99);
      expect(mockResponse.errors.internalError('e', 99).id).toBe(99);
      expect(mockResponse.errors.resourceNotFound('r', 99).id).toBe(99);
      expect(mockResponse.errors.toolNotFound('t', 99).id).toBe(99);
      expect(mockResponse.errors.unauthorized(99).id).toBe(99);
      expect(mockResponse.errors.forbidden(99).id).toBe(99);
    });

    it('all error helpers should accept null id', () => {
      expect(mockResponse.errors.methodNotFound('m', null).id).toBeNull();
      expect(mockResponse.errors.unauthorized(null).id).toBeNull();
      expect(mockResponse.errors.forbidden(null).id).toBeNull();
    });
  });
});
