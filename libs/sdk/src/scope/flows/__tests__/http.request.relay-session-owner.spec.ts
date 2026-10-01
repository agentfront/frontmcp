/**
 * `relayToSessionOwner` — in a distributed deployment, a request for an MCP session
 * another live node owns is served by that node (#680). The stage runs before quota and
 * authentication: the owner runs the whole `http:request` flow for the relayed request.
 */
import 'reflect-metadata';

import { FlowControl, httpOutputSchema } from '../../../common';
import { SessionOwnerUnreachableError } from '../../../errors';
import HttpRequestFlow from '../http.request.flow';

function createStage(transportService?: { findRemoteSessionOwner: jest.Mock; relayToSessionOwner: jest.Mock }) {
  const stage = Object.create(HttpRequestFlow.prototype) as HttpRequestFlow & Record<string, unknown>;
  const request = { headers: { 'mcp-session-id': 'sess-1' }, body: { jsonrpc: '2.0', id: 4, method: 'tools/list' } };
  const response = { headersSent: false };
  Object.assign(stage, {
    scope: { transportService },
    // The real output schema: the 503 the stage answers must be a valid flow output.
    metadata: { outputSchema: httpOutputSchema },
    logger: { verbose: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
    requestId: 'req-1',
    rawInput: { request, response },
  });
  return { stage, request, response };
}

async function run(stage: HttpRequestFlow): Promise<FlowControl | undefined> {
  try {
    await (stage as unknown as { relayToSessionOwner(): Promise<void> }).relayToSessionOwner();
    return undefined;
  } catch (error) {
    if (error instanceof FlowControl) return error;
    throw error;
  }
}

describe('http:request relayToSessionOwner', () => {
  it('relays a request for a session owned by another live node and ends the flow', async () => {
    const owner = { nodeId: 'node-a', channel: 'mcp:ha:notify:node-a' };
    const transportService = {
      findRemoteSessionOwner: jest.fn().mockResolvedValue(owner),
      relayToSessionOwner: jest.fn().mockResolvedValue(undefined),
    };
    const { stage, request, response } = createStage(transportService);

    const control = await run(stage);

    expect(transportService.findRemoteSessionOwner).toHaveBeenCalledWith(request);
    expect(transportService.relayToSessionOwner).toHaveBeenCalledWith(owner, request, response);
    expect(control?.type).toBe('handled');
  });

  it('continues the flow here when no other node owns the session', async () => {
    const transportService = {
      findRemoteSessionOwner: jest.fn().mockResolvedValue(undefined),
      relayToSessionOwner: jest.fn(),
    };
    const { stage } = createStage(transportService);

    await expect(run(stage)).resolves.toBeUndefined();
    expect(transportService.relayToSessionOwner).not.toHaveBeenCalled();
  });

  it('continues the flow without a transport service', async () => {
    const { stage } = createStage(undefined);
    await expect(run(stage)).resolves.toBeUndefined();
  });

  it('answers a retryable 503 when the owner does not answer', async () => {
    const transportService = {
      findRemoteSessionOwner: jest.fn().mockResolvedValue({ nodeId: 'node-a', channel: 'c' }),
      relayToSessionOwner: jest.fn().mockRejectedValue(new SessionOwnerUnreachableError('node-a', 30, 'no ack')),
    };
    const { stage } = createStage(transportService);

    const control = await run(stage);

    expect(control?.type).toBe('respond');
    expect(control?.output).toMatchObject({
      kind: 'json',
      status: 503,
      headers: { 'Retry-After': '30' },
      body: { jsonrpc: '2.0', id: 4, error: { code: -32000, message: expect.stringContaining('Retry after 30s') } },
    });
  });

  it('propagates any other relay failure', async () => {
    const transportService = {
      findRemoteSessionOwner: jest.fn().mockResolvedValue({ nodeId: 'node-a', channel: 'c' }),
      relayToSessionOwner: jest.fn().mockRejectedValue(new Error('bug')),
    };
    const { stage } = createStage(transportService);
    await expect(run(stage)).rejects.toThrow('bug');
  });
});
