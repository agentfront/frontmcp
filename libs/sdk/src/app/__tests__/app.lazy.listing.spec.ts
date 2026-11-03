/** A lazy app's entries are listed from `frontmcp.manifest.json`, through the list flows, without importing it. */
import 'reflect-metadata';

import { FlowHooksOf, LogLevel, Plugin, type FlowCtxOf, type FrontMcpConfigInput } from '../../common';
import type { DirectClient } from '../../direct/client.types';
import { connect } from '../../direct/connect';
import { buildManifest } from '../../manifest/build-manifest';
import type { ServerManifest } from '../../manifest/server-manifest.schema';
import { billingImport, capturedLogs, eagerServer, lazyServer } from './lazy-app.fixtures';

const ListToolsHook = FlowHooksOf('tools:list-tools');

@Plugin({ name: 'no-balance-listing' })
class NoBalanceListingPlugin {
  @ListToolsHook.Did('findTools')
  withhold(ctx: FlowCtxOf<'tools:list-tools'>) {
    const kept = ctx.state.tools?.filter(({ tool }) => tool.metadata.name !== 'balance');
    if (kept) ctx.state.set('tools', kept);
  }
}

const shared: Partial<FrontMcpConfigInput> = {
  plugins: [NoBalanceListingPlugin],
  elicitation: { enabled: true },
};

async function listsOf(client: DirectClient) {
  const [tools, resources, templates, prompts] = await Promise.all([
    client.listTools(),
    client.listResources(),
    client.listResourceTemplates(),
    client.listPrompts(),
  ]);
  const withoutSurface = <T extends { _meta?: unknown }>({ _meta: _ignored, ...rest }: T) => rest;
  return {
    tools,
    resources: withoutSurface(resources),
    templates: withoutSurface(templates),
    prompts: withoutSurface(prompts),
  };
}

async function manifestOf(config: FrontMcpConfigInput): Promise<ServerManifest> {
  return buildManifest(config);
}

describe('lazy app listings', () => {
  const clients: DirectClient[] = [];
  const track = async (client: Promise<DirectClient>) => {
    const connected = await client;
    clients.push(connected);
    return connected;
  };

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    capturedLogs.length = 0;
  });

  it('lists what the loaded app lists, after hooks, without importing it', async () => {
    const manifest = await manifestOf(lazyServer(billingImport(), shared));
    const lazy = billingImport();
    const client = await track(connect(lazyServer(lazy, { ...shared, manifest })));
    const eager = await track(connect(eagerServer(shared)));

    const lazyLists = await listsOf(client);

    expect(lazy).not.toHaveBeenCalled();
    expect(lazyLists).toEqual(await listsOf(eager));
    expect(JSON.stringify(lazyLists.tools)).toContain('charge');
    expect(JSON.stringify(lazyLists.tools)).not.toContain('"balance"');
  });

  it('lists what a client profile sees, without importing it', async () => {
    const profile: Partial<FrontMcpConfigInput> = { clients: { 'plain-client': { structured: 'text' } } };
    const manifest = await manifestOf(lazyServer(billingImport(), profile));
    const lazy = billingImport();
    const clientInfo = { name: 'plain-client', version: '1.0.0' };
    const client = await track(connect(lazyServer(lazy, { ...profile, manifest }), { clientInfo }));
    const eager = await track(connect(eagerServer(profile), { clientInfo }));

    expect(await client.listTools()).toEqual(await eager.listTools());
    expect(lazy).not.toHaveBeenCalled();
  });

  it('swaps the placeholders for the loaded entries without a list_changed when the manifest matches', async () => {
    const manifest = await manifestOf(lazyServer(billingImport()));
    const client = await track(connect(lazyServer(billingImport(), { manifest })));
    const notifications: string[] = [];
    client.onNotification(({ method }) => notifications.push(method));
    const before = await listsOf(client);

    await client.callTool('charge', { customer: 'acme', cents: 100 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await listsOf(client)).toEqual(before);
    expect(notifications.filter((method) => method.endsWith('list_changed'))).toEqual([]);
    expect(capturedLogs.filter(({ level }) => level >= LogLevel.Warn)).toEqual([]);
  });

  it('lists the loaded app and sends list_changed when the manifest is stale', async () => {
    const manifest = await manifestOf(lazyServer(billingImport()));
    const stale: ServerManifest = {
      ...manifest,
      tools: manifest.tools.map((tool) =>
        tool.name === 'charge' ? { ...tool, description: 'An old description' } : tool,
      ),
    };
    const client = await track(connect(lazyServer(billingImport(), { manifest: stale })));
    const notifications: string[] = [];
    client.onNotification(({ method }) => notifications.push(method));

    const listed = await client.listTools();
    expect(JSON.stringify(listed)).toContain('An old description');

    await client.callTool('charge', { customer: 'acme', cents: 100 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(JSON.stringify(await client.listTools())).not.toContain('An old description');
    expect(notifications).toContain('notifications/tools/list_changed');
    expect(notifications).not.toContain('notifications/prompts/list_changed');
    expect(capturedLogs.map(({ message }) => message)).toContainEqual(
      expect.stringMatching(/App "billing" does not match frontmcp\.manifest\.json \(tools\).*frontmcp build/),
    );
  });

  it('answers a call to a tool the stale manifest lists but the app no longer has as an unknown tool', async () => {
    const manifest = await manifestOf(lazyServer(billingImport()));
    const charge = manifest.tools.find((tool) => tool.name === 'charge');
    if (!charge) throw new Error('the manifest lists no charge tool');
    const stale: ServerManifest = {
      ...manifest,
      tools: [...manifest.tools, { ...charge, name: 'payout', aliases: [] }],
    };
    const client = await track(connect(lazyServer(billingImport(), { manifest: stale })));

    const result = await client.callTool('payout', { customer: 'acme', cents: 1 });

    expect(result).toEqual(expect.objectContaining({ isError: true }));
    expect(JSON.stringify(result)).toMatch(/payout/);
    expect(JSON.stringify(await client.listTools())).not.toContain('payout');
  });
});
