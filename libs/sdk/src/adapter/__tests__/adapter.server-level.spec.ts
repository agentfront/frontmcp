/**
 * `@FrontMcp({ adapters })` registers what each adapter fetches on the server, for every app, as the
 * adapters docs show. The option was dropped by the config schema, so a server-level adapter was
 * never instantiated and its tools never listed (#678). Each server builds its own adapter from an
 * `init()` record, and disposing the server stops the polling and update subscription of its
 * adapters, server-level and app-level alike.
 */
import 'reflect-metadata';

import { type ReadResourceResult } from '@frontmcp/protocol';

import {
  Adapter,
  App,
  DynamicAdapter,
  frontMcpMetadataSchema,
  LogLevel,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
  type AdapterType,
  type FrontMcpAdapterResponse,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

interface StatusOptions {
  name: string;
  region: string;
}

let fetches = 0;

@Adapter({ name: 'status-api', description: 'Status tools from a fake API' })
class StatusAdapter extends DynamicAdapter<StatusOptions> {
  options: StatusOptions;

  constructor(options: StatusOptions) {
    super();
    this.options = options;
  }

  async fetch(): Promise<FrontMcpAdapterResponse> {
    fetches++;
    const { region } = this.options;

    @Tool({ name: `status_${region}`, inputSchema: {} })
    class RegionStatusTool extends ToolContext {
      async execute() {
        return { region, up: true };
      }
    }

    @Resource({ name: `status-${region}`, uri: `status://${region}` })
    class RegionStatusResource extends ResourceContext {
      async execute(uri: string): Promise<ReadResourceResult> {
        return { contents: [{ uri, text: `${region} is up` }] };
      }
    }

    return { tools: [RegionStatusTool], resources: [RegionStatusResource] };
  }
}

@Tool({ name: 'app_tool', inputSchema: {} })
class AppTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [AppTool] })
class DeskApp {}

describe('server-level adapters', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'server-adapters', version: '1.0.0' },
      apps: [DeskApp],
      adapters: [StatusAdapter.init({ name: 'status-eu', region: 'eu' })],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('keeps the option through the config schema', () => {
    const parsed = frontMcpMetadataSchema.parse({
      info: { name: 'x', version: '1' },
      apps: [DeskApp],
      adapters: [StatusAdapter.init({ name: 'status-us', region: 'us' })],
    });
    expect(parsed.adapters).toHaveLength(1);
  });

  it('lists the tools an adapter fetches next to the apps tools', async () => {
    const { tools } = await server.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['app_tool', 'status_eu']);
  });

  it('calls a tool the adapter fetched', async () => {
    const result = await server.callTool('status_eu', {});
    expect(result.structuredContent).toEqual({ region: 'eu', up: true });
  });

  it('reads a resource the adapter fetched', async () => {
    const result = await server.readResource('status://eu');
    expect((result.contents[0] as { text?: string }).text).toBe('eu is up');
  });

  it('fetches once for the server', () => {
    expect(fetches).toBe(1);
  });
});

interface FeedOptions {
  name: string;
  feed: string;
  failOn?: 'unsubscribe' | 'stopPolling';
}

const feedAdapters: FeedAdapter[] = [];

@Adapter({ name: 'feed-api', description: 'A feed that polls for changes' })
class FeedAdapter extends DynamicAdapter<FeedOptions> {
  options: FeedOptions;
  readonly events: string[] = [];
  private readonly listeners = new Set<(response: FrontMcpAdapterResponse) => void>();

  constructor(options: FeedOptions) {
    super();
    this.options = options;
    feedAdapters.push(this);
  }

  async fetch(): Promise<FrontMcpAdapterResponse> {
    this.events.push('fetch');
    return {};
  }

  onUpdate(callback: (response: FrontMcpAdapterResponse) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
      this.failIf('unsubscribe');
    };
  }

  startPolling(): void {
    this.events.push('start');
  }

  stopPolling(): void {
    this.events.push('stop');
    this.failIf('stopPolling');
  }

  private failIf(step: FeedOptions['failOn']): void {
    if (this.options.failOn === step) throw new Error(`${this.options.name}: ${step} failed`);
  }

  get subscribers(): number {
    return this.listeners.size;
  }
}

function serverWith(...adapters: AdapterType[]): Promise<DirectMcpServer> {
  return FrontMcpInstance.createDirect({
    info: { name: 'feed-server', version: '1.0.0' },
    apps: [DeskApp],
    adapters,
    logging: { level: LogLevel.Off },
  });
}

function feedAdapter(options: FeedOptions): { record: AdapterType; adapter: FeedAdapter } {
  const record = FeedAdapter.init(options);
  return { record, adapter: feedAdapters[feedAdapters.length - 1] };
}

describe('server-level adapter lifecycle', () => {
  it('stops polling and drops the update subscription when the server is disposed', async () => {
    const record = FeedAdapter.init({ name: 'feed-dispose', feed: 'dispose' });
    const adapter = feedAdapters[feedAdapters.length - 1];
    const server = await serverWith(record);

    expect(adapter.events).toEqual(['fetch', 'start']);
    expect(adapter.subscribers).toBe(1);

    await server.dispose();

    expect(adapter.events).toEqual(['fetch', 'start', 'stop']);
    expect(adapter.subscribers).toBe(0);
  });

  it("stops an app adapter's polling when the server is disposed", async () => {
    @App({ id: 'feeds', name: 'Feeds', adapters: [FeedAdapter.init({ name: 'feed-app', feed: 'app' })] })
    class FeedsApp {}
    const adapter = feedAdapters[feedAdapters.length - 1];
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'feed-app-server', version: '1.0.0' },
      apps: [FeedsApp],
      logging: { level: LogLevel.Off },
    });

    expect(adapter.events).toEqual(['fetch', 'start']);

    await server.dispose();

    expect(adapter.events).toEqual(['fetch', 'start', 'stop']);
    expect(adapter.subscribers).toBe(0);
  });

  it('builds an adapter of its own for each server that installs one init() record', async () => {
    const record = FeedAdapter.init({ name: 'feed-per-server', feed: 'shared-options' });
    const configured = feedAdapters[feedAdapters.length - 1];
    const first = await serverWith(record);
    const second = await serverWith(record);
    const rebuilt = feedAdapters[feedAdapters.length - 1];

    expect(rebuilt).not.toBe(configured);
    expect(rebuilt.options).toEqual(configured.options);
    expect(configured.events).toEqual(['fetch', 'start']);
    expect(rebuilt.events).toEqual(['fetch', 'start']);

    await first.dispose();
    expect(configured.events).toEqual(['fetch', 'start', 'stop']);
    expect(rebuilt.events).toEqual(['fetch', 'start']);

    await second.dispose();
    expect(rebuilt.events).toEqual(['fetch', 'start', 'stop']);
  });

  it('keeps a shared useValue adapter polling until the last server serving it is disposed', async () => {
    const shared = new FeedAdapter({ name: 'feed-shared', feed: 'shared' });
    const record = { provide: Symbol('feed-shared'), useValue: shared } as unknown as AdapterType;
    const first = await serverWith(record);
    const second = await serverWith(record);

    expect(shared.events).toEqual(['fetch', 'start', 'fetch']);
    expect(shared.subscribers).toBe(2);

    await first.dispose();
    expect(shared.events).toEqual(['fetch', 'start', 'fetch']);
    expect(shared.subscribers).toBe(1);

    await second.dispose();
    expect(shared.events).toEqual(['fetch', 'start', 'fetch', 'stop']);
    expect(shared.subscribers).toBe(0);
  });

  it('stops polling when the update unsubscribe throws', async () => {
    const { record, adapter } = feedAdapter({ name: 'feed-bad-unsubscribe', feed: 'u', failOn: 'unsubscribe' });
    const server = await serverWith(record);

    await server.dispose();

    expect(adapter.events).toEqual(['fetch', 'start', 'stop']);
    expect(adapter.subscribers).toBe(0);
  });

  it('stops the other adapters when one fails to stop polling', async () => {
    const failing = feedAdapter({ name: 'feed-bad-stop', feed: 's', failOn: 'stopPolling' });
    const healthy = feedAdapter({ name: 'feed-after-bad-stop', feed: 'h' });
    const server = await serverWith(failing.record, healthy.record);

    await server.dispose();

    expect(failing.adapter.events).toEqual(['fetch', 'start', 'stop']);
    expect(healthy.adapter.events).toEqual(['fetch', 'start', 'stop']);
    expect(healthy.adapter.subscribers).toBe(0);
  });
});

describe('several adapters installed together', () => {
  async function toolNamesOf(server: DirectMcpServer): Promise<string[]> {
    const { tools } = await server.listTools();
    return tools.map((tool) => tool.name).sort();
  }

  it('serves the tools of every adapter installed on the server', async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'two-server-adapters', version: '1.0.0' },
      apps: [DeskApp],
      adapters: [
        StatusAdapter.init({ name: 'status-ap', region: 'ap' }),
        StatusAdapter.init({ name: 'status-sa', region: 'sa' }),
      ],
      logging: { level: LogLevel.Off },
    });

    try {
      expect(await toolNamesOf(server)).toEqual(['app_tool', 'status_ap', 'status_sa']);
    } finally {
      await server.dispose();
    }
  });

  it('serves the tools of every adapter installed on one app', async () => {
    @App({
      id: 'regions',
      name: 'Regions',
      adapters: [
        StatusAdapter.init({ name: 'status-af', region: 'af' }),
        StatusAdapter.init({ name: 'status-oc', region: 'oc' }),
      ],
    })
    class RegionsApp {}
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'two-app-adapters', version: '1.0.0' },
      apps: [RegionsApp],
      logging: { level: LogLevel.Off },
    });

    try {
      expect(await toolNamesOf(server)).toEqual(['status_af', 'status_oc']);
    } finally {
      await server.dispose();
    }
  });
});
