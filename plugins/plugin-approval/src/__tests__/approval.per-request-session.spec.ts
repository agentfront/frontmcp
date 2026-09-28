/**
 * MCP 2026-07-28 has no sessions: a session approval of a caller that speaks it belongs to the
 * caller, whatever `mcp-session-id` a request carries.
 *
 * The server mints a session id for every request of a static-key caller, and a tool can see it. A
 * request that sent one back as `mcp-session-id` counted as that session, so its approvals were
 * looked up (and granted) under an id no other request of the caller has.
 */
import 'reflect-metadata';

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
