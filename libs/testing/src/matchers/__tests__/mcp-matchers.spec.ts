import { mcpMatchers } from '../mcp-matchers';

// Register matchers once for the suite
expect.extend(mcpMatchers);

// Declare augmented matchers for TypeScript
declare module 'expect' {
  interface Matchers<R> {
    toContainTool(toolName: string): R;
    toBeSuccessful(): R;
    toBeError(expectedCode?: number): R;
    toHaveTextContent(expectedText?: string): R;
    toBeValidJsonRpc(): R;
    toHaveResult(): R;
    toHaveError(): R;
  }
}

describe('mcpMatchers', () => {
  describe('toContainTool', () => {
    it('should pass when tools array contains the tool name', () => {
      const tools = [{ name: 'tool-a' }, { name: 'tool-b' }];
      expect(tools).toContainTool('tool-a');
    });

    it('should fail when tools array does not contain the tool name', () => {
      const tools = [{ name: 'tool-a' }];
      expect(() => expect(tools).toContainTool('tool-missing')).toThrow();
    });

    it('should fail when received is not an array', () => {
      expect(() => expect('not-array' as unknown).toContainTool('tool')).toThrow(/Expected an array of tools/);
    });

    it('should support .not negation', () => {
      const tools = [{ name: 'tool-a' }];
      expect(tools).not.toContainTool('tool-missing');
    });

    it('should fail .not negation when tool is present', () => {
      const tools = [{ name: 'tool-a' }];
      expect(() => expect(tools).not.toContainTool('tool-a')).toThrow();
    });
  });

  describe('toBeSuccessful', () => {
    it('should pass when result has isSuccess true', () => {
      const result = { isSuccess: true, isError: false };
      expect(result).toBeSuccessful();
    });

    it('should fail when result has isSuccess false', () => {
      const result = { isSuccess: false, isError: true, error: { message: 'fail', code: -1 } };
      expect(() => expect(result).toBeSuccessful()).toThrow(/Expected result to be successful/);
    });

    it('should fail when received is not a valid wrapper', () => {
      expect(() => expect('not-an-object' as unknown).toBeSuccessful()).toThrow(/Expected a result wrapper/);
    });

    it('should fail when received is null', () => {
      expect(() => expect(null as unknown).toBeSuccessful()).toThrow();
    });
  });

  describe('toBeError', () => {
    it('should pass when result has isError true', () => {
      const result = { isSuccess: false, isError: true, error: { code: -32600, message: 'bad' } };
      expect(result).toBeError();
    });

    it('should pass with matching error code', () => {
      const result = { isSuccess: false, isError: true, error: { code: -32602, message: 'invalid' } };
      expect(result).toBeError(-32602);
    });

    it('should fail when error code does not match', () => {
      const result = { isSuccess: false, isError: true, error: { code: -32600, message: 'bad' } };
      expect(() => expect(result).toBeError(-32602)).toThrow(/Expected error code -32602/);
    });

    it('should fail when result is successful', () => {
      const result = { isSuccess: true, isError: false };
      expect(() => expect(result).toBeError()).toThrow(/Expected result to be an error/);
    });

    it('should fail when received is not a valid wrapper', () => {
      expect(() => expect(42 as unknown).toBeError()).toThrow(/Expected a result wrapper/);
    });
  });

  describe('toHaveTextContent', () => {
    it('should pass when wrapper has text content via hasTextContent', () => {
      const result = {
        text: () => 'hello world',
        hasTextContent: () => true,
      };
      expect(result).toHaveTextContent();
    });

    it('should pass when text contains expected substring', () => {
      const result = {
        text: () => 'hello world',
        hasTextContent: () => true,
      };
      expect(result).toHaveTextContent('hello');
    });

    it('should fail when text does not contain expected substring', () => {
      const result = {
        text: () => 'hello world',
        hasTextContent: () => true,
      };
      expect(() => expect(result).toHaveTextContent('goodbye')).toThrow(/Expected text to contain "goodbye"/);
    });

    it('should fail when wrapper has no text content', () => {
      const result = {
        text: () => undefined,
        hasTextContent: () => false,
      };
      expect(() => expect(result).toHaveTextContent()).toThrow(/Expected result to have text content/);
    });

    it('should work with ResourceContentWrapper style (no hasTextContent method)', () => {
      const result = {
        text: () => 'some text',
      };
      expect(result).toHaveTextContent();
    });

    it('should treat undefined text as no content for ResourceContentWrapper style', () => {
      const result = {
        text: () => undefined,
      };
      expect(() => expect(result).toHaveTextContent()).toThrow(/Expected result to have text content/);
    });

    it('should fail when received is not a valid wrapper', () => {
      expect(() => expect(123 as unknown).toHaveTextContent()).toThrow();
    });
  });

  describe('toBeValidJsonRpc', () => {
    it('should pass for valid success response', () => {
      const resp = { jsonrpc: '2.0', id: 1, result: {} };
      expect(resp).toBeValidJsonRpc();
    });

    it('should pass for valid error response', () => {
      const resp = { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad' } };
      expect(resp).toBeValidJsonRpc();
    });

    it('should pass with null id', () => {
      const resp = { jsonrpc: '2.0', id: null, result: 'ok' };
      expect(resp).toBeValidJsonRpc();
    });

    it('should fail when jsonrpc is not "2.0"', () => {
      const resp = { jsonrpc: '1.0', id: 1, result: {} };
      expect(() => expect(resp).toBeValidJsonRpc()).toThrow(/missing or invalid "jsonrpc": "2.0"/);
    });

    it('should fail when id field is missing', () => {
      const resp = { jsonrpc: '2.0', result: {} };
      expect(() => expect(resp).toBeValidJsonRpc()).toThrow(/missing "id" field/);
    });

    it('should fail when neither result nor error is present', () => {
      const resp = { jsonrpc: '2.0', id: 1 };
      expect(() => expect(resp).toBeValidJsonRpc()).toThrow(/missing "result" or "error"/);
    });

    it('should fail when both result and error are present', () => {
      const resp = { jsonrpc: '2.0', id: 1, result: {}, error: { code: -1, message: 'x' } };
      expect(() => expect(resp).toBeValidJsonRpc()).toThrow(/cannot have both "result" and "error"/);
    });

    it('should fail for non-object values', () => {
      expect(() => expect('string' as unknown).toBeValidJsonRpc()).toThrow(/Expected an object/);
    });

    it('should fail for null', () => {
      expect(() => expect(null as unknown).toBeValidJsonRpc()).toThrow(/Expected an object/);
    });
  });

  describe('toHaveResult', () => {
    it('should pass when response has result key', () => {
      const resp = { jsonrpc: '2.0', id: 1, result: { data: 'ok' } };
      expect(resp).toHaveResult();
    });

    it('should fail when response does not have result key', () => {
      const resp = { jsonrpc: '2.0', id: 1, error: { code: -1, message: 'err' } };
      expect(() => expect(resp).toHaveResult()).toThrow(/Expected response to have result/);
    });

    it('should fail for non-object', () => {
      expect(() => expect(42 as unknown).toHaveResult()).toThrow(/Expected an object/);
    });
  });

  describe('toHaveError', () => {
    it('should pass when response has error key', () => {
      const resp = { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad' } };
      expect(resp).toHaveError();
    });

    it('should fail when response does not have error key', () => {
      const resp = { jsonrpc: '2.0', id: 1, result: {} };
      expect(() => expect(resp).toHaveError()).toThrow(/Expected response to have error/);
    });

    it('should fail for non-object', () => {
      expect(() => expect(null as unknown).toHaveError()).toThrow(/Expected an object/);
    });
  });
});
