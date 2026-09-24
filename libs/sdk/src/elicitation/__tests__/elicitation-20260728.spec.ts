import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../common';

interface InputRequest {
  method: string;
  params: { message: string; requestedSchema?: Record<string, unknown> };
}

interface ToolCallResult {
  resultType?: string;
  inputRequests?: Record<string, InputRequest>;
  requestState?: string;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

@Tool({ name: 'order_shirt', inputSchema: {} })
class OrderShirtTool extends ToolContext {
  async execute() {
    const answer = await this.elicit('Which size?', z.object({ size: z.enum(['S', 'M', 'L']) }));
    const size: unknown = answer.content?.size;
    return { status: answer.status, size, typeofSize: typeof size };
  }
}

@App({ id: 'shop', name: 'Shop', tools: [OrderShirtTool] })
class ShopApp {}

const ELICITATION_CAPABILITIES = { elicitation: { form: {} } };

describe('elicitation under MCP 2026-07-28', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'elicitation-20260728', version: '1.0.0' },
      apps: [ShopApp],
      elicitation: { enabled: true },
    });
  });

  async function listToolNames(capabilities?: Record<string, unknown>): Promise<string[]> {
    const { message } = await rpc20260728(server.handler, 'tools/list', {}, { capabilities });
    const tools = (message.result?.['tools'] as Array<{ name: string }> | undefined) ?? [];
    return tools.map((tool) => tool.name);
  }

  it('rejects an accepted answer whose content does not match the requested schema with INVALID_INPUT', async () => {
    const firstRound = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'order_shirt', arguments: {} },
      { capabilities: ELICITATION_CAPABILITIES },
    );
    const inputRequired = firstRound.message.result as ToolCallResult | undefined;
    expect(inputRequired?.resultType).toBe('input_required');
    const [inputKey] = Object.keys(inputRequired?.inputRequests ?? {});

    const secondRound = await rpc20260728(
      server.handler,
      'tools/call',
      {
        name: 'order_shirt',
        arguments: {},
        inputResponses: { [inputKey]: { action: 'accept', content: { size: 42 } } },
        requestState: inputRequired?.requestState,
      },
      { capabilities: ELICITATION_CAPABILITIES },
    );
    const answered = secondRound.message.result as ToolCallResult | undefined;
    const refusalCode = secondRound.message.error?.code ?? answered?._meta?.['code'];

    expect(answered?.structuredContent).toBeUndefined();
    expect([-32602, 'INVALID_INPUT']).toContain(refusalCode);
  });

  it('does not list sendElicitationResult to a client that declares the elicitation capability', async () => {
    const toolNames = await listToolNames(ELICITATION_CAPABILITIES);

    expect(toolNames).toContain('order_shirt');
    expect(toolNames).not.toContain('sendElicitationResult');
  });

  it('does not list sendElicitationResult to a 2026-07-28 client without the elicitation capability', async () => {
    const toolNames = await listToolNames();

    expect(toolNames).toContain('order_shirt');
    expect(toolNames).not.toContain('sendElicitationResult');
  });
});
