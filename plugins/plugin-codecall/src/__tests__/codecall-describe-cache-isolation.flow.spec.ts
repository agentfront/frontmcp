/**
 * `codecall:describe` answers from the cache of the server it runs on (#647).
 *
 * Its result is cached for 60 seconds by the CachePlugin CodeCall installs, and that plugin's
 * memory store was created once, when the module loaded, so every server in the process shared
 * it. A server whose `includeTools` excludes a tool then served a describe another server had
 * cached, schema of the excluded tool included, to the same caller.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput } from '../codecall.types';

interface DescribeOutcome {
  tools: Array<{ name: string }>;
  notFound?: string[];
}

@Tool({ name: 'get_invoice', description: 'Returns an invoice', inputSchema: {} })
class GetInvoiceTool extends ToolContext {
  async execute() {
    return { invoice: 'INV-1' };
  }
}

@Tool({ name: 'purge_ledger', description: 'Deletes every ledger entry', inputSchema: {} })
class PurgeLedgerTool extends ToolContext {
  async execute() {
    return { purged: true };
  }
}

async function buildServer(codecallOptions: CodeCallPluginOptionsInput): Promise<DirectMcpServer> {
  @App({
    id: 'billing',
    name: 'Billing',
    tools: [GetInvoiceTool, PurgeLedgerTool],
    plugins: [CodeCallPlugin.init(codecallOptions)],
  })
  class BillingApp {}

  return FrontMcpInstance.createDirect({
    info: { name: 'codecall-describe-cache-isolation', version: '1.0.0' },
    apps: [BillingApp],
    logging: { level: LogLevel.Off },
  });
}

async function describeTools(server: DirectMcpServer, toolNames: string[]): Promise<DescribeOutcome> {
  const result = await server.callTool('codecall:describe', { toolNames });
  return result.structuredContent as unknown as DescribeOutcome;
}

describe('codecall:describe — cached per server (#647)', () => {
  let everything: DirectMcpServer;
  let restricted: DirectMcpServer;

  beforeEach(async () => {
    everything = await buildServer({});
    restricted = await buildServer({ includeTools: (tool) => tool.name !== 'purge_ledger' });
  });

  afterEach(async () => {
    await everything.dispose();
    await restricted.dispose();
  });

  it('does not describe a tool the server excludes after another server described it', async () => {
    await describeTools(everything, ['purge_ledger']);

    await expect(describeTools(restricted, ['purge_ledger'])).resolves.toEqual({
      tools: [],
      notFound: ['purge_ledger'],
    });
  });

  it('still describes the tool on the server that includes it', async () => {
    await describeTools(restricted, ['purge_ledger']);
    const described = await describeTools(everything, ['purge_ledger']);

    expect(described.tools.map((tool) => tool.name)).toEqual(['purge_ledger']);
  });
});
