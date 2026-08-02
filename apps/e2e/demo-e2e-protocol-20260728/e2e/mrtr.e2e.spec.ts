/**
 * Multi Round-Trip Requests (MRTR) — SEP-2322.
 *
 * Servers no longer send their own JSON-RPC requests for sampling, elicitation,
 * or roots. Instead they answer the ORIGINAL request with an
 * `InputRequiredResult` (`resultType: "input_required"`) carrying
 * `inputRequests`, and the client re-issues the request with `inputResponses`.
 */
import { expect, test } from '@frontmcp/testing';

import {
  mcpStatelessFetch,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  type InputRequest,
} from './helpers/mcp-stateless-client';

const ELICITING_CALL = {
  method: 'tools/call' as const,
  params: { name: 'confirm', arguments: { action: 'deploy to prod' } },
  clientCapabilities: { elicitation: { form: {} } },
};

test.describe('protocol 2026-07-28 — MRTR', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  test('answers an eliciting tool with resultType "input_required"', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { ...ELICITING_CALL, id: 1 });

    expect(res.status).toBe(200);
    const { result, error } = res.json();
    expect(error).toBeUndefined();
    expect(result.resultType).toBe('input_required');
  });

  test('carries an elicitation/create entry in inputRequests', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { ...ELICITING_CALL, id: 2 });
    const { result } = res.json();

    const entries = Object.entries(result.inputRequests ?? {});
    expect(entries.length).toBeGreaterThan(0);

    const [, request] = entries[0] as [string, InputRequest];
    expect(request.method).toBe('elicitation/create');
    expect(request.params.message).toContain('deploy to prod');
    expect(request.params.requestedSchema.type).toBe('object');
    expect(request.params.requestedSchema.properties.confirmed).toBeDefined();
  });

  test('carries an opaque requestState the client echoes back', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { ...ELICITING_CALL, id: 3 });
    const { result } = res.json();

    expect(typeof result.requestState).toBe('string');
    expect(result.requestState.length).toBeGreaterThan(0);
  });

  test('never sends a server-initiated JSON-RPC request on the response stream', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      ...ELICITING_CALL,
      id: 4,
      accept: 'text/event-stream',
    });

    // Under MRTR the server must NOT push `elicitation/create` as its own
    // request — it may only appear nested inside `result.inputRequests`.
    const framesWithBareRequest = res.text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((payload) => {
        try {
          const msg = JSON.parse(payload);
          return msg.method === 'elicitation/create';
        } catch {
          return false;
        }
      });

    expect(framesWithBareRequest).toEqual([]);
  });

  test('completes the call when the client retries with inputResponses', async ({ server }) => {
    const first = await mcpStatelessFetch(server.info.baseUrl, { ...ELICITING_CALL, id: 5 });
    const { result: interim } = first.json();

    const [key] = Object.keys(interim.inputRequests);

    const second = await mcpStatelessFetch(server.info.baseUrl, {
      ...ELICITING_CALL,
      id: 6,
      params: {
        ...ELICITING_CALL.params,
        inputResponses: {
          [key]: { action: 'accept', content: { confirmed: true } },
        },
        requestState: interim.requestState,
      },
    });

    expect(second.status).toBe(200);
    const { result, error } = second.json();
    expect(error).toBeUndefined();
    expect(result.resultType).toBe('complete');
    expect(JSON.stringify(result.structuredContent ?? result.content)).toContain('"confirmed":true');
  });

  test('honours a declined elicitation on retry', async ({ server }) => {
    const first = await mcpStatelessFetch(server.info.baseUrl, { ...ELICITING_CALL, id: 7 });
    const { result: interim } = first.json();
    const [key] = Object.keys(interim.inputRequests);

    const second = await mcpStatelessFetch(server.info.baseUrl, {
      ...ELICITING_CALL,
      id: 8,
      params: {
        ...ELICITING_CALL.params,
        inputResponses: { [key]: { action: 'decline' } },
        requestState: interim.requestState,
      },
    });

    const { result } = second.json();
    expect(result.resultType).toBe('complete');
    expect(JSON.stringify(result.structuredContent ?? result.content)).toContain('"confirmed":false');
  });

  test('rejects an eliciting call when the client declared no elicitation capability', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 9,
      params: { name: 'confirm', arguments: { action: 'deploy' } },
      clientCapabilities: {},
    });

    expect(res.status).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe(MISSING_REQUIRED_CLIENT_CAPABILITY);
    expect(error.data.requiredCapabilities.elicitation).toBeDefined();
  });

  test('does not emit notifications/elicitation/complete (removed in 2026-07-28)', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      ...ELICITING_CALL,
      id: 10,
      accept: 'text/event-stream',
    });

    expect(res.text).not.toContain('notifications/elicitation/complete');
  });

  test('does not leak an elicitationId field', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { ...ELICITING_CALL, id: 11 });
    const { result } = res.json();
    const [, request] = Object.entries(result.inputRequests)[0] as [string, InputRequest];

    // `elicitationId` was removed alongside the completion notification.
    expect(request.params.elicitationId).toBeUndefined();
  });
});
