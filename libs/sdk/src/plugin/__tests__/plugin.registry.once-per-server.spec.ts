/**
 * A plugin declaring `oncePerServer` refuses a second install in the same server.
 *
 * A plugins list keeps one entry per plugin class, so listing a plugin twice dropped the first entry
 * without a word; and two lists of one server (the server's and an app's, or two apps') installed two
 * instances that registered the same providers, tools and skills over each other.
 */
import 'reflect-metadata';

import { App, DynamicPlugin, LogLevel, Plugin, Tool, ToolContext } from '../../common';
import { DuplicatePluginError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const REASON = 'One catalog can hold several sources.';

interface CatalogOptions {
  source: string;
}

@Tool({ name: 'catalog_source', inputSchema: {} })
class CatalogSourceTool extends ToolContext {
  async execute() {
    return 'catalog';
  }
}

@Plugin({ name: 'catalog', tools: [CatalogSourceTool], oncePerServer: REASON })
class CatalogPlugin extends DynamicPlugin<CatalogOptions> {
  constructor(readonly options: CatalogOptions) {
    super();
  }
}

@Plugin({ name: 'counter' })
class CounterPlugin extends DynamicPlugin<CatalogOptions> {
  constructor(readonly options: CatalogOptions) {
    super();
  }
}

function startServer(config: Record<string, unknown>, endpoint?: { app: string }) {
  return FrontMcpInstance.createDirect(
    {
      info: { name: 'once-per-server', version: '1.0.0' },
      logging: { level: LogLevel.Off },
      apps: [],
      ...config,
    } as never,
    endpoint,
  );
}

const DUPLICATE_MESSAGE = `Plugin "catalog" can be installed once per server, and this server installs it twice. ${REASON}`;

describe('PluginRegistry — a plugin installed once per server (oncePerServer)', () => {
  it('refuses to start a server whose plugins list names it twice', async () => {
    const started = startServer({
      plugins: [CatalogPlugin.init({ source: 'a' }), CatalogPlugin.init({ source: 'b' })],
    });

    await expect(started).rejects.toThrow(DuplicatePluginError);
    await expect(started).rejects.toThrow(DUPLICATE_MESSAGE);
  });

  it('refuses to start a server that installs it and whose app installs it too', async () => {
    @App({ name: 'billing', plugins: [CatalogPlugin.init({ source: 'b' })] })
    class BillingApp {}

    await expect(startServer({ apps: [BillingApp], plugins: [CatalogPlugin.init({ source: 'a' })] })).rejects.toThrow(
      DUPLICATE_MESSAGE,
    );
  });

  it('refuses to start a server two of whose apps install it', async () => {
    @App({ name: 'billing', plugins: [CatalogPlugin.init({ source: 'a' })] })
    class BillingApp {}
    @App({ name: 'crm', plugins: [CatalogPlugin.init({ source: 'b' })] })
    class CrmApp {}

    await expect(startServer({ apps: [BillingApp, CrmApp] })).rejects.toThrow(DUPLICATE_MESSAGE);
  });

  it('starts a server that installs it once, and serves it', async () => {
    const server = await startServer({ plugins: [CatalogPlugin.init({ source: 'a' })] });

    expect((await server.listTools()).tools.map((tool) => tool.name)).toEqual(['catalog_source']);
    await server.dispose();
  });

  it('lets each app of a splitByApp server install its own, as each is a server of its own', async () => {
    @App({ name: 'billing', plugins: [CatalogPlugin.init({ source: 'a' })] })
    class BillingApp {}
    @App({ name: 'crm', plugins: [CatalogPlugin.init({ source: 'b' })] })
    class CrmApp {}

    const server = await startServer({ apps: [BillingApp, CrmApp], splitByApp: true }, { app: 'crm' });

    expect((await server.listTools()).tools.map((tool) => tool.name)).toEqual(['catalog_source']);
    await server.dispose();
  });

  it('lets two servers install the same init() record', async () => {
    const record = CatalogPlugin.init({ source: 'a' });
    const first = await startServer({ plugins: [record] });
    const second = await startServer({ plugins: [record] });

    for (const server of [first, second]) {
      expect((await server.listTools()).tools.map((tool) => tool.name)).toEqual(['catalog_source']);
    }
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it('still starts a server that lists twice a plugin without oncePerServer', async () => {
    const server = await startServer({
      plugins: [CounterPlugin.init({ source: 'a' }), CounterPlugin.init({ source: 'b' })],
    });

    expect((await server.listTools()).tools).toEqual([]);
    await server.dispose();
  });
});
