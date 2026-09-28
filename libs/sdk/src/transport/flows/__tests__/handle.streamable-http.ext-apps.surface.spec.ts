/**
 * An MCP App's `ui/callServerTool` is a call from the MCP client the widget runs in, so it carries
 * the `'mcp'` surface like the client's own `tools/call`: a tool whose `availableWhen.surface`
 * leaves out `'mcp'` (an agent-only tool, say) is not found, and a tool it reaches sees `'mcp'`
 * as `getCallSurface()`.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { App, LogLevel, Tool, ToolContext } from '../../../common';
import { getCallSurface } from '../../../context/call-surface';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

const runs: Array<{ tool: string; surface: string | null }> = [];

function surfaceTool(name: string, surface?: Array<'mcp' | 'agent'>) {
  @Tool({ name, inputSchema: {}, ...(surface ? { availableWhen: { surface } } : {}) })
  class SurfaceTool extends ToolContext {
    async execute() {
      runs.push({ tool: name, surface: getCallSurface() ?? null });
      return { ran: name };
    }
  }
  return SurfaceTool;
}

@App({ id: 'desk', name: 'Desk', tools: [surfaceTool('open_ticket'), surfaceTool('agent_only', ['agent'])] })
class DeskApp {}

describe('ui/callServerTool surface', () => {
  let node: http.Server;
  let base: string;
  let sessionId: string;

  const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${base}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
    });

  beforeAll(async () => {
    const app = (await FrontMcpInstance.createHandler({
      info: { name: 'desk-ext-apps', version: '1.0.0' },
      logging: { level: LogLevel.Off },
      apps: [DeskApp],
    })) as http.RequestListener;
    node = http.createServer(app);
    await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;

    const initialized = await post({
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'host', version: '1.0.0' } },
    });
    sessionId = initialized.headers.get('mcp-session-id') ?? '';
    await initialized.text();
    expect(sessionId).not.toBe('');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => node.close(() => resolve()));
  });

  beforeEach(() => {
    runs.length = 0;
  });

  async function callServerTool(name: string): Promise<string> {
    const response = await post(
      { method: 'ui/callServerTool', params: { name, arguments: {} } },
      { 'mcp-session-id': sessionId },
    );
    return response.text();
  }

  it("runs a tool offered to MCP clients on the 'mcp' surface", async () => {
    const answer = await callServerTool('open_ticket');

    expect(answer).toContain('open_ticket');
    expect(runs).toEqual([{ tool: 'open_ticket', surface: 'mcp' }]);
  });

  it("does not reach a tool whose surface leaves out 'mcp'", async () => {
    const answer = await callServerTool('agent_only');

    expect(runs).toEqual([]);
    expect(answer).toContain('not found');
  });
});
