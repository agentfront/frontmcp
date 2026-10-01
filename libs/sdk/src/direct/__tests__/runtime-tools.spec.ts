import 'reflect-metadata';

import { App, LogLevel, Plugin, Tool, ToolContext, type FlowCtxOf } from '../../common';
import { EntryValidationError, InternalMcpError, ToolNameConflictError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { ToolHook } from '../../index';
import { type DirectClient } from '../client.types';
import { create } from '../create';
import { type DirectMcpServer, type RuntimeToolDefinition } from '../direct.types';

/**
 * `server.registerTool()` adds a tool to a running server, for code outside it (a React component,
 * a page script). The tool must be a regular server tool: listed, run by the `tools:call-tool` flow
 * (so hooks apply), and announced to connected clients with `notifications/tools/list_changed`.
 */

/** Every tool the call-tool flow's `execute` stage ran, as a hook saw it. */
const executed: string[] = [];

@Plugin({ name: 'execute-recorder' })
class ExecuteRecorderPlugin {
  @ToolHook.Will('execute')
  record(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool } = flowCtx.state;
    if (tool) executed.push(tool.metadata.name);
  }
}

@Tool({ name: 'static_tool', inputSchema: {} })
class StaticTool extends ToolContext {
  async execute() {
    return { ran: 'static_tool' };
  }
}

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

function echoTool(overrides: Partial<RuntimeToolDefinition> = {}): RuntimeToolDefinition {
  return {
    name: 'echo',
    title: 'Echo',
    description: 'Echoes its message',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    annotations: { readOnlyHint: true },
    execute: (args) => text(String(args['message'])),
    ...overrides,
  };
}

describe('DirectMcpServer.registerTool()', () => {
  let server: DirectMcpServer;
  const unregisters: Array<() => void> = [];

  beforeEach(async () => {
    executed.length = 0;
    server = await create({
      info: { name: 'runtime-tools', version: '1.0.0' },
      tools: [StaticTool],
      plugins: [ExecuteRecorderPlugin],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    for (const unregister of unregisters.splice(0)) unregister();
    await server.dispose();
  });

  async function register(definition: RuntimeToolDefinition): Promise<() => void> {
    const unregister = await server.registerTool(definition);
    unregisters.push(unregister);
    return unregister;
  }

  it('lists the tool with the schema, title, description and annotations it was given', async () => {
    await register(echoTool());

    const { tools } = await server.listTools();

    expect(tools.find((tool) => tool.name === 'echo')).toEqual(
      expect.objectContaining({
        name: 'echo',
        title: 'Echo',
        description: 'Echoes its message',
        inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
        annotations: expect.objectContaining({ readOnlyHint: true }),
      }),
    );
  });

  it('lists a tool without an input schema as taking an empty object', async () => {
    await register(echoTool({ inputSchema: undefined }));

    const { tools } = await server.listTools();

    expect(tools.find((tool) => tool.name === 'echo')?.inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('runs the tool through the call-tool flow, passing its arguments and an abort signal', async () => {
    const execute = jest.fn((args: Record<string, unknown>) => text(`hello ${String(args['message'])}`));
    await register(echoTool({ execute }));

    const result = await server.callTool('echo', { message: 'world' });

    expect(result).toEqual(text('hello world'));
    expect(execute).toHaveBeenCalledWith({ message: 'world' }, { signal: expect.any(AbortSignal) });
    expect(executed).toEqual(['echo']);
  });

  it('passes no arguments as an empty object', async () => {
    const execute = jest.fn(() => text('ok'));
    await register(echoTool({ execute }));

    await server.callTool('echo');

    expect(execute).toHaveBeenCalledWith({}, expect.anything());
  });

  it('reports an execute that throws as a failed call', async () => {
    await register(
      echoTool({
        execute: () => {
          throw new Error('cart is locked');
        },
      }),
    );

    const outcome = await server.callTool('echo', { message: 'x' }).then(
      (result) => ({ isError: result.isError === true }),
      () => ({ isError: true }),
    );

    expect(outcome).toEqual({ isError: true });
  });

  it('removes the tool when unregistered, and unregistering twice is harmless', async () => {
    const unregister = await register(echoTool());

    unregister();
    unregister();
    const { tools } = await server.listTools();

    expect(tools.map((tool) => tool.name)).not.toContain('echo');
    const outcome = await server.callTool('echo', { message: 'x' }).then(
      (result) => (result.isError ? 'error' : 'ran'),
      () => 'error',
    );
    expect(outcome).toBe('error');
  });

  it('can register the same name again after unregistering it', async () => {
    const unregister = await register(echoTool());
    unregister();

    await register(echoTool({ execute: () => text('second') }));

    expect(await server.callTool('echo', { message: 'x' })).toEqual(text('second'));
  });

  it('honors availableWhen: a webmcp-only tool is not offered to MCP callers', async () => {
    await register(echoTool({ availableWhen: { surface: ['webmcp'] } }));

    const { tools } = await server.listTools();

    expect(tools.map((tool) => tool.name)).not.toContain('echo');
  });

  it('refuses a name a server tool already has', async () => {
    await expect(server.registerTool(echoTool({ name: 'static_tool' }))).rejects.toThrow(ToolNameConflictError);
  });

  it('refuses a name another runtime tool already has', async () => {
    await register(echoTool());

    await expect(server.registerTool(echoTool())).rejects.toThrow(ToolNameConflictError);
  });

  it('refuses the second of two registrations racing for one name', async () => {
    const outcomes = await Promise.allSettled([server.registerTool(echoTool()), server.registerTool(echoTool())]);

    for (const outcome of outcomes) if (outcome.status === 'fulfilled') unregisters.push(outcome.value);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it.each([
    ['an empty name', echoTool({ name: '' })],
    ['a name over 64 characters', echoTool({ name: 'x'.repeat(65) })],
    ['no execute function', { ...echoTool(), execute: undefined } as unknown as RuntimeToolDefinition],
  ])('refuses %s', async (_label, definition) => {
    await expect(server.registerTool(definition)).rejects.toThrow(EntryValidationError);
  });

  it('refuses to register on a disposed server', async () => {
    await server.dispose();

    await expect(server.registerTool(echoTool())).rejects.toThrow(InternalMcpError);
  });

  describe('a connected client', () => {
    let client: DirectClient;
    const notifications: string[] = [];

    beforeEach(async () => {
      notifications.length = 0;
      client = await server.connect();
      client.onNotification((notification) => {
        notifications.push(notification.method);
      });
    });

    afterEach(async () => {
      await client.close();
    });

    async function settle() {
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('is told the tool list changed when a tool is registered and unregistered', async () => {
      const unregister = await register(echoTool());
      await settle();
      const afterRegister = notifications.filter((method) => method === 'notifications/tools/list_changed').length;

      unregister();
      await settle();
      const afterUnregister = notifications.filter((method) => method === 'notifications/tools/list_changed').length;

      expect(afterRegister).toBeGreaterThanOrEqual(1);
      expect(afterUnregister).toBeGreaterThan(afterRegister);
    });

    it('calls the tool through MCP', async () => {
      await register(echoTool());

      const result = await client.callTool('echo', { message: 'over mcp' });

      expect(JSON.stringify(result)).toContain('over mcp');
    });
  });
});

describe('DirectMcpServer.registerTool() on a server with several apps', () => {
  @Tool({ name: 'billing_tool', inputSchema: {} })
  class BillingTool extends ToolContext {
    async execute() {
      return {};
    }
  }

  @App({ id: 'billing', name: 'Billing', tools: [BillingTool], plugins: [ExecuteRecorderPlugin] })
  class BillingApp {}

  @App({ id: 'support', name: 'Support', tools: [StaticTool] })
  class SupportApp {}

  let server: DirectMcpServer;

  beforeEach(async () => {
    executed.length = 0;
    server = await FrontMcpInstance.createDirect({
      info: { name: 'runtime-tools-multi', version: '1.0.0' },
      apps: [BillingApp, SupportApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('needs to be told which app the tool joins', async () => {
    await expect(server.registerTool(echoTool())).rejects.toThrow(/must name its app \(one of: billing, support\)/);
  });

  it("joins the app it names, whose plugins' hooks then apply to it", async () => {
    const unregister = await server.registerTool(echoTool({ app: 'billing' }));

    await server.callTool('echo', { message: 'x' });
    unregister();

    expect(executed).toEqual(['echo']);
  });

  it('refuses an app that is not there', async () => {
    await expect(server.registerTool(echoTool({ app: 'shipping' }))).rejects.toThrow(EntryValidationError);
  });
});
