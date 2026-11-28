/**
 * `DELETE /mcp` (`handleDeleteSession`): ends the session for every caller the flow
 * authorized, public and anonymous ones included (#713), and a relayed DELETE names the node
 * that owns the session in `X-FrontMCP-Machine-Id` (#714).
 */
import 'reflect-metadata';

import { getMachineId, resetRuntimeContext } from '@frontmcp/utils';

import { FlowControl, httpOutputSchema, ServerRequestTokens } from '../../../common';
import { SessionEndUnconfirmedError } from '../../../errors';
import HttpRequestFlow from '../http.request.flow';

type TransportServiceStub = {
  destroyTransporter: jest.Mock;
  endSessionOnOtherInstances: jest.Mock;
  deleteStoredSession: jest.Mock;
};

function createStage(
  authorization: { token: string } | undefined,
  transportService: TransportServiceStub,
  sessionId = 'sess-1',
) {
  const stage = Object.create(HttpRequestFlow.prototype) as HttpRequestFlow & Record<string, unknown>;
  const request = {
    method: 'DELETE',
    headers: { 'mcp-session-id': sessionId },
    [ServerRequestTokens.sessionId]: sessionId,
    [ServerRequestTokens.auth]: authorization,
  };
  const response = { setHeader: jest.fn() };
  Object.assign(stage, {
    scope: { transportService, notifications: { terminateSession: jest.fn() } },
    metadata: { outputSchema: httpOutputSchema },
    logger: { verbose: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
    requestId: 'req-1',
    requestStartTime: Date.now(),
    state: new Map<string, unknown>(),
    rawInput: { request, response },
  });
  return { stage, response };
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
    endSessionOnOtherInstances: jest.fn().mockResolvedValue(undefined),
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

  it('does not answer 204 when the stored session could not be deleted', async () => {
    const transportService = transportServiceStub();
    transportService.deleteStoredSession.mockRejectedValue(new Error('Redis down'));
    const { stage } = createStage({ token: '' }, transportService);

    await expect(runStage(stage, 'handleDeleteSession')).rejects.toThrow('Redis down');
  });

  it('logs only the start of the session id it ends, so the log does not hold a usable id', async () => {
    const sessionId = 'Q2hhbmdlTWVJdk9ubHk.dGFnLXRhZy10YWctdGFn.Y2lwaGVydGV4dC10aGF0LWlzLWxvbmc';
    const { stage } = createStage({ token: '' }, transportServiceStub(), sessionId);

    await runStage(stage, 'handleDeleteSession');

    const logged = JSON.stringify((stage['logger'] as unknown as { info: jest.Mock }).info.mock.calls);
    expect(logged).toContain(`${sessionId.slice(0, 20)}...`);
    expect(logged).not.toContain(sessionId);
  });

  it('asks the other instances sharing the session store to close the session before it answers (#1446)', async () => {
    const transportService = transportServiceStub();
    const { stage } = createStage({ token: '' }, transportService);

    const control = await runStage(stage, 'handleDeleteSession');

    expect(transportService.endSessionOnOtherInstances).toHaveBeenCalledWith('sess-1');
    expect(control?.output).toMatchObject({ status: 204 });
  });

  it.each([
    ['the owner over the bus', 'destroyTransporter'],
    ['another instance sharing the session store', 'endSessionOnOtherInstances'],
  ] as const)(
    'answers a retryable 503, not 204, when %s does not confirm it closed the session (#1446)',
    async (_holder, method) => {
      const transportService = transportServiceStub();
      transportService[method].mockRejectedValue(new SessionEndUnconfirmedError('node-2', 7, 'no answer', 'timed-out'));
      const { stage } = createStage({ token: '' }, transportService);

      const control = await runStage(stage, 'handleDeleteSession');

      expect(control?.output).toMatchObject({
        status: 503,
        headers: expect.objectContaining({ 'Retry-After': '7' }),
        body: {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: expect.stringContaining('Retry the DELETE') },
        },
      });
      // The session is ended everywhere else: a retried DELETE asks the holder again
      expect(transportService.deleteStoredSession).toHaveBeenCalledWith('sess-1');
    },
  );

  it('fails the DELETE when asking the other instances fails otherwise', async () => {
    const transportService = transportServiceStub();
    transportService.endSessionOnOtherInstances.mockRejectedValue(new Error('Redis down'));
    const { stage } = createStage({ token: '' }, transportService);

    await expect(runStage(stage, 'handleDeleteSession')).rejects.toThrow('Redis down');
  });

  it('touches no transport when the request carries no verified authorization', async () => {
    const transportService = transportServiceStub();
    const { stage } = createStage(undefined, transportService);

    await runStage(stage, 'handleDeleteSession');

    expect(transportService.destroyTransporter).not.toHaveBeenCalled();
    expect(transportService.deleteStoredSession).not.toHaveBeenCalled();
  });
});

describe('http:request, a DELETE sent again while the holder has not confirmed (#1446)', () => {
  /** A DELETE run through the router and handleDeleteSession stages, as the flow runs them. */
  async function deleteThroughStages(transportService: TransportServiceStub, terminated: Set<string>) {
    const stage = Object.create(HttpRequestFlow.prototype) as HttpRequestFlow & Record<string, unknown>;
    const authorization = { token: '', session: { id: 'sess-1', payload: { protocol: 'streamable-http' } } };
    const state = new Map<string, unknown>();
    const request = { method: 'DELETE', path: '/', headers: { 'mcp-session-id': 'sess-1' }, query: {} };
    Object.assign(stage, {
      scope: {
        metadata: { transport: { protocol: 'modern' } },
        transportService,
        notifications: {
          terminateSession: (sessionId: string) => terminated.add(sessionId),
          isSessionTerminated: (sessionId: string) => terminated.has(sessionId),
          unmarkTerminated: (sessionId: string) => terminated.delete(sessionId),
        },
      },
      metadata: { outputSchema: httpOutputSchema },
      logger: { verbose: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
      requestId: 'req-1',
      requestStartTime: Date.now(),
      state: {
        required: { verifyResult: { kind: 'authorized', authorization } },
        set: (key: string, value: unknown) => state.set(key, value),
        get: (key: string) => state.get(key),
      },
      rawInput: { request, response: { setHeader: jest.fn() } },
    });
    const routed = await runStage(stage, 'router');
    if (routed) return routed.output;
    expect(state.get('intent')).toBe('delete-session');
    return (await runStage(stage, 'handleDeleteSession'))?.output;
  }

  it('asks the holder again each time, never answering 404 for the session it ended itself', async () => {
    const transportService = transportServiceStub();
    transportService.endSessionOnOtherInstances.mockRejectedValue(
      new SessionEndUnconfirmedError('1 of 1 other instances', 5, 'no answer', 'timed-out'),
    );
    const terminated = new Set<string>();

    const first = await deleteThroughStages(transportService, terminated);
    const second = await deleteThroughStages(transportService, terminated);

    expect([first, second]).toEqual([
      expect.objectContaining({ status: 503 }),
      expect.objectContaining({ status: 503 }),
    ]);
    expect(terminated.has('sess-1')).toBe(true);
    expect(transportService.endSessionOnOtherInstances).toHaveBeenCalledTimes(2);
    expect(transportService.destroyTransporter).toHaveBeenCalledTimes(4);
  });
});

describe('http:request applyDeleteNodeHeaders', () => {
  const originalMode = process.env['FRONTMCP_DEPLOYMENT_MODE'];

  afterEach(() => {
    if (originalMode === undefined) delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
    else process.env['FRONTMCP_DEPLOYMENT_MODE'] = originalMode;
    resetRuntimeContext();
  });

  it('names this node, the session owner, in X-FrontMCP-Machine-Id when distributed', async () => {
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'distributed';
    resetRuntimeContext();
    const { stage, response } = createStage({ token: '' }, transportServiceStub());

    await runStage(stage, 'applyDeleteNodeHeaders');

    expect(response.setHeader).toHaveBeenCalledWith('X-FrontMCP-Machine-Id', getMachineId());
  });

  it('sets no machine-id header outside distributed deployments', async () => {
    delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
    resetRuntimeContext();
    const { stage, response } = createStage({ token: '' }, transportServiceStub());

    await runStage(stage, 'applyDeleteNodeHeaders');

    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
