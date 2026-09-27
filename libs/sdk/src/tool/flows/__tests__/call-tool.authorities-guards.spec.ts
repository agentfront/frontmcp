import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';

/**
 * A guard admits the caller only by returning `true` (#267). A guard that forgets to
 * `return`, or returns `null`, `0` or an object, refuses: it no longer lets everyone in.
 */

const guardResults: Record<string, unknown> = {
  forgets_to_return: undefined,
  returns_null: null,
  returns_zero: 0,
  returns_an_object: { granted: false },
  returns_true: true,
};

const tools = Object.entries(guardResults).map(([name, value]) => {
  @Tool({
    name,
    inputSchema: {},
    authorities: { guards: [(() => value) as unknown as () => boolean] },
  })
  class GuardedTool extends ToolContext {
    async execute() {
      return { ran: true };
    }
  }
  return GuardedTool;
});

@App({ id: 'desk', name: 'Desk', tools })
class DeskApp {}

describe('authorities guards on tools/call and tools/list', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'call-tool-authorities-guards', version: '1.0.0' },
      apps: [DeskApp],
      authorities: {},
    });
  });

  it('refuses a call unless the guard returns true', async () => {
    const outcomes: Record<string, unknown> = {};
    for (const name of Object.keys(guardResults)) {
      const { message } = await rpc20260728(server.handler, 'tools/call', { name, arguments: {} });
      const result = message.result as { isError?: boolean; _meta?: Record<string, unknown> };
      outcomes[name] = result.isError ? result._meta?.['code'] : 'ran';
    }

    expect(outcomes).toEqual({
      forgets_to_return: 'AUTHORITY_DENIED',
      returns_null: 'AUTHORITY_DENIED',
      returns_zero: 'AUTHORITY_DENIED',
      returns_an_object: 'AUTHORITY_DENIED',
      returns_true: 'ran',
    });
  });

  it('lists only the tools whose guard returns true', async () => {
    const { message } = await rpc20260728(server.handler, 'tools/list', {});

    expect((message.result?.['tools'] as Array<{ name: string }>).map((tool) => tool.name)).toEqual(['returns_true']);
  });
});
