import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { Agent, AgentContext, App, LogLevel, Tool, ToolContext } from '../../common';
import { type DirectAuthContext, type DirectMcpServer } from '../../direct';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

/**
 * The elicitation fallback (`sendElicitationResult`, for clients without native elicitation) must
 * either ask a caller it can hold to the answer, or refuse up front; and once its owner answers, it
 * must finish the call the owner made.
 *
 * - An anonymous caller on the stateless web transport was asked the question (the server made up a
 *   session for its request and took it for a verified one), then its answer was refused with
 *   `ELICITATION_NOT_OWNED`, since its next request got another session.
 * - The re-run handed the tool the request context object as its call context, so the tool lost
 *   its auth info: `this.auth` failed with "Cannot read properties of undefined (reading 'extra')".
 * - An agent that asked was re-run by its agent name, not by the `invoke_<agent>` tool the caller
 *   called: `Tool "triage" not found`.
 */

@Tool({ name: 'close_ticket', inputSchema: { id: z.string() } })
class CloseTicketTool extends ToolContext {
  async execute(input: { id: string }) {
    const answer = await this.elicit(`Close ticket ${input.id}?`, z.object({ confirm: z.boolean() }));
    return { closed: answer.status === 'accept' && answer.content?.confirm === true, by: this.auth.user.sub };
  }
}

@Agent({
  name: 'triage',
  inputSchema: { ticketId: z.string() },
  llm: {
    adapter: {
      async completion() {
        return { content: 'High', finishReason: 'stop' };
      },
    },
  },
})
class TriageAgent extends AgentContext {
  override async execute(input: { ticketId: string }) {
    const answer = await this.elicit(`Set ${input.ticketId} to high priority?`, z.object({ confirm: z.boolean() }));
    return { escalated: answer.status === 'accept' && answer.content?.confirm === true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [CloseTicketTool], agents: [TriageAgent] })
class DeskApp {}

const config = {
  info: { name: 'elicitation-fallback-rerun', version: '1.0.0' },
  apps: [DeskApp],
  elicitation: { enabled: true },
  logging: { level: LogLevel.Off },
};

interface ToolResultShape {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  _meta?: { elicitationPending?: { elicitId: string } };
}

async function callTool(
  server: DirectMcpServer,
  name: string,
  args: Record<string, unknown>,
  authContext: DirectAuthContext,
): Promise<ToolResultShape | string> {
  try {
    return (await server.callTool(name, args, { authContext })) as ToolResultShape;
  } catch (error) {
    return `${(error as Error).constructor.name}: ${(error as Error).message}`;
  }
}

async function askAndAnswer(server: DirectMcpServer, name: string, args: Record<string, unknown>) {
  const nour: DirectAuthContext = { user: { sub: 'nour' } };
  const asked = await callTool(server, name, args, nour);
  const elicitId = typeof asked === 'string' ? undefined : asked._meta?.elicitationPending?.elicitId;
  if (!elicitId) throw new Error(`${name} did not ask: ${JSON.stringify(asked)}`);
  return callTool(server, 'sendElicitationResult', { elicitId, action: 'accept', content: { confirm: true } }, nour);
}

describe('the elicitation fallback, answered by its owner through createDirect()', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect(config);
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('re-runs the tool with the owner’s auth', async () => {
    const answered = await askAndAnswer(server, 'close_ticket', { id: 'T-1' });

    expect(answered).toMatchObject({ structuredContent: { closed: true, by: 'nour' } });
  });

  it('re-runs the agent that asked, through the tool the caller called', async () => {
    const answered = await askAndAnswer(server, 'invoke_triage', { ticketId: 'T-1' });

    expect(answered).toMatchObject({ structuredContent: { escalated: true } });
  });
});

describe('the elicitation fallback for an anonymous caller on the stateless web transport', () => {
  it('is refused up front instead of asking a question whose answer would be refused', async () => {
    const server = await createTestFetchServer(config);

    const response = await server.handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'close_ticket', arguments: { id: 'T-1' } },
        }),
      }),
    );
    const body = await response.text();

    expect(body).not.toContain('elicitationPending');
    expect(body).toContain('does not support elicitation');
  });
});
