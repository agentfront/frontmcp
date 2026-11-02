/**
 * E2E: `@frontmcp/observability` closes the `tools/call` span and records the failure on the request log when
 * a tool's output schema refuses its answer. The refusal fails the `finalize` stage, which skips that stage's
 * Did hooks, so the span stayed open and the request log recorded no error. Observability closes them in a
 * Finally hook now.
 */
import { expect, test } from '@frontmcp/testing';

interface Telemetry {
  spans: Array<{ tool: string; call: string }>;
  requestLogs: Array<{ status: string; errorCode?: string }>;
}

test.describe('Observability of an answer the output schema refuses', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main-observability.ts',
    project: 'demo-e2e-standalone',
    publicMode: true,
  });

  test('closes the tools/call span as failed and records INVALID_OUTPUT on the request log', async ({ mcp }) => {
    const result = await mcp.tools.call('refused-answer', {});
    expect(result).toBeError();
    expect(result.raw._meta?.['code']).toBe('INVALID_OUTPUT');

    const telemetry = await mcp.tools.call('get-telemetry', { toolName: 'refused-answer' });

    expect(telemetry.json<Telemetry>()).toEqual({
      spans: [{ tool: 'ok', call: 'error' }],
      requestLogs: [{ status: 'error', errorCode: 'INVALID_OUTPUT' }],
    });
  });
});
