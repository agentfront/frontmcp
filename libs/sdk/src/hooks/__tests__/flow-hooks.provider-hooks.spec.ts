/**
 * Hooks declared on providers run like the hooks of an app's GLOBAL providers (#678):
 * - a server-level provider (`@FrontMcp({ providers })`) hooks every app's entries;
 * - a CONTEXT-scoped provider's hook runs on the instance built for the request, the same instance
 *   the request's tools resolve.
 */
import 'reflect-metadata';

import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { App, LogLevel, Provider, ProviderScope, Tool, ToolContext, ToolHook, type FlowCtxOf } from '../../index';

const runs: string[] = [];

@Provider({ name: 'server-audit' })
class ServerAudit {
  @ToolHook.Will('execute')
  beforeExecute(ctx: FlowCtxOf<'tools:call-tool'>) {
    runs.push(`server:${ctx.state.tool?.name}`);
  }
}

let built = 0;

@Provider({ name: 'request-trace', scope: ProviderScope.CONTEXT })
class RequestTrace {
  readonly id = ++built;
  readonly seen: string[] = [];

  @ToolHook.Will('execute')
  beforeExecute(ctx: FlowCtxOf<'tools:call-tool'>) {
    this.seen.push(`will:${ctx.state.tool?.name}`);
    runs.push(`context:${this.id}:${ctx.state.tool?.name}`);
  }
}

@Tool({ name: 'traced', inputSchema: {} })
class TracedTool extends ToolContext {
  async execute() {
    const trace = this.get(RequestTrace);
    return { id: trace.id, seen: [...trace.seen] };
  }
}

@Tool({ name: 'plain', inputSchema: {} })
class PlainTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'traced', name: 'Traced', providers: [RequestTrace], tools: [TracedTool] })
class TracedApp {}

@App({ id: 'plain', name: 'Plain', tools: [PlainTool] })
class PlainApp {}

const CALLER = { authContext: { sessionId: 'session-provider-hooks', user: { sub: 'alice' } } };

describe('hooks declared on providers', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'provider-hooks', version: '1.0.0' },
      apps: [TracedApp, PlainApp],
      providers: [ServerAudit],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    runs.length = 0;
  });

  it('run for every app when the provider is declared on the server', async () => {
    await server.callTool('traced', {}, CALLER);
    await server.callTool('plain', {}, CALLER);

    expect(runs.filter((run) => run.startsWith('server:'))).toEqual(['server:traced', 'server:plain']);
  });

  it('run a CONTEXT-scoped provider hook on the instance the request resolves', async () => {
    const result = await server.callTool('traced', {}, { authContext: { sessionId: 'session-a', user: { sub: 'a' } } });
    const { id, seen } = result.structuredContent as { id: number; seen: string[] };

    expect(seen).toEqual(['will:traced']);
    expect(runs.filter((run) => run.startsWith('context:'))).toEqual([`context:${id}:traced`]);
  });

  it('run a CONTEXT-scoped provider hook only for its own app', async () => {
    await server.callTool('plain', {}, CALLER);

    expect(runs.filter((run) => run.startsWith('context:'))).toEqual([]);
  });

  it('run a CONTEXT-scoped provider hook on the instance of each session', async () => {
    const first = await server.callTool('traced', {}, { authContext: { sessionId: 'session-b', user: { sub: 'b' } } });
    const second = await server.callTool('traced', {}, { authContext: { sessionId: 'session-c', user: { sub: 'c' } } });

    const [a, b] = [first, second].map((r) => r.structuredContent as { id: number; seen: string[] });
    expect(a.id).not.toBe(b.id);
    expect(a.seen).toEqual(['will:traced']);
    expect(b.seen).toEqual(['will:traced']);
  });
});
