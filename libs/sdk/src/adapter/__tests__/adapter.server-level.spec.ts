/**
 * `@FrontMcp({ adapters })` registers what each adapter fetches on the server, for every app, as the
 * adapters docs show. The option was dropped by the config schema, so a server-level adapter was
 * never instantiated and its tools never listed (#678).
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
