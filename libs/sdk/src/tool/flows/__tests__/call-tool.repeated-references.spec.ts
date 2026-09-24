import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';

const expectedTicket = {
  id: 'T-1',
  reporter: { id: 'u1', name: 'Alice' },
  assignee: { id: 'u1', name: 'Alice' },
  tags: [{ label: 'urgent' }, { label: 'urgent' }],
};

@Tool({ name: 'get_ticket', inputSchema: {} })
class GetTicketTool extends ToolContext {
  async execute() {
    const alice = { id: 'u1', name: 'Alice' };
    const urgent = { label: 'urgent' };
    return { id: 'T-1', reporter: alice, assignee: alice, tags: [urgent, urgent] };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [GetTicketTool] })
class DeskApp {}

describe('tools/call result with repeated object references', () => {
  let server: TestFetchServer;
  let result: Record<string, unknown>;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'repeated-refs', version: '1.0.0' }, apps: [DeskApp] });
    const { message } = await rpc20260728(server.handler, 'tools/call', { name: 'get_ticket', arguments: {} });
    result = message.result ?? {};
  });

  it('keeps every repeated reference in structuredContent', () => {
    expect(result['structuredContent']).toEqual(expectedTicket);
  });

  it('keeps every repeated reference in the text content block', () => {
    const [firstBlock] = (result['content'] as Array<{ type: string; text?: string }> | undefined) ?? [];

    expect(JSON.parse(firstBlock?.text ?? 'null')).toEqual(expectedTicket);
  });
});
