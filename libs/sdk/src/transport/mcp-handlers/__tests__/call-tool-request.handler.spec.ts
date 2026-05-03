/**
 * call-tool-request handler tests — focus on FlowControl unwrap (#369).
 *
 * The CLI's in-process client routes through:
 *   DirectClient → MCP protocol Client → in-memory transport → this handler.
 *
 * Round-1 added the unwrap in `direct-server.ts` for the listTools/listResources
 * paths but missed this handler — so `this.fail(new PublicMcpError(...))` reached
 * the CLI as the sentinel "Flow ended with: fail" rather than the user's message.
 */
import { FlowControl } from '../../../common';
import { PublicMcpError } from '../../../errors';
import callToolRequestHandler from '../call-tool-request.handler';
import type { McpHandlerOptions } from '../mcp-handlers.types';

describe('callToolRequestHandler — FlowControl unwrap (#369)', () => {
  const mockLogger = {
    child: jest.fn(() => mockLogger),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };

  function buildScope(runFlowForOutput: jest.Mock) {
    return {
      logger: mockLogger,
      runFlowForOutput,
    } as unknown as McpHandlerOptions['scope'];
  }

  function buildRequest(name = 'divide') {
    return { params: { name, arguments: { a: 1, b: 0 } } } as never;
  }

  it('surfaces PublicMcpError.message and code when tool calls this.fail(new PublicMcpError(...))', async () => {
    const original = new PublicMcpError('Cannot divide by zero', 'INVALID_PARAMS');
    const fc = new FlowControl('fail', { error: original.message });
    (fc as { originalError?: Error }).originalError = original;

    const runFlowForOutput = jest.fn().mockRejectedValue(fc);
    const handler = callToolRequestHandler({ scope: buildScope(runFlowForOutput) } as McpHandlerOptions);

    const result = await handler.handler(buildRequest(), {} as never);

    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text?: string } | undefined)?.text;
    expect(text).toBe('Cannot divide by zero');
    const meta = (result as { _meta?: { code?: string } })._meta;
    expect(meta?.code).toBe('INVALID_PARAMS');
  });

  it('falls back to "Flow ended with: fail" when FlowControl.fail has no originalError attached', async () => {
    // Defensive — covers `new FlowControl('fail', ...)` constructed by hand
    // (without `FlowControl.fail(err)`), and the abort/handled branches.
    const fc = new FlowControl('fail', { error: 'manual' });
    const runFlowForOutput = jest.fn().mockRejectedValue(fc);
    const handler = callToolRequestHandler({ scope: buildScope(runFlowForOutput) } as McpHandlerOptions);

    const result = await handler.handler(buildRequest(), {} as never);

    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text?: string } | undefined)?.text;
    expect(text).toContain('Flow ended with: fail');
  });

  it('still surfaces the sentinel for FlowControl.abort', async () => {
    const fc = new FlowControl('abort', { reason: 'cancelled' });
    const runFlowForOutput = jest.fn().mockRejectedValue(fc);
    const handler = callToolRequestHandler({ scope: buildScope(runFlowForOutput) } as McpHandlerOptions);

    const result = await handler.handler(buildRequest(), {} as never);

    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text?: string } | undefined)?.text;
    expect(text).toContain('Flow ended with: abort');
  });
});
