import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  Adapter,
  App,
  DynamicAdapter,
  FlowHooksOf,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Tool,
  ToolContext,
  type FrontMcpAdapterResponse,
  type FrontMcpConfigInput,
  type LogRecord,
} from '../../common';
import { type DirectClient } from '../../direct/client.types';
import { connect } from '../../direct/connect';
import { type DirectMcpServer } from '../../direct/direct.types';
import { ToolAliasConflictError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const CallToolHook = FlowHooksOf('tools:call-tool');

@Tool({ name: 'get_ticket', inputSchema: { id: z.string() } })
class GetTicketTool extends ToolContext {
  async execute(input: { id: string }) {
    return { id: input.id, title: 'Printer on fire' };
  }
}

@Tool({ name: 'mail.send', inputSchema: {} })
class MailSendTool extends ToolContext {
  async execute() {
    return { sent: true };
  }
}

@Tool({ name: 'call_by_name', inputSchema: { name: z.string() } })
class CallByNameTool extends ToolContext {
  async execute(input: { name: string }) {
    const result = await this.callTool(input.name, input.name.includes('ticket') ? { id: 'T-1' } : {});
    return { result: result.structuredContent };
  }
}

@Tool({ name: 'purge_tickets', inputSchema: {}, visibility: 'internal' })
class PurgeTicketsTool extends ToolContext {
  async execute() {
    return { purged: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [GetTicketTool, MailSendTool, CallByNameTool, PurgeTicketsTool] })
class DeskApp {}

const serverConfig: FrontMcpConfigInput = {
  info: { name: 'call-tool-names', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off },
};

describe('this.callTool() tool names', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);
  });

  afterAll(async () => {
    await server.dispose();
  });

  it.each([['get_ticket'], ['desk:get_ticket'], ['desk.get_ticket'], ['desk.get-ticket']])(
    'finds a tool called %s',
    async (name) => {
      const result = await server.callTool('call_by_name', { name });

      expect(result.structuredContent).toEqual({ result: { id: 'T-1', title: 'Printer on fire' } });
    },
  );

  it('still finds a tool whose own name has a dot', async () => {
    const result = await server.callTool('call_by_name', { name: 'mail.send' });

    expect(result.structuredContent).toEqual({ result: { sent: true } });
  });
});

describe('tools/call tool names', () => {
  it.each([['get_ticket'], ['desk:get_ticket'], ['desk.get_ticket'], ['desk.get-ticket']])(
    'finds a tool called %s, as this.callTool() does',
    async (name) => {
      const client = await connect(serverConfig);
      const result = (await client.callTool(name, { id: 'T-1' })) as { structuredContent?: unknown };
      await client.close();

      expect(result.structuredContent).toEqual({ id: 'T-1', title: 'Printer on fire' });
    },
  );

  it('still answers an internal tool called owner.name like an unknown tool', async () => {
    const client = await connect(serverConfig);
    const result = (await client.callTool('desk.purge_tickets', {})) as { isError?: boolean; content?: unknown };
    await client.close();

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('not found');
  });
});

const capturedLogs: Array<{ levelName: string; line: string }> = [];

@LogTransport({ name: 'AliasCaptureLogger', description: 'Captures log records for the alias tests' })
class AliasCaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    capturedLogs.push({ levelName: record.levelName, line: [record.message, ...record.args].map(String).join(' ') });
  }
}

@Tool({ name: 'review_list', aliases: ['review.list', 'reviews', 'pending_reviews'], inputSchema: {} })
class ReviewListTool extends ToolContext {
  async execute() {
    return { tool: 'review_list' };
  }
}

@Tool({ name: 'list', inputSchema: {} })
class ListQueuesTool extends ToolContext {
  async execute() {
    return { tool: 'list' };
  }
}

@Tool({ name: 'call_review_tool', inputSchema: { name: z.string() } })
class CallReviewToolTool extends ToolContext {
  async execute(input: { name: string }) {
    const result = await this.callTool(input.name, {});
    return { result: result.structuredContent };
  }
}

@Tool({ name: 'deploy', aliases: ['ship'], inputSchema: {}, availableWhen: { env: ['production'] } })
class DeployTool extends ToolContext {
  async execute() {
    return { deployed: true };
  }
}

@App({ id: 'review', name: 'Review', tools: [ReviewListTool, ListQueuesTool, CallReviewToolTool, DeployTool] })
class ReviewApp {}

const aliasConfig: FrontMcpConfigInput = {
  info: { name: 'tool-aliases', version: '1.0.0' },
  apps: [ReviewApp],
  logging: { level: LogLevel.Info, enableConsole: false, transports: [AliasCaptureLogTransport] },
};

describe('tool aliases', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect(aliasConfig);
  });

  afterAll(async () => {
    await client.close();
  });

  it.each([['review.list'], ['reviews']])('calls review_list by its alias %s', async (name) => {
    const result = (await client.callTool(name, {})) as { structuredContent?: unknown };

    expect(result.structuredContent).toEqual({ tool: 'review_list' });
  });

  it('reads review.list as the alias before reading it as the owner name review:list', async () => {
    const byAlias = (await client.callTool('review.list', {})) as { structuredContent?: unknown };
    const byFullName = (await client.callTool('review:list', {})) as { structuredContent?: unknown };

    expect(byAlias.structuredContent).toEqual({ tool: 'review_list' });
    expect(byFullName.structuredContent).toEqual({ tool: 'list' });
  });

  it('resolves an alias in this.callTool()', async () => {
    const result = (await client.callTool('call_review_tool', { name: 'review.list' })) as {
      structuredContent?: unknown;
    };

    expect(result.structuredContent).toEqual({ result: { tool: 'review_list' } });
  });

  it('never lists an alias', async () => {
    const server = await FrontMcpInstance.createDirect(aliasConfig);
    const { tools } = await server.listTools();
    await server.dispose();

    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['review_list', 'list']));
    expect(names).not.toContain('review.list');
    expect(names).not.toContain('reviews');
  });

  it('logs a call by an alias once, at info level, naming the tool it reaches', async () => {
    capturedLogs.length = 0;

    await client.callTool('pending_reviews', {});
    await client.callTool('pending_reviews', {});

    const aliasLines = capturedLogs.filter(({ line }) => line.includes('"pending_reviews" is an alias'));
    expect(aliasLines).toHaveLength(1);
    expect(aliasLines[0].levelName).toBe('info');
    expect(aliasLines[0].line).toContain('"review_list"');
  });

  it('answers an alias of an unavailable tool as unavailable, with a remedy', async () => {
    const result = (await client.callTool('ship', {})) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
      _meta?: Record<string, unknown>;
    };

    expect(result.isError).toBe(true);
    expect(result._meta?.['code']).toBe('ENTRY_UNAVAILABLE');
    expect(result._meta?.['remedy']).toEqual({ say: 'Run the server where env is production to use this tool.' });
    expect(result.content?.[0]?.text).toContain('Run the server where env is production');
  });
});

function serverWith(...apps: Array<new () => unknown>): FrontMcpConfigInput {
  return { info: { name: 'tool-alias-conflicts', version: '1.0.0' }, apps, logging: { level: LogLevel.Off } };
}

describe('tool alias conflicts', () => {
  @Tool({ name: 'list_orders', aliases: ['orders.list'], inputSchema: {} })
  class ListOrdersTool extends ToolContext {
    async execute() {
      return {};
    }
  }

  @App({ id: 'orders', name: 'Orders', tools: [ListOrdersTool] })
  class OrdersApp {}

  it('fails startup when an alias is the name of a tool in another app', async () => {
    @Tool({ name: 'orders.list', inputSchema: {} })
    class DottedOrdersTool extends ToolContext {
      async execute() {
        return {};
      }
    }

    @App({ id: 'legacy', name: 'Legacy', tools: [DottedOrdersTool] })
    class LegacyApp {}

    const started = connect(serverWith(OrdersApp, LegacyApp));

    await expect(started).rejects.toThrow(ToolAliasConflictError);
    await expect(started).rejects.toThrow(
      /alias "orders\.list" of tool "list_orders" is the name of tool "orders\.list"/,
    );
  });

  it('fails startup when two tools in different apps declare one alias', async () => {
    @Tool({ name: 'search_orders', aliases: ['orders.list'], inputSchema: {} })
    class SearchOrdersTool extends ToolContext {
      async execute() {
        return {};
      }
    }

    @App({ id: 'search', name: 'Search', tools: [SearchOrdersTool] })
    class SearchApp {}

    await expect(connect(serverWith(OrdersApp, SearchApp))).rejects.toThrow(
      /alias "orders\.list" is declared by both "orders:list_orders" and "search:search_orders"/,
    );
  });

  it('fails startup when a tool lists its own name as an alias', async () => {
    @Tool({ name: 'ping', aliases: ['ping'], inputSchema: {} })
    class PingTool extends ToolContext {
      async execute() {
        return {};
      }
    }

    @App({ id: 'health', name: 'Health', tools: [PingTool] })
    class HealthApp {}

    await expect(connect(serverWith(HealthApp))).rejects.toThrow(ToolAliasConflictError);
  });

  it('refuses a runtime tool named like an alias', async () => {
    const server = await FrontMcpInstance.createDirect(serverWith(OrdersApp));

    const registration = server.registerTool({
      name: 'orders.list',
      inputSchema: { type: 'object', properties: {} },
      execute: () => ({ content: [] }),
    });

    await expect(registration).rejects.toThrow(ToolAliasConflictError);
    const { tools } = await server.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain('orders.list');
    await server.dispose();
  });

  it('rejects an empty alias where the tool is declared', () => {
    class BlankAliasTool extends ToolContext {
      async execute() {
        return {};
      }
    }

    expect(() => Tool({ name: 'blank', aliases: [''], inputSchema: {} })(BlankAliasTool)).toThrow(/alias/i);
  });

  it("refuses an adapter update whose tool takes another tool's name as an alias, and keeps the tools it had", async () => {
    @Tool({ name: 'count_orders', inputSchema: {} })
    class CountOrdersTool extends ToolContext {
      async execute() {
        return { tool: 'count_orders' };
      }
    }

    @Tool({ name: 'feed_orders', aliases: ['count_orders'], inputSchema: {} })
    class FeedOrdersTool extends ToolContext {
      async execute() {
        return { tool: 'feed_orders' };
      }
    }

    let publish: (response: FrontMcpAdapterResponse) => void = () => undefined;

    @Adapter({ name: 'orders-feed' })
    class OrdersFeedAdapter extends DynamicAdapter<{ name: string }> {
      constructor(readonly options: { name: string }) {
        super();
      }
      async fetch(): Promise<FrontMcpAdapterResponse> {
        return {};
      }
      onUpdate(callback: (response: FrontMcpAdapterResponse) => void): () => void {
        publish = callback;
        return () => undefined;
      }
    }

    @App({
      id: 'counts',
      name: 'Counts',
      tools: [CountOrdersTool],
      adapters: [OrdersFeedAdapter.init({ name: 'orders-feed' })],
    })
    class CountsApp {}

    const server = await FrontMcpInstance.createDirect(serverWith(CountsApp));

    expect(() => publish({ tools: [FeedOrdersTool] })).toThrow(ToolAliasConflictError);

    const result = (await server.callTool('count_orders', {})) as { structuredContent?: unknown };
    expect(result.structuredContent).toEqual({ tool: 'count_orders' });
    const { tools } = await server.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain('feed_orders');
    await server.dispose();
  });
  it('builds nothing from a refused adapter update, so a later update runs its tool hooks once', async () => {
    const hookRuns: string[] = [];

    @Tool({ name: 'count_stock', inputSchema: {} })
    class CountStockTool extends ToolContext {
      async execute() {
        return {};
      }
    }

    @Tool({ name: 'feed_stock', aliases: ['count_stock'], inputSchema: {} })
    class FeedStockTool extends ToolContext {
      async execute() {
        return {};
      }

      @CallToolHook.Will('execute')
      record() {
        hookRuns.push('feed_stock');
      }
    }

    let publish: (response: FrontMcpAdapterResponse) => void = () => undefined;

    @Adapter({ name: 'stock-feed' })
    class StockFeedAdapter extends DynamicAdapter<{ name: string }> {
      constructor(readonly options: { name: string }) {
        super();
      }
      async fetch(): Promise<FrontMcpAdapterResponse> {
        return { tools: [CountStockTool] };
      }
      onUpdate(callback: (response: FrontMcpAdapterResponse) => void): () => void {
        publish = callback;
        return () => undefined;
      }
    }

    @App({ id: 'stock', name: 'Stock', adapters: [StockFeedAdapter.init({ name: 'stock-feed' })] })
    class StockApp {}

    const server = await FrontMcpInstance.createDirect(serverWith(StockApp));

    expect(() => publish({ tools: [CountStockTool, FeedStockTool] })).toThrow(ToolAliasConflictError);
    publish({ tools: [FeedStockTool] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await server.callTool('feed_stock', {});

    expect(hookRuns).toEqual(['feed_stock']);
    await server.dispose();
  });
});
