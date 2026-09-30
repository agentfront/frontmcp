/**
 * An agent reply that fails its `outputSchema` is reported like a tool's:
 * `INVALID_OUTPUT` with the field that did not match, and no stack trace or
 * server file paths in the result.
 *
 * `invoke_<agent>` runs the `agents:call-agent` flow inside the outer
 * `tools:call-tool` flow, which wrapped the flow's `InvalidOutputError` into a
 * `TOOL_EXECUTION_ERROR` carrying `Original error:` and the stack.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { Agent, AgentContext, App } from '../../common';

const outputSchema = z.object({ priority: z.enum(['low', 'normal', 'high']) });

@Agent({
  name: 'triage_enum',
  inputSchema: {},
  outputSchema,
  llm: { adapter: { completion: async () => ({ content: '{"priority":"urgent"}', finishReason: 'stop' as const }) } },
})
class TriageEnumAgent extends AgentContext {}

@Agent({
  name: 'triage_text',
  inputSchema: {},
  outputSchema,
  llm: { adapter: { completion: async () => ({ content: 'I could not decide', finishReason: 'stop' as const }) } },
})
class TriageTextAgent extends AgentContext {}

@Agent({
  name: 'triage_ok',
  inputSchema: {},
  outputSchema,
  llm: { adapter: { completion: async () => ({ content: '{"priority":"high"}', finishReason: 'stop' as const }) } },
})
class TriageOkAgent extends AgentContext {}

@App({ id: 'triage', name: 'Triage', agents: [TriageEnumAgent, TriageTextAgent, TriageOkAgent] })
class TriageApp {}

describe('invoke_<agent> output validation', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'agent-output', version: '1.0.0' }, apps: [TriageApp] });
  });

  async function invoke(name: string) {
    const { message } = await rpc20260728(server.handler, 'tools/call', { name, arguments: {} });
    const result = message.result ?? {};
    const meta = result['_meta'] as Record<string, unknown> | undefined;
    const content = (result['content'] as Array<{ text?: string }> | undefined) ?? [];
    return {
      isError: result['isError'] === true,
      code: meta?.['code'],
      text: content.map((block) => block.text ?? '').join('\n'),
    };
  }

  it('reports INVALID_OUTPUT, not TOOL_EXECUTION_ERROR, when a field is outside the enum', async () => {
    const { isError, code, text } = await invoke('invoke_triage_enum');

    expect({ isError, code }).toEqual({ isError: true, code: 'INVALID_OUTPUT' });
    expect(text).toContain('Tool output validation failed');
    expect(text).toContain('output does not match outputSchema at priority');
  });

  it('reports INVALID_OUTPUT when the model answers with text that is not JSON', async () => {
    const { isError, code } = await invoke('invoke_triage_text');

    expect({ isError, code }).toEqual({ isError: true, code: 'INVALID_OUTPUT' });
  });

  it.each(['invoke_triage_enum', 'invoke_triage_text'])(
    'leaves no stack trace or file path in the %s result',
    async (name) => {
      const { text } = await invoke(name);

      expect(text).not.toContain('Original error');
      expect(text).not.toMatch(/\n\s+at\s/);
      expect(text).not.toMatch(/file:\/\/|\.mjs|\.js:\d+|\.ts:\d+/);
      expect(text).not.toContain('CallAgentFlow');
    },
  );

  it('still answers a valid reply', async () => {
    const { isError, code } = await invoke('invoke_triage_ok');

    expect({ isError, code }).toEqual({ isError: false, code: undefined });
  });
});
