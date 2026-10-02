import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  create,
  LogLevel,
  Plugin,
  PublicMcpError,
  tool,
  Tool,
  ToolContext,
  ToolHook,
  type DirectMcpServer,
  type FlowCtxOf,
} from '@frontmcp/sdk';

import WebMcpPlugin from '../webmcp.plugin';
import { FakeModelContext, settle, waitFor } from './helpers/fake-model-context';

/**
 * A server in the page, with WebMcpPlugin, registers its tools on `document.modelContext` and keeps
 * them in sync. An agent's call runs the server's `tools:call-tool` flow on the `'webmcp'` surface.
 */

/** Whether the last `wait_for_abort` call saw its signal abort. */
let abortSeen = false;

@Tool({
  name: 'search_products',
  description: 'Search the catalog',
  inputSchema: { query: z.string() },
  outputSchema: { results: z.array(z.string()) },
  annotations: { readOnlyHint: true },
})
class SearchProductsTool extends ToolContext {
  async execute({ query }: { query: string }) {
    return { results: [`${query}-1`, `${query}-2`] };
  }
}

@Tool({
  name: 'checkout',
  title: 'Checkout',
  description: 'Place the order',
  inputSchema: {},
  annotations: { destructiveHint: true, openWorldHint: true },
})
class CheckoutTool extends ToolContext {
  async execute() {
    return 'ordered';
  }
}

@Tool({ name: 'mcp_only', description: 'MCP clients only', inputSchema: {}, availableWhen: { surface: ['mcp'] } })
class McpOnlyTool extends ToolContext {
  async execute() {
    return 'mcp';
  }
}

@Tool({
  name: 'webmcp_only',
  description: 'Browser agents only',
  inputSchema: {},
  availableWhen: { surface: ['webmcp'] },
})
class WebMcpOnlyTool extends ToolContext {
  async execute() {
    return 'webmcp';
  }
}

@Tool({ name: 'whoami', description: 'Who is calling', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.context.authInfo.user?.sub ?? null, session: this.context.sessionId };
  }
}

@Tool({ name: 'explode', description: 'Always fails', inputSchema: {} })
class ExplodeTool extends ToolContext {
  async execute(): Promise<string> {
    throw new Error('boom');
  }
}

@Tool({ name: 'archived_order', description: 'Fails through this.fail()', inputSchema: {} })
class ArchivedOrderTool extends ToolContext {
  async execute(): Promise<string> {
    this.fail(new PublicMcpError('Order is archived'));
  }
}

@Tool({ name: 'wait_for_abort', description: 'Waits until cancelled', inputSchema: {} })
class WaitForAbortTool extends ToolContext {
  async execute() {
    await new Promise<void>((resolve) => {
      if (this.signal?.aborted) return resolve();
      this.signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    abortSeen = this.signal?.aborted === true;
    return 'aborted';
  }
}

const tools = [
  SearchProductsTool,
  CheckoutTool,
  McpOnlyTool,
  WebMcpOnlyTool,
  WhoAmITool,
  ExplodeTool,
  WaitForAbortTool,
];

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

describe('WebMcpPlugin', () => {
  let modelContext: FakeModelContext;
  let server: DirectMcpServer;

  async function start(options: Parameters<typeof WebMcpPlugin.init>[0] = {}, extraTools: unknown[] = []) {
    server = await create({
      info: { name: 'shop', version: '1.0.0' },
      tools: [...tools, ...extraTools] as never,
      plugins: [WebMcpPlugin.init({ modelContext, ...options })],
      logging: { level: LogLevel.Off },
    });
    await settle();
  }

  beforeEach(() => {
    modelContext = new FakeModelContext();
    abortSeen = false;
  });

  afterEach(async () => {
    await server?.dispose();
  });

  describe('registration', () => {
    it("registers the tools the 'webmcp' surface lists, once the server is ready", async () => {
      await start();

      expect(modelContext.names()).toEqual([
        'checkout',
        'explode',
        'search_products',
        'wait_for_abort',
        'webmcp_only',
        'whoami',
      ]);
    });

    it('describes each tool with its title, description, input schema and WebMCP hints', async () => {
      await start();

      const { execute: _search, ...search } = modelContext.tool('search_products');
      const { execute: _checkout, ...checkout } = modelContext.tool('checkout');
      expect(search).toEqual({
        name: 'search_products',
        description: 'Search the catalog',
        inputSchema: expect.objectContaining({ type: 'object', properties: { query: { type: 'string' } } }),
        annotations: { readOnlyHint: true },
      });
      expect(checkout).toEqual({
        name: 'checkout',
        title: 'Checkout',
        description: 'Place the order',
        inputSchema: expect.objectContaining({ type: 'object' }),
        annotations: { consequentialHint: true, untrustedContentHint: true },
      });
      expect(modelContext.tool('whoami').annotations).toBeUndefined();
    });

    it('prefixes the names, and keeps them WebMCP-valid and distinct', async () => {
      await start({ prefix: 'shop.' });
      await server.registerTool({ name: 'cart:items', execute: () => text('from cart:items') });
      await server.registerTool({ name: 'cart_items', execute: () => text('from cart_items') });
      await settle();

      const cartNames = modelContext.names().filter((name) => name.startsWith('shop.cart'));
      expect(cartNames).toEqual(['shop.cart_items', 'shop.cart_items_2']);
      expect(modelContext.names()).toContain('shop.search_products');
      const outputs = await Promise.all(cartNames.map((name) => modelContext.execute(name)));
      expect(outputs.map((output) => JSON.stringify(output)).sort()).toEqual([
        JSON.stringify(text('from cart:items')),
        JSON.stringify(text('from cart_items')),
      ]);
    });

    it('describes a tool without a description by its title, or else its name', async () => {
      await start();
      await server.registerTool({ name: 'titled', title: 'A titled tool', execute: () => text('t') });
      await server.registerTool({ name: 'bare', execute: () => text('b') });
      await settle();

      expect(modelContext.tool('titled').description).toBe('A titled tool');
      expect(modelContext.tool('bare').description).toBe('bare');
    });

    it('exposes only what `include` accepts', async () => {
      await start({ include: (listed) => listed.name !== 'checkout' });

      expect(modelContext.names()).not.toContain('checkout');
      expect(modelContext.names()).toContain('search_products');
    });

    it('passes exposedTo through to WebMCP', async () => {
      await start({ exposedTo: ['https://parent.example'] });

      expect(modelContext.options('whoami')).toEqual(
        expect.objectContaining({ exposedTo: ['https://parent.example'], signal: expect.any(AbortSignal) }),
      );
    });

    it('registers every page of a long tool list', async () => {
      const many = Array.from({ length: 45 }, (_, i) =>
        tool({ name: `bulk_${String(i).padStart(2, '0')}`, inputSchema: {} })(() => `bulk ${i}`),
      );
      await start({}, many);

      expect(modelContext.names().filter((name) => name.startsWith('bulk_'))).toHaveLength(45);
    });

    it('skips a tool WebMCP refuses, and registers the others', async () => {
      modelContext.refuse.add('checkout');
      await start();

      expect(modelContext.names()).not.toContain('checkout');
      expect(modelContext.names()).toContain('search_products');
    });
  });

  describe('keeping in sync', () => {
    it('registers a tool added at runtime, and unregisters it when it is removed', async () => {
      await start();

      const unregister = await server.registerTool({
        name: 'get_cart',
        description: 'Items in the cart',
        execute: () => text('[]'),
      });
      await waitFor(() => modelContext.registered.has('get_cart'));
      unregister();
      await waitFor(() => !modelContext.registered.has('get_cart'));

      expect(modelContext.unregistered).toContain('get_cart');
    });

    it('re-registers a tool whose description changed', async () => {
      await start();
      const unregisterV1 = await server.registerTool({ name: 'note', description: 'v1', execute: () => text('1') });
      await settle();

      unregisterV1();
      await server.registerTool({ name: 'note', description: 'v2', execute: () => text('2') });
      await settle();

      expect(modelContext.tool('note').description).toBe('v2');
      expect(await modelContext.execute('note')).toEqual(text('2'));
    });

    it('does not re-register unchanged tools when the list changes', async () => {
      await start();
      const before = modelContext.registerCalls.filter((name) => name === 'search_products').length;

      await server.registerTool({ name: 'extra', execute: () => text('x') });
      await settle();

      expect(modelContext.registerCalls.filter((name) => name === 'search_products')).toHaveLength(before);
    });

    it('registers each tool of a burst of runtime registrations once', async () => {
      await start();

      await Promise.all(
        Array.from({ length: 8 }, (_, i) => server.registerTool({ name: `burst_${i}`, execute: () => text(`${i}`) })),
      );
      await settle();

      const burstCalls = modelContext.registerCalls.filter((name) => name.startsWith('burst_'));
      expect(burstCalls.sort()).toEqual(Array.from({ length: 8 }, (_, i) => `burst_${i}`));
    });

    it('unregisters every tool when the server is disposed', async () => {
      await start();
      const registered = modelContext.names();

      await server.dispose();

      expect(modelContext.names()).toEqual([]);
      expect([...modelContext.unregistered].sort()).toEqual(registered);
    });
  });

  describe("an agent's call", () => {
    it('runs the tool through the server and returns its content and structured content', async () => {
      await start();

      const result = await modelContext.execute('search_products', { query: 'mug' });

      expect(result).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
        structuredContent: { results: ['mug-1', 'mug-2'] },
      });
    });

    it("leaves out the result's _meta", async () => {
      await start();
      await server.registerTool({
        name: 'with_meta',
        execute: () => ({ ...text('visible'), _meta: { internal: true } }),
      });
      await settle();

      expect(await modelContext.execute('with_meta')).toEqual(text('visible'));
    });

    it('rejects with the text of an error result', async () => {
      await start();
      await server.registerTool({
        name: 'locked',
        execute: () => ({ isError: true, content: [{ type: 'text', text: 'cart is locked' }] }),
      });
      await settle();

      await expect(modelContext.execute('locked')).rejects.toThrow('cart is locked');
    });

    it('rejects with a generic message when an error result has no text', async () => {
      await start();
      await server.registerTool({ name: 'silent_failure', execute: () => ({ isError: true, content: [] }) });
      await settle();

      await expect(modelContext.execute('silent_failure')).rejects.toThrow('Tool "silent_failure" failed');
    });

    it('rejects when the tool throws', async () => {
      await start();

      await expect(modelContext.execute('explode')).rejects.toThrow();
    });

    it('rejects with the message of the error the tool passed to this.fail()', async () => {
      await start({}, [ArchivedOrderTool]);

      await expect(modelContext.execute('archived_order')).rejects.toThrow(/^Order is archived$/);
    });

    it('passes non-object input as no arguments', async () => {
      await start();
      const execute = jest.fn(() => text('ok'));
      await server.registerTool({ name: 'no_args', execute });
      await settle();

      await modelContext.tool('no_args').execute(null as never, { signal: new AbortController().signal });

      expect(execute).toHaveBeenCalledWith({}, expect.anything());
    });

    it("aborts the tool's signal when the agent cancels the call", async () => {
      await start();
      const controller = new AbortController();

      const call = modelContext.execute('wait_for_abort', {}, controller.signal).catch(() => 'rejected');
      await settle();
      controller.abort();
      await call;

      expect(abortSeen).toBe(true);
    });

    it('rejects a call to a tool that is no longer on the server', async () => {
      await start();
      // An agent holding a stale reference: the tool was registered, then became unavailable
      const unregister = await server.registerTool({ name: 'gone', execute: () => text('x') });
      await settle();
      const staleTool = modelContext.tool('gone');
      unregister();
      await settle();

      await expect(staleTool.execute({}, { signal: new AbortController().signal })).rejects.toThrow(/not found/i);
    });
  });

  describe('the caller', () => {
    it('is an anonymous webmcp caller by default, in one session', async () => {
      await start();

      const first = (await modelContext.execute('whoami')) as { structuredContent?: unknown; content: unknown };
      const second = (await modelContext.execute('whoami')) as { structuredContent?: unknown; content: unknown };

      expect(JSON.stringify(first)).toContain('"sub":"webmcp"');
      expect(JSON.stringify(first)).toContain('webmcp:');
      expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
    });

    it('is the authContext given', async () => {
      await start({ authContext: { sessionId: 'page-session', user: { sub: 'alice' }, token: 't', extra: { a: 1 } } });

      const result = JSON.stringify(await modelContext.execute('whoami'));

      expect(result).toContain('"sub":"alice"');
      expect(result).toContain('page-session');
    });

    it('is whoever an authContext function returns at call time', async () => {
      let user = 'alice';
      await start({ authContext: () => ({ user: { sub: user, iss: 'https://idp.example' } }) });

      const asAlice = JSON.stringify(await modelContext.execute('whoami'));
      user = 'bob';
      const asBob = JSON.stringify(await modelContext.execute('whoami'));

      expect(asAlice).toContain('"sub":"alice"');
      expect(asBob).toContain('"sub":"bob"');
    });
  });

  describe('where WebMCP is unavailable', () => {
    it('does nothing, and the server works as usual', async () => {
      server = await create({
        info: { name: 'no-webmcp', version: '1.0.0' },
        tools: [SearchProductsTool],
        plugins: [WebMcpPlugin.init()],
        logging: { level: LogLevel.Off },
      });
      await settle();

      const { tools: listed } = await server.listTools();
      expect(listed.map((entry) => entry.name)).toContain('search_products');
    });
  });

  describe('hooks', () => {
    /** Every tool call a plugin hook saw. */
    const seen: string[] = [];

    @Plugin({ name: 'call-recorder' })
    class CallRecorderPlugin {
      @ToolHook.Will('execute')
      record(flowCtx: FlowCtxOf<'tools:call-tool'>) {
        const { tool: called } = flowCtx.state;
        if (called) seen.push(called.metadata.name);
      }
    }

    it("run for an agent's call, for server and runtime tools alike", async () => {
      seen.length = 0;
      server = await create({
        info: { name: 'hooked', version: '1.0.0' },
        tools: [SearchProductsTool],
        plugins: [CallRecorderPlugin, WebMcpPlugin.init({ modelContext })],
        logging: { level: LogLevel.Off },
      });
      const unregister = await server.registerTool({
        name: 'page_tool',
        description: 'Defined by the page',
        execute: () => text('from the page'),
      });
      await waitFor(() => modelContext.registered.has('page_tool'));

      await modelContext.execute('search_products', { query: 'shoes' });
      await modelContext.execute('page_tool');
      unregister();

      expect(seen).toEqual(['search_products', 'page_tool']);
    });
  });
});
