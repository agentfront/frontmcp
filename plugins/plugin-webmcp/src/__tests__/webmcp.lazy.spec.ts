import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { create, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import { syncListenerOf } from '../webmcp.handoff';
import { listWebMcpTools, registerWebMcpTools, type WebMcpToolDescriptor } from '../webmcp.lazy';
import WebMcpPlugin from '../webmcp.plugin';
import type { ModelContext } from '../webmcp.types';
import { FakeModelContext, settle, waitFor } from './helpers/fake-model-context';

/**
 * A page registers its tools from a list computed at build time, and loads the server on an agent's
 * first call. The calls then run through the plugin, which follows the server's tool changes.
 */

@Tool({
  name: 'search_products',
  description: 'Search the catalog',
  inputSchema: { query: z.string() },
  annotations: { readOnlyHint: true },
})
class SearchProductsTool extends ToolContext {
  async execute({ query }: { query: string }) {
    return { results: [`${query}-1`] };
  }
}

@Tool({ name: 'checkout', title: 'Checkout', description: 'Place the order', inputSchema: {} })
class CheckoutTool extends ToolContext {
  async execute() {
    return 'ordered';
  }
}

interface ShopOptions {
  tools?: unknown[];
  cartDescription?: string;
  exposedTo?: string[];
}

/** The shop server, with a `get_cart` tool the page adds at runtime. */
async function createShopServer(modelContext: ModelContext, options: ShopOptions = {}) {
  const server = await create({
    info: { name: 'shop', version: '1.0.0' },
    tools: (options.tools ?? [SearchProductsTool, CheckoutTool]) as never,
    plugins: [WebMcpPlugin.init({ modelContext, prefix: 'shop.', exposedTo: options.exposedTo })],
    logging: { level: LogLevel.Off },
  });
  const removeCart = await server.registerTool({
    name: 'get_cart',
    description: options.cartDescription ?? 'Items in the cart',
    execute: () => ({ content: [{ type: 'text', text: '[]' }] }),
  });
  return Object.assign(server, { removeCart });
}

type ShopServer = Awaited<ReturnType<typeof createShopServer>>;

function descriptorsOf(modelContext: FakeModelContext): WebMcpToolDescriptor[] {
  return modelContext.names().map((name) => {
    const { execute: _execute, ...descriptor } = modelContext.tool(name);
    return descriptor;
  });
}

const byName = (a: WebMcpToolDescriptor, b: WebMcpToolDescriptor) => a.name.localeCompare(b.name);

describe('listWebMcpTools', () => {
  it('returns exactly what the plugin registers, and disposes the server it built', async () => {
    const live = new FakeModelContext();
    const liveServer = await createShopServer(live);
    await settle();
    let built: DirectMcpServer | undefined;

    const listed = await listWebMcpTools(async (modelContext) => (built = await createShopServer(modelContext)));

    expect([...listed].sort(byName)).toEqual(descriptorsOf(live));
    expect(JSON.parse(JSON.stringify(listed))).toEqual(listed);
    await expect(built?.listTools()).rejects.toThrow(/disposed/);
    await liveServer.dispose();
  });

  it('rejects with the error that kept the plugin from listing the tools', async () => {
    await expect(
      listWebMcpTools((modelContext) =>
        create({
          info: { name: 'locked', version: '1.0.0' },
          tools: [CheckoutTool],
          plugins: [
            WebMcpPlugin.init({
              modelContext,
              authContext: () => {
                throw new Error('no signed-in user');
              },
            }),
          ],
          logging: { level: LogLevel.Off },
        }),
      ),
    ).rejects.toThrow('no signed-in user');
  });

  it('rejects, and disposes the server, when it has no WebMcpPlugin using the context it was given', async () => {
    let built: DirectMcpServer | undefined;

    await expect(
      listWebMcpTools(
        async () =>
          (built = await create({
            info: { name: 'bare', version: '1.0.0' },
            tools: [CheckoutTool],
            logging: { level: LogLevel.Off },
          })),
      ),
    ).rejects.toThrow(/WebMcpPlugin\.init\(\{ modelContext \}\)/);
    await expect(built?.listTools()).rejects.toThrow(/disposed/);
  });
});

describe('registerWebMcpTools', () => {
  let modelContext: FakeModelContext;
  let server: ShopServer | undefined;
  let loads: number;
  let listed: WebMcpToolDescriptor[];

  beforeAll(async () => {
    listed = await listWebMcpTools((context) => createShopServer(context));
  });

  beforeEach(() => {
    modelContext = new FakeModelContext();
    server = undefined;
    loads = 0;
  });

  afterEach(async () => {
    await server?.dispose();
  });

  async function registerFromList(options: ShopOptions = {}, registerOptions = {}) {
    await registerWebMcpTools(
      modelContext,
      listed,
      async (context) => {
        loads++;
        server = await createShopServer(context, options);
        return server;
      },
      registerOptions,
    );
  }

  it('registers every listed tool at once, without loading the server', async () => {
    await registerFromList();

    expect(descriptorsOf(modelContext)).toEqual([...listed].sort(byName));
    expect(loads).toBe(0);
  });

  it('loads the server once for concurrent first calls, and answers them through the plugin', async () => {
    await registerFromList();

    const results = await Promise.all([
      modelContext.execute('shop.search_products', { query: 'mug' }),
      modelContext.execute('shop.checkout'),
      modelContext.execute('shop.get_cart'),
    ]);

    expect(loads).toBe(1);
    expect(results).toEqual([
      { results: ['mug-1'] },
      { value: 'ordered' },
      { content: [{ type: 'text', text: '[]' }] },
    ]);
    expect(modelContext.registerCalls.filter((name) => name === 'shop.checkout')).toHaveLength(1);
  });

  it("follows the server's tool changes once it is loaded", async () => {
    await registerFromList();
    await modelContext.execute('shop.checkout');

    const removeNote = await server?.registerTool({ name: 'note', execute: () => ({ content: [] }) });
    await waitFor(() => modelContext.registered.has('shop.note'));
    removeNote?.();
    server?.removeCart();
    await waitFor(() => !modelContext.registered.has('shop.note') && !modelContext.registered.has('shop.get_cart'));

    expect(modelContext.names()).toEqual(['shop.checkout', 'shop.search_products']);
    await server?.dispose();
    server = undefined;
    expect(modelContext.names()).toEqual([]);
  });

  it('replaces a listed tool the loaded server describes differently', async () => {
    await registerFromList({ cartDescription: 'What the cart holds' });
    await modelContext.execute('shop.checkout');
    await settle();

    expect(modelContext.tool('shop.get_cart').description).toBe('What the cart holds');
    expect(await modelContext.execute('shop.get_cart')).toEqual({ content: [{ type: 'text', text: '[]' }] });
  });

  it('registers the listed tools again when the server offers them to other origins', async () => {
    await registerFromList({ exposedTo: ['https://parent.example'] });
    await modelContext.execute('shop.checkout');
    await settle();

    expect(modelContext.options('shop.checkout')?.exposedTo).toEqual(['https://parent.example']);
  });

  it('offers the listed tools to the origins given, and keeps them when the server offers them the same way', async () => {
    const exposedTo = ['https://parent.example'];
    await registerFromList({ exposedTo }, { exposedTo });

    expect(modelContext.options('shop.checkout')?.exposedTo).toEqual(exposedTo);
    await modelContext.execute('shop.checkout');
    expect(modelContext.registerCalls.filter((name) => name === 'shop.checkout')).toHaveLength(1);
  });

  it('unregisters a listed tool the loaded server no longer has, and rejects a call to it', async () => {
    await registerFromList({ tools: [SearchProductsTool] });
    const staleCheckout = modelContext.tool('shop.checkout');

    await expect(modelContext.execute('shop.checkout')).rejects.toThrow('Tool "shop.checkout" not found');
    expect(modelContext.names()).toEqual(['shop.get_cart', 'shop.search_products']);
    await expect(staleCheckout.execute({}, { signal: new AbortController().signal })).rejects.toThrow(/not found/);
  });

  it('rejects the call when loading fails, and loads again on the next call', async () => {
    let attempts = 0;
    await registerWebMcpTools(modelContext, listed, async (context) => {
      attempts++;
      if (attempts === 1) throw new Error('chunk failed to load');
      server = await createShopServer(context);
      return server;
    });

    await expect(modelContext.execute('shop.checkout')).rejects.toThrow('chunk failed to load');
    await expect(modelContext.execute('shop.checkout')).resolves.toEqual({ value: 'ordered' });
    expect(attempts).toBe(2);
  });

  it('disposes a server whose first sync failed, and registers each tool once when the next call loads again', async () => {
    const failedServer = { dispose: jest.fn(), registrations: new AbortController() };
    let attempts = 0;
    await registerWebMcpTools(modelContext, listed, async (context) => {
      attempts++;
      if (attempts > 1) {
        server = await createShopServer(context);
        return server;
      }
      // A plugin that adopts the listed tools, then fails to finish its sync
      const listener = syncListenerOf(context);
      listener?.started();
      for (const descriptor of listed) {
        await context.registerTool(
          { ...descriptor, execute: async () => 'from the failed server' },
          { signal: failedServer.registrations.signal },
        );
      }
      await context.registerTool(
        { name: 'shop.extra', description: 'Only on the failed server', execute: async () => 'extra' },
        { signal: failedServer.registrations.signal },
      );
      failedServer.dispose.mockImplementation(async () => {
        failedServer.registrations.abort();
        throw new Error('dispose failed too');
      });
      listener?.synced(new Error('listing failed'));
      return failedServer;
    });

    await expect(modelContext.execute('shop.checkout')).rejects.toThrow('listing failed');
    expect(failedServer.dispose).toHaveBeenCalledTimes(1);
    expect(modelContext.names()).toEqual(['shop.checkout', 'shop.get_cart', 'shop.search_products']);

    await expect(modelContext.execute('shop.checkout')).resolves.toEqual({ value: 'ordered' });
    for (const descriptor of listed) {
      expect(modelContext.registerCalls.filter((name) => name === descriptor.name)).toHaveLength(1);
    }
    expect(modelContext.names()).toEqual(['shop.checkout', 'shop.get_cart', 'shop.search_products']);
  });

  it('rejects the call when the loaded server has no plugin on the given context, and loads again on the next call', async () => {
    let attempts = 0;
    await registerWebMcpTools(modelContext, listed, async (context) => {
      attempts++;
      if (attempts === 1) return undefined;
      server = await createShopServer(context);
      return server;
    });

    await expect(modelContext.execute('shop.checkout')).rejects.toThrow(/WebMcpPlugin\.init\(\{ modelContext \}\)/);
    await expect(modelContext.execute('shop.checkout')).resolves.toEqual({ value: 'ordered' });
  });

  it('skips a listed tool the page context refuses', async () => {
    modelContext.refuse.add('shop.checkout');

    await registerFromList();

    expect(modelContext.names()).toEqual(['shop.get_cart', 'shop.search_products']);
  });

  it('does nothing without a ModelContext', async () => {
    const loadServer = jest.fn();

    await registerWebMcpTools(undefined, listed, loadServer);

    expect(loadServer).not.toHaveBeenCalled();
  });
});
