import 'reflect-metadata';

import { LogLevel, Tool, ToolContext } from '../../common';
import { create } from '../create';
import { type DirectMcpServer } from '../direct.types';

/**
 * A browser build has no AsyncContext, so the server runs one request at a time
 * (`#async-context` → `browser-async-context.ts`). A runtime tool's `execute` is page code: it must
 * not hold that turn, or a tool that calls its own server back (or waits on the network) would stall
 * every other request, or wait for itself forever.
 */
jest.mock('#async-context', () => jest.requireActual('../../../../utils/src/async-context/browser-async-context'));

@Tool({ name: 'static_tool', inputSchema: {} })
class StaticTool extends ToolContext {
  async execute() {
    return { ran: 'static_tool' };
  }
}

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

describe('runtime tools on the browser async-context runtime', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await create({
      info: { name: 'runtime-tools-browser', version: '1.0.0' },
      tools: [StaticTool],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('lets a runtime tool call its own server back', async () => {
    const unregister = await server.registerTool({
      name: 'call_back',
      execute: async () => {
        const inner = await server.callTool('static_tool');
        return text(`inner:${JSON.stringify(inner.structuredContent ?? inner.content)}`);
      },
    });

    const result = await server.callTool('call_back');
    unregister();

    expect(JSON.stringify(result)).toContain('static_tool');
  });

  it('serves other requests while a runtime tool waits', async () => {
    let finish: () => void = () => undefined;
    const unregister = await server.registerTool({
      name: 'slow',
      execute: () => new Promise((resolve) => (finish = () => resolve(text('slow done')))),
    });

    const slow = server.callTool('slow');
    const other = await server.callTool('static_tool');
    finish();
    const slowResult = await slow;
    unregister();

    expect(other.isError).toBeFalsy();
    expect(slowResult).toEqual(text('slow done'));
  });
});
