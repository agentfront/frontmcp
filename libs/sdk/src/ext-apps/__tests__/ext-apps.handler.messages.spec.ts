/**
 * What a widget's request is answered with when it fails.
 */
import { InvalidInputError, ToolExecutionError } from '../../errors';
import { ExtAppsMessageHandler, type ExtAppsHandlerContext } from '../ext-apps.handler';
import { type ExtAppsJsonRpcRequest } from '../ext-apps.types';

const logger = {
  debug: jest.fn(),
  verbose: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

function handlerWith(overrides: Partial<ExtAppsHandlerContext> = {}): ExtAppsMessageHandler {
  const context: ExtAppsHandlerContext = {
    sessionId: 'session-1',
    logger: logger as unknown as ExtAppsHandlerContext['logger'],
    callTool: jest.fn(),
    ...overrides,
  };
  return new ExtAppsMessageHandler({ context, hostCapabilities: { serverToolProxy: true, logging: true } });
}

function request(method: string, params: unknown): ExtAppsJsonRpcRequest {
  return { jsonrpc: '2.0', id: 1, method, params };
}

beforeEach(() => jest.clearAllMocks());

describe('the answer to a widget request that fails', () => {
  it("does not carry a tool's internal failure message", async () => {
    const failure = new ToolExecutionError('lookup', new Error('connect ECONNREFUSED 10.0.0.7:5432 as admin'));
    const handler = handlerWith({ callTool: jest.fn().mockRejectedValue(failure) });

    const response = await handler.handleRequest(request('ui/callServerTool', { name: 'lookup', arguments: {} }));

    expect(response.error?.message).not.toContain('ECONNREFUSED');
    expect(response.error?.message).toContain(failure.errorId);
  });

  it('does not carry the message of an error that is not an MCP error', async () => {
    const handler = handlerWith({ callTool: jest.fn().mockRejectedValue(new Error('row 7 of table secrets')) });

    const response = await handler.handleRequest(request('ui/callServerTool', { name: 'lookup', arguments: {} }));

    expect(response.error?.message).not.toContain('secrets');
  });

  it('carries the message of a public error', async () => {
    const handler = handlerWith({ callTool: jest.fn().mockRejectedValue(new InvalidInputError('id is required')) });

    const response = await handler.handleRequest(request('ui/callServerTool', { name: 'lookup', arguments: {} }));

    expect(response.error?.message).toBe('id is required');
  });

  it("carries the handler's own message about the request", async () => {
    const response = await handlerWith().handleRequest(request('ui/callServerTool', { arguments: {} }));

    expect(response.error?.message).toBe('Tool name is required');
  });
});
