/**
 * One plugins list that names a plugin twice refuses to start.
 *
 * A plugins list keeps one entry per plugin token, so the second entry replaced the first and its
 * options were dropped without a word. The same plugin in two lists (two apps, or the server and
 * an app) is two installs, each with its own options, and keeps working.
 */
import 'reflect-metadata';

import { App, DynamicPlugin, LogLevel, Plugin, Tool, ToolContext, type ProviderType } from '../../common';
import { DuplicatePluginEntryError, DuplicatePluginError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

class LedgerOwner {
  constructor(readonly name: string) {}
}

interface LedgerOptions {
  owner: string;
}

@Plugin({ name: 'ledger' })
class LedgerPlugin extends DynamicPlugin<LedgerOptions> {
  constructor(readonly options: LedgerOptions) {
    super();
  }

  static override dynamicProviders(options: LedgerOptions): ProviderType[] {
    return [{ name: 'ledger-owner', provide: LedgerOwner, useValue: new LedgerOwner(options.owner) }];
  }
}

@Plugin({ name: 'audit' })
class AuditPlugin {}

@Plugin({ name: 'catalog', oncePerServer: 'One catalog holds every source.' })
class CatalogPlugin extends DynamicPlugin<LedgerOptions> {
  constructor(readonly options: LedgerOptions) {
    super();
  }
}

@Tool({ name: 'billing_owner', inputSchema: {} })
class BillingOwnerTool extends ToolContext {
  async execute() {
    return { owner: this.get(LedgerOwner).name };
  }
}

@Tool({ name: 'support_owner', inputSchema: {} })
class SupportOwnerTool extends ToolContext {
  async execute() {
    return { owner: this.get(LedgerOwner).name };
  }
}

function startServer(config: Record<string, unknown>) {
  return FrontMcpInstance.createDirect({
    info: { name: 'duplicate-plugin-entry', version: '1.0.0' },
    logging: { level: LogLevel.Off },
    apps: [],
    ...config,
  } as never);
}

@Plugin({ name: 'host', plugins: [LedgerPlugin.init({ owner: 'a' }), LedgerPlugin.init({ owner: 'b' })] })
class HostPlugin {}

function duplicateMessage(listName: string, firstEntry: number, secondEntry: number): string {
  return `Plugin "ledger" is listed twice in ${listName} (entries ${firstEntry} and ${secondEntry}), and only one entry could be installed.`;
}

describe('PluginRegistry — a plugin listed twice in one plugins list', () => {
  it('refuses to start a server whose plugins list names the plugin class twice', async () => {
    const started = startServer({ plugins: [LedgerPlugin, LedgerPlugin] });

    await expect(started).rejects.toThrow(DuplicatePluginEntryError);
    await expect(started).rejects.toThrow(duplicateMessage('@FrontMcp({ plugins })', 1, 2));
  });

  it('refuses to start a server whose app lists two init() entries of the plugin, naming both entries', async () => {
    @App({
      id: 'billing',
      name: 'Billing',
      plugins: [LedgerPlugin.init({ owner: 'a' }), AuditPlugin, LedgerPlugin.init({ owner: 'b' })],
    })
    class BillingApp {}

    const started = startServer({ apps: [BillingApp] });

    await expect(started).rejects.toThrow(DuplicatePluginEntryError);
    await expect(started).rejects.toThrow(duplicateMessage('the plugins of app "billing"', 1, 3));
  });

  it('refuses a list that names the plugin by its class and by init()', async () => {
    await expect(startServer({ plugins: [LedgerPlugin.init({ owner: 'a' }), LedgerPlugin] })).rejects.toThrow(
      duplicateMessage('@FrontMcp({ plugins })', 1, 2),
    );
  });

  it("names a plugin's nested plugins list", async () => {
    await expect(startServer({ plugins: [HostPlugin] })).rejects.toThrow(
      duplicateMessage('the plugins of plugin "host"', 1, 2),
    );
  });

  it('tells how to fix it, with the DUPLICATE_PLUGIN_ENTRY code', async () => {
    const error = await startServer({ plugins: [LedgerPlugin, LedgerPlugin] }).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'DUPLICATE_PLUGIN_ENTRY' });
    expect((error as Error).message).toContain(
      'List it once, with all its options in that entry, or install the other configuration on an @App of its own.',
    );
  });

  it('keeps DuplicatePluginError for a plugin installed once per server', async () => {
    const started = startServer({
      plugins: [CatalogPlugin.init({ owner: 'a' }), CatalogPlugin.init({ owner: 'b' })],
    });

    await expect(started).rejects.toThrow(DuplicatePluginError);
    await expect(started).rejects.not.toThrow(DuplicatePluginEntryError);
  });

  it('lets two apps install the plugin, each with its own options', async () => {
    @App({
      id: 'billing',
      name: 'Billing',
      plugins: [LedgerPlugin.init({ owner: 'billing' })],
      tools: [BillingOwnerTool],
    })
    class BillingApp {}
    @App({
      id: 'support',
      name: 'Support',
      plugins: [LedgerPlugin.init({ owner: 'support' })],
      tools: [SupportOwnerTool],
    })
    class SupportApp {}

    const server = await startServer({ apps: [BillingApp, SupportApp] });

    expect((await server.callTool('billing_owner', {})).structuredContent).toEqual({ owner: 'billing' });
    expect((await server.callTool('support_owner', {})).structuredContent).toEqual({ owner: 'support' });
    await server.dispose();
  });

  it('lets the server and an app each install the plugin', async () => {
    @App({
      id: 'billing',
      name: 'Billing',
      plugins: [LedgerPlugin.init({ owner: 'billing' })],
      tools: [BillingOwnerTool],
    })
    class BillingApp {}

    const server = await startServer({ apps: [BillingApp], plugins: [LedgerPlugin.init({ owner: 'server' })] });

    expect((await server.callTool('billing_owner', {})).structuredContent).toEqual({ owner: 'billing' });
    await server.dispose();
  });
});
