/** @jest-environment node */
import 'reflect-metadata';

import {
  create,
  LogLevel,
  Tool,
  ToolContext,
  ToolNameConflictError,
  type CallToolResult,
  type DirectMcpServer,
  type RuntimeToolDefinition,
} from '@frontmcp/sdk';

import type { DynamicToolDef } from '../../types';
import { bindDynamicTools } from '../bindDynamicTools';
import { DynamicRegistry } from '../DynamicRegistry';

@Tool({ name: 'static_tool', inputSchema: {} })
class StaticTool extends ToolContext {
  async execute() {
    return { ran: 'static_tool' };
  }
}

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function toolDef(overrides: Partial<DynamicToolDef> = {}): DynamicToolDef {
  return {
    name: 'dyn_tool',
    description: 'A dynamic tool',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: async (args) => text(`dyn:${String(args['q'])}`),
    ...overrides,
  };
}

/** Lets the binder's microtask reconcile and the server's async registration finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function listedNames(server: DirectMcpServer): Promise<string[]> {
  const { tools } = await server.listTools();
  return tools.map((tool) => tool.name);
}

describe('bindDynamicTools with a real server', () => {
  let server: DirectMcpServer;
  let registry: DynamicRegistry;
  let unbind: () => void;

  beforeEach(async () => {
    server = await create({
      info: { name: 'bind-dynamic-tools', version: '1.0.0' },
      tools: [StaticTool],
      logging: { level: LogLevel.Off },
    });
    registry = new DynamicRegistry();
  });

  afterEach(async () => {
    unbind?.();
    await server.dispose();
  });

  it('registers the tools already in the registry, as real server tools', async () => {
    registry.registerTool(
      toolDef({ annotations: { readOnlyHint: true }, availableWhen: { surface: ['mcp', 'webmcp'] } }),
    );

    unbind = bindDynamicTools(registry, server);
    await settle();

    const { tools } = await server.listTools();
    expect(tools.find((tool) => tool.name === 'dyn_tool')).toEqual(
      expect.objectContaining({
        description: 'A dynamic tool',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        annotations: expect.objectContaining({ readOnlyHint: true }),
      }),
    );
    expect(await server.callTool('dyn_tool', { q: 'hi' })).toEqual(text('dyn:hi'));
  });

  it('registers and removes tools as components register and unregister them', async () => {
    unbind = bindDynamicTools(registry, server);
    const unregister = registry.registerTool(toolDef());
    await settle();
    expect(await listedNames(server)).toContain('dyn_tool');

    unregister();
    await settle();

    expect(await listedNames(server)).not.toContain('dyn_tool');
  });

  it('settles StrictMode churn (register, unregister, register) into one registration', async () => {
    const registerTool = jest.spyOn(server, 'registerTool');
    unbind = bindDynamicTools(registry, server);

    registry.registerTool(toolDef())();
    registry.registerTool(toolDef());
    await settle();

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(await listedNames(server)).toContain('dyn_tool');
  });

  it('runs the latest execute the registry holds', async () => {
    unbind = bindDynamicTools(registry, server);
    registry.registerTool(toolDef());
    await settle();

    registry.updateToolExecute('dyn_tool', async () => text('updated'));

    expect(await server.callTool('dyn_tool', { q: 'x' })).toEqual(text('updated'));
  });

  it('re-registers a tool whose description or schema changed', async () => {
    unbind = bindDynamicTools(registry, server);
    const unregister = registry.registerTool(toolDef());
    await settle();

    unregister();
    registry.registerTool(toolDef({ description: 'Changed' }));
    await settle();

    const { tools } = await server.listTools();
    expect(tools.find((tool) => tool.name === 'dyn_tool')?.description).toBe('Changed');
  });

  it("reports a tool the server refuses, and doesn't retry it until it changes", async () => {
    const onError = jest.fn();
    const registerTool = jest.spyOn(server, 'registerTool');
    unbind = bindDynamicTools(registry, server, { onError });

    registry.registerTool(toolDef({ name: 'static_tool' }));
    await settle();
    registry.registerTool(toolDef({ name: 'other_tool' }));
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(ToolNameConflictError), 'static_tool');
    expect(registerTool.mock.calls.map(([definition]) => definition.name)).toEqual(['static_tool', 'other_tool']);
  });

  it('retries a refused tool once its name is free and it is registered again', async () => {
    const onError = jest.fn();
    unbind = bindDynamicTools(registry, server, { onError });
    const holder = registry.registerTool(toolDef({ name: 'shared_name' }));
    await settle();
    // A second registry bound to the same server wants the same name
    const otherRegistry = new DynamicRegistry();
    const unbindOther = bindDynamicTools(otherRegistry, server, { onError });
    const otherUnregister = otherRegistry.registerTool(toolDef({ name: 'shared_name', description: 'Other' }));
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);

    holder();
    await settle();
    otherUnregister();
    await settle();
    otherRegistry.registerTool(toolDef({ name: 'shared_name', description: 'Other' }));
    await settle();

    const { tools } = await server.listTools();
    expect(tools.find((tool) => tool.name === 'shared_name')?.description).toBe('Other');
    unbindOther();
  });

  it('re-registers a tool that a second registrant redefines', async () => {
    const registerTool = jest.spyOn(server, 'registerTool');
    unbind = bindDynamicTools(registry, server);
    registry.registerTool(toolDef());
    await settle();

    // Same definition from a second registrant: nothing to change on the server
    registry.registerTool(toolDef());
    await settle();
    expect(registerTool).toHaveBeenCalledTimes(1);

    registry.registerTool(toolDef({ description: 'Redefined', annotations: { readOnlyHint: true } }));
    await settle();

    const { tools } = await server.listTools();
    expect(tools.find((tool) => tool.name === 'dyn_tool')).toEqual(
      expect.objectContaining({
        description: 'Redefined',
        annotations: expect.objectContaining({ readOnlyHint: true }),
      }),
    );
    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it('warns on the console when no onError is given', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    unbind = bindDynamicTools(registry, server);

    registry.registerTool(toolDef({ name: 'static_tool' }));
    await settle();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"static_tool" was not registered'));
    warn.mockRestore();
  });

  it('removes every mirrored tool when unbound, and ignores later registry changes', async () => {
    unbind = bindDynamicTools(registry, server);
    registry.registerTool(toolDef());
    await settle();

    unbind();
    unbind();
    registry.registerTool(toolDef({ name: 'late_tool' }));
    await settle();

    const names = await listedNames(server);
    expect(names).not.toContain('dyn_tool');
    expect(names).not.toContain('late_tool');
  });
});

describe('bindDynamicTools edge cases', () => {
  /** A server double that records registrations and lets the spec resolve them. */
  function fakeServer() {
    const definitions: RuntimeToolDefinition[] = [];
    const unregisters: jest.Mock[] = [];
    let release: (() => void) | undefined;
    let hold = false;
    const server = {
      registerTool: jest.fn(async (definition: RuntimeToolDefinition) => {
        definitions.push(definition);
        if (hold) await new Promise<void>((resolve) => (release = resolve));
        const unregister = jest.fn();
        unregisters.push(unregister);
        return unregister;
      }),
    } as unknown as DirectMcpServer;
    return {
      server,
      definitions,
      unregisters,
      holdRegistrations: () => (hold = true),
      releaseRegistration: () => release?.(),
    };
  }

  it('answers a call for a tool that left the registry as no longer available', async () => {
    const { server, definitions } = fakeServer();
    const registry = new DynamicRegistry();
    const unbind = bindDynamicTools(registry, server);
    const unregister = registry.registerTool(toolDef());
    await settle();

    unregister();
    const result = await definitions[0].execute({}, { signal: new AbortController().signal });

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Tool "dyn_tool" is no longer available' }],
    });
    unbind();
  });

  it('unregisters a registration that completes after unbinding', async () => {
    const fake = fakeServer();
    fake.holdRegistrations();
    const registry = new DynamicRegistry();
    const unbind = bindDynamicTools(registry, fake.server);
    registry.registerTool(toolDef());
    await settle();

    unbind();
    fake.releaseRegistration();
    await settle();

    expect(fake.unregisters).toHaveLength(1);
    expect(fake.unregisters[0]).toHaveBeenCalledTimes(1);
  });

  it('does not re-register a tool whose schema cannot be serialized', async () => {
    const { server } = fakeServer();
    const registry = new DynamicRegistry();
    const circular: Record<string, unknown> = { type: 'object' };
    circular['self'] = circular;
    const unbind = bindDynamicTools(registry, server);
    registry.registerTool(toolDef({ inputSchema: circular }));
    await settle();

    registry.registerTool(toolDef({ name: 'other' }));
    await settle();

    expect((server.registerTool as jest.Mock).mock.calls.map(([definition]) => definition.name)).toEqual([
      'dyn_tool',
      'other',
    ]);
    unbind();
  });

  it('reports a non-Error refusal as an Error', async () => {
    const server = {
      registerTool: jest.fn().mockRejectedValue('nope'),
    } as unknown as DirectMcpServer;
    const registry = new DynamicRegistry();
    const onError = jest.fn();
    const unbind = bindDynamicTools(registry, server, { onError });

    registry.registerTool(toolDef());
    await settle();

    expect(onError).toHaveBeenCalledWith(new Error('nope'), 'dyn_tool');
    unbind();
  });

  it('does nothing for a server without registerTool', async () => {
    const registry = new DynamicRegistry();
    const unbind = bindDynamicTools(registry, {} as DirectMcpServer);
    registry.registerTool(toolDef());
    await settle();

    expect(() => unbind()).not.toThrow();
  });
});
