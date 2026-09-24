import { McpError } from '@frontmcp/protocol';

import { InternalMcpError, ResourceNotFoundError } from '../../../errors';
import { toJsonRpcError } from '../dispatcher';

describe('toJsonRpcError (2026-07-28)', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('answers resource-not-found with -32602 and a message without the retired code', () => {
    const { error } = toJsonRpcError(new McpError(-32002, 'Resource not found: nothing://here'));

    expect(error).toMatchObject({ code: -32602, message: 'Resource not found: nothing://here' });
  });

  it('keeps the JSON-RPC shape an error declares', () => {
    const { error } = toJsonRpcError(new ResourceNotFoundError('orders://1'));

    expect(error).toEqual({ code: -32602, message: 'Resource not found: orders://1', data: { uri: 'orders://1' } });
  });

  it('hides an internal message in production', () => {
    process.env['NODE_ENV'] = 'production';

    const { error } = toJsonRpcError(new InternalMcpError('connect ECONNREFUSED 10.0.3.7:5432'));

    expect(error.code).toBe(-32603);
    expect(error.message).not.toContain('ECONNREFUSED');
  });
});
