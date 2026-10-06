/**
 * `DELETE /mcp` (`handleDeleteSession`): ends the session for every caller the flow
 * authorized, public and anonymous ones included (#713).
 */
import 'reflect-metadata';

import { FlowControl, httpOutputSchema, ServerRequestTokens } from '../../../common';
import HttpRequestFlow from '../http.request.flow';

type TransportServiceStub = { destroyTransporter: jest.Mock; deleteStoredSession: jest.Mock };

function createStage(authorization: { token: string } | undefined, transportService: TransportServiceStub) {
  const stage = Object.create(HttpRequestFlow.prototype) as HttpRequestFlow & Record<string, unknown>;
  const request = {
    method: 'DELETE',
    headers: { 'mcp-session-id': 'sess-1' },
    [ServerRequestTokens.sessionId]: 'sess-1',
    [ServerRequestTokens.auth]: authorization,
  };
  const response = {};
  Object.assign(stage, {
    scope: { transportService, notifications: { terminateSession: jest.fn() } },
    metadata: { outputSchema: httpOutputSchema },
    logger: { verbose: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
    requestId: 'req-1',
    rawInput: { request, response },
  });
  return { stage };
}

async function runStage(stage: HttpRequestFlow, stageName: string): Promise<FlowControl | undefined> {
  try {
    await (stage as unknown as Record<string, () => Promise<void>>)[stageName]();
    return undefined;
  } catch (error) {
    if (error instanceof FlowControl) return error;
    throw error;
  }
}

function transportServiceStub(): TransportServiceStub {
  return {
    destroyTransporter: jest.fn().mockResolvedValue(undefined),
    deleteStoredSession: jest.fn().mockResolvedValue(undefined),
  };
}

describe('http:request handleDeleteSession', () => {
  it('destroys the transport and the stored session of a public session (empty token)', async () => {
    const transportService = transportServiceStub();
    const { stage } = createStage({ token: '' }, transportService);

    const control = await runStage(stage, 'handleDeleteSession');

    expect(control?.output).toMatchObject({ status: 204 });
    expect(transportService.destroyTransporter).toHaveBeenCalledWith('streamable-http', '', 'sess-1');
    expect(transportService.destroyTransporter).toHaveBeenCalledWith('sse', '', 'sess-1');
    expect(transportService.deleteStoredSession).toHaveBeenCalledWith('sess-1');
  });

  it('deletes the stored session even when no transport is live here (after a restart)', async () => {
    const transportService = transportServiceStub();
    transportService.destroyTransporter.mockRejectedValue(new Error('Invalid session'));
    const { stage } = createStage({ token: 'tok' }, transportService);

    await runStage(stage, 'handleDeleteSession');

    expect(transportService.deleteStoredSession).toHaveBeenCalledWith('sess-1');
  });

  it('touches no transport when the request carries no verified authorization', async () => {
    const transportService = transportServiceStub();
    const { stage } = createStage(undefined, transportService);

    await runStage(stage, 'handleDeleteSession');

    expect(transportService.destroyTransporter).not.toHaveBeenCalled();
    expect(transportService.deleteStoredSession).not.toHaveBeenCalled();
  });
});
