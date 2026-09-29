/**
 * Capability discovery follows list pagination to the end.
 *
 * A FrontMCP remote pages `tools/list` 40 at a time by default, so proxying
 * only the first page silently dropped every tool after the 40th.
 */
import { createMockLogger } from '../../__test-utils__/fixtures/flow.fixtures';
import { type FrontMcpLogger } from '../../common';
import { McpClientService } from '../mcp-client.service';
import { type McpClientConnection } from '../mcp-client.types';

type Page<K extends string> = Record<K, Array<Record<string, unknown>>> & { nextCursor?: string };
type ListFn<K extends string> = jest.Mock<Promise<Page<K>>, [({ cursor?: string } | undefined)?]>;

interface FakeClient {
  listTools: ListFn<'tools'>;
  listResources: ListFn<'resources'>;
  listResourceTemplates: ListFn<'resourceTemplates'>;
  listPrompts: ListFn<'prompts'>;
}

/** Two pages per list: the first carries `nextCursor: 'page-2'`. */
function twoPages<K extends string>(key: K, first: string[], second: string[]): ListFn<K> {
  return jest.fn(async (params?: { cursor?: string }) => {
    const names = params?.cursor === 'page-2' ? second : first;
    const page = { [key]: names.map((name) => ({ name, uri: `test://${name}`, uriTemplate: `test://${name}/{id}` })) };
    return (params?.cursor === 'page-2' ? page : { ...page, nextCursor: 'page-2' }) as Page<K>;
  });
}

function serviceWith(client: FakeClient): { service: McpClientService; logger: FrontMcpLogger } {
  const logger = createMockLogger();
  const service = new McpClientService(logger, { enableHealthCheck: false });
  const connection = { client, status: 'connected' } as unknown as McpClientConnection;
  (service as unknown as { connections: Map<string, McpClientConnection> }).connections.set('remote', connection);
  return { service, logger };
}

describe('McpClientService — list pagination', () => {
  it('collects every page of tools, resources, resource templates and prompts', async () => {
    const client: FakeClient = {
      listTools: twoPages('tools', ['t1', 't2'], ['t3']),
      listResources: twoPages('resources', ['r1'], ['r2']),
      listResourceTemplates: twoPages('resourceTemplates', ['rt1'], ['rt2']),
      listPrompts: twoPages('prompts', ['p1'], ['p2']),
    };
    const { service } = serviceWith(client);

    const capabilities = await service.discoverCapabilities('remote');

    expect(capabilities.tools.map((t) => t.name)).toEqual(['t1', 't2', 't3']);
    expect(capabilities.resources.map((r) => r.name)).toEqual(['r1', 'r2']);
    expect(capabilities.resourceTemplates.map((r) => r.name)).toEqual(['rt1', 'rt2']);
    expect(capabilities.prompts.map((p) => p.name)).toEqual(['p1', 'p2']);
    expect(client.listTools.mock.calls.map(([params]) => params)).toEqual([undefined, { cursor: 'page-2' }]);
  });

  it('gives up on a list whose cursor repeats, and says why', async () => {
    const client: FakeClient = {
      listTools: jest.fn(async () => ({ tools: [{ name: 'looping' }], nextCursor: 'stuck' })),
      listResources: twoPages('resources', ['r1'], ['r2']),
      listResourceTemplates: twoPages('resourceTemplates', [], []),
      listPrompts: twoPages('prompts', [], []),
    };
    const { service, logger } = serviceWith(client);

    const capabilities = await service.discoverCapabilities('remote');

    expect(capabilities.tools).toEqual([]);
    expect(capabilities.resources.map((r) => r.name)).toEqual(['r1', 'r2']);
    expect(client.listTools).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('tools/list returned the cursor "stuck" twice'));
  });
});
