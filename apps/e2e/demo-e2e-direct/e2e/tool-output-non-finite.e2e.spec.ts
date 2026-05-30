/**
 * E2E: non-finite tool output (Infinity / -Infinity / NaN) is rejected.
 *
 * Regression coverage for the bug where a tool returning a non-finite number was
 * silently serialized to `null` (JSON.stringify coerces it) with no validation.
 * The finalize-stage guard now throws `InvalidOutputError` unless the server opts
 * out via `@FrontMcp({ output: { allowNonFinite: true } })`. Exercised here through
 * a real tool call (the helper is unit-tested; this covers the flow wiring).
 */
import { App, FrontMcpInstance, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'non_finite_out',
  description: 'Returns a non-finite number to exercise output validation',
  inputSchema: {},
  outputSchema: { value: z.number() },
})
class NonFiniteTool extends ToolContext {
  async execute(): Promise<{ value: number }> {
    return { value: Infinity };
  }
}

@App({ name: 'NonFinite', description: 'Non-finite output fixture', tools: [NonFiniteTool] })
class NonFiniteApp {}

describe('non-finite tool output (E2E)', () => {
  it('rejects Infinity in tool output by default', async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'non-finite-e2e', version: '0.0.0' },
      apps: [NonFiniteApp],
      auth: { mode: 'public' as const },
    });
    try {
      // The error may surface as an isError result or a thrown rejection; accept either.
      let isError = false;
      try {
        const result = await server.callTool('non_finite_out', {});
        isError = result.isError === true;
      } catch {
        isError = true;
      }
      expect(isError).toBe(true);
    } finally {
      await server.dispose();
    }
  });

  it('allows non-finite output when output.allowNonFinite is true', async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'non-finite-allow-e2e', version: '0.0.0' },
      apps: [NonFiniteApp],
      auth: { mode: 'public' as const },
      output: { allowNonFinite: true },
    });
    try {
      const result = await server.callTool('non_finite_out', {});
      expect(result.isError).not.toBe(true);
    } finally {
      await server.dispose();
    }
  });
});
