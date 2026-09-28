/**
 * MCP 2026-07-28 has no sessions: a session approval of a caller that speaks it belongs to the
 * caller, whatever `mcp-session-id` a request carries.
 *
 * The server mints a session id for every request of a static-key caller, and a tool can see it. A
 * request that sent one back as `mcp-session-id` counted as that session, so its approvals were
 * looked up (and granted) under an id no other request of the caller has.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { z } from '@frontmcp/lazy-zod';
import { App, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';
import { createMemoryStorage } from '@frontmcp/utils';

import { ApprovalPlugin } from '../index';

const DEPLOY_TOOL_ID = 'ops:deploy_service';
const STATIC_KEY = 'sk-ops-static-key-0001';
const executedDeployments: string[] = [];

@Tool({ name: 'deploy_service', inputSchema: { service: z.string() }, approval: { required: true } })
class DeployServiceTool extends ToolContext {
  async execute(input: { service: string }) {
    executedDeployments.push(input.service);
    return { deployed: input.service };
  }
}

@Tool({ name: 'approve_deploy', inputSchema: {} })
class ApproveDeployTool extends ToolContext {
  async execute() {
    await this.approval.grantSessionApproval(DEPLOY_TOOL_ID);
    return { approved: true };
  }
}

/** The id the request's transport carries, which the server made up for this one request. */
@Tool({ name: 'request_session', inputSchema: {} })
class RequestSessionTool extends ToolContext {
  async execute() {
    return { sessionId: this.authInfo.sessionId ?? null };
  }
}

type FetchHandler = (request: Request) => Promise<Response>;

let nextRequestId = 1;

async function callTool(
  handler: FetchHandler,
  name: string,
  args: Record<string, unknown> = {},
  sessionId?: string,
): Promise<string> {
  const response = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${STATIC_KEY}`,
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': name,
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextRequestId++,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'approval-spec', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  );
  return response.text();
}

describe('session approval of a static-key caller over MCP 2026-07-28', () => {
  let handler: FetchHandler;
  let mintedSessionId: string;

  beforeEach(async () => {
    executedDeployments.length = 0;
    const storage = createMemoryStorage();
    await storage.connect();

    @App({
      id: 'ops',
      name: 'Ops',
      plugins: [ApprovalPlugin.init({ storageInstance: storage })],
      tools: [DeployServiceTool, ApproveDeployTool, RequestSessionTool],
    })
    class OpsApp {}

    handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'approval-per-request-session', version: '1.0.0' },
      apps: [OpsApp],
      auth: { mode: 'static', tokens: [STATIC_KEY] },
      logging: { level: LogLevel.Off },
    });
    const body = JSON.parse(await callTool(handler, 'request_session')) as {
      result?: { structuredContent?: { sessionId?: string | null } };
    };
    const sessionId = body.result?.structuredContent?.sessionId;
    if (!sessionId) throw new Error('the request carried no session id');
    mintedSessionId = sessionId;
  });

  it('is found by a request that sends back a session id the server made up', async () => {
    await callTool(handler, 'approve_deploy');

    await callTool(handler, 'deploy_service', { service: 'api' }, mintedSessionId);

    expect(executedDeployments).toEqual(['api']);
  });

  it('granted by a request that sent such an id, is found by the caller’s next request', async () => {
    await callTool(handler, 'approve_deploy', {}, mintedSessionId);

    await callTool(handler, 'deploy_service', { service: 'api' });

    expect(executedDeployments).toEqual(['api']);
  });
});

/**
 * A legacy SSE session is a session: its approvals stay with it. The request context never counted
 * it as verified (its id arrives in `?sessionId=`), so a session approval of a static-key caller
 * was keyed by the key instead, and every other SSE session of that key used it.
 */
describe('session approval of a static-key caller over legacy SSE sessions', () => {
  let node: http.Server;
  let base: string;
  const open: AbortController[] = [];
  let sseRequestId = 1;

  beforeAll(async () => {
    const storage = createMemoryStorage();
    await storage.connect();

    @App({
      id: 'ops',
      name: 'Ops',
      plugins: [ApprovalPlugin.init({ storageInstance: storage })],
      tools: [DeployServiceTool, ApproveDeployTool],
    })
    class OpsApp {}

    const app = (await FrontMcpInstance.createHandler({
      info: { name: 'approval-sse-session', version: '1.0.0' },
      apps: [OpsApp],
      auth: { mode: 'static', tokens: [STATIC_KEY] },
      logging: { level: LogLevel.Off },
    })) as http.RequestListener;
    node = http.createServer(app);
    await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    executedDeployments.length = 0;
  });

  afterAll(async () => {
    for (const controller of open) controller.abort();
    await new Promise<void>((resolve) => {
      node.close(() => resolve());
      node.closeAllConnections();
    });
    // Let the server finish closing the sessions of the connections it just dropped.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  /** A legacy SSE session: responses arrive on the stream, requests go to the endpoint it names. */
  async function openSseSession(): Promise<(name: string, args?: Record<string, unknown>) => Promise<string>> {
    const abort = new AbortController();
    open.push(abort);
    const authorization = `Bearer ${STATIC_KEY}`;
    const stream = await fetch(`${base}/sse`, {
      headers: { accept: 'text/event-stream', authorization },
      signal: abort.signal,
    });
    if (!stream.body) throw new Error(`the SSE stream has no body (HTTP ${stream.status})`);
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';

    async function nextData(): Promise<string> {
      for (;;) {
        const end = buffered.indexOf('\n\n');
        if (end >= 0) {
          const raw = buffered.slice(0, end);
          buffered = buffered.slice(end + 2);
          return raw
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trim())
            .join('');
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('the SSE stream ended');
        buffered += decoder.decode(value, { stream: true });
      }
    }

    const endpoint = new URL(await nextData(), base);
    const send = (body: Record<string, unknown>) =>
      fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization },
        body: JSON.stringify(body),
      });

    async function request(method: string, params: Record<string, unknown>): Promise<string> {
      const id = sseRequestId++;
      await (await send({ jsonrpc: '2.0', id, method, params })).text();
      for (;;) {
        const data = await nextData();
        if (data && (JSON.parse(data) as { id?: number }).id === id) return data;
      }
    }

    const clientInfo = { name: 'approval-spec', version: '1' };
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo });
    await (await send({ jsonrpc: '2.0', method: 'notifications/initialized' })).text();
    return (name, args = {}) => request('tools/call', { name, arguments: args });
  }

  it('is used by a later request of the same session', async () => {
    const call = await openSseSession();
    await call('approve_deploy');

    await call('deploy_service', { service: 'from-session' });

    expect(executedDeployments).toEqual(['from-session']);
  });

  it('is not used by another SSE session of the same key', async () => {
    const [granting, other] = [await openSseSession(), await openSseSession()];
    await granting('approve_deploy');

    const response = await other('deploy_service', { service: 'from-other-session' });

    expect(response).toContain('requires approval');
    expect(executedDeployments).toEqual([]);
  });
});
