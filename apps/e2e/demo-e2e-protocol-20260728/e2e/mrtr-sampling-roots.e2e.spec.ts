/**
 * MRTR for sampling and roots — SEP-2322.
 *
 * Both features lost their inline transport when the server→client request
 * direction was removed, so they now travel as `inputRequests` inside an
 * `InputRequiredResult` exactly like elicitation.
 */
import { expect, test } from '@frontmcp/testing';

import {
  mcpStatelessFetch,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  type InputRequest,
} from './helpers/mcp-stateless-client';

const SAMPLING_CALL = {
  method: 'tools/call' as const,
  params: { name: 'summarize', arguments: { text: 'a long document' } },
  clientCapabilities: { sampling: {} },
};

const ROOTS_CALL = {
  method: 'tools/call' as const,
  params: { name: 'list-workspaces', arguments: {} },
  clientCapabilities: { roots: {} },
};

test.describe('protocol 2026-07-28 — MRTR for sampling and roots', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  test.describe('sampling', () => {
    test('answers with a sampling/createMessage input request', async ({ server }) => {
      const res = await mcpStatelessFetch(server.info.baseUrl, { ...SAMPLING_CALL, id: 1 });

      const { result, error } = res.json();
      expect(error).toBeUndefined();
      expect(result.resultType).toBe('input_required');

      const [, request] = Object.entries(result.inputRequests)[0] as [string, InputRequest];
      expect(request.method).toBe('sampling/createMessage');
      expect(request.params.maxTokens).toBe(100);
      expect(request.params.systemPrompt).toBe('You are a concise summarizer.');
      expect(request.params.messages[0].content.text).toContain('a long document');
    });

    test('completes the call when the client supplies the completion', async ({ server }) => {
      const first = await mcpStatelessFetch(server.info.baseUrl, { ...SAMPLING_CALL, id: 2 });
      const { result: interim } = first.json();
      const [key] = Object.keys(interim.inputRequests);

      const second = await mcpStatelessFetch(server.info.baseUrl, {
        ...SAMPLING_CALL,
        id: 3,
        params: {
          ...SAMPLING_CALL.params,
          inputResponses: {
            [key]: {
              role: 'assistant',
              content: { type: 'text', text: 'It is about a document.' },
              model: 'test-model',
              stopReason: 'endTurn',
            },
          },
          requestState: interim.requestState,
        },
      });

      const { result, error } = second.json();
      expect(error).toBeUndefined();
      expect(result.resultType).toBe('complete');
      const payload = JSON.stringify(result.structuredContent ?? result.content);
      expect(payload).toContain('It is about a document.');
      expect(payload).toContain('test-model');
    });

    test('rejects sampling when the client declared no sampling capability', async ({ server }) => {
      const res = await mcpStatelessFetch(server.info.baseUrl, {
        ...SAMPLING_CALL,
        id: 4,
        clientCapabilities: {},
      });

      expect(res.status).toBe(400);
      const { error } = res.json();
      expect(error.code).toBe(MISSING_REQUIRED_CLIENT_CAPABILITY);
      expect(error.data.requiredCapabilities.sampling).toBeDefined();
    });
  });

  test.describe('roots', () => {
    test('answers with a roots/list input request', async ({ server }) => {
      const res = await mcpStatelessFetch(server.info.baseUrl, { ...ROOTS_CALL, id: 5 });

      const { result } = res.json();
      expect(result.resultType).toBe('input_required');

      const [, request] = Object.entries(result.inputRequests)[0] as [string, InputRequest];
      expect(request.method).toBe('roots/list');
    });

    test('completes the call when the client supplies its roots', async ({ server }) => {
      const first = await mcpStatelessFetch(server.info.baseUrl, { ...ROOTS_CALL, id: 6 });
      const { result: interim } = first.json();
      const [key] = Object.keys(interim.inputRequests);

      const second = await mcpStatelessFetch(server.info.baseUrl, {
        ...ROOTS_CALL,
        id: 7,
        params: {
          ...ROOTS_CALL.params,
          inputResponses: {
            [key]: { roots: [{ uri: 'file:///work', name: 'work' }, { uri: 'file:///tmp' }] },
          },
          requestState: interim.requestState,
        },
      });

      const { result, error } = second.json();
      expect(error).toBeUndefined();
      expect(result.resultType).toBe('complete');
      const payload = JSON.stringify(result.structuredContent ?? result.content);
      expect(payload).toContain('file:///work');
      expect(payload).toContain('file:///tmp');
    });

    test('rejects roots when the client declared no roots capability', async ({ server }) => {
      const res = await mcpStatelessFetch(server.info.baseUrl, { ...ROOTS_CALL, id: 8, clientCapabilities: {} });

      expect(res.status).toBe(400);
      expect(res.json().error.code).toBe(MISSING_REQUIRED_CLIENT_CAPABILITY);
    });
  });

  test.describe('requestState integrity', () => {
    test('ignores a tampered requestState and re-asks', async ({ server }) => {
      const first = await mcpStatelessFetch(server.info.baseUrl, { ...SAMPLING_CALL, id: 9 });
      const { result: interim } = first.json();
      const [key] = Object.keys(interim.inputRequests);

      // Forge a state blob claiming an answer the server never issued.
      const forged = Buffer.from(
        JSON.stringify({ r: { [key]: { role: 'assistant', content: { type: 'text', text: 'forged' } } } }),
        'utf8',
      ).toString('base64url');

      const res = await mcpStatelessFetch(server.info.baseUrl, {
        ...SAMPLING_CALL,
        id: 10,
        params: { ...SAMPLING_CALL.params, requestState: `${forged}.notavalidsignature` },
      });

      // The forged answers must be discarded, so the server asks again rather
      // than completing with attacker-supplied content.
      const { result } = res.json();
      expect(result.resultType).toBe('input_required');
      expect(JSON.stringify(result)).not.toContain('forged');
    });

    test('rejects a requestState replayed onto a different tool call', async ({ server }) => {
      const first = await mcpStatelessFetch(server.info.baseUrl, { ...SAMPLING_CALL, id: 11 });
      const { result: interim } = first.json();
      expect(interim.resultType).toBe('input_required');

      // Replay the signed blob against DIFFERENT arguments, and deliberately send
      // no `inputResponses` — the carried state is then the only thing that could
      // complete the call. If the server honoured the mismatched binding it would
      // answer `complete`; rejecting it means asking again.
      const res = await mcpStatelessFetch(server.info.baseUrl, {
        ...SAMPLING_CALL,
        id: 12,
        params: {
          name: 'summarize',
          arguments: { text: 'a DIFFERENT document' },
          requestState: interim.requestState,
        },
      });

      const { result } = res.json();
      expect(result.resultType).toBe('input_required');
    });

    test('accepts a legitimately signed requestState', async ({ server }) => {
      const first = await mcpStatelessFetch(server.info.baseUrl, { ...ROOTS_CALL, id: 13 });
      const { result: interim } = first.json();
      const [key] = Object.keys(interim.inputRequests);

      const res = await mcpStatelessFetch(server.info.baseUrl, {
        ...ROOTS_CALL,
        id: 14,
        params: {
          ...ROOTS_CALL.params,
          inputResponses: { [key]: { roots: [{ uri: 'file:///ok' }] } },
          requestState: interim.requestState,
        },
      });

      expect(res.json().result.resultType).toBe('complete');
    });
  });
});
