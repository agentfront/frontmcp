/**
 * A validation error (`ZodError`) thrown while a request runs is that request's failure. It was taken for an
 * invalid server configuration, so a route (or any flow) that validated its input with zod answered 500
 * `server_misconfigured` with CONFIG_INVALID ("the server refuses to start").
 *
 * Driven over the fetch handler and the Node server.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, HttpRoute, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { HttpRouteContext } from '../../common/interfaces/http-route.interface';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const orderSchema = z.object({ orderId: z.string() });

@Tool({ name: 'find_order', inputSchema: {} })
class FindOrderTool extends ToolContext {
  async execute() {
    return orderSchema.parse({});
  }
}

@HttpRoute({ method: 'GET', path: '/orders', auth: 'public' })
class OrdersRoute extends HttpRouteContext {
  handle() {
    return orderSchema.parse(this.request.query);
  }
}

@App({ id: 'desk', name: 'Desk', tools: [FindOrderTool], routes: [OrdersRoute] })
class DeskApp {}

const CONFIG: FrontMcpConfigInput = {
  info: { name: 'desk', version: '1.0.0' },
  logging: { level: LogLevel.Off },
  apps: [DeskApp],
};

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spec-client', version: '1.0.0' } },
};

type Send = (path: string, init?: RequestInit) => Promise<Response>;

const fetchServers: TestFetchServer[] = [];
let nodeServer: http.Server | undefined;

async function overFetchHandler(): Promise<Send> {
  const server = await createTestFetchServer(CONFIG);
  fetchServers.push(server);
  return (path, init) => server.handler(new Request(`http://localhost${path}`, init));
}

async function overNodeServer(): Promise<Send> {
  const listener = (await FrontMcpInstance.createHandler(CONFIG)) as http.RequestListener;
  const server = http.createServer(listener);
  nodeServer = server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
}

afterAll(async () => {
  await disposeServers(fetchServers);
  await new Promise<void>((resolve) => (nodeServer ? nodeServer.close(() => resolve()) : resolve()));
});

describe.each<[string, () => Promise<Send>]>([
  ['the fetch handler', overFetchHandler],
  ['the Node server', overNodeServer],
])('a validation error thrown while a request runs, over %s', (_transport, start) => {
  let send: Send;

  beforeAll(async () => {
    send = await start();
  });

  it('is not a server misconfiguration when a route throws it', async () => {
    const response = await send('/orders');

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('server_misconfigured');
  });

  it('is the error of the tool call when a tool throws it', async () => {
    const initialized = await send('/', { method: 'POST', headers: MCP_HEADERS, body: JSON.stringify(INITIALIZE) });
    const sessionId = initialized.headers.get('mcp-session-id');
    await initialized.text();

    const response = await send('/', {
      method: 'POST',
      headers: { ...MCP_HEADERS, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'find_order', arguments: {} },
      }),
    });

    expect(response.status).toBe(200);
    const answer = await response.text();
    expect(answer).toContain('TOOL_EXECUTION_ERROR');
    expect(answer).not.toContain('server_misconfigured');
  });
});
