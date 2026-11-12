/**
 * A failed transport recreation is logged without the whole session id: the error of a session
 * another node holds (`SessionClaimConflictError`) names the id in its message.
 */
import 'reflect-metadata';

import { FlowControl, httpOutputSchema } from '../../../common';
import { SessionClaimConflictError } from '../../../errors';
import HandleStreamableHttpFlow from '../handle.streamable-http.flow';

const SESSION_ID = 'Q2hhbmdlTWVJdk9ubHk.dGFnLXRhZy10YWctdGFn.Y2lwaGVydGV4dC10aGF0LWlzLWxvbmc';

/** Run the SSE listener stage for a session whose transport recreation fails with `error`; returns the warnings. */
async function sseListenerWarnings(error: Error): Promise<string> {
  const stage = Object.create(HandleStreamableHttpFlow.prototype) as HandleStreamableHttpFlow & Record<string, unknown>;
  const logger = { info: jest.fn(), warn: jest.fn(), verbose: jest.fn(), error: jest.fn() };
  Object.assign(stage, {
    scope: {
      transportService: {
        getTransporter: jest.fn().mockResolvedValue(undefined),
        getStoredSession: jest.fn().mockResolvedValue({ initialized: true, createdAt: 1 }),
        recreateTransporter: jest.fn().mockRejectedValue(error),
      },
    },
    scopeLogger: { child: () => logger },
    metadata: { outputSchema: httpOutputSchema },
    state: { required: { token: 'token-1', session: { id: SESSION_ID } } },
    rawInput: { request: { headers: { 'mcp-session-id': SESSION_ID } }, response: {} },
  });
  try {
    await (stage as unknown as { onSseListener: () => Promise<void> }).onSseListener();
  } catch (thrown) {
    if (!(thrown instanceof FlowControl)) throw thrown;
  }
  return JSON.stringify(logger.warn.mock.calls);
}

describe('handle:streamable-http transport recreation log', () => {
  it('writes the start of the session id, never the whole id, when another node holds the session', async () => {
    const warnings = await sseListenerWarnings(new SessionClaimConflictError(SESSION_ID));

    expect(warnings).toContain('claimed by another pod');
    expect(warnings).toContain(`${SESSION_ID.slice(0, 20)}...`);
    expect(warnings).not.toContain(SESSION_ID);
  });

  it('keeps the message of an error that does not name the session', async () => {
    const warnings = await sseListenerWarnings(new Error('Redis connection lost'));

    expect(warnings).toContain('Redis connection lost');
  });
});
