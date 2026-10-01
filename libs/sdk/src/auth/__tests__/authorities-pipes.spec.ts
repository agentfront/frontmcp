/**
 * `@FrontMcp({ authorities: { pipes } })` extends `this.auth` with the fields the pipes return. Pipes
 * may be async, so the flow that builds a context runs them before any code reads `this.auth`:
 * tools, resources, agents and jobs see the piped fields (#678).
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { type ReadResourceResult } from '@frontmcp/protocol';

import {
  Agent,
  AgentContext,
  App,
  Job,
  JobContext,
  LogLevel,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

declare global {
  interface ExtendFrontMcpAuthContext {
    team?: string;
    tenant?: string;
  }
}

function piped(auth: { team?: string; tenant?: string; user: { sub: string } }) {
  return { team: auth.team ?? null, tenant: auth.tenant ?? null, sub: auth.user.sub };
}

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return piped(this.auth);
  }
}

@Resource({ name: 'whoami', uri: 'auth://whoami' })
class WhoAmIResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: JSON.stringify(piped(this.auth)) }] };
  }
}

@Agent({
  name: 'who_agent',
  inputSchema: {},
  llm: { adapter: { completion: async () => ({ content: 'unused', finishReason: 'stop' as const }) } },
})
class WhoAgent extends AgentContext {
  override async execute() {
    return piped(this.auth);
  }
}

@Job({
  name: 'who_job',
  inputSchema: {},
  outputSchema: { team: z.string().nullable(), tenant: z.string().nullable(), sub: z.string() },
})
class WhoJob extends JobContext {
  async execute() {
    return piped(this.auth);
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  tools: [WhoAmITool],
  resources: [WhoAmIResource],
  agents: [WhoAgent],
  jobs: [WhoJob],
})
class DeskApp {}

const CALLER = { authContext: { sessionId: 'session-pipes', user: { sub: 'alice' } } };
const EXPECTED = { team: 'billing', tenant: 'tenant-of-alice', sub: 'alice' };

describe('authorities pipes', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'authorities-pipes', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
      jobs: { enabled: true },
      authorities: {
        pipes: [
          () => ({ team: 'billing' }),
          async (claims: Readonly<Record<string, unknown>>) => ({ tenant: `tenant-of-${String(claims['sub'])}` }),
        ],
      },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('run before a tool reads this.auth', async () => {
    const result = await server.callTool('whoami', {}, CALLER);
    expect(result.structuredContent).toEqual(EXPECTED);
  });

  it('run before a resource reads this.auth', async () => {
    const result = await server.readResource('auth://whoami', CALLER);
    expect(JSON.parse((result.contents[0] as { text: string }).text)).toEqual(EXPECTED);
  });

  it('run before an agent reads this.auth', async () => {
    const result = await server.callTool('invoke_who_agent', {}, CALLER);
    expect(result.structuredContent).toEqual(EXPECTED);
  });

  it('run before a job reads this.auth', async () => {
    const result = await server.callTool('execute_job', { name: 'who_job', input: {} }, CALLER);
    expect((result.structuredContent as { result?: unknown }).result).toEqual(EXPECTED);
  });
});
